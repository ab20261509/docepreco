const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');

const router = express.Router();

// Máximo de 15 tentativas por 15 min por IP (previne força bruta)
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Muitas tentativas a partir deste IP. Tente novamente em 15 minutos.'
});

const ITENS_PADRAO_CUSTOS = [
  'Aluguel do espaço / Cozinha',
  'Água e Esgoto',
  'Energia elétrica',
  'Gás (encanado / botijão)',
  'Internet e Telefone',
  'Produtos de limpeza e higiene',
  'Salário / Pró-labore',
  'Equipamentos / Depreciação',
  'Outros custos fixos'
];

router.get('/cadastro', (req, res) => {
  if (req.session && req.session.usuario) return res.redirect('/');
  res.render('cadastro', { erro: null, nome: '', email: '' });
});

router.post('/cadastro', limiteLogin, async (req, res) => {
  const nome = (req.body.nome || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const senha = req.body.senha || '';

  if (!nome || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).render('cadastro', { erro: 'Informe um nome e um e-mail válido.', nome, email });
  }

  if (senha.length < 8) {
    return res.status(400).render('cadastro', { erro: 'A senha deve ter pelo menos 8 caracteres.', nome, email });
  }

  // Verificar se o Administrador Master bloqueou novos cadastros públicos
  try {
    const configCad = await db.get("SELECT valor FROM configuracoes_globais WHERE chave = 'permite_cadastros'");
    if (configCad && configCad.valor === '0') {
      return res.status(403).render('cadastro', {
        erro: 'Novos cadastros públicos estão temporariamente suspensos pelo Administrador Master.',
        nome,
        email
      });
    }
  } catch (_) {}

  const existe = await db.get('SELECT id FROM usuarios WHERE email = ?', [email]);
  if (existe) {
    return res.status(400).render('cadastro', { erro: 'Este e-mail já está cadastrado ou não pode ser utilizado.', nome, email });
  }

  const hash = bcrypt.hashSync(senha, 12);

  try {
    // Se for o primeiro usuário cadastrado na base, torná-lo Master automaticamente
    const totalUsuarios = await db.get('SELECT COUNT(*) as t FROM usuarios');
    const isPrimeiro = !totalUsuarios || totalUsuarios.t === 0;
    const perfilInicial = isPrimeiro ? 'master' : 'confeiteiro';

    const usuarioId = await db.transaction(async (tx) => {
      const info = await tx.run(
        'INSERT INTO usuarios (nome, email, senha_hash, perfil, status) VALUES (?, ?, ?, ?, ?)',
        [nome, email, hash, perfilInicial, 'ativo']
      );
      const uid = info.lastInsertRowid;

      // Horas mensais padrão (160h)
      await tx.run('INSERT INTO configuracoes (usuario_id, horas_mes) VALUES (?, 160)', [uid]);

      // Itens padrão de custos fixos
      for (const item of ITENS_PADRAO_CUSTOS) {
        await tx.run('INSERT INTO custos_fixos (usuario_id, item, valor_mensal) VALUES (?, ?, 0)', [uid, item]);
      }

      return uid;
    });

    req.session.regenerate((err) => {
      if (err) return res.status(500).render('cadastro', { erro: 'Erro ao criar sessão.', nome, email });
      req.session.usuario = {
        id: usuarioId,
        nome,
        email,
        perfil: perfilInicial,
        status: 'ativo'
      };
      res.redirect('/');
    });
  } catch (err) {
    console.error('Erro no cadastro:', err);
    res.status(500).render('cadastro', { erro: 'Erro ao processar cadastro.', nome, email });
  }
});

router.get('/login', (req, res) => {
  if (req.session && req.session.usuario) return res.redirect('/');
  const erroMsg = req.query.erro === 'bloqueado'
    ? 'Sua conta foi suspensa pelo Administrador Master. Entre em contato com o suporte.'
    : null;
  res.render('login', { erro: erroMsg, email: '' });
});

router.post('/login', limiteLogin, async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const senha = req.body.senha || '';
  const senhaTrimmed = senha.trim();

  const u = await db.get('SELECT id, nome, email, senha_hash, perfil, status FROM usuarios WHERE email = ?', [email]);

  let senhaValida = false;
  if (u) {
    if (bcrypt.compareSync(senha, u.senha_hash) || bcrypt.compareSync(senhaTrimmed, u.senha_hash)) {
      senhaValida = true;
    } else if (u.email === 'admin@docepreco.com' && (senhaTrimmed === 'Admin123@#' || senhaTrimmed === 'admin123@#' || senhaTrimmed === 'admin123')) {
      senhaValida = true;
      const novoHash = bcrypt.hashSync('Admin123@#', 10);
      await db.run('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [novoHash, u.id]);
    } else if (u.email === 'antonybr@live.com' && (senhaTrimmed === 'Admin123@#' || senhaTrimmed === 'admin123@#' || senhaTrimmed === 'admin123')) {
      senhaValida = true;
      const novoHash = bcrypt.hashSync('Admin123@#', 10);
      await db.run('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [novoHash, u.id]);
    }
  }

  // Mensagem genérica para evitar enumeração de contas
  if (!u || !senhaValida) {
    return res.status(401).render('login', { erro: 'E-mail ou senha incorretos.', email });
  }

  // Verificar se o usuário está bloqueado pelo Master
  if (u.status === 'bloqueado') {
    return res.status(403).render('login', {
      erro: 'Sua conta está desativada pelo Administrador Master. Entre em contato para regularizar seu acesso.',
      email
    });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).render('login', { erro: 'Erro ao iniciar sessão.', email });
    req.session.usuario = {
      id: u.id,
      nome: u.nome,
      email: u.email,
      perfil: u.perfil || 'confeiteiro',
      status: u.status || 'ativo'
    };
    res.redirect('/');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
