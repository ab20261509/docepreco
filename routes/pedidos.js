const express = require('express');
const db = require('../db');
const { exigirLogin } = require('../middleware/auth');
const { custoFixoHora, calcularProduto } = require('../calculo');
const { formatarTelefone, gerarLinkWhatsApp: helperLinkWhatsApp } = require('./clientes');

const router = express.Router();

function formatarMoeda(val) {
  const num = Number(val) || 0;
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarDataBR(dataIso) {
  if (!dataIso) return '';
  const partes = dataIso.split('-');
  if (partes.length === 3) return partes[2] + '/' + partes[1] + '/' + partes[0];
  return dataIso;
}

function buscarProdutosComPreco(usuarioId) {
  const totalFixosRow = db.prepare('SELECT COALESCE(SUM(valor_mensal), 0) AS t FROM custos_fixos WHERE usuario_id = ?').get(usuarioId);
  const totalFixos = totalFixosRow ? totalFixosRow.t : 0;
  const configRow = db.prepare('SELECT horas_mes FROM configuracoes WHERE usuario_id = ?').get(usuarioId);
  const horasMes = configRow && configRow.horas_mes > 0 ? configRow.horas_mes : 160;
  const cfHora = custoFixoHora(totalFixos, horasMes);

  const produtos = db.prepare('SELECT * FROM produtos WHERE usuario_id = ? ORDER BY nome ASC').all(usuarioId);
  return produtos.map(p => {
    const ing = db.prepare('SELECT * FROM ingredientes WHERE produto_id = ?').all(p.id);
    const comp = db.prepare('SELECT * FROM complementos WHERE produto_id = ?').all(p.id);
    let precoSugerido = 0;
    try {
      const calc = calcularProduto(p, ing, comp, cfHora);
      precoSugerido = calc && calc.preco > 0 ? Number(calc.preco.toFixed(2)) : 0;
    } catch (_) {}
    return {
      id: p.id,
      nome: p.nome,
      rendimento: p.rendimento,
      precoSugerido
    };
  });
}

function gerarTextoWhatsApp(pedido, itens) {
  const clienteNome = pedido.cliente_cadastrado_nome || pedido.cliente_nome_avulso || 'Cliente';
  const dataEntregaFmt = formatarDataBR(pedido.data_entrega);
  const horario = pedido.horario_entrega ? ' às ' + pedido.horario_entrega : '';
  const tipo = pedido.tipo_entrega === 'entrega' ? '🚗 Entrega no Endereço' : '🏬 Retirada no Local';
  const endereco = (pedido.tipo_entrega === 'entrega' && pedido.endereco_entrega) ? '\n📍 *Endereço*: ' + pedido.endereco_entrega : '';

  let texto = '🧁 *' + (pedido.status === 'orcamento' ? 'ORÇAMENTO' : 'PEDIDO') + ' #' + pedido.id + ' - DOCE PREÇO* 🧁\n\n';
  texto += '👤 *Cliente*: ' + clienteNome + '\n';
  texto += '📅 *Data de Entrega*: ' + dataEntregaFmt + horario + '\n';
  texto += '📦 *Forma de Recebimento*: ' + tipo + endereco + '\n\n';
  
  texto += '🎂 *ITENS:*\n';
  itens.forEach(item => {
    const obs = item.observacao ? ' _(' + item.observacao + ')_' : '';
    texto += '• *' + item.quantidade + 'x* ' + item.descricao + ' — ' + formatarMoeda(item.preco_unitario) + ' un = *' + formatarMoeda(item.subtotal) + '*' + obs + '\n';
  });
  
  texto += '\n💰 *Subtotal*: ' + formatarMoeda(pedido.valor_produtos) + '\n';
  if (pedido.taxa_entrega > 0) {
    texto += '🚗 *Taxa de Entrega*: +' + formatarMoeda(pedido.taxa_entrega) + '\n';
  }
  if (pedido.desconto > 0) {
    texto += '🏷️ *Desconto*: -' + formatarMoeda(pedido.desconto) + '\n';
  }
  texto += '⭐ *VALOR TOTAL*: *' + formatarMoeda(pedido.valor_total) + '*\n\n';
  
  if (pedido.valor_sinal > 0) {
    const statusSinal = (pedido.status_pagamento === 'sinal_pago' || pedido.status_pagamento === 'pago') ? '✅ Pago' : '⏳ A Pagar';
    const saldo = Math.max(0, pedido.valor_total - pedido.valor_sinal);
    texto += '💵 *Sinal / Entrada*: ' + formatarMoeda(pedido.valor_sinal) + ' (' + statusSinal + ')\n';
    texto += '💳 *Saldo Restante*: *' + formatarMoeda(saldo) + '* (na entrega)\n';
  } else if (pedido.status_pagamento === 'pago') {
    texto += '💵 *Pagamento*: ✅ Totalmente Pago\n';
  } else {
    texto += '💵 *Pagamento*: ⏳ Pendente na entrega\n';
  }

  if (pedido.forma_pagamento) {
    texto += '💳 *Forma de Pagamento*: ' + pedido.forma_pagamento + '\n';
  }

  if (pedido.observacoes) {
    texto += '\n📝 *Observações*: ' + pedido.observacoes + '\n';
  }

  texto += '\nMuito obrigada pela preferência! Ficamos à disposição para qualquer dúvida. 💕';

  return texto;
}

// 1. Listagem de Pedidos
router.get('/', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;
  const statusFiltro = (req.query.status || 'todos').toLowerCase();

  let querySql = `
    SELECT 
      p.*,
      c.nome AS cliente_cadastrado_nome,
      c.telefone AS cliente_cadastrado_telefone,
      c.bairro AS cliente_cadastrado_bairro,
      (SELECT COUNT(*) FROM pedido_itens WHERE pedido_id = p.id) AS total_itens,
      (SELECT GROUP_CONCAT(quantidade || 'x ' || descricao, ', ') FROM pedido_itens WHERE pedido_id = p.id) AS resumo_itens
    FROM pedidos p
    LEFT JOIN clientes c ON c.id = p.cliente_id
    WHERE p.usuario_id = ?
  `;
  const params = [uid];

  if (statusFiltro && statusFiltro !== 'todos') {
    querySql += ' AND p.status = ?';
    params.push(statusFiltro);
  }

  querySql += ' ORDER BY p.data_entrega ASC, p.horario_entrega ASC, p.id DESC';

  const pedidos = db.prepare(querySql).all(...params);

  // KPIs
  const kpis = db.prepare(`
    SELECT 
      COUNT(*) AS total_pedidos,
      SUM(CASE WHEN status IN ('orcamento', 'confirmado', 'producao') THEN 1 ELSE 0 END) AS total_abertos,
      SUM(CASE WHEN status = 'entregue' THEN 1 ELSE 0 END) AS total_entregues,
      SUM(CASE WHEN status != 'cancelado' THEN valor_total ELSE 0 END) AS faturamento_previsto
    FROM pedidos
    WHERE usuario_id = ?
  `).get(uid);

  const listaFormatada = pedidos.map(p => {
    const nomeCliente = p.cliente_cadastrado_nome || p.cliente_nome_avulso || 'Cliente Avulso';
    const telefone = p.cliente_cadastrado_telefone || p.cliente_telefone_avulso || '';
    const saldoRestante = Math.max(0, p.valor_total - p.valor_sinal);

    return {
      ...p,
      nomeCliente,
      telefoneFormatado: formatarTelefone(telefone),
      waLink: helperLinkWhatsApp(telefone),
      dataEntregaFmt: formatarDataBR(p.data_entrega),
      saldoRestante
    };
  });

  res.render('pedidos', {
    pedidos: listaFormatada,
    statusFiltro,
    kpis: {
      total: kpis.total_pedidos || 0,
      abertos: kpis.total_abertos || 0,
      entregues: kpis.total_entregues || 0,
      faturamento: kpis.faturamento_previsto || 0
    },
    sucesso: req.query.sucesso === '1',
    activeNav: 'pedidos',
    activeModulo: 'comercial'
  });
});

// 2. Formulário de Novo Pedido / Orçamento
router.get('/novo', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;
  const clientes = db.prepare('SELECT id, nome, telefone, endereco, bairro, cidade FROM clientes WHERE usuario_id = ? ORDER BY nome ASC').all(uid);
  const produtos = buscarProdutosComPreco(uid);

  const clientePreSelecionado = req.query.cliente_id ? parseInt(req.query.cliente_id, 10) : null;

  res.render('pedido_form', {
    pedido: null,
    itens: [],
    clientes,
    produtos,
    clientePreSelecionado,
    activeNav: 'pedidos',
    activeModulo: 'comercial'
  });
});

// 3. Salvar Novo Pedido / Orçamento
router.post('/', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;
  
  const clienteId = req.body.cliente_id ? parseInt(req.body.cliente_id, 10) : null;
  const clienteNomeAvulso = (req.body.cliente_nome_avulso || '').trim();
  const clienteTelefoneAvulso = (req.body.cliente_telefone_avulso || '').trim();
  const dataEntrega = (req.body.data_entrega || '').trim();
  const horarioEntrega = (req.body.horario_entrega || '').trim();
  const tipoEntrega = req.body.tipo_entrega === 'entrega' ? 'entrega' : 'retirada';
  const enderecoEntrega = (req.body.endereco_entrega || '').trim();
  const status = ['orcamento', 'confirmado', 'producao', 'entregue', 'cancelado'].includes(req.body.status) ? req.body.status : 'orcamento';
  const taxaEntrega = Math.max(0, parseFloat(req.body.taxa_entrega) || 0);
  const desconto = Math.max(0, parseFloat(req.body.desconto) || 0);
  const valorSinal = Math.max(0, parseFloat(req.body.valor_sinal) || 0);
  const statusPagamento = ['pendente', 'sinal_pago', 'pago'].includes(req.body.status_pagamento) ? req.body.status_pagamento : 'pendente';
  const formaPagamento = (req.body.forma_pagamento || '').trim();
  const observacoes = (req.body.observacoes || '').trim();

  if (!dataEntrega) {
    return res.status(400).send('A data de entrega é obrigatória.');
  }

  // Parse dos itens
  let itensParsed = [];
  const descs = Array.isArray(req.body.item_descricao) ? req.body.item_descricao : (req.body.item_descricao ? [req.body.item_descricao] : []);
  const prods = Array.isArray(req.body.item_produto_id) ? req.body.item_produto_id : (req.body.item_produto_id ? [req.body.item_produto_id] : []);
  const qtds = Array.isArray(req.body.item_quantidade) ? req.body.item_quantidade : (req.body.item_quantidade ? [req.body.item_quantidade] : []);
  const precos = Array.isArray(req.body.item_preco) ? req.body.item_preco : (req.body.item_preco ? [req.body.item_preco] : []);
  const obss = Array.isArray(req.body.item_observacao) ? req.body.item_observacao : (req.body.item_observacao ? [req.body.item_observacao] : []);

  let valorProdutos = 0;
  for (let i = 0; i < descs.length; i++) {
    const descricao = (descs[i] || '').trim();
    if (!descricao) continue;
    const prodId = prods[i] ? parseInt(prods[i], 10) : null;
    const qtd = Math.max(0.01, parseFloat(qtds[i]) || 1);
    const preco = Math.max(0, parseFloat(precos[i]) || 0);
    const subtotal = Number((qtd * preco).toFixed(2));
    const obs = (obss[i] || '').trim();
    
    valorProdutos += subtotal;
    itensParsed.push({ produtoId: prodId, descricao, quantidade: qtd, precoUnitario: preco, subtotal, observacao: obs });
  }

  if (itensParsed.length === 0) {
    return res.status(400).send('O pedido precisa ter pelo menos um item.');
  }

  const valorTotal = Math.max(0, Number((valorProdutos + taxaEntrega - desconto).toFixed(2)));

  const salvar = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO pedidos (
        usuario_id, cliente_id, cliente_nome_avulso, cliente_telefone_avulso,
        data_entrega, horario_entrega, tipo_entrega, endereco_entrega,
        status, valor_produtos, taxa_entrega, desconto, valor_total,
        valor_sinal, status_pagamento, forma_pagamento, observacoes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uid, clienteId, clienteNomeAvulso || null, clienteTelefoneAvulso || null,
      dataEntrega, horarioEntrega || null, tipoEntrega, enderecoEntrega || null,
      status, valorProdutos, taxaEntrega, desconto, valorTotal,
      valorSinal, statusPagamento, formaPagamento || null, observacoes || null
    );

    const pedidoId = result.lastInsertRowid;
    const insertItem = db.prepare(`
      INSERT INTO pedido_itens (pedido_id, produto_id, descricao, quantidade, preco_unitario, subtotal, observacao)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of itensParsed) {
      insertItem.run(pedidoId, item.produtoId, item.descricao, item.quantidade, item.precoUnitario, item.subtotal, item.observacao || null);
    }

    return pedidoId;
  });

  try {
    const pedidoId = salvar();
    res.redirect('/pedidos/' + pedidoId + '?sucesso=1');
  } catch (err) {
    console.error('Erro ao salvar pedido:', err);
    res.status(500).send('Erro ao salvar pedido.');
  }
});

// 4. Detalhes do Pedido com Mensagem WhatsApp
router.get('/:id', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;
  const id = parseInt(req.params.id, 10);

  const pedido = db.prepare(`
    SELECT 
      p.*,
      c.nome AS cliente_cadastrado_nome,
      c.telefone AS cliente_cadastrado_telefone,
      c.endereco AS cliente_cadastrado_endereco,
      c.bairro AS cliente_cadastrado_bairro,
      c.cidade AS cliente_cadastrado_cidade
    FROM pedidos p
    LEFT JOIN clientes c ON c.id = p.cliente_id
    WHERE p.id = ? AND p.usuario_id = ?
  `).get(id, uid);

  if (!pedido) {
    return res.status(404).render('erro_404', { mensagem: 'Pedido não encontrado.', activeNav: 'pedidos' });
  }

  const itens = db.prepare(`
    SELECT pi.*, p.nome AS produto_nome
    FROM pedido_itens pi
    LEFT JOIN produtos p ON p.id = pi.produto_id
    WHERE pi.pedido_id = ?
  `).all(id);

  const textoWhatsApp = gerarTextoWhatsApp(pedido, itens);
  const telefone = pedido.cliente_cadastrado_telefone || pedido.cliente_telefone_avulso || '';
  const waLink = helperLinkWhatsApp(telefone) ? helperLinkWhatsApp(telefone) + '?text=' + encodeURIComponent(textoWhatsApp) : null;
  const saldoRestante = Math.max(0, pedido.valor_total - pedido.valor_sinal);

  res.render('pedido_detalhes', {
    pedido: {
      ...pedido,
      nomeCliente: pedido.cliente_cadastrado_nome || pedido.cliente_nome_avulso || 'Cliente Avulso',
      telefoneFormatado: formatarTelefone(telefone),
      dataEntregaFmt: formatarDataBR(pedido.data_entrega),
      saldoRestante
    },
    itens,
    textoWhatsApp,
    waLink,
    sucesso: req.query.sucesso === '1',
    activeNav: 'pedidos',
    activeModulo: 'comercial'
  });
});

// 5. Formulário de Edição de Pedido
router.get('/:id/editar', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;
  const id = parseInt(req.params.id, 10);

  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ? AND usuario_id = ?').get(id, uid);
  if (!pedido) {
    return res.status(404).render('erro_404', { mensagem: 'Pedido não encontrado.', activeNav: 'pedidos' });
  }

  const itens = db.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ?').all(id);
  const clientes = db.prepare('SELECT id, nome, telefone, endereco, bairro, cidade FROM clientes WHERE usuario_id = ? ORDER BY nome ASC').all(uid);
  const produtos = buscarProdutosComPreco(uid);

  res.render('pedido_form', {
    pedido,
    itens,
    clientes,
    produtos,
    clientePreSelecionado: pedido.cliente_id,
    activeNav: 'pedidos',
    activeModulo: 'comercial'
  });
});

// 6. Atualizar Pedido Existente
router.post('/:id/editar', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;
  const id = parseInt(req.params.id, 10);

  const pedidoAtual = db.prepare('SELECT id FROM pedidos WHERE id = ? AND usuario_id = ?').get(id, uid);
  if (!pedidoAtual) {
    return res.status(404).send('Pedido não encontrado.');
  }

  const clienteId = req.body.cliente_id ? parseInt(req.body.cliente_id, 10) : null;
  const clienteNomeAvulso = (req.body.cliente_nome_avulso || '').trim();
  const clienteTelefoneAvulso = (req.body.cliente_telefone_avulso || '').trim();
  const dataEntrega = (req.body.data_entrega || '').trim();
  const horarioEntrega = (req.body.horario_entrega || '').trim();
  const tipoEntrega = req.body.tipo_entrega === 'entrega' ? 'entrega' : 'retirada';
  const enderecoEntrega = (req.body.endereco_entrega || '').trim();
  const status = ['orcamento', 'confirmado', 'producao', 'entregue', 'cancelado'].includes(req.body.status) ? req.body.status : 'orcamento';
  const taxaEntrega = Math.max(0, parseFloat(req.body.taxa_entrega) || 0);
  const desconto = Math.max(0, parseFloat(req.body.desconto) || 0);
  const valorSinal = Math.max(0, parseFloat(req.body.valor_sinal) || 0);
  const statusPagamento = ['pendente', 'sinal_pago', 'pago'].includes(req.body.status_pagamento) ? req.body.status_pagamento : 'pendente';
  const formaPagamento = (req.body.forma_pagamento || '').trim();
  const observacoes = (req.body.observacoes || '').trim();

  if (!dataEntrega) {
    return res.status(400).send('A data de entrega é obrigatória.');
  }

  let itensParsed = [];
  const descs = Array.isArray(req.body.item_descricao) ? req.body.item_descricao : (req.body.item_descricao ? [req.body.item_descricao] : []);
  const prods = Array.isArray(req.body.item_produto_id) ? req.body.item_produto_id : (req.body.item_produto_id ? [req.body.item_produto_id] : []);
  const qtds = Array.isArray(req.body.item_quantidade) ? req.body.item_quantidade : (req.body.item_quantidade ? [req.body.item_quantidade] : []);
  const precos = Array.isArray(req.body.item_preco) ? req.body.item_preco : (req.body.item_preco ? [req.body.item_preco] : []);
  const obss = Array.isArray(req.body.item_observacao) ? req.body.item_observacao : (req.body.item_observacao ? [req.body.item_observacao] : []);

  let valorProdutos = 0;
  for (let i = 0; i < descs.length; i++) {
    const descricao = (descs[i] || '').trim();
    if (!descricao) continue;
    const prodId = prods[i] ? parseInt(prods[i], 10) : null;
    const qtd = Math.max(0.01, parseFloat(qtds[i]) || 1);
    const preco = Math.max(0, parseFloat(precos[i]) || 0);
    const subtotal = Number((qtd * preco).toFixed(2));
    const obs = (obss[i] || '').trim();
    
    valorProdutos += subtotal;
    itensParsed.push({ produtoId: prodId, descricao, quantidade: qtd, precoUnitario: preco, subtotal, observacao: obs });
  }

  if (itensParsed.length === 0) {
    return res.status(400).send('O pedido precisa ter pelo menos um item.');
  }

  const valorTotal = Math.max(0, Number((valorProdutos + taxaEntrega - desconto).toFixed(2)));

  const atualizar = db.transaction(() => {
    db.prepare(`
      UPDATE pedidos SET
        cliente_id = ?, cliente_nome_avulso = ?, cliente_telefone_avulso = ?,
        data_entrega = ?, horario_entrega = ?, tipo_entrega = ?, endereco_entrega = ?,
        status = ?, valor_produtos = ?, taxa_entrega = ?, desconto = ?, valor_total = ?,
        valor_sinal = ?, status_pagamento = ?, forma_pagamento = ?, observacoes = ?,
        atualizado_em = datetime('now')
      WHERE id = ? AND usuario_id = ?
    `).run(
      clienteId, clienteNomeAvulso || null, clienteTelefoneAvulso || null,
      dataEntrega, horarioEntrega || null, tipoEntrega, enderecoEntrega || null,
      status, valorProdutos, taxaEntrega, desconto, valorTotal,
      valorSinal, statusPagamento, formaPagamento || null, observacoes || null,
      id, uid
    );

    // Substituir itens
    db.prepare('DELETE FROM pedido_itens WHERE pedido_id = ?').run(id);

    const insertItem = db.prepare(`
      INSERT INTO pedido_itens (pedido_id, produto_id, descricao, quantidade, preco_unitario, subtotal, observacao)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of itensParsed) {
      insertItem.run(id, item.produtoId, item.descricao, item.quantidade, item.precoUnitario, item.subtotal, item.observacao || null);
    }
  });

  try {
    atualizar();
    res.redirect('/pedidos/' + id + '?sucesso=1');
  } catch (err) {
    console.error('Erro ao atualizar pedido:', err);
    res.status(500).send('Erro ao atualizar pedido.');
  }
});

// 7. Atualização Rápida de Status
router.post('/:id/status', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;
  const id = parseInt(req.params.id, 10);
  const novoStatus = (req.body.novo_status || '').trim();

  if (!['orcamento', 'confirmado', 'producao', 'entregue', 'cancelado'].includes(novoStatus)) {
    return res.status(400).send('Status inválido.');
  }

  try {
    db.prepare(`
      UPDATE pedidos 
      SET status = ?, atualizado_em = datetime('now')
      WHERE id = ? AND usuario_id = ?
    `).run(novoStatus, id, uid);

    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({ sucesso: true, novoStatus });
    }

    res.redirect(req.headers.referer || '/pedidos');
  } catch (err) {
    console.error('Erro ao atualizar status:', err);
    res.status(500).send('Erro ao atualizar status.');
  }
});

// 8. Excluir Pedido
router.post('/:id/excluir', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;
  const id = parseInt(req.params.id, 10);

  try {
    db.prepare('DELETE FROM pedidos WHERE id = ? AND usuario_id = ?').run(id, uid);
    res.redirect('/pedidos?sucesso=1');
  } catch (err) {
    console.error('Erro ao excluir pedido:', err);
    res.status(500).send('Erro ao excluir pedido.');
  }
});

module.exports = router;
module.exports.gerarTextoWhatsApp = gerarTextoWhatsApp;
module.exports.buscarProdutosComPreco = buscarProdutosComPreco;
