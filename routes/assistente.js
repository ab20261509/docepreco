const express = require('express');
const db = require('../db');
const { exigirLogin, exigirPermissao } = require('../middleware/auth');
const assistenteIa = require('../services/assistente_ia');

const router = express.Router();

/**
 * Obtém a sessão ativa de atendimento do usuário ou cria uma nova se não houver nenhuma aberta
 */
async function obterOuCriarSessaoAtiva(dbInstance, usuarioId) {
  let sessao = await dbInstance.get(`
    SELECT id, titulo, status, iniciada_em
    FROM chat_sessoes
    WHERE usuario_id = ? AND status = 'aberta'
    ORDER BY id DESC
    LIMIT 1
  `, [usuarioId]);

  if (!sessao) {
    const resInsert = await dbInstance.run(`
      INSERT INTO chat_sessoes (usuario_id, status, iniciada_em)
      VALUES (?, 'aberta', datetime('now'))
    `, [usuarioId]);
    sessao = {
      id: resInsert.lastInsertRowid || resInsert.lastID,
      titulo: null,
      status: 'aberta'
    };
  }

  return sessao;
}

// 1. Tela Completa do Assistente
router.get('/', exigirLogin, exigirPermissao('assistente', 'ver'), async (req, res, next) => {
  try {
    const uid = req.session.usuario.id;
    const sessao = await obterOuCriarSessaoAtiva(db, uid);

    const historico = await db.all(`
      SELECT id, sessao_id, papel, conteudo, feedback, criado_em
      FROM chat_mensagens
      WHERE usuario_id = ? AND (sessao_id = ? OR sessao_id IS NULL)
      ORDER BY id ASC
      LIMIT 60
    `, [uid, sessao.id]);

    const sessoesAnteriores = await db.all(`
      SELECT id, titulo, aprendizado_resumo, encerrada_em
      FROM chat_sessoes
      WHERE usuario_id = ? AND status = 'encerrada' AND aprendizado_resumo IS NOT NULL
      ORDER BY encerrada_em DESC
      LIMIT 5
    `, [uid]);

    const contexto = await assistenteIa.coletarContextoUsuario(db, uid);

    res.render('assistente', {
      sessao,
      historico,
      sessoesAnteriores,
      contexto,
      temApiKey: Boolean((process.env.GEMINI_API_KEY || '').trim()),
      activeNav: 'assistente',
      activeModulo: 'assistente'
    });
  } catch (err) {
    next(err);
  }
});

// 2. Obter Histórico e Sessão Ativa via JSON (para o Drawer Flutuante)
router.get('/historico', exigirLogin, exigirPermissao('assistente', 'ver'), async (req, res) => {
  try {
    const uid = req.session.usuario.id;
    const sessao = await obterOuCriarSessaoAtiva(db, uid);

    const mensagens = await db.all(`
      SELECT id, sessao_id, papel, conteudo, feedback, criado_em
      FROM chat_mensagens
      WHERE usuario_id = ? AND (sessao_id = ? OR sessao_id IS NULL)
      ORDER BY id ASC
      LIMIT 60
    `, [uid, sessao.id]);

    res.json({ sucesso: true, sessao, mensagens });
  } catch (err) {
    console.error('Erro ao carregar histórico do chat:', err);
    res.status(500).json({ sucesso: false, erro: 'Erro ao carregar histórico.' });
  }
});

// 3. Enviar Mensagem e Obter Resposta da IA (associada à sessão ativa)
router.post('/mensagem', exigirLogin, exigirPermissao('assistente', 'criar'), async (req, res) => {
  try {
    const uid = req.session.usuario.id;
    const mensagem = (req.body.mensagem || '').trim();

    if (!mensagem) {
      return res.status(400).json({ sucesso: false, erro: 'Mensagem vazia.' });
    }

    const sessao = await obterOuCriarSessaoAtiva(db, uid);

    // 1. Persistir mensagem do usuário no banco
    await db.run(`
      INSERT INTO chat_mensagens (usuario_id, sessao_id, papel, conteudo, criado_em)
      VALUES (?, ?, 'usuario', ?, datetime('now'))
    `, [uid, sessao.id, mensagem]);

    // 2. Coletar contexto atualizado do usuário
    const contexto = await assistenteIa.coletarContextoUsuario(db, uid);

    // 3. Buscar mensagens recentes da sessão para manter o diálogo vivo
    const historicoRecente = await db.all(`
      SELECT papel, conteudo
      FROM chat_mensagens
      WHERE usuario_id = ? AND (sessao_id = ? OR sessao_id IS NULL)
      ORDER BY id DESC
      LIMIT 6
    `, [uid, sessao.id]);
    historicoRecente.reverse();

    // 4. Gerar resposta com Gemini (ou fallback nativo com conhecimento do manual)
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    const resposta = await assistenteIa.responderDuvidaSistema(mensagem, historicoRecente, contexto, apiKey);

    // 5. Persistir resposta do assistente no banco
    const resInsert = await db.run(`
      INSERT INTO chat_mensagens (usuario_id, sessao_id, papel, conteudo, criado_em)
      VALUES (?, ?, 'assistente', ?, datetime('now'))
    `, [uid, sessao.id, resposta]);

    const agora = new Date();
    const horaFormatada = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;

    res.json({
      sucesso: true,
      mensagemId: resInsert.lastInsertRowid || resInsert.lastID,
      sessaoId: sessao.id,
      resposta,
      hora: horaFormatada,
      fonte: apiKey ? 'gemini_ia' : 'nativo'
    });
  } catch (err) {
    console.error('Erro no processamento da mensagem do assistente:', err);
    res.status(500).json({ sucesso: false, erro: 'Erro interno ao processar resposta.' });
  }
});

// 4. Feedback de Avaliação da Resposta (👍 / 👎)
router.post('/mensagem/:id/feedback', exigirLogin, exigirPermissao('assistente', 'criar'), async (req, res) => {
  try {
    const uid = req.session.usuario.id;
    const msgId = parseInt(req.params.id, 10);
    const feedbackRecebido = parseInt(req.body.feedback, 10);

    if (isNaN(msgId)) {
      return res.status(400).json({ sucesso: false, erro: 'ID de mensagem inválido.' });
    }

    // Aceita 1 (positivo 👍), -1 (negativo 👎) ou 0/null para remoção
    let valorFeedback = null;
    if (feedbackRecebido === 1) valorFeedback = 1;
    else if (feedbackRecebido === -1) valorFeedback = -1;

    await db.run(`
      UPDATE chat_mensagens
      SET feedback = ?
      WHERE id = ? AND usuario_id = ?
    `, [valorFeedback, msgId, uid]);

    res.json({
      sucesso: true,
      mensagemId: msgId,
      feedback: valorFeedback
    });
  } catch (err) {
    console.error('Erro ao registrar feedback da resposta:', err);
    res.status(500).json({ sucesso: false, erro: 'Erro ao registrar feedback.' });
  }
});

// 5. Encerrar Atendimento com Documentação de Aprendizado Contínuo
router.post('/encerrar', exigirLogin, exigirPermissao('assistente', 'editar'), async (req, res) => {
  try {
    const uid = req.session.usuario.id;
    const sessao = await db.get(`
      SELECT id, titulo, status FROM chat_sessoes
      WHERE usuario_id = ? AND status = 'aberta'
      ORDER BY id DESC LIMIT 1
    `, [uid]);

    if (!sessao) {
      return res.json({
        sucesso: true,
        mensagem: 'Nenhum atendimento aberto para encerrar.'
      });
    }

    // Buscar todas as mensagens da sessão com os feedbacks
    const mensagens = await db.all(`
      SELECT id, papel, conteudo, feedback
      FROM chat_mensagens
      WHERE sessao_id = ?
      ORDER BY id ASC
    `, [sessao.id]);

    const likes = mensagens.filter(m => m.feedback === 1).length;
    const dislikes = mensagens.filter(m => m.feedback === -1).length;

    // Sintetizar aprendizado da sessão com a IA (ou heurística)
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    const sintese = await assistenteIa.sintetizarAprendizadoSessao(mensagens, { likes, dislikes }, apiKey);

    // Atualizar a sessão para encerrada com a síntese de aprendizado
    await db.run(`
      UPDATE chat_sessoes
      SET status = 'encerrada',
          titulo = ?,
          aprendizado_resumo = ?,
          encerrada_em = datetime('now')
      WHERE id = ? AND usuario_id = ?
    `, [sintese.titulo, sintese.aprendizadoResumo, sessao.id, uid]);

    // Criar imediatamente a próxima sessão limpa para o usuário
    const novaSessao = await db.run(`
      INSERT INTO chat_sessoes (usuario_id, status, iniciada_em)
      VALUES (?, 'aberta', datetime('now'))
    `, [uid]);

    res.json({
      sucesso: true,
      sessaoEncerradaId: sessao.id,
      novaSessaoId: novaSessao.lastInsertRowid || novaSessao.lastID,
      titulo: sintese.titulo,
      aprendizadoResumo: sintese.aprendizadoResumo,
      totalMensagens: mensagens.length,
      feedbacks: { likes, dislikes }
    });
  } catch (err) {
    console.error('Erro ao encerrar atendimento do assistente:', err);
    res.status(500).json({ sucesso: false, erro: 'Erro ao encerrar atendimento.' });
  }
});

// 6. Consultar Sessões Anteriores Encerradas
router.get('/sessoes', exigirLogin, exigirPermissao('assistente', 'ver'), async (req, res) => {
  try {
    const uid = req.session.usuario.id;
    const sessoes = await db.all(`
      SELECT id, titulo, status, aprendizado_resumo, iniciada_em, encerrada_em
      FROM chat_sessoes
      WHERE usuario_id = ? AND status = 'encerrada' AND aprendizado_resumo IS NOT NULL
      ORDER BY encerrada_em DESC
      LIMIT 15
    `, [uid]);

    res.json({ sucesso: true, sessoes });
  } catch (err) {
    console.error('Erro ao listar sessões:', err);
    res.status(500).json({ sucesso: false, erro: 'Erro ao listar sessões.' });
  }
});

// 7. Limpar Histórico de Mensagens da Sessão
router.delete('/historico', exigirLogin, exigirPermissao('assistente', 'excluir'), async (req, res) => {
  try {
    const uid = req.session.usuario.id;
    const sessao = await obterOuCriarSessaoAtiva(db, uid);

    await db.run('DELETE FROM chat_mensagens WHERE usuario_id = ? AND sessao_id = ?', [uid, sessao.id]);
    res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro ao limpar histórico:', err);
    res.status(500).json({ sucesso: false, erro: 'Erro ao limpar histórico.' });
  }
});

router.obterOuCriarSessaoAtiva = obterOuCriarSessaoAtiva;
module.exports = router;
