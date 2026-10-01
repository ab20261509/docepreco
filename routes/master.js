const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { exigirMaster } = require('../middleware/auth');

const router = express.Router();

const MODULOS_SISTEMA = [
  { id: 'produtos', nome: '🧁 Produtos & Precificação', desc: 'Fichas técnicas, receitas e margens de lucro' },
  { id: 'ingredientes', nome: '🥣 Insumos & Estoque', desc: 'Catálogo de ingredientes, compras e validades' },
  { id: 'custos', nome: '🏢 Custos Fixos', desc: 'Despesas da estrutura e custo da hora trabalhada' },
  { id: 'producao', nome: '🍳 Modo Cozinha & Produção', desc: 'Pesagem guiada, timers de forno e lotes de preparo' },
  { id: 'pedidos', nome: '📝 Pedidos & Orçamentos', desc: 'Vendas, controle de sinais e envio via WhatsApp' },
  { id: 'agenda', nome: '📅 Agenda de Entregas', desc: 'Cronograma operacional e calendário de entregas' },
  { id: 'compras', nome: '🛒 Planejamento de Compras', desc: 'Cálculo inteligente de insumos para encomendas' },
  { id: 'clientes', nome: '👥 Cadastro de Clientes', desc: 'Base de contatos, histórico e endereços' },
  { id: 'assistente', nome: '💬 Assistente Virtual (IA)', desc: 'DoceIA para dúvidas operacionais e estoque' }
];

// Todas as rotas deste router exigem privilégio Master
router.use(exigirMaster);

// 1. Dashboard Master: Visão 360° da Plataforma
router.get('/', async (req, res, next) => {
  try {
    const [
      totalUsuariosRow,
      usuariosAtivosRow,
      usuariosBloqueadosRow,
      totalMastersRow,
      totalReceitasRow,
      totalPedidosRow,
      volumeTotalRow,
      totalClientesRow,
      totalProducoesRow,
      ultimosUsuarios,
      configuracoes
    ] = await Promise.all([
      db.get('SELECT COUNT(*) as t FROM usuarios'),
      db.get("SELECT COUNT(*) as t FROM usuarios WHERE status = 'ativo'"),
      db.get("SELECT COUNT(*) as t FROM usuarios WHERE status = 'bloqueado'"),
      db.get("SELECT COUNT(*) as t FROM usuarios WHERE perfil = 'master'"),
      db.get('SELECT COUNT(*) as t FROM produtos'),
      db.get('SELECT COUNT(*) as t FROM pedidos'),
      db.get("SELECT COALESCE(SUM(valor_total), 0) as t FROM pedidos WHERE status != 'cancelado'"),
      db.get('SELECT COUNT(*) as t FROM clientes'),
      db.get("SELECT COUNT(*) as t FROM producoes WHERE status = 'concluido'"),
      db.all(`
        SELECT u.id, u.nome, u.email, u.perfil, u.status, u.criado_em,
               (SELECT COUNT(*) FROM produtos WHERE usuario_id = u.id) as total_produtos,
               (SELECT COUNT(*) FROM pedidos WHERE usuario_id = u.id) as total_pedidos
        FROM usuarios u
        ORDER BY u.id DESC
        LIMIT 6
      `),
      db.all('SELECT chave, valor FROM configuracoes_globais')
    ]);

    const mapaConfigs = {};
    configuracoes.forEach(c => {
      mapaConfigs[c.chave] = c.valor;
    });

    res.render('master/painel', {
      kpis: {
        totalUsuarios: totalUsuariosRow ? totalUsuariosRow.t : 0,
        usuariosAtivos: usuariosAtivosRow ? usuariosAtivosRow.t : 0,
        usuariosBloqueados: usuariosBloqueadosRow ? usuariosBloqueadosRow.t : 0,
        totalMasters: totalMastersRow ? totalMastersRow.t : 0,
        totalReceitas: totalReceitasRow ? totalReceitasRow.t : 0,
        totalPedidos: totalPedidosRow ? totalPedidosRow.t : 0,
        volumeTotal: volumeTotalRow ? volumeTotalRow.t : 0,
        totalClientes: totalClientesRow ? totalClientesRow.t : 0,
        totalProducoes: totalProducoesRow ? totalProducoesRow.t : 0
      },
      ultimosUsuarios,
      configs: mapaConfigs,
      activeNav: 'master'
    });
  } catch (err) {
    next(err);
  }
});

// 2. Gestão de Usuários: Listagem Completa com Filtros
router.get('/usuarios', async (req, res, next) => {
  try {
    const termoBusca = (req.query.q || '').trim().toLowerCase();
    const filtroPerfil = req.query.perfil || '';
    const filtroStatus = req.query.status || '';

    let sql = `
      SELECT u.id, u.nome, u.email, u.perfil, u.status, u.criado_em,
             (SELECT COUNT(*) FROM produtos WHERE usuario_id = u.id) as total_produtos,
             (SELECT COUNT(*) FROM pedidos WHERE usuario_id = u.id) as total_pedidos
      FROM usuarios u
      WHERE 1=1
    `;
    const params = [];

    if (termoBusca) {
      sql += ' AND (LOWER(u.nome) LIKE ? OR LOWER(u.email) LIKE ?)';
      params.push(`%${termoBusca}%`, `%${termoBusca}%`);
    }

    if (filtroPerfil) {
      sql += ' AND u.perfil = ?';
      params.push(filtroPerfil);
    }

    if (filtroStatus) {
      sql += ' AND u.status = ?';
      params.push(filtroStatus);
    }

    sql += ' ORDER BY u.id DESC';

    const usuarios = await db.all(sql, params);

    res.render('master/usuarios', {
      usuarios,
      termoBusca,
      filtroPerfil,
      filtroStatus,
      activeNav: 'master_usuarios'
    });
  } catch (err) {
    next(err);
  }
});

// 3. Matriz de Permissões RBAC de um Usuário
router.get('/usuarios/:id/permissoes', async (req, res, next) => {
  try {
    const usuarioAlvoId = parseInt(req.params.id, 10);
    const usuarioAlvo = await db.get('SELECT id, nome, email, perfil, status, criado_em FROM usuarios WHERE id = ?', [usuarioAlvoId]);

    if (!usuarioAlvo) {
      return res.status(404).render('erro_404', { mensagem: 'Usuário não encontrado.' });
    }

    // Carregar permissões atuais deste usuário
    const permsGravadas = await db.all(`
      SELECT modulo, pode_ver, pode_criar, pode_editar, pode_excluir
      FROM permissoes_usuario
      WHERE usuario_id = ?
    `, [usuarioAlvoId]);

    const mapaPerms = {};
    permsGravadas.forEach(p => {
      mapaPerms[p.modulo] = {
        pode_ver: Boolean(p.pode_ver),
        pode_criar: Boolean(p.pode_criar),
        pode_editar: Boolean(p.pode_editar),
        pode_excluir: Boolean(p.pode_excluir)
      };
    });

    res.render('master/permissoes', {
      usuarioAlvo,
      modulos: MODULOS_SISTEMA,
      mapaPerms,
      sucessoMsg: req.query.sucesso ? 'Permissões atualizadas com sucesso!' : null,
      activeNav: 'master_usuarios'
    });
  } catch (err) {
    next(err);
  }
});

// 4. Salvar Matriz de Permissões do Usuário
router.post('/usuarios/:id/permissoes', async (req, res, next) => {
  try {
    const usuarioAlvoId = parseInt(req.params.id, 10);
    const usuarioAlvo = await db.get('SELECT id FROM usuarios WHERE id = ?', [usuarioAlvoId]);

    if (!usuarioAlvo) {
      return res.status(404).render('erro_404', { mensagem: 'Usuário não encontrado.' });
    }

    const permissoesBody = req.body.permissoes || {};

    await db.transaction(async (tx) => {
      // Limpar permissões anteriores deste usuário
      await tx.run('DELETE FROM permissoes_usuario WHERE usuario_id = ?', [usuarioAlvoId]);

      // Inserir cada módulo com suas opções selecionadas
      for (const mod of MODULOS_SISTEMA) {
        const item = permissoesBody[mod.id] || {};
        const podeVer = item.ver === '1' ? 1 : 0;
        const podeCriar = item.criar === '1' ? 1 : 0;
        const podeEditar = item.editar === '1' ? 1 : 0;
        const podeExcluir = item.excluir === '1' ? 1 : 0;

        await tx.run(`
          INSERT INTO permissoes_usuario (usuario_id, modulo, pode_ver, pode_criar, pode_editar, pode_excluir)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [usuarioAlvoId, mod.id, podeVer, podeCriar, podeEditar, podeExcluir]);
      }
    });

    res.redirect(`/master/usuarios/${usuarioAlvoId}/permissoes?sucesso=1`);
  } catch (err) {
    next(err);
  }
});

// 5. Alternar Status do Usuário (Ativo <-> Bloqueado)
router.post('/usuarios/:id/status', async (req, res, next) => {
  try {
    const usuarioAlvoId = parseInt(req.params.id, 10);
    const masterLogadoId = req.session.usuario.id;

    // Impedir que o Master bloqueie a si mesmo acidentalmente
    if (usuarioAlvoId === masterLogadoId) {
      return res.status(400).send('Você não pode bloquear o seu próprio usuário master.');
    }

    const usuario = await db.get('SELECT id, status FROM usuarios WHERE id = ?', [usuarioAlvoId]);
    if (!usuario) {
      return res.status(404).send('Usuário não encontrado.');
    }

    const novoStatus = usuario.status === 'ativo' ? 'bloqueado' : 'ativo';
    await db.run('UPDATE usuarios SET status = ? WHERE id = ?', [novoStatus, usuarioAlvoId]);

    res.redirect('back');
  } catch (err) {
    next(err);
  }
});

// 6. Alternar Perfil do Usuário (Confeiteiro <-> Master)
router.post('/usuarios/:id/perfil', async (req, res, next) => {
  try {
    const usuarioAlvoId = parseInt(req.params.id, 10);
    const masterLogadoId = req.session.usuario.id;

    if (usuarioAlvoId === masterLogadoId) {
      return res.status(400).send('Você não pode alterar o seu próprio perfil de master.');
    }

    const usuario = await db.get('SELECT id, perfil FROM usuarios WHERE id = ?', [usuarioAlvoId]);
    if (!usuario) {
      return res.status(404).send('Usuário não encontrado.');
    }

    const novoPerfil = usuario.perfil === 'master' ? 'confeiteiro' : 'master';
    await db.run('UPDATE usuarios SET perfil = ? WHERE id = ?', [novoPerfil, usuarioAlvoId]);

    res.redirect('back');
  } catch (err) {
    next(err);
  }
});

// 7. Redefinir Senha do Usuário pelo Master
router.post('/usuarios/:id/redefinir-senha', async (req, res, next) => {
  try {
    const usuarioAlvoId = parseInt(req.params.id, 10);
    const novaSenha = (req.body.nova_senha || '').trim();

    if (novaSenha.length < 8) {
      return res.status(400).send('A nova senha deve ter no mínimo 8 caracteres.');
    }

    const hash = bcrypt.hashSync(novaSenha, 12);
    await db.run('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [hash, usuarioAlvoId]);

    res.redirect('back');
  } catch (err) {
    next(err);
  }
});

// 8. Configurações Globais do Sistema
router.get('/configuracoes', async (req, res, next) => {
  try {
    const configs = await db.all('SELECT chave, valor, descricao, atualizado_em FROM configuracoes_globais');
    const mapa = {};
    configs.forEach(c => {
      mapa[c.chave] = c.valor;
    });

    res.render('master/configuracoes', {
      configs: mapa,
      sucessoMsg: req.query.sucesso ? 'Configurações globais salvas com sucesso!' : null,
      activeNav: 'master_configuracoes'
    });
  } catch (err) {
    next(err);
  }
});

// 9. Salvar Configurações Globais
router.post('/configuracoes', async (req, res, next) => {
  try {
    const {
      nome_sistema,
      modo_manutencao,
      permite_cadastros,
      aviso_geral_banner,
      gemini_api_key_global
    } = req.body;

    const updates = [
      { chave: 'nome_sistema', valor: (nome_sistema || 'DocePreço').trim() },
      { chave: 'modo_manutencao', valor: modo_manutencao === '1' ? '1' : '0' },
      { chave: 'permite_cadastros', valor: permite_cadastros === '1' ? '1' : '0' },
      { chave: 'aviso_geral_banner', valor: (aviso_geral_banner || '').trim() },
      { chave: 'gemini_api_key_global', valor: (gemini_api_key_global || '').trim() }
    ];

    await db.transaction(async (tx) => {
      for (const item of updates) {
        await tx.run(`
          INSERT INTO configuracoes_globais (chave, valor, atualizado_em)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em
        `, [item.chave, item.valor]);
      }
    });

    res.redirect('/master/configuracoes?sucesso=1');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.MODULOS_SISTEMA = MODULOS_SISTEMA;
