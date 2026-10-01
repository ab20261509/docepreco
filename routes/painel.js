const express = require('express');
const db = require('../db');
const { exigirLogin } = require('../middleware/auth');
const { custoFixoHora, calcularProduto } = require('../calculo');

const router = express.Router();

router.get('/', exigirLogin, async (req, res, next) => {
  try {
    const uid = req.session.usuario.id;

    const totalFixosRow = await db.get('SELECT COALESCE(SUM(valor_mensal), 0) AS t FROM custos_fixos WHERE usuario_id = ?', [uid]);
    const totalFixos = totalFixosRow ? totalFixosRow.t : 0;

    const configRow = await db.get('SELECT horas_mes FROM configuracoes WHERE usuario_id = ?', [uid]);
    const horasMes = configRow && configRow.horas_mes > 0 ? configRow.horas_mes : 160;

    const cfHora = custoFixoHora(totalFixos, horasMes);

    const produtos = await db.all('SELECT * FROM produtos WHERE usuario_id = ? ORDER BY nome ASC', [uid]);

    const resumo = await Promise.all(produtos.map(async (p) => {
      const ing = await db.all('SELECT * FROM ingredientes WHERE produto_id = ?', [p.id]);
      const comp = await db.all('SELECT * FROM complementos WHERE produto_id = ?', [p.id]);
      
      let calc = null;
      let erroCalculo = null;
      try {
        calc = calcularProduto(p, ing, comp, cfHora);
      } catch (err) {
        erroCalculo = err.message;
      }

      return {
        produto: p,
        totalIngredientes: ing.length,
        totalComplementos: comp.length,
        calculo: calc,
        erroCalculo
      };
    }));

    res.render('painel', {
      resumo,
      totalFixos,
      horasMes,
      cfHora,
      activeNav: 'painel'
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
