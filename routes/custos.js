const express = require('express');
const db = require('../db');
const { exigirLogin } = require('../middleware/auth');
const { custoFixoHora } = require('../calculo');

const router = express.Router();

router.get('/', exigirLogin, async (req, res) => {
  const uid = req.session.usuario.id;

  const configRow = await db.get('SELECT horas_mes FROM configuracoes WHERE usuario_id = ?', [uid]);
  const horasMes = configRow && configRow.horas_mes > 0 ? configRow.horas_mes : 160;

  const custos = await db.all('SELECT * FROM custos_fixos WHERE usuario_id = ? ORDER BY id ASC', [uid]);
  const totalFixos = custos.reduce((acc, c) => acc + (Number(c.valor_mensal) || 0), 0);
  const cfHora = custoFixoHora(totalFixos, horasMes);

  res.render('custos', {
    custos,
    horasMes,
    totalFixos,
    cfHora,
    sucesso: req.query.salvo === '1',
    erro: null,
    activeNav: 'custos'
  });
});

router.post('/', exigirLogin, async (req, res) => {
  const uid = req.session.usuario.id;
  const horasMes = parseFloat(req.body.horas_mes) || 160;

  if (horasMes <= 0) {
    return res.status(400).send('Horas trabalhadas por mês deve ser maior que zero.');
  }

  const ids = Array.isArray(req.body.custo_id) ? req.body.custo_id : (req.body.custo_id ? [req.body.custo_id] : []);
  const itens = Array.isArray(req.body.custo_item) ? req.body.custo_item : (req.body.custo_item ? [req.body.custo_item] : []);
  const valores = Array.isArray(req.body.custo_valor) ? req.body.custo_valor : (req.body.custo_valor ? [req.body.custo_valor] : []);

  try {
    await db.transaction(async (tx) => {
      // 1. Atualizar horas/mês
      await tx.run(`
        INSERT INTO configuracoes (usuario_id, horas_mes) VALUES (?, ?)
        ON CONFLICT(usuario_id) DO UPDATE SET horas_mes = excluded.horas_mes
      `, [uid, horasMes]);

      // 2. Atualizar custos existentes pertencentes ao usuário
      for (let i = 0; i < ids.length; i++) {
        const id = parseInt(ids[i], 10);
        const item = (itens[i] || '').trim();
        const valor = Math.max(0, parseFloat(valores[i]) || 0);
        if (id && item) {
          await tx.run('UPDATE custos_fixos SET item = ?, valor_mensal = ? WHERE id = ? AND usuario_id = ?', [item, valor, id, uid]);
        }
      }

      // 3. Adicionar novo item se fornecido
      const novoItem = (req.body.novo_item || '').trim();
      const novoValor = parseFloat(req.body.novo_valor);
      if (novoItem && !isNaN(novoValor)) {
        await tx.run('INSERT INTO custos_fixos (usuario_id, item, valor_mensal) VALUES (?, ?, ?)', [uid, novoItem, Math.max(0, novoValor)]);
      }
    });

    res.redirect('/custos?salvo=1');
  } catch (err) {
    console.error('Erro ao salvar custos fixos:', err);
    res.status(500).send('Erro ao salvar custos fixos.');
  }
});

// Excluir um item de custo fixo
router.post('/excluir/:id', exigirLogin, async (req, res) => {
  const uid = req.session.usuario.id;
  const id = parseInt(req.params.id, 10);

  await db.run('DELETE FROM custos_fixos WHERE id = ? AND usuario_id = ?', [id, uid]);
  res.redirect('/custos');
});

module.exports = router;
