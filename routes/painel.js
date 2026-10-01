const express = require('express');
const db = require('../db');
const { exigirLogin } = require('../middleware/auth');
const { custoFixoHora, calcularProduto } = require('../calculo');

const router = express.Router();

/**
 * Carrega e calcula a visão de precificação e lucros de todas as receitas cadastradas do usuário
 */
async function carregarDadosPrecificacao(uid) {
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

  return { totalFixos, horasMes, cfHora, resumo };
}

// 1. Página Inicial após o login: Botões Compactos Agrupados + Painel de Precificação
router.get('/', exigirLogin, async (req, res, next) => {
  try {
    const uid = req.session.usuario.id;

    const agora = new Date();
    const ano = agora.getFullYear();
    const mes = String(agora.getMonth() + 1).padStart(2, '0');
    const dia = String(agora.getDate()).padStart(2, '0');
    const hoje = `${ano}-${mes}-${dia}`;

    const [
      produtosCount,
      clientesCount,
      pedidosHojeCount,
      pedidosAbertosCount,
      custosTotalRow,
      estoqueBaixoRow,
      lotesRiscoRow,
      precificacao
    ] = await Promise.all([
      db.get('SELECT COUNT(*) as t FROM produtos WHERE usuario_id = ?', [uid]),
      db.get('SELECT COUNT(*) as t FROM clientes WHERE usuario_id = ?', [uid]),
      db.get("SELECT COUNT(*) as t FROM pedidos WHERE usuario_id = ? AND data_entrega = ? AND status != 'cancelado'", [uid, hoje]),
      db.get("SELECT COUNT(*) as t FROM pedidos WHERE usuario_id = ? AND status IN ('orcamento', 'confirmado', 'producao')", [uid]),
      db.get('SELECT COALESCE(SUM(valor_mensal), 0) AS t FROM custos_fixos WHERE usuario_id = ?', [uid]),
      db.get('SELECT COUNT(*) as t FROM ingredientes_catalogo WHERE usuario_id = ? AND ((estoque_minimo > 0 AND estoque_atual <= estoque_minimo) OR estoque_atual <= 0)', [uid]),
      db.get("SELECT COUNT(*) as t FROM ingredientes_compras WHERE usuario_id = ? AND status = 'ativo' AND data_validade IS NOT NULL AND data_validade <= date('now', '+7 days')", [uid]),
      carregarDadosPrecificacao(uid)
    ]);

    const stats = {
      totalProdutos: produtosCount ? produtosCount.t : 0,
      totalClientes: clientesCount ? clientesCount.t : 0,
      pedidosHoje: pedidosHojeCount ? pedidosHojeCount.t : 0,
      pedidosAbertos: pedidosAbertosCount ? pedidosAbertosCount.t : 0,
      totalCustosFixos: custosTotalRow ? custosTotalRow.t : 0,
      itensEstoqueBaixo: estoqueBaixoRow ? estoqueBaixoRow.t : 0,
      lotesRisco: lotesRiscoRow ? lotesRiscoRow.t : 0
    };

    res.render('inicio', {
      stats,
      resumo: precificacao.resumo,
      totalFixos: precificacao.totalFixos,
      horasMes: precificacao.horasMes,
      cfHora: precificacao.cfHora,
      activeNav: 'inicio'
    });
  } catch (err) {
    next(err);
  }
});

// 2. Painel de Precificação e Produtos Cadastrados (Rota dedicada)
router.get(['/produtos', '/painel'], exigirLogin, async (req, res, next) => {
  try {
    const uid = req.session.usuario.id;
    const precificacao = await carregarDadosPrecificacao(uid);

    res.render('painel', {
      resumo: precificacao.resumo,
      totalFixos: precificacao.totalFixos,
      horasMes: precificacao.horasMes,
      cfHora: precificacao.cfHora,
      activeNav: 'produtos'
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.carregarDadosPrecificacao = carregarDadosPrecificacao;
