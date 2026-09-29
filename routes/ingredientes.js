const express = require('express');
const db = require('../db');
const { exigirLogin } = require('../middleware/auth');

const router = express.Router();

function calcularStatusValidade(dataValidade, statusCompra) {
  if (statusCompra === 'descartado') {
    return { status: 'descartado', rotulo: 'DESCARTADO', classe: 'badge-descartado', dias: 0 };
  }
  if (!dataValidade) {
    return { status: 'sem_validade', rotulo: 'Sem validade', classe: 'badge-neutro', dias: null };
  }
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const [ano, mes, dia] = dataValidade.split('-').map(Number);
  const dataVal = new Date(ano, mes - 1, dia);
  dataVal.setHours(0, 0, 0, 0);

  const diffMs = dataVal.getTime() - hoje.getTime();
  const dias = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (dias < 0) {
    return {
      status: 'vencido',
      rotulo: `VENCIDO (há ${Math.abs(dias)} ${Math.abs(dias) === 1 ? 'dia' : 'dias'})`,
      classe: 'badge-vencido',
      dias
    };
  } else if (dias <= 7) {
    return {
      status: 'vencendo',
      rotulo: dias === 0 ? 'VENCE HOJE!' : `VENCE EM ${dias} ${dias === 1 ? 'DIA' : 'DIAS'}`,
      classe: 'badge-vencendo',
      dias
    };
  } else if (dias <= 30) {
    return {
      status: 'no_prazo',
      rotulo: `No prazo (${dias} dias)`,
      classe: 'badge-em-dia',
      dias
    };
  } else {
    const dataFmt = `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`;
    return {
      status: 'no_prazo',
      rotulo: `✓ ${dataFmt}`,
      classe: 'badge-em-dia',
      dias
    };
  }
}

// Listagem de todos os ingredientes com indicadores de estoque e alertas de validade
router.get('/', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;

  const ingredientes = db.prepare(`
    SELECT * FROM ingredientes_catalogo 
    WHERE usuario_id = ? 
    ORDER BY nome ASC
  `).all(uid);

  let valorTotalEstoque = 0;
  let itensEstoqueBaixo = 0;

  // Obter lotes ativos com validade para listar alertas de risco
  const lotesComValidade = db.prepare(`
    SELECT c.*, ic.nome as ingrediente_nome, ic.unidade as ingrediente_unidade
    FROM ingredientes_compras c
    JOIN ingredientes_catalogo ic ON ic.id = c.ingrediente_id
    WHERE c.usuario_id = ? AND c.status = 'ativo' AND c.data_validade IS NOT NULL
    ORDER BY c.data_validade ASC
  `).all(uid);

  const lotesVencidos = [];
  const lotesVencendo = [];

  lotesComValidade.forEach(lote => {
    const valInfo = calcularStatusValidade(lote.data_validade, lote.status);
    if (valInfo.status === 'vencido') {
      lotesVencidos.push({ ...lote, valInfo });
    } else if (valInfo.status === 'vencendo') {
      lotesVencendo.push({ ...lote, valInfo });
    }
  });

  const listaFormatada = ingredientes.map((item) => {
    const custoGramaOuUnidade = item.qtd_embalagem_padrao > 0 ? (item.preco_atual / item.qtd_embalagem_padrao) : 0;
    const valorEmEstoque = item.estoque_atual * custoGramaOuUnidade;
    valorTotalEstoque += valorEmEstoque;

    const estaBaixo = item.estoque_minimo > 0 && item.estoque_atual <= item.estoque_minimo;
    const estaZerado = item.estoque_atual <= 0;
    if (estaBaixo || estaZerado) {
      itensEstoqueBaixo++;
    }

    // Buscar o lote mais próximo do vencimento para este ingrediente
    const proximoLote = db.prepare(`
      SELECT data_validade FROM ingredientes_compras 
      WHERE ingrediente_id = ? AND status = 'ativo' AND data_validade IS NOT NULL
      ORDER BY data_validade ASC LIMIT 1
    `).get(item.id);

    let infoValidadeProxima = null;
    if (proximoLote && proximoLote.data_validade) {
      infoValidadeProxima = calcularStatusValidade(proximoLote.data_validade, 'ativo');
      infoValidadeProxima.data = proximoLote.data_validade;
    }

    return {
      ...item,
      custoGramaOuUnidade,
      valorEmEstoque,
      estaBaixo,
      estaZerado,
      infoValidadeProxima
    };
  });

  res.render('ingredientes', {
    ingredientes: listaFormatada,
    totalItens: ingredientes.length,
    itensEstoqueBaixo,
    valorTotalEstoque,
    lotesVencidos,
    lotesVencendo,
    sucesso: req.query.sucesso === '1' || req.query.compra_sucesso === '1',
    erro: null,
    activeNav: 'ingredientes'
  });
});

// Cadastrar novo ingrediente
router.post('/', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;
  const nome = (req.body.nome || '').trim();
  const unidade = ['g', 'ml', 'un'].includes(req.body.unidade) ? req.body.unidade : 'g';
  const qtdEmbalagem = parseFloat(req.body.qtd_embalagem_padrao) || 1;
  const estoqueMinimo = Math.max(0, parseFloat(req.body.estoque_minimo) || 0);

  // Compra inicial opcional
  const qtdComprada = parseFloat(req.body.compra_qtd) || 0;
  const valorUnitario = Math.max(0, parseFloat(req.body.compra_valor) || 0);
  const dataValidade = (req.body.data_validade || '').trim() || null;

  if (!nome) {
    return res.status(400).send('O nome do ingrediente é obrigatório.');
  }

  const cadastrarTx = db.transaction(() => {
    const estoqueInicial = qtdComprada * qtdEmbalagem;

    const info = db.prepare(`
      INSERT INTO ingredientes_catalogo 
      (usuario_id, nome, unidade, estoque_atual, estoque_minimo, preco_atual, qtd_embalagem_padrao, atualizado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(uid, nome, unidade, estoqueInicial, estoqueMinimo, valorUnitario, qtdEmbalagem);

    const ingredienteId = info.lastInsertRowid;

    if (qtdComprada > 0 && valorUnitario >= 0) {
      const valorTotal = qtdComprada * valorUnitario;
      const dataCompra = req.body.data_compra || new Date().toISOString().split('T')[0];

      db.prepare(`
        INSERT INTO ingredientes_compras 
        (ingrediente_id, usuario_id, data_compra, data_validade, qtd_embalagens, qtd_por_embalagem, valor_unitario_embalagem, valor_total, status, criado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ativo', datetime('now'))
      `).run(ingredienteId, uid, dataCompra, dataValidade, qtdComprada, qtdEmbalagem, valorUnitario, valorTotal);
    }

    return ingredienteId;
  });

  try {
    const id = cadastrarTx();
    const redirectUrl = req.body.redirect || '/ingredientes?sucesso=1';
    res.redirect(redirectUrl);
  } catch (err) {
    console.error('Erro ao cadastrar ingrediente:', err);
    res.status(500).send('Erro ao cadastrar ingrediente.');
  }
});

// Detalhes do ingrediente com a Grade de Compras, Validades e Histórico
router.get('/:id', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;
  const id = parseInt(req.params.id, 10);

  const ingrediente = db.prepare(`
    SELECT * FROM ingredientes_catalogo 
    WHERE id = ? AND usuario_id = ?
  `).get(id, uid);

  if (!ingrediente) {
    return res.status(404).render('erro_404', { mensagem: 'Ingrediente não encontrado.' });
  }

  const comprasBrutas = db.prepare(`
    SELECT * FROM ingredientes_compras 
    WHERE ingrediente_id = ? AND usuario_id = ?
    ORDER BY data_compra DESC, id DESC
  `).all(id, uid);

  const compras = comprasBrutas.map(c => {
    return {
      ...c,
      valInfo: calcularStatusValidade(c.data_validade, c.status)
    };
  });

  // Buscar receitas (produtos) que utilizam este insumo
  const receitasRelacionadas = db.prepare(`
    SELECT DISTINCT p.id, p.nome 
    FROM produtos p 
    JOIN ingredientes i ON i.produto_id = p.id 
    WHERE LOWER(i.nome) LIKE '%' || LOWER(?) || '%' AND p.usuario_id = ?
  `).all(ingrediente.nome, uid);

  const custoGramaOuUnidade = ingrediente.qtd_embalagem_padrao > 0 ? (ingrediente.preco_atual / ingrediente.qtd_embalagem_padrao) : 0;
  const totalEmbalagensEmEstoque = ingrediente.qtd_embalagem_padrao > 0 ? (ingrediente.estoque_atual / ingrediente.qtd_embalagem_padrao) : 0;

  res.render('ingrediente_detalhes', {
    ingrediente,
    compras,
    receitasRelacionadas,
    custoGramaOuUnidade,
    totalEmbalagensEmEstoque,
    hoje: new Date().toISOString().split('T')[0],
    sucesso: req.query.sucesso === '1',
    descarteSucesso: req.query.descartado === '1',
    compraEditada: req.query.compra_editada === '1',
    compraExcluida: req.query.compra_excluida === '1',
    activeNav: 'ingredientes'
  });
});

// Grade de Compras: Lançar nova compra com Data de Validade
router.post('/:id/compras', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;
  const id = parseInt(req.params.id, 10);

  const ingrediente = db.prepare('SELECT * FROM ingredientes_catalogo WHERE id = ? AND usuario_id = ?').get(id, uid);
  if (!ingrediente) {
    return res.status(404).send('Ingrediente não encontrado.');
  }

  const dataCompra = req.body.data_compra || new Date().toISOString().split('T')[0];
  const dataValidade = (req.body.data_validade || '').trim() || null;
  const qtdEmbalagens = parseFloat(req.body.qtd_embalagens) || 1;
  const qtdPorEmbalagem = parseFloat(req.body.qtd_por_embalagem) || ingrediente.qtd_embalagem_padrao || 1;
  const valorUnitario = Math.max(0, parseFloat(req.body.valor_unitario_embalagem) || 0);
  const valorTotal = qtdEmbalagens * valorUnitario;

  const lancarCompraTx = db.transaction(() => {
    // 1. Inserir registro na grade de compras
    db.prepare(`
      INSERT INTO ingredientes_compras 
      (ingrediente_id, usuario_id, data_compra, data_validade, qtd_embalagens, qtd_por_embalagem, valor_unitario_embalagem, valor_total, status, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ativo', datetime('now'))
    `).run(id, uid, dataCompra, dataValidade, qtdEmbalagens, qtdPorEmbalagem, valorUnitario, valorTotal);

    // 2. Incrementar estoque e atualizar preço de reposição mais recente
    const incrementoEstoque = qtdEmbalagens * qtdPorEmbalagem;
    db.prepare(`
      UPDATE ingredientes_catalogo
      SET estoque_atual = estoque_atual + ?,
          preco_atual = ?,
          qtd_embalagem_padrao = ?,
          atualizado_em = datetime('now')
      WHERE id = ? AND usuario_id = ?
    `).run(incrementoEstoque, valorUnitario, qtdPorEmbalagem, id, uid);
  });

  try {
    lancarCompraTx();
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json')) || req.body.ajax === '1') {
      const atualizado = db.prepare('SELECT * FROM ingredientes_catalogo WHERE id = ? AND usuario_id = ?').get(id, uid);
      return res.json({ sucesso: true, ingrediente: atualizado });
    }
    const redirectUrl = req.body.redirect || `/ingredientes/${id}?sucesso=1`;
    res.redirect(redirectUrl);
  } catch (err) {
    console.error('Erro ao lançar compra:', err);
    res.status(500).send('Erro ao lançar compra.');
  }
});

// Ação de Descarte / Baixa por Validade ou Perda
router.post('/compras/:compraId/descartar', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;
  const compraId = parseInt(req.params.compraId, 10);
  const motivo = (req.body.motivo || 'Descarte por Validade').trim();

  const compra = db.prepare('SELECT * FROM ingredientes_compras WHERE id = ? AND usuario_id = ?').get(compraId, uid);
  if (!compra) {
    return res.status(404).send('Lote de compra não encontrado.');
  }

  if (compra.status !== 'descartado') {
    const volumeDescarte = compra.qtd_embalagens * compra.qtd_por_embalagem;

    const descartarTx = db.transaction(() => {
      db.prepare(`
        UPDATE ingredientes_compras 
        SET status = 'descartado', motivo_baixa = ?
        WHERE id = ? AND usuario_id = ?
      `).run(motivo, compraId, uid);

      db.prepare(`
        UPDATE ingredientes_catalogo
        SET estoque_atual = MAX(0, estoque_atual - ?),
            atualizado_em = datetime('now')
        WHERE id = ? AND usuario_id = ?
      `).run(volumeDescarte, compra.ingrediente_id, uid);
    });

    try {
      descartarTx();
    } catch (err) {
      console.error('Erro ao descartar lote:', err);
      return res.status(500).send('Erro ao descartar lote.');
    }
  }

  res.redirect(`/ingredientes/${compra.ingrediente_id}?descartado=1`);
});

// Editar uma compra existente (recalcula volume de estoque e preço)
router.post('/compras/:compraId/editar', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;
  const compraId = parseInt(req.params.compraId, 10);

  const compra = db.prepare('SELECT * FROM ingredientes_compras WHERE id = ? AND usuario_id = ?').get(compraId, uid);
  if (!compra) {
    return res.status(404).send('Compra não encontrada.');
  }

  const dataCompra = req.body.data_compra || compra.data_compra;
  const dataValidade = (req.body.data_validade || '').trim() || null;
  const qtdEmbalagens = parseFloat(req.body.qtd_embalagens) || 1;
  const qtdPorEmbalagem = parseFloat(req.body.qtd_por_embalagem) || compra.qtd_por_embalagem;
  const valorUnitario = Math.max(0, parseFloat(req.body.valor_unitario_embalagem) || 0);
  const valorTotal = qtdEmbalagens * valorUnitario;

  const editarCompraTx = db.transaction(() => {
    if (compra.status === 'ativo') {
      const volumeAntigo = compra.qtd_embalagens * compra.qtd_por_embalagem;
      const volumeNovo = qtdEmbalagens * qtdPorEmbalagem;
      const diferenca = volumeNovo - volumeAntigo;

      db.prepare(`
        UPDATE ingredientes_catalogo
        SET estoque_atual = MAX(0, estoque_atual + ?),
            preco_atual = ?,
            qtd_embalagem_padrao = ?,
            atualizado_em = datetime('now')
        WHERE id = ? AND usuario_id = ?
      `).run(diferenca, valorUnitario, qtdPorEmbalagem, compra.ingrediente_id, uid);
    }

    db.prepare(`
      UPDATE ingredientes_compras
      SET data_compra = ?,
          data_validade = ?,
          qtd_embalagens = ?,
          qtd_por_embalagem = ?,
          valor_unitario_embalagem = ?,
          valor_total = ?
      WHERE id = ? AND usuario_id = ?
    `).run(dataCompra, dataValidade, qtdEmbalagens, qtdPorEmbalagem, valorUnitario, valorTotal, compraId, uid);
  });

  try {
    editarCompraTx();
    res.redirect(`/ingredientes/${compra.ingrediente_id}?compra_editada=1`);
  } catch (err) {
    console.error('Erro ao editar compra:', err);
    res.status(500).send('Erro ao editar compra.');
  }
});

// Excluir uma compra lançada por engano
router.post('/compras/:compraId/excluir', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;
  const compraId = parseInt(req.params.compraId, 10);

  const compra = db.prepare('SELECT * FROM ingredientes_compras WHERE id = ? AND usuario_id = ?').get(compraId, uid);
  if (!compra) {
    return res.status(404).send('Compra não encontrada.');
  }

  const excluirCompraTx = db.transaction(() => {
    if (compra.status === 'ativo') {
      const volume = compra.qtd_embalagens * compra.qtd_por_embalagem;
      db.prepare(`
        UPDATE ingredientes_catalogo
        SET estoque_atual = MAX(0, estoque_atual - ?),
            atualizado_em = datetime('now')
        WHERE id = ? AND usuario_id = ?
      `).run(volume, compra.ingrediente_id, uid);
    }

    db.prepare('DELETE FROM ingredientes_compras WHERE id = ? AND usuario_id = ?').run(compraId, uid);
  });

  try {
    excluirCompraTx();
    res.redirect(`/ingredientes/${compra.ingrediente_id}?compra_excluida=1`);
  } catch (err) {
    console.error('Erro ao excluir compra:', err);
    res.status(500).send('Erro ao excluir compra.');
  }
});

// Ajuste manual de estoque (inventário / quebras)
router.post('/:id/ajuste-estoque', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;
  const id = parseInt(req.params.id, 10);
  const novoEstoque = Math.max(0, parseFloat(req.body.novo_estoque) || 0);

  db.prepare(`
    UPDATE ingredientes_catalogo 
    SET estoque_atual = ?, atualizado_em = datetime('now') 
    WHERE id = ? AND usuario_id = ?
  `).run(novoEstoque, id, uid);

  res.redirect(`/ingredientes/${id}?sucesso=1`);
});

// Editar dados básicos do ingrediente
router.post('/:id/editar', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;
  const id = parseInt(req.params.id, 10);

  const nome = (req.body.nome || '').trim();
  const unidade = ['g', 'ml', 'un'].includes(req.body.unidade) ? req.body.unidade : 'g';
  const estoqueMinimo = Math.max(0, parseFloat(req.body.estoque_minimo) || 0);
  const qtdEmbalagem = parseFloat(req.body.qtd_embalagem_padrao) || 1;
  const precoAtual = parseFloat(req.body.preco_atual);

  if (!nome) {
    return res.status(400).send('Nome é obrigatório.');
  }

  if (!isNaN(precoAtual) && precoAtual >= 0) {
    db.prepare(`
      UPDATE ingredientes_catalogo
      SET nome = ?, unidade = ?, estoque_minimo = ?, qtd_embalagem_padrao = ?, preco_atual = ?, atualizado_em = datetime('now')
      WHERE id = ? AND usuario_id = ?
    `).run(nome, unidade, estoqueMinimo, qtdEmbalagem, precoAtual, id, uid);
  } else {
    db.prepare(`
      UPDATE ingredientes_catalogo
      SET nome = ?, unidade = ?, estoque_minimo = ?, qtd_embalagem_padrao = ?, atualizado_em = datetime('now')
      WHERE id = ? AND usuario_id = ?
    `).run(nome, unidade, estoqueMinimo, qtdEmbalagem, id, uid);
  }

  const redirectUrl = req.body.redirect || `/ingredientes/${id}?sucesso=1`;
  res.redirect(redirectUrl);
});

// Excluir ingrediente
router.post('/:id/excluir', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;
  const id = parseInt(req.params.id, 10);

  db.prepare('DELETE FROM ingredientes_catalogo WHERE id = ? AND usuario_id = ?').run(id, uid);
  res.redirect('/ingredientes');
});

// Endpoint JSON para integração com formulário de produtos
router.get('/api/lista', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;
  const itens = db.prepare(`
    SELECT id, nome, unidade, estoque_atual, estoque_minimo, preco_atual, qtd_embalagem_padrao
    FROM ingredientes_catalogo
    WHERE usuario_id = ?
    ORDER BY nome ASC
  `).all(uid);

  res.json(itens);
});

module.exports = router;
