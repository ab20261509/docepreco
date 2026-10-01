const express = require('express');
const db = require('../db');
const { exigirLogin } = require('../middleware/auth');

const router = express.Router();

function formatarMoeda(val) {
  const num = Number(val) || 0;
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarDataBR(dataIso) {
  if (!dataIso) return '';
  const partes = dataIso.split('-');
  if (partes.length === 3) return `${partes[2]}/${partes[1]}/${partes[0]}`;
  return dataIso;
}

function obterHojeLocal() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function adicionarDias(dataIso, dias) {
  const partes = dataIso.split('-').map(Number);
  const d = new Date(partes[0], partes[1] - 1, partes[2]);
  d.setDate(d.getDate() + dias);
  const resAno = d.getFullYear();
  const resMes = String(d.getMonth() + 1).padStart(2, '0');
  const resDia = String(d.getDate()).padStart(2, '0');
  return `${resAno}-${resMes}-${resDia}`;
}

// Helper para calcular o planejamento unificado
async function calcularPlanejamentoCompras(uid, options = {}) {
  const incluirVendas = options.incluirVendas !== false;
  const incluirMinimo = options.incluirMinimo !== false;
  const incluirUltimas = options.incluirUltimas !== false;
  const periodo = options.periodo || 'semana';

  const hoje = obterHojeLocal();
  const amanha = adicionarDias(hoje, 1);
  const daqui7dias = adicionarDias(hoje, 7);

  // 1. Filtrar Pedidos do Período
  let sqlCondData = '';
  const paramsPedidos = [uid];

  if (periodo === 'hoje') {
    sqlCondData = 'AND p.data_entrega = ?';
    paramsPedidos.push(hoje);
  } else if (periodo === 'amanha') {
    sqlCondData = 'AND p.data_entrega = ?';
    paramsPedidos.push(amanha);
  } else if (periodo === 'semana') {
    sqlCondData = 'AND p.data_entrega >= ? AND p.data_entrega <= ?';
    paramsPedidos.push(hoje, daqui7dias);
  } // Se periodo === 'todos', não filtra por data de entrega

  const pedidos = await db.all(`
    SELECT p.*, c.nome AS cliente_cadastrado_nome
    FROM pedidos p
    LEFT JOIN clientes c ON p.cliente_id = c.id
    WHERE p.usuario_id = ? AND p.status IN ('confirmado', 'producao') ${sqlCondData}
    ORDER BY p.data_entrega ASC
  `, paramsPedidos);

  const pedidoIds = pedidos.map(p => p.id);

  // 2. Apurar demanda de insumos das vendas pendentes
  const demandaVendasPorNome = {};

  if (pedidoIds.length > 0) {
    const placeholders = pedidoIds.map(() => '?').join(',');
    const itensPedidos = await db.all(`
      SELECT 
        pi.pedido_id,
        pi.produto_id,
        pi.quantidade AS qtd_pedida,
        pi.descricao AS item_descricao,
        p.nome AS produto_nome,
        p.rendimento
      FROM pedido_itens pi
      LEFT JOIN produtos p ON pi.produto_id = p.id
      WHERE pi.pedido_id IN (${placeholders}) AND pi.produto_id IS NOT NULL
    `, pedidoIds);

    const produtoIds = [...new Set(itensPedidos.map(it => it.produto_id).filter(Boolean))];
    const ingredientesPorProduto = {};
    if (produtoIds.length > 0) {
      const pPlaceholders = produtoIds.map(() => '?').join(',');
      const todosIngs = await db.all(`SELECT * FROM ingredientes WHERE produto_id IN (${pPlaceholders})`, produtoIds);
      todosIngs.forEach(ing => {
        if (!ingredientesPorProduto[ing.produto_id]) {
          ingredientesPorProduto[ing.produto_id] = [];
        }
        ingredientesPorProduto[ing.produto_id].push(ing);
      });
    }

    itensPedidos.forEach(it => {
      const rendimento = it.rendimento > 0 ? it.rendimento : 1;
      const fatorLote = it.qtd_pedida / rendimento;

      const ings = ingredientesPorProduto[it.produto_id] || [];
      ings.forEach(ing => {
        const chave = ing.nome.trim().toLowerCase();
        const qtdConsumida = ing.qtd_usada * fatorLote;

        if (!demandaVendasPorNome[chave]) {
          demandaVendasPorNome[chave] = {
            nomeOriginal: ing.nome.trim(),
            demandaTotal: 0,
            precoPacote: ing.preco_pacote,
            qtdPacote: ing.qtd_pacote,
            produtosOrigem: new Set()
          };
        }
        demandaVendasPorNome[chave].demandaTotal += qtdConsumida;
        demandaVendasPorNome[chave].produtosOrigem.add(it.produto_nome || it.item_descricao);
      });
    });
  }

  // 3. Buscar catálogo de ingredientes da usuária
  const catalogo = await db.all(`
    SELECT * FROM ingredientes_catalogo
    WHERE usuario_id = ?
    ORDER BY nome ASC
  `, [uid]);

  // 4. Buscar últimas compras ativas para cada ingrediente
  const ultimasComprasRaw = await db.all(`
    SELECT 
      c.ingrediente_id,
      c.data_compra,
      (c.qtd_embalagens * c.qtd_por_embalagem) AS qtd_total_comprada,
      c.qtd_embalagens,
      c.qtd_por_embalagem,
      c.valor_unitario_embalagem,
      c.valor_total
    FROM ingredientes_compras c
    WHERE c.usuario_id = ? AND c.status = 'ativo'
    ORDER BY c.data_compra DESC, c.id DESC
  `, [uid]);

  const mapaUltimaCompra = {};
  ultimasComprasRaw.forEach(compra => {
    if (!mapaUltimaCompra[compra.ingrediente_id]) {
      mapaUltimaCompra[compra.ingrediente_id] = compra;
    }
  });

  // 5. Unificar catálogo com demanda das vendas
  const mapaUnificado = {};

  // Inserir todos do catálogo
  catalogo.forEach(cat => {
    const chave = cat.nome.trim().toLowerCase();
    const ultCompra = mapaUltimaCompra[cat.id] || null;

    mapaUnificado[chave] = {
      catalogoId: cat.id,
      nome: cat.nome,
      unidade: cat.unidade || 'g',
      estoqueAtual: Number(cat.estoque_atual) || 0,
      estoqueMinimo: Number(cat.estoque_minimo) || 0,
      precoEmbalagem: Number(cat.preco_atual) || (ultCompra ? ultCompra.valor_unitario_embalagem : 0),
      qtdEmbalagem: Number(cat.qtd_embalagem_padrao) || (ultCompra ? ultCompra.qtd_por_embalagem : 1),
      ultimaCompraData: ultCompra ? formatarDataBR(ultCompra.data_compra) : null,
      ultimaCompraQtd: ultCompra ? Number(ultCompra.qtd_total_comprada) : 0,
      ultimaCompraEmbalagens: ultCompra ? Number(ultCompra.qtd_embalagens) : 0,
      vendasPendentes: 0,
      produtosOrigem: []
    };
  });

  // Mesclar demandas das vendas
  Object.keys(demandaVendasPorNome).forEach(chave => {
    const dem = demandaVendasPorNome[chave];
    if (mapaUnificado[chave]) {
      mapaUnificado[chave].vendasPendentes = dem.demandaTotal;
      mapaUnificado[chave].produtosOrigem = Array.from(dem.produtosOrigem);
      if (mapaUnificado[chave].precoEmbalagem === 0 && dem.precoPacote > 0) {
        mapaUnificado[chave].precoEmbalagem = dem.precoPacote;
      }
      if (mapaUnificado[chave].qtdEmbalagem <= 1 && dem.qtdPacote > 0) {
        mapaUnificado[chave].qtdEmbalagem = dem.qtdPacote;
      }
    } else {
      // Insumo está na receita mas não está no catálogo de estoque
      mapaUnificado[chave] = {
        catalogoId: null,
        nome: dem.nomeOriginal,
        unidade: 'g',
        estoqueAtual: 0,
        estoqueMinimo: 0,
        precoEmbalagem: dem.precoPacote || 0,
        qtdEmbalagem: dem.qtdPacote || 1,
        ultimaCompraData: null,
        ultimaCompraQtd: 0,
        ultimaCompraEmbalagens: 0,
        vendasPendentes: dem.demandaTotal,
        produtosOrigem: Array.from(dem.produtosOrigem)
      };
    }
  });

  // 6. Realizar o cálculo unificado conforme os toggles ativados
  let custoTotalEstimado = 0;
  let totalItensComprar = 0;
  let totalItensSuficientes = 0;

  const itensPlanejamento = Object.values(mapaUnificado).map(item => {
    const E = item.estoqueAtual;
    const V = incluirVendas ? item.vendasPendentes : 0;
    const M = incluirMinimo ? item.estoqueMinimo : 0;
    const U = incluirUltimas ? item.ultimaCompraQtd : 0;

    let necessidadeBruta = 0;
    let faltaLiquida = 0;
    let sugestaoQtd = 0;

    if (incluirVendas || incluirMinimo) {
      necessidadeBruta = V + M;
      faltaLiquida = Math.max(0, necessidadeBruta - E);
      sugestaoQtd = faltaLiquida;

      // Se incluir_ultimas estiver ativo e houver falta, respeitar o lote habitual se for maior
      if (incluirUltimas && U > 0 && faltaLiquida > 0 && faltaLiquida < U) {
        sugestaoQtd = U;
      }
    } else if (incluirUltimas && U > 0) {
      // Somente últimas compras ativada: sugere reposição pelo volume da última compra se estoque estiver baixo
      if (E <= 0) {
        sugestaoQtd = U;
      } else {
        sugestaoQtd = 0;
      }
    }

    // Cálculo de embalagens/pacotes inteiros
    const qtdPorEmb = item.qtdEmbalagem > 0 ? item.qtdEmbalagem : 1;
    let pacotesAComprar = 0;
    if (sugestaoQtd > 0) {
      pacotesAComprar = Math.ceil(sugestaoQtd / qtdPorEmb);
    }

    const custoEstimado = pacotesAComprar * item.precoEmbalagem;
    const situacao = pacotesAComprar > 0 ? 'comprar' : 'suficiente';

    if (situacao === 'comprar') {
      totalItensComprar++;
      custoTotalEstimado += custoEstimado;
    } else {
      totalItensSuficientes++;
    }

    return {
      ...item,
      V,
      M,
      U,
      necessidadeBruta: Number(necessidadeBruta.toFixed(2)),
      faltaLiquida: Number(faltaLiquida.toFixed(2)),
      sugestaoQtd: Number(sugestaoQtd.toFixed(2)),
      pacotesAComprar,
      custoEstimado,
      custoEstimadoFmt: formatarMoeda(custoEstimado),
      precoEmbalagemFmt: formatarMoeda(item.precoEmbalagem),
      situacao
    };
  });

  // Ordenar: primeiro os que precisam comprar (maior custo primeiro), depois suficientes em ordem alfabética
  itensPlanejamento.sort((a, b) => {
    if (a.situacao === 'comprar' && b.situacao !== 'comprar') return -1;
    if (a.situacao !== 'comprar' && b.situacao === 'comprar') return 1;
    if (a.situacao === 'comprar' && b.situacao === 'comprar') {
      return b.custoEstimado - a.custoEstimado;
    }
    return a.nome.localeCompare(b.nome);
  });

  // 7. Gerar texto formatado da Lista de Mercado para WhatsApp
  const itensAComprar = itensPlanejamento.filter(i => i.pacotesAComprar > 0);
  let textoWhatsApp = '🛒 *LISTA DE COMPRAS - DOCE PREÇO* 🧁\n\n';
  
  if (itensAComprar.length === 0) {
    textoWhatsApp += '✅ *Estoque 100% abastecido!* Nenhum insumo precisa ser comprado no momento.\n';
  } else {
    itensAComprar.forEach(item => {
      const embDesc = item.qtdEmbalagem > 1 ? ` (${item.qtdEmbalagem}${item.unidade})` : '';
      const precoDesc = item.custoEstimado > 0 ? ` — Est: *${item.custoEstimadoFmt}*` : '';
      textoWhatsApp += `• *${item.pacotesAComprar}x* ${item.nome}${embDesc}${precoDesc}\n`;
    });
    textoWhatsApp += `\n💰 *Custo Total Estimado*: *${formatarMoeda(custoTotalEstimado)}*`;
  }

  return {
    pedidos,
    totalPedidos: pedidos.length,
    itensPlanejamento,
    itensAComprar,
    custoTotalEstimado,
    custoTotalEstimadoFmt: formatarMoeda(custoTotalEstimado),
    totalItensComprar,
    totalItensSuficientes,
    textoWhatsApp,
    hoje,
    amanha,
    daqui7dias
  };
}

// 1. Tela Principal de Compras e Planejamento Unificado
router.get('/', exigirLogin, async (req, res, next) => {
  try {
    const uid = req.session.usuario.id;

    const incluirVendas = req.query.incluir_vendas !== '0';
    const incluirMinimo = req.query.incluir_minimo !== '0';
    const incluirUltimas = req.query.incluir_ultimas !== '0';
    const periodo = req.query.periodo || 'semana';
    const somenteFaltantes = req.query.somente_faltantes === '1';

    const resultado = await calcularPlanejamentoCompras(uid, {
      incluirVendas,
      incluirMinimo,
      incluirUltimas,
      periodo
    });

    const listaExibicao = somenteFaltantes 
      ? resultado.itensPlanejamento.filter(i => i.situacao === 'comprar')
      : resultado.itensPlanejamento;

    res.render('compras', {
      activeNav: 'compras',
      activeModulo: 'comercial',
      incluirVendas,
      incluirMinimo,
      incluirUltimas,
      periodo,
      somenteFaltantes,
      pedidos: resultado.pedidos,
      totalPedidos: resultado.totalPedidos,
      itens: listaExibicao,
      totalItens: resultado.itensPlanejamento.length,
      custoTotalEstimadoFmt: resultado.custoTotalEstimadoFmt,
      totalItensComprar: resultado.totalItensComprar,
      totalItensSuficientes: resultado.totalItensSuficientes,
      textoWhatsApp: resultado.textoWhatsApp,
      sucessoBaixa: req.query.sucesso_baixa === '1'
    });
  } catch (err) {
    next(err);
  }
});

// 2. Dar Baixa no Estoque pela Produção Selecionada
router.post('/baixa-producao', exigirLogin, async (req, res) => {
  const uid = req.session.usuario.id;
  const periodo = req.body.periodo || 'semana';

  try {
    const resultado = await calcularPlanejamentoCompras(uid, {
      incluirVendas: true,
      incluirMinimo: false,
      incluirUltimas: false,
      periodo
    });

    // Executar baixa transacional no estoque dos insumos do catálogo
    await db.transaction(async (tx) => {
      for (const item of resultado.itensPlanejamento) {
        if (item.catalogoId && item.V > 0) {
          await tx.run(`
            UPDATE ingredientes_catalogo
            SET estoque_atual = MAX(0, estoque_atual - ?),
                atualizado_em = datetime('now')
            WHERE id = ? AND usuario_id = ?
          `, [item.V, item.catalogoId, uid]);
        }
      }

      for (const p of resultado.pedidos) {
        if (p.status === 'confirmado') {
          await tx.run(`
            UPDATE pedidos
            SET status = 'producao', atualizado_em = datetime('now')
            WHERE id = ? AND usuario_id = ?
          `, [p.id, uid]);
        }
      }
    });

    res.redirect('/compras?sucesso_baixa=1');
  } catch (err) {
    console.error('Erro ao dar baixa na produção:', err);
    res.status(500).send('Erro ao processar a baixa de estoque da produção.');
  }
});

module.exports = {
  router,
  calcularPlanejamentoCompras
};
