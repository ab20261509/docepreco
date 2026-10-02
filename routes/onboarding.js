const express = require('express');
const db = require('../db');
const { exigirLogin } = require('../middleware/auth');
const onboardingService = require('../services/onboarding');

const router = express.Router();

/**
 * Marca um módulo de onboarding como 'concluido' pelo usuário atual
 */
router.post('/:modulo/concluir', exigirLogin, async (req, res) => {
  try {
    const uid = req.session.usuario.id;
    const modulo = req.params.modulo;

    await onboardingService.atualizarStatusGuia(db, uid, modulo, 'concluido');
    res.json({ sucesso: true, modulo, status: 'concluido' });
  } catch (err) {
    console.error('Erro ao concluir onboarding:', err);
    res.status(500).json({ sucesso: false, erro: 'Erro ao salvar status.' });
  }
});

/**
 * Marca um módulo de onboarding como 'dispensado' pelo usuário atual
 */
router.post('/:modulo/dispensar', exigirLogin, async (req, res) => {
  try {
    const uid = req.session.usuario.id;
    const modulo = req.params.modulo;

    await onboardingService.atualizarStatusGuia(db, uid, modulo, 'dispensado');
    res.json({ sucesso: true, modulo, status: 'dispensado' });
  } catch (err) {
    console.error('Erro ao dispensar onboarding:', err);
    res.status(500).json({ sucesso: false, erro: 'Erro ao dispensar guia.' });
  }
});

/**
 * Reinicia/Reativa um módulo de onboarding ('pendente') pelo próprio usuário
 */
router.post('/:modulo/reiniciar', exigirLogin, async (req, res) => {
  try {
    const uid = req.session.usuario.id;
    const modulo = req.params.modulo;

    await onboardingService.reativarGuia(db, uid, modulo);

    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.json({ sucesso: true, modulo, status: 'pendente' });
    }
    res.redirect(req.get('Referrer') || '/');
  } catch (err) {
    console.error('Erro ao reiniciar onboarding:', err);
    res.status(500).json({ sucesso: false, erro: 'Erro ao reiniciar guia.' });
  }
});

/**
 * Reinicia todos os módulos de onboarding para o próprio usuário
 */
router.post('/reiniciar-todos', exigirLogin, async (req, res) => {
  try {
    const uid = req.session.usuario.id;
    await onboardingService.reiniciarTodosGuias(db, uid);

    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.json({ sucesso: true, status: 'pendente' });
    }
    res.redirect(req.get('Referrer') || '/');
  } catch (err) {
    console.error('Erro ao reiniciar todos os onboardings:', err);
    res.status(500).json({ sucesso: false, erro: 'Erro ao reiniciar guias.' });
  }
});

module.exports = router;
