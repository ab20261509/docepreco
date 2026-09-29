const express = require('express');
const db = require('../db');
const { exigirLogin } = require('../middleware/auth');
const { custoFixoHora, calcularProduto } = require('../calculo');

const router = express.Router();

router.get('/', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;

  const totalFixosRow = db.prepare('SELECT COALESCE(SUM(valor_mensal), 0) AS t FROM custos_fixos WHERE usuario_id = ?').get(uid);
  const totalFixos = totalFixosRow ? totalFixosRow.t : 0;

  const configRow = db.prepare('SELECT horas_mes FROM configuracoes WHERE usuario_id = ?').get(uid);
  const horasMes = configRow && configRow.horas_mes > 0 ? configRow.horas_mes : 160;

  const cfHora = custoFixoHora(totalFixos, horasMes);

  const produtos = db.prepare('SELECT * FROM produtos WHERE usuario_id = ? ORDER BY nome ASC').all(uid);

  const resumo = produtos.map((p) => {
    const ing = db.prepare('SELECT * FROM ingredientes WHERE produto_id = ?').all(p.id);
    const comp = db.prepare('SELECT * FROM complementos WHERE produto_id = ?').all(p.id);
    
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
  });

  res.render('painel', {
    resumo,
    totalFixos,
    horasMes,
    cfHora,
    activeNav: 'painel'
  });
});

module.exports = router;
