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

router.post('/cadastro', limiteLogin, (req, res) => {
  const nome = (req.body.nome || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const senha = req.body.senha || '';

  if (!nome || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).render('cadastro', { erro: 'Informe um nome e um e-mail válido.', nome, email });
  }

  if (senha.length < 8) {
    return res.status(400).render('cadastro', { erro: 'A senha deve ter pelo menos 8 caracteres.', nome, email });
  }

  const existe = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
  if (existe) {
    return res.status(400).render('cadastro', { erro: 'Este e-mail já está cadastrado ou não pode ser utilizado.', nome, email });
  }

  const hash = bcrypt.hashSync(senha, 12);

  const criarUsuarioTx = db.transaction(() => {
    const info = db.prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)')
                   .run(nome, email, hash);
    const usuarioId = info.lastInsertRowid;

    // Horas mensais padrão (160h)
    db.prepare('INSERT INTO configuracoes (usuario_id, horas_mes) VALUES (?, 160)')
      .run(usuarioId);

    // Itens padrão de custos fixos
    const stmtCusto = db.prepare('INSERT INTO custos_fixos (usuario_id, item, valor_mensal) VALUES (?, ?, 0)');
    for (const item of ITENS_PADRAO_CUSTOS) {
      stmtCusto.run(usuarioId, item);
    }

    return usuarioId;
  });

  const usuarioId = criarUsuarioTx();

  req.session.regenerate((err) => {
    if (err) return res.status(500).render('cadastro', { erro: 'Erro ao criar sessão.', nome, email });
    req.session.usuario = { id: usuarioId, nome, email };
    res.redirect('/');
  });
});

router.get('/login', (req, res) => {
  if (req.session && req.session.usuario) return res.redirect('/');
  res.render('login', { erro: null, email: '' });
});

router.post('/login', limiteLogin, (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const senha = req.body.senha || '';

  const u = db.prepare('SELECT id, nome, email, senha_hash FROM usuarios WHERE email = ?').get(email);

  // Mensagem genérica para evitar enumeração de contas
  if (!u || !bcrypt.compareSync(senha, u.senha_hash)) {
    return res.status(401).render('login', { erro: 'E-mail ou senha incorretos.', email });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).render('login', { erro: 'Erro ao iniciar sessão.', email });
    req.session.usuario = { id: u.id, nome: u.nome, email: u.email };
    res.redirect('/');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
