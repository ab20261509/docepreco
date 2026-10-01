const express = require('express');
const db = require('../db');
const { exigirLogin, exigirPermissao } = require('../middleware/auth');
const chefIa = require('../services/chef_ia');

const router = express.Router();

function formatarDataBR(dataIso) {
  if (!dataIso) return '';
  const partes = dataIso.split('-');
  if (partes.length === 3) return `${partes[2]}/${partes[1]}/${partes[0]}`;
  return dataIso;
}

function formatarDataHoraBR(dataHoraIso) {
  if (!dataHoraIso) return '';
  try {
    const d = new Date(dataHoraIso);
    if (isNaN(d.getTime())) return dataHoraIso;
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const ano = d.getFullYear();
    const hora = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dia}/${mes}/${ano} às ${hora}:${min}`;
  } catch (_) {
    return dataHoraIso;
  }
}

function calcularFatorEscala(qtdPedida, unPedida, rendimentoBase, unBase) {
  const qPed = Math.max(0.001, parseFloat(qtdPedida) || 1);
  const rBase = Math.max(0.001, parseFloat(rendimentoBase) || 1);
  const uPed = (unPedida || 'un').toLowerCase();
  const uBase = (unBase || 'un').toLowerCase();

  let qtdEfetiva = qPed;
  if (uBase === 'kg' && uPed === 'g') {
    qtdEfetiva = qPed / 1000;
  } else if (uBase === 'g' && uPed === 'kg') {
    qtdEfetiva = qPed * 1000;
  }

  return qtdEfetiva / rBase;
}

// 1. Hub Central da Cozinha
router.get('/', exigirLogin, exigirPermissao('producao', 'ver'), async (req, res, next) => {
  try {
    const uid = req.session.usuario.id;

    // A. Receitas cadastradas da fábrica
    const produtos = await db.all(`
      SELECT id, nome, rendimento, unidade, tempo_horas 
      FROM produtos 
      WHERE usuario_id = ? 
      ORDER BY nome ASC
    `, [uid]);

    // B. Fila de Encomendas Pendentes para Produzir (status 'confirmado' ou 'producao')
    const pedidosPendentes = await db.all(`
      SELECT 
        p.id AS pedido_id,
        p.data_entrega,
        p.horario_entrega,
        p.status,
        c.nome AS cliente_cadastrado_nome,
        p.cliente_nome_avulso
      FROM pedidos p
      LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE p.usuario_id = ? AND p.status IN ('confirmado', 'producao')
      ORDER BY p.data_entrega ASC, p.horario_entrega ASC
    `, [uid]);

    const filaPedidos = [];
    for (const p of pedidosPendentes) {
      const itensReceitas = await db.all(`
        SELECT 
          pi.id AS item_id,
          pi.produto_id,
          pi.descricao,
          pi.quantidade,
          pi.unidade,
          pi.observacao,
          prod.nome AS produto_nome,
          prod.rendimento AS produto_rendimento,
          prod.unidade AS produto_unidade,
          prod.tempo_horas AS produto_tempo_horas
        FROM pedido_itens pi
        INNER JOIN produtos prod ON prod.id = pi.produto_id
        WHERE pi.pedido_id = ? AND (pi.tipo_item IS NULL OR pi.tipo_item = 'produto')
        ORDER BY pi.id ASC
      `, [p.pedido_id]);

      if (itensReceitas.length > 0) {
        filaPedidos.push({
          ...p,
          clienteNome: p.cliente_cadastrado_nome || p.cliente_nome_avulso || 'Cliente Avulso',
          dataEntregaFmt: formatarDataBR(p.data_entrega),
          itens: itensReceitas
        });
      }
    }

    // C. Produções em Andamento (ativas)
    const producoesAtivas = await db.all(`
      SELECT 
        pr.*,
        p.nome AS produto_original_nome
      FROM producoes pr
      LEFT JOIN produtos p ON p.id = pr.produto_id
      WHERE pr.usuario_id = ? AND pr.status = 'em_preparo'
      ORDER BY pr.iniciado_em DESC
    `, [uid]);

    // D. Histórico dos Últimos Preparos Concluídos ou Cancelados
    const historico = await db.all(`
      SELECT 
        pr.*,
        p.nome AS produto_original_nome
      FROM producoes pr
      LEFT JOIN produtos p ON p.id = pr.produto_id
      WHERE pr.usuario_id = ? AND pr.status IN ('concluido', 'cancelado')
      ORDER BY COALESCE(pr.concluido_em, pr.iniciado_em) DESC
      LIMIT 25
    `, [uid]);

    // E. KPIs do Mês
    const agora = new Date();
    const anoMes = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
    const kpiRow = await db.get(`
      SELECT 
        COUNT(*) AS total_concluidos_mes,
        COALESCE(AVG(tempo_real_min), 0) AS tempo_medio_min
      FROM producoes
      WHERE usuario_id = ? AND status = 'concluido' AND iniciado_em LIKE ?
    `, [uid, `${anoMes}%`]);

    res.render('producao', {
      produtos,
      filaPedidos,
      producoesAtivas: producoesAtivas.map(pa => ({
        ...pa,
        iniciadoEmFmt: formatarDataHoraBR(pa.iniciado_em)
      })),
      historico: historico.map(h => ({
        ...h,
        iniciadoEmFmt: formatarDataHoraBR(h.iniciado_em),
        concluidoEmFmt: formatarDataHoraBR(h.concluido_em)
      })),
      kpis: {
        totalConcluidosMes: kpiRow ? kpiRow.total_concluidos_mes : 0,
        tempoMedioMin: kpiRow ? Math.round(kpiRow.tempo_medio_min) : 0,
        totalNaFila: filaPedidos.reduce((acc, p) => acc + p.itens.length, 0)
      },
      sucessoConclusao: req.query.concluido === '1',
      activeNav: 'producao',
      activeModulo: 'fabrica'
    });
  } catch (err) {
    next(err);
  }
});

// 2. Assistente de Preparo "Modo Cozinha"
router.get('/preparar', exigirLogin, exigirPermissao('producao', 'ver'), async (req, res, next) => {
  try {
    const uid = req.session.usuario.id;
    const producaoId = req.query.producao_id ? parseInt(req.query.producao_id, 10) : null;
    let produtoId = req.query.produto_id ? parseInt(req.query.produto_id, 10) : null;
    const pedidoId = req.query.pedido_id ? parseInt(req.query.pedido_id, 10) : null;
    let qtdDesejada = req.query.quantidade ? parseFloat(req.query.quantidade) : null;
    let unidadeDesejada = req.query.unidade ? req.query.unidade.trim() : null;

    let producaoAtual = null;

    if (producaoId) {
      producaoAtual = await db.get('SELECT * FROM producoes WHERE id = ? AND usuario_id = ?', [producaoId, uid]);
      if (producaoAtual) {
        produtoId = producaoAtual.produto_id;
        qtdDesejada = producaoAtual.quantidade_produzida;
        unidadeDesejada = producaoAtual.unidade;
      }
    }

    if (!produtoId && pedidoId) {
      // Se veio com pedido_id sem produto_id, pegar o primeiro item de receita daquele pedido
      const itemPedido = await db.get(`
        SELECT pi.produto_id, pi.quantidade, pi.unidade
        FROM pedido_itens pi
        WHERE pi.pedido_id = ? AND pi.produto_id IS NOT NULL
        LIMIT 1
      `, [pedidoId]);
      if (itemPedido) {
        produtoId = itemPedido.produto_id;
        if (!qtdDesejada) qtdDesejada = itemPedido.quantidade;
        if (!unidadeDesejada) unidadeDesejada = itemPedido.unidade;
      }
    }

    if (!produtoId) {
      return res.redirect('/producao');
    }

    const produto = await db.get('SELECT * FROM produtos WHERE id = ? AND usuario_id = ?', [produtoId, uid]);
    if (!produto) {
      return res.status(404).render('erro_404', { mensagem: 'Receita não encontrada ou sem permissão.' });
    }

    const rendimentoBase = produto.rendimento > 0 ? produto.rendimento : 1;
    const unidadeBase = produto.unidade || 'un';

    const qtdFinal = (qtdDesejada && qtdDesejada > 0) ? qtdDesejada : rendimentoBase;
    const unidadeFinal = unidadeDesejada || unidadeBase;

    // Calcular fator de escala dos ingredientes
    const fator = calcularFatorEscala(qtdFinal, unidadeFinal, rendimentoBase, unidadeBase);

    // Buscar ingredientes e complementos da receita
    const ingredientesRaw = await db.all('SELECT * FROM ingredientes WHERE produto_id = ? ORDER BY id ASC', [produtoId]);
    const complementosRaw = await db.all('SELECT * FROM complementos WHERE produto_id = ? ORDER BY id ASC', [produtoId]);

    // Buscar saldo atual dos insumos no catálogo para exibir em tempo real na balança
    const catalogoInsumos = await db.all('SELECT id, nome, estoque_atual, unidade FROM ingredientes_catalogo WHERE usuario_id = ?', [uid]);
    const mapaCatalogo = {};
    catalogoInsumos.forEach(c => {
      mapaCatalogo[c.nome.trim().toLowerCase()] = c;
    });

    const ingredientes = ingredientesRaw.map(ing => {
      const qtdEscalada = Number((ing.qtd_usada * fator).toFixed(2));
      const chave = ing.nome.trim().toLowerCase();
      const insumoCat = mapaCatalogo[chave] || null;
      return {
        ...ing,
        qtdEscalada,
        estoqueDisponivel: insumoCat ? insumoCat.estoque_atual : null,
        catalogoId: insumoCat ? insumoCat.id : null
      };
    });

    // Se ainda não existia producao ativa e veio com flag auto_iniciar ou pedido, criar registro inicial
    if (!producaoAtual) {
      const tempoEstimadoMin = Math.max(1, Math.round((parseFloat(produto.tempo_horas) || 0) * 60));
      const infoProd = await db.run(`
        INSERT INTO producoes (
          usuario_id, produto_id, pedido_id, nome_receita,
          quantidade_produzida, unidade, tempo_estimado_min, status, iniciado_em
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'em_preparo', datetime('now'))
      `, [uid, produtoId, pedidoId, produto.nome, qtdFinal, unidadeFinal, tempoEstimadoMin]);
      
      const novaId = Number(infoProd.lastInsertRowid);
      producaoAtual = await db.get('SELECT * FROM producoes WHERE id = ?', [novaId]);

      // Se veio vinculado a pedido e o pedido estava em 'confirmado', avançar para 'producao'
      if (pedidoId) {
        await db.run("UPDATE pedidos SET status = 'producao', atualizado_em = datetime('now') WHERE id = ? AND usuario_id = ? AND status = 'confirmado'", [pedidoId, uid]);
      }
    }

    // Buscar dados do pedido vinculado se houver
    let pedidoVinculado = null;
    if (producaoAtual && producaoAtual.pedido_id) {
      pedidoVinculado = await db.get(`
        SELECT p.*, c.nome AS cliente_nome 
        FROM pedidos p 
        LEFT JOIN clientes c ON c.id = p.cliente_id 
        WHERE p.id = ?
      `, [producaoAtual.pedido_id]);
    }

    let sequenciaSalva = null;
    if (produto.modo_preparo) {
      try {
        sequenciaSalva = JSON.parse(produto.modo_preparo);
      } catch (_) {
        sequenciaSalva = {
          fonte: 'manual',
          tipo_receita: 'Instruções da Receita',
          passos: [
            {
              ordem: 1,
              titulo: '1. Instruções Salvas da Receita',
              instrucao: produto.modo_preparo,
              equipamento: null,
              tempo_timer_min: null,
              temperatura: null,
              ponto_visual: null,
              dica_chef: null
            }
          ]
        };
      }
    }

    res.render('producao_preparar', {
      produto,
      producao: producaoAtual,
      pedido: pedidoVinculado,
      ingredientes,
      complementos: complementosRaw,
      fator,
      qtdFinal,
      unidadeFinal,
      tempoEstimadoMin: producaoAtual ? producaoAtual.tempo_estimado_min : Math.round((produto.tempo_horas || 0) * 60),
      sequenciaSalva,
      temApiKey: Boolean((process.env.GEMINI_API_KEY || '').trim()),
      activeNav: 'producao',
      activeModulo: 'fabrica'
    });
  } catch (err) {
    next(err);
  }
});

// 3. Iniciar Novo Preparo
router.post('/iniciar', exigirLogin, exigirPermissao('producao', 'criar'), async (req, res, next) => {
  try {
    const uid = req.session.usuario.id;
    const produtoId = parseInt(req.body.produto_id, 10);
    const pedidoId = req.body.pedido_id ? parseInt(req.body.pedido_id, 10) : null;
    const quantidade = Math.max(0.01, parseFloat(req.body.quantidade) || 1);
    const unidade = (req.body.unidade || 'un').trim();

    const produto = await db.get('SELECT * FROM produtos WHERE id = ? AND usuario_id = ?', [produtoId, uid]);
    if (!produto) {
      return res.status(404).send('Receita não encontrada.');
    }

    const tempoEstimadoMin = Math.max(1, Math.round((parseFloat(produto.tempo_horas) || 0) * 60));

    const info = await db.run(`
      INSERT INTO producoes (
        usuario_id, produto_id, pedido_id, nome_receita,
        quantidade_produzida, unidade, tempo_estimado_min, status, iniciado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'em_preparo', datetime('now'))
    `, [uid, produtoId, pedidoId, produto.nome, quantidade, unidade, tempoEstimadoMin]);

    const novaId = Number(info.lastInsertRowid);

    if (pedidoId) {
      await db.run("UPDATE pedidos SET status = 'producao', atualizado_em = datetime('now') WHERE id = ? AND usuario_id = ? AND status = 'confirmado'", [pedidoId, uid]);
    }

    res.redirect(`/producao/preparar?producao_id=${novaId}`);
  } catch (err) {
    next(err);
  }
});

// 4. Concluir Preparo
router.post('/:id/concluir', exigirLogin, exigirPermissao('producao', 'editar'), async (req, res, next) => {
  try {
    const uid = req.session.usuario.id;
    const id = parseInt(req.params.id, 10);
    const tempoRealMin = Math.max(1, parseFloat(req.body.tempo_real_min) || 0);
    const observacoes = (req.body.observacoes || '').trim();
    const darBaixaEstoque = req.body.dar_baixa_estoque === '1';
    const avancarPedido = req.body.avancar_pedido === '1';

    const producao = await db.get('SELECT * FROM producoes WHERE id = ? AND usuario_id = ?', [id, uid]);
    if (!producao) {
      return res.status(404).send('Registro de produção não encontrado.');
    }

    await db.transaction(async (tx) => {
      // 1. Atualizar registro da produção
      await tx.run(`
        UPDATE producoes
        SET status = 'concluido',
            tempo_real_min = ?,
            observacoes = ?,
            concluido_em = datetime('now')
        WHERE id = ? AND usuario_id = ?
      `, [tempoRealMin, observacoes || null, id, uid]);

      // 2. Dar baixa opcional de estoque dos insumos
      if (darBaixaEstoque && producao.produto_id) {
        const produto = await tx.get('SELECT rendimento, unidade FROM produtos WHERE id = ?', [producao.produto_id]);
        if (produto) {
          const fator = calcularFatorEscala(producao.quantidade_produzida, producao.unidade, produto.rendimento, produto.unidade);
          const ingredientes = await tx.all('SELECT nome, qtd_usada FROM ingredientes WHERE produto_id = ?', [producao.produto_id]);

          for (const ing of ingredientes) {
            const qtdConsumida = ing.qtd_usada * fator;
            await tx.run(`
              UPDATE ingredientes_catalogo
              SET estoque_atual = MAX(0, estoque_atual - ?),
                  atualizado_em = datetime('now')
              WHERE usuario_id = ? AND LOWER(TRIM(nome)) = LOWER(TRIM(?))
            `, [qtdConsumida, uid, ing.nome]);
          }
        }
      }

      // 3. Avançar status do pedido se vinculado
      if (avancarPedido && producao.pedido_id) {
        await tx.run(`
          UPDATE pedidos
          SET status = 'entregue',
              atualizado_em = datetime('now')
          WHERE id = ? AND usuario_id = ?
        `, [producao.pedido_id, uid]);
      }
    });

    res.redirect('/producao?concluido=1');
  } catch (err) {
    next(err);
  }
});

// 5. Cancelar Preparo
router.post('/:id/cancelar', exigirLogin, exigirPermissao('producao', 'editar'), async (req, res, next) => {
  try {
    const uid = req.session.usuario.id;
    const id = parseInt(req.params.id, 10);

    await db.run(`
      UPDATE producoes
      SET status = 'cancelado',
          concluido_em = datetime('now')
      WHERE id = ? AND usuario_id = ?
    `, [id, uid]);

    res.redirect('/producao');
  } catch (err) {
    next(err);
  }
});

// 6. Gerar Passo a Passo com IA ou Motor Culinário
router.post('/produto/:id/gerar-passos-ia', exigirLogin, exigirPermissao('producao', 'editar'), async (req, res) => {
  try {
    const uid = req.session.usuario.id;
    const produtoId = parseInt(req.params.id, 10);
    const fator = Math.max(0.01, parseFloat(req.body.fator) || 1);

    const produto = await db.get('SELECT * FROM produtos WHERE id = ? AND usuario_id = ?', [produtoId, uid]);
    if (!produto) {
      return res.status(404).json({ sucesso: false, erro: 'Receita não encontrada.' });
    }

    const ingredientes = await db.all('SELECT * FROM ingredientes WHERE produto_id = ? ORDER BY id ASC', [produtoId]);
    const resultado = await chefIa.obterSequenciaPreparo(produto, ingredientes, produto.rendimento, fator);

    res.json({ sucesso: true, sequencia: resultado });
  } catch (err) {
    console.error('Erro ao gerar passos com IA:', err);
    res.status(500).json({ sucesso: false, erro: 'Erro interno ao gerar passos.' });
  }
});

// 7. Salvar Passo a Passo / Modo de Preparo no Produto
router.post('/produto/:id/salvar-modo-preparo', exigirLogin, exigirPermissao('producao', 'editar'), async (req, res) => {
  try {
    const uid = req.session.usuario.id;
    const produtoId = parseInt(req.params.id, 10);
    const modoPreparo = req.body.modo_preparo !== undefined ? req.body.modo_preparo : '';

    const conteudoParaSalvar = typeof modoPreparo === 'object' ? JSON.stringify(modoPreparo) : String(modoPreparo);

    await db.run('UPDATE produtos SET modo_preparo = ? WHERE id = ? AND usuario_id = ?', [conteudoParaSalvar, produtoId, uid]);

    res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro ao salvar modo de preparo:', err);
    res.status(500).json({ sucesso: false, erro: 'Erro ao salvar modo de preparo.' });
  }
});

module.exports = router;
module.exports.calcularFatorEscala = calcularFatorEscala;
