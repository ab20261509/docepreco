const express = require('express');
const db = require('../db');
const { exigirLogin } = require('../middleware/auth');
const assistenteIa = require('../services/assistente_ia');

const router = express.Router();

// 1. Tela Completa do Assistente
router.get('/', exigirLogin, async (req, res, next) => {
  try {
    const uid = req.session.usuario.id;
    const historico = await db.all(`
      SELECT id, papel, conteudo, criado_em
      FROM chat_mensagens
      WHERE usuario_id = ?
      ORDER BY id ASC
      LIMIT 50
    `, [uid]);

    const contexto = await assistenteIa.coletarContextoUsuario(db, uid);

    res.render('assistente', {
      historico,
      contexto,
      temApiKey: Boolean((process.env.GEMINI_API_KEY || '').trim()),
      activeNav: 'assistente',
      activeModulo: 'assistente'
    });
  } catch (err) {
    next(err);
  }
});

// 2. Obter Histórico via JSON (para o Drawer Flutuante)
router.get('/historico', exigirLogin, async (req, res) => {
  try {
    const uid = req.session.usuario.id;
    const mensagens = await db.all(`
      SELECT id, papel, conteudo, criado_em
      FROM chat_mensagens
      WHERE usuario_id = ?
      ORDER BY id ASC
      LIMIT 60
    `, [uid]);

    res.json({ sucesso: true, mensagens });
  } catch (err) {
    console.error('Erro ao carregar histórico do chat:', err);
    res.status(500).json({ sucesso: false, erro: 'Erro ao carregar histórico.' });
  }
});

// 3. Enviar Mensagem e Obter Resposta da IA (com persistência no banco)
router.post('/mensagem', exigirLogin, async (req, res) => {
  try {
    const uid = req.session.usuario.id;
    const mensagem = (req.body.mensagem || '').trim();

    if (!mensagem) {
      return res.status(400).json({ sucesso: false, erro: 'Mensagem vazia.' });
    }

    // 1. Persistir mensagem do usuário no banco
    await db.run(`
      INSERT INTO chat_mensagens (usuario_id, papel, conteudo, criado_em)
      VALUES (?, 'usuario', ?, datetime('now'))
    `, [uid, mensagem]);

    // 2. Coletar contexto atualizado do usuário
    const contexto = await assistenteIa.coletarContextoUsuario(db, uid);

    // 3. Buscar mensagens recentes para contexto contínuo
    const historicoRecente = await db.all(`
      SELECT papel, conteudo
      FROM chat_mensagens
      WHERE usuario_id = ?
      ORDER BY id DESC
      LIMIT 6
    `, [uid]);
    historicoRecente.reverse();

    // 4. Gerar resposta com Gemini (ou fallback nativo)
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    const resposta = await assistenteIa.responderDuvidaSistema(mensagem, historicoRecente, contexto, apiKey);

    // 5. Persistir resposta do assistente no banco
    await db.run(`
      INSERT INTO chat_mensagens (usuario_id, papel, conteudo, criado_em)
      VALUES (?, 'assistente', ?, datetime('now'))
    `, [uid, resposta]);

    const agora = new Date();
    const horaFormatada = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;

    res.json({
      sucesso: true,
      resposta,
      hora: horaFormatada,
      fonte: apiKey ? 'gemini_ia' : 'nativo'
    });
  } catch (err) {
    console.error('Erro no processamento da mensagem do assistente:', err);
    res.status(500).json({ sucesso: false, erro: 'Erro interno ao processar resposta.' });
  }
});

// 4. Limpar Histórico de Mensagens do Usuário
router.delete('/historico', exigirLogin, async (req, res) => {
  try {
    const uid = req.session.usuario.id;
    await db.run('DELETE FROM chat_mensagens WHERE usuario_id = ?', [uid]);
    res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro ao limpar histórico:', err);
    res.status(500).json({ sucesso: false, erro: 'Erro ao limpar histórico.' });
  }
});

module.exports = router;
