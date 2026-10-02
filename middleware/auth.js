const db = require('../db');

function exigirLogin(req, res, next) {
  if (!req.session || !req.session.usuario) {
    return res.redirect('/login');
  }

  // Se a conta do usuário foi bloqueada pelo Administrador Master
  if (req.session.usuario.status === 'bloqueado') {
    req.session.destroy(() => {
      res.redirect('/login?erro=bloqueado');
    });
    return;
  }

  next();
}

function exigirMaster(req, res, next) {
  exigirLogin(req, res, () => {
    if (req.session.usuario.perfil !== 'master') {
      return res.status(403).render('erro_403', {
        mensagem: 'Acesso restrito ao Administrador Master do sistema.',
        activeNav: ''
      });
    }
    next();
  });
}

/**
 * Middleware para carregar a matriz de permissões do usuário logado
 * e disponibilizar o helper `pode(modulo, acao)` para views e rotas
 */
async function carregarPermissoes(req, res, next) {
  if (!req.session || !req.session.usuario) {
    res.locals.pode = () => false;
    res.locals.isMaster = false;
    res.locals.onboardingGuias = {};
    return next();
  }

  const usuario = req.session.usuario;
  const isMaster = usuario.perfil === 'master';
  res.locals.isMaster = isMaster;

  const onboardingGuias = {
    geral: 'pendente',
    custos: 'pendente',
    ingredientes: 'pendente',
    produtos: 'pendente',
    pedidos: 'pendente'
  };

  try {
    const obRows = await db.all('SELECT modulo, status FROM usuario_onboardings WHERE usuario_id = ?', [usuario.id]);
    if (obRows && obRows.length > 0) {
      obRows.forEach(r => {
        onboardingGuias[r.modulo] = r.status;
      });
    }
  } catch (_) {}

  res.locals.onboardingGuias = onboardingGuias;
  req.onboardingGuias = onboardingGuias;

  // Master tem permissão total em tudo
  if (isMaster) {
    const fnSemprePode = () => true;
    req.pode = fnSemprePode;
    res.locals.pode = fnSemprePode;
    return next();
  }

  try {
    // Buscar permissões específicas gravadas para este usuário
    const perms = await db.all(`
      SELECT modulo, pode_ver, pode_criar, pode_editar, pode_excluir
      FROM permissoes_usuario
      WHERE usuario_id = ?
    `, [usuario.id]);

    const mapaPermissoes = {};
    perms.forEach(p => {
      mapaPermissoes[p.modulo] = {
        ver: Boolean(p.pode_ver),
        criar: Boolean(p.pode_criar),
        editar: Boolean(p.pode_editar),
        excluir: Boolean(p.pode_excluir)
      };
    });

    const fnPode = (modulo, acao = 'ver') => {
      // Master do sistema é exclusivo
      if (modulo === 'master') return false;

      // Se o módulo foi configurado na tabela, respeitar as escolhas do Master
      if (mapaPermissoes[modulo]) {
        return Boolean(mapaPermissoes[modulo][acao]);
      }

      // Caso o usuário ainda não tenha registro na tabela (permissão padrão de confeiteiro)
      return true;
    };

    req.pode = fnPode;
    res.locals.pode = fnPode;
    req.mapaPermissoes = mapaPermissoes;
    next();
  } catch (err) {
    console.error('Erro ao carregar permissões do usuário:', err);
    res.locals.pode = () => true;
    req.pode = () => true;
    next();
  }
}

/**
 * Middleware para proteger rotas por módulo e ação (ver, criar, editar, excluir)
 */
function exigirPermissao(modulo, acao = 'ver') {
  return (req, res, next) => {
    exigirLogin(req, res, () => {
      if (typeof req.pode === 'function' && !req.pode(modulo, acao)) {
        const nomesAcoes = {
          ver: 'visualizar',
          criar: 'inserir novos registros em',
          editar: 'editar registros em',
          excluir: 'excluir registros em'
        };
        const acaoTxt = nomesAcoes[acao] || acao;

        return res.status(403).render('erro_403', {
          mensagem: `Você não possui permissão para ${acaoTxt} no módulo de ${modulo}. Solicite acesso ao Administrador Master.`,
          activeNav: ''
        });
      }
      next();
    });
  };
}

module.exports = {
  exigirLogin,
  exigirMaster,
  carregarPermissoes,
  exigirPermissao
};
