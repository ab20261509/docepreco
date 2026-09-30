const assert = require('assert');
const db = require('../db');

console.log('🧪 Iniciando testes do Módulo Operacional: Agenda de Entregas & Calendário...');

// Limpar dados anteriores
db.prepare("DELETE FROM usuarios WHERE email IN ('agenda_test1@confeitaria.com', 'agenda_test2@confeitaria.com')").run();

try {
  // 1. Criar dois usuários para testar regras e isolamento
  const u1 = db.prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)')
    .run('Confeiteira Ana', 'agenda_test1@confeitaria.com', 'hash1');
  const u2 = db.prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)')
    .run('Confeiteira Bia', 'agenda_test2@confeitaria.com', 'hash2');

  const u1Id = u1.lastInsertRowid;
  const u2Id = u2.lastInsertRowid;

  // Clientes
  const c1 = db.prepare('INSERT INTO clientes (usuario_id, nome, telefone) VALUES (?, ?, ?)')
    .run(u1Id, 'Carlos Cliente', '11988887777');
  const c2 = db.prepare('INSERT INTO clientes (usuario_id, nome, telefone) VALUES (?, ?, ?)')
    .run(u2Id, 'Daniela Outra', '21977776666');

  const c1Id = c1.lastInsertRowid;
  const c2Id = c2.lastInsertRowid;

  // Datas de referência
  const agora = new Date();
  const formatarIso = d => {
    const ano = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(diaIso => diaIso).padStart ? String(d.getDate()).padStart(2, '0') : d.getDate();
    return `${ano}-${mes}-${dia}`;
  };

  const hoje = formatarIso(agora);

  const dAmanha = new Date(agora);
  dAmanha.setDate(dAmanha.getDate() + 1);
  const amanha = formatarIso(dAmanha);

  const dDaqui3 = new Date(agora);
  dDaqui3.setDate(dDaqui3.getDate() + 3);
  const daqui3dias = formatarIso(dDaqui3);

  // Inserir pedidos de Ana (u1Id)
  // Pedido 1: Hoje às 14:00 (Sinal pago R$ 50, saldo pendente R$ 50)
  const resP1 = db.prepare(`
    INSERT INTO pedidos (
      usuario_id, cliente_id, data_pedido, data_entrega, horario_entrega,
      tipo_entrega, status, valor_produtos, valor_total, valor_sinal, status_pagamento
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(u1Id, c1Id, hoje, hoje, '14:00', 'entrega', 'confirmado', 100, 100, 50, 'sinal_pago');
  const p1Id = resP1.lastInsertRowid;

  db.prepare(`INSERT INTO pedido_itens (pedido_id, descricao, quantidade, preco_unitario, subtotal) VALUES (?, ?, ?, ?, ?)`)
    .run(p1Id, 'Bolo de Chocolate', 1, 100, 100);

  // Pedido 2: Hoje às 10:00 (Mais cedo, totalmente pago R$ 60)
  const resP2 = db.prepare(`
    INSERT INTO pedidos (
      usuario_id, cliente_id, data_pedido, data_entrega, horario_entrega,
      tipo_entrega, status, valor_produtos, valor_total, valor_sinal, status_pagamento
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(u1Id, c1Id, hoje, hoje, '10:00', 'retirada', 'confirmado', 60, 60, 60, 'pago');
  const p2Id = resP2.lastInsertRowid;

  // Pedido 3: Amanhã às 16:00
  const resP3 = db.prepare(`
    INSERT INTO pedidos (
      usuario_id, cliente_id, data_pedido, data_entrega, horario_entrega,
      tipo_entrega, status, valor_produtos, valor_total, valor_sinal, status_pagamento
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(u1Id, c1Id, hoje, amanha, '16:00', 'retirada', 'confirmado', 80, 80, 40, 'sinal_pago');
  const p3Id = resP3.lastInsertRowid;

  // Pedido 4: Daqui a 3 dias
  const resP4 = db.prepare(`
    INSERT INTO pedidos (
      usuario_id, cliente_id, data_pedido, data_entrega, horario_entrega,
      tipo_entrega, status, valor_produtos, valor_total, valor_sinal, status_pagamento
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(u1Id, c1Id, hoje, daqui3dias, '11:00', 'entrega', 'orcamento', 150, 150, 0, 'pendente');
  const p4Id = resP4.lastInsertRowid;

  // Pedido do Usuário 2 (Bia) para Hoje (para testar isolamento)
  const resPUser2 = db.prepare(`
    INSERT INTO pedidos (
      usuario_id, cliente_id, data_pedido, data_entrega, horario_entrega,
      tipo_entrega, status, valor_produtos, valor_total, valor_sinal, status_pagamento
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(u2Id, c2Id, hoje, hoje, '15:00', 'retirada', 'confirmado', 200, 200, 100, 'sinal_pago');
  const pUser2Id = resPUser2.lastInsertRowid;

  // 1. Validar busca de pedidos de Hoje para Ana
  const pedidosHojeAna = db.prepare(`
    SELECT p.*, c.nome AS cliente_cadastrado_nome
    FROM pedidos p
    LEFT JOIN clientes c ON p.cliente_id = c.id
    WHERE p.usuario_id = ? AND p.data_entrega = ? AND p.status != 'cancelado'
    ORDER BY CASE WHEN p.horario_entrega IS NULL OR p.horario_entrega = '' THEN '99:99' ELSE p.horario_entrega END ASC
  `).all(u1Id, hoje);

  assert.strictEqual(pedidosHojeAna.length, 2, 'Ana deve ter exatamente 2 pedidos hoje');
  assert.strictEqual(pedidosHojeAna[0].horario_entrega, '10:00', 'O primeiro pedido deve ser o das 10:00 (ordem cronológica)');
  assert.strictEqual(pedidosHojeAna[1].horario_entrega, '14:00', 'O segundo pedido deve ser o das 14:00');
  console.log('✅ Ordenação e filtro de pedidos de Hoje validados com sucesso');

  // 2. Validar cálculo do saldo a receber hoje
  const saldoReceberHoje = pedidosHojeAna
    .filter(p => p.status !== 'entregue' && p.status_pagamento !== 'pago')
    .reduce((acc, p) => acc + Math.max(0, p.valor_total - p.valor_sinal), 0);
  assert.strictEqual(saldoReceberHoje, 50, 'Saldo a receber hoje deve ser R$ 50 (R$ 100 - R$ 50)');
  console.log('✅ Cálculo de saldo pendente a receber para Hoje validado');

  // 3. Validar pedidos de Amanhã
  const pedidosAmanhaAna = db.prepare(`
    SELECT p.* FROM pedidos p
    WHERE p.usuario_id = ? AND p.data_entrega = ? AND p.status != 'cancelado'
  `).all(u1Id, amanha);
  assert.strictEqual(pedidosAmanhaAna.length, 1, 'Ana deve ter 1 pedido amanhã');
  assert.strictEqual(pedidosAmanhaAna[0].id, p3Id);
  console.log('✅ Filtro de pedidos de Amanhã validado com sucesso');

  // 4. Validar pedidos dos Próximos 7 Dias (após amanhã)
  const dDaqui7 = new Date(agora);
  dDaqui7.setDate(dDaqui7.getDate() + 7);
  const daqui7dias = formatarIso(dDaqui7);

  const pedidosSemanaAna = db.prepare(`
    SELECT p.* FROM pedidos p
    WHERE p.usuario_id = ? AND p.data_entrega > ? AND p.data_entrega <= ? AND p.status != 'cancelado'
  `).all(u1Id, amanha, daqui7dias);
  assert.strictEqual(pedidosSemanaAna.length, 1, 'Ana deve ter 1 pedido no restante da semana');
  assert.strictEqual(pedidosSemanaAna[0].id, p4Id);
  console.log('✅ Filtro de carga semanal validado com sucesso');

  // 5. Validar Agrupamento do Calendário Mensal
  const mesAtual = hoje.slice(0, 7);
  const resumoMes = db.prepare(`
    SELECT 
      p.data_entrega,
      COUNT(*) AS total,
      SUM(CASE WHEN p.status = 'entregue' THEN 1 ELSE 0 END) AS concluidos,
      SUM(CASE WHEN p.status IN ('confirmado', 'producao') THEN 1 ELSE 0 END) AS em_producao,
      SUM(CASE WHEN p.status = 'orcamento' THEN 1 ELSE 0 END) AS orcamentos,
      SUM(p.valor_total) AS total_valor
    FROM pedidos p
    WHERE p.usuario_id = ? AND strftime('%Y-%m', p.data_entrega) = ? AND p.status != 'cancelado'
    GROUP BY p.data_entrega
  `).all(u1Id, mesAtual);

  assert.ok(resumoMes.length >= 1, 'Deve agrupar os dias de entrega do mês');
  const resumoHoje = resumoMes.find(r => r.data_entrega === hoje);
  assert.ok(resumoHoje, 'Deve conter registro para a data de hoje');
  assert.strictEqual(resumoHoje.total, 2, 'Total de hoje no calendário deve ser 2');
  assert.strictEqual(resumoHoje.em_producao, 2, 'Ambos pedidos de hoje estão confirmados/produção');
  console.log('✅ Agrupamento do Calendário Mensal aprovado');

  // 6. Testar avanço ágil de status
  db.prepare(`UPDATE pedidos SET status = ? WHERE id = ? AND usuario_id = ?`).run('producao', p1Id, u1Id);
  const p1Atualizado = db.prepare(`SELECT status FROM pedidos WHERE id = ?`).get(p1Id);
  assert.strictEqual(p1Atualizado.status, 'producao', 'Status deve avançar para produção');

  db.prepare(`UPDATE pedidos SET status = ? WHERE id = ? AND usuario_id = ?`).run('entregue', p1Id, u1Id);
  const p1Entregue = db.prepare(`SELECT status FROM pedidos WHERE id = ?`).get(p1Id);
  assert.strictEqual(p1Entregue.status, 'entregue', 'Status deve avançar para entregue');
  console.log('✅ Avanço de status operacional via Agenda validado');

  // 7. Isolamento Multi-tenant
  const pedidosHojeBia = db.prepare(`
    SELECT p.* FROM pedidos p
    WHERE p.usuario_id = ? AND p.data_entrega = ? AND p.status != 'cancelado'
  `).all(u2Id, hoje);
  assert.strictEqual(pedidosHojeBia.length, 1, 'Bia deve ver somente seu próprio pedido de hoje');
  assert.strictEqual(pedidosHojeBia[0].id, pUser2Id);

  // Tentativa do usuário 1 alterar pedido do usuário 2
  const updateTentativa = db.prepare(`UPDATE pedidos SET status = ? WHERE id = ? AND usuario_id = ?`)
    .run('entregue', pUser2Id, u1Id);
  assert.strictEqual(updateTentativa.changes, 0, 'Ana não pode alterar pedido de Bia');
  console.log('✅ Isolamento multi-tenant da Agenda validado com sucesso');

  console.log('🎉 Todos os testes da Agenda de Entregas & Calendário foram concluídos com 100% de sucesso!');
} finally {
  // Limpar registros de teste
  db.prepare("DELETE FROM usuarios WHERE email IN ('agenda_test1@confeitaria.com', 'agenda_test2@confeitaria.com')").run();
}
