const express = require('express');
const db = require('../db');
const { exigirLogin } = require('../middleware/auth');

const router = express.Router();

// Função auxiliar para gerar link do WhatsApp
function gerarLinkWhatsApp(telefone) {
  if (!telefone) return null;
  const digitos = telefone.replace(/\D/g, '');
  if (!digitos || digitos.length < 10) return null;
  const ddi = digitos.length <= 11 ? '55' : '';
  return `https://wa.me/${ddi}${digitos}`;
}

// Formatar telefone para exibição (ex: (11) 99999-9999)
function formatarTelefone(telefone) {
  if (!telefone) return '';
  const d = telefone.replace(/\D/g, '');
  if (d.length === 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  } else if (d.length === 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  }
  return telefone;
}

// 1. Listagem de Clientes
router.get('/', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;

  const clientes = db.prepare(`
    SELECT * FROM clientes
    WHERE usuario_id = ?
    ORDER BY nome ASC
  `).all(uid);

  const listaFormatada = clientes.map(c => ({
    ...c,
    telefoneFormatado: formatarTelefone(c.telefone),
    waLink: gerarLinkWhatsApp(c.telefone)
  }));

  res.render('clientes', {
    clientes: listaFormatada,
    totalClientes: clientes.length,
    sucesso: req.query.sucesso === '1',
    activeNav: 'clientes',
    activeModulo: 'comercial'
  });
});

// 2. Cadastrar Novo Cliente
router.post('/', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;
  const nome = (req.body.nome || '').trim();
  const telefone = (req.body.telefone || '').trim();
  const email = (req.body.email || '').trim();
  const endereco = (req.body.endereco || '').trim();
  const bairro = (req.body.bairro || '').trim();
  const cidade = (req.body.cidade || '').trim();
  const observacoes = (req.body.observacoes || '').trim();

  if (!nome) {
    return res.status(400).send('O nome do cliente é obrigatório.');
  }

  try {
    db.prepare(`
      INSERT INTO clientes 
      (usuario_id, nome, telefone, email, endereco, bairro, cidade, observacoes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uid, nome, telefone || null, email || null, endereco || null, bairro || null, cidade || null, observacoes || null);

    res.redirect('/clientes?sucesso=1');
  } catch (err) {
    console.error('Erro ao cadastrar cliente:', err);
    res.status(500).send('Erro ao cadastrar cliente.');
  }
});

// 3. Editar Cliente Existente
router.post('/:id/editar', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;
  const id = parseInt(req.params.id, 10);
  const nome = (req.body.nome || '').trim();
  const telefone = (req.body.telefone || '').trim();
  const email = (req.body.email || '').trim();
  const endereco = (req.body.endereco || '').trim();
  const bairro = (req.body.bairro || '').trim();
  const cidade = (req.body.cidade || '').trim();
  const observacoes = (req.body.observacoes || '').trim();

  if (!nome) {
    return res.status(400).send('O nome do cliente é obrigatório.');
  }

  try {
    db.prepare(`
      UPDATE clientes
      SET nome = ?, telefone = ?, email = ?, endereco = ?, bairro = ?, cidade = ?, observacoes = ?
      WHERE id = ? AND usuario_id = ?
    `).run(nome, telefone || null, email || null, endereco || null, bairro || null, cidade || null, observacoes || null, id, uid);

    res.redirect('/clientes?sucesso=1');
  } catch (err) {
    console.error('Erro ao editar cliente:', err);
    res.status(500).send('Erro ao editar cliente.');
  }
});

// 4. Excluir Cliente
router.post('/:id/excluir', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;
  const id = parseInt(req.params.id, 10);

  try {
    db.prepare('DELETE FROM clientes WHERE id = ? AND usuario_id = ?').run(id, uid);
    res.redirect('/clientes?sucesso=1');
  } catch (err) {
    console.error('Erro ao excluir cliente:', err);
    res.status(500).send('Erro ao excluir cliente.');
  }
});

// 5. API de Busca Rápida (para autocomplete em pedidos/orçamentos)
router.get('/api/buscar', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;
  const termo = (req.query.q || '').trim();

  if (!termo) {
    const todos = db.prepare(`
      SELECT id, nome, telefone, endereco, bairro, cidade 
      FROM clientes WHERE usuario_id = ? ORDER BY nome ASC LIMIT 15
    `).all(uid);
    return res.json(todos);
  }

  const like = `%${termo}%`;
  const resultados = db.prepare(`
    SELECT id, nome, telefone, endereco, bairro, cidade 
    FROM clientes 
    WHERE usuario_id = ? AND (nome LIKE ? OR telefone LIKE ? OR bairro LIKE ?)
    ORDER BY nome ASC LIMIT 10
  `).all(uid, like, like, like);

  res.json(resultados);
});

module.exports = router;
module.exports.gerarLinkWhatsApp = gerarLinkWhatsApp;
module.exports.formatarTelefone = formatarTelefone;
