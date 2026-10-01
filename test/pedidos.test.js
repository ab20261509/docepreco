const assert = require('assert');
const db = require('../db');
const { gerarTextoWhatsApp, buscarProdutosComPreco } = require('../routes/pedidos');

console.log('🧪 Iniciando testes do Módulo Comercial: Pedidos & Orçamentos...');

async function run() {
  await db.rodarMigracoes();

  // Limpar dados anteriores
  await db.run("DELETE FROM usuarios WHERE email IN ('pedidos_test1@confeitaria.com', 'pedidos_test2@confeitaria.com')");

  // 1. Criar duas usuárias de teste
  const u1 = await db.run('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)', ['Confeiteira Clara', 'pedidos_test1@confeitaria.com', 'hash_fake']);
  const uid1 = u1.lastInsertRowid;

  const u2 = await db.run('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)', ['Confeiteira Denise', 'pedidos_test2@confeitaria.com', 'hash_fake']);
  const uid2 = u2.lastInsertRowid;

  // 2. Criar cliente para usuária Clara
  const resCli = await db.run(`
    INSERT INTO clientes (usuario_id, nome, telefone, email, endereco, bairro, cidade)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [uid1, 'Juliana Paes', '11988889999', 'juliana@email.com', 'Rua das Flores, 123', 'Jardins', 'São Paulo']);
  const clienteId = resCli.lastInsertRowid;

  // 3. Criar produto na fábrica para usuária Clara
  const resProd = await db.run(`
    INSERT INTO produtos (usuario_id, nome, rendimento, tempo_horas, mao_obra_extra, margem_pct, taxas_pct)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [uid1, 'Bolo Red Velvet', 1, 1.5, 0, 40, 5]);
  const prodId = resProd.lastInsertRowid;

  await db.run(`
    INSERT INTO ingredientes (produto_id, nome, qtd_usada, preco_pacote, qtd_pacote)
    VALUES (?, ?, ?, ?, ?)
  `, [prodId, 'Farinha de Trigo', 300, 6.00, 1000]);

  // Custos fixos para Clara
  await db.run("INSERT INTO custos_fixos (usuario_id, item, valor_mensal) VALUES (?, 'Energia', 200)", [uid1]);

  // 4. Testar buscarProdutosComPreco
  const produtosComPreco = await buscarProdutosComPreco(uid1);
  assert.strictEqual(produtosComPreco.length, 1);
  assert.strictEqual(produtosComPreco[0].nome, 'Bolo Red Velvet');
  assert.ok(produtosComPreco[0].precoSugerido > 0, 'Preço sugerido deve ser maior que zero');
  console.log('✅ Cálculo de Preço Sugerido da Fábrica para o Pedido aprovado: R$ ' + produtosComPreco[0].precoSugerido);

  // 5. Testar criação de pedido e cálculo financeiro
  const valorUnitario = produtosComPreco[0].precoSugerido;
  const qtd = 2;
  const subtotalProd = Number((qtd * valorUnitario).toFixed(2));
  const taxaEntrega = 15.00;
  const desconto = 5.00;
  const valorTotal = Number((subtotalProd + taxaEntrega - desconto).toFixed(2));
  const valorSinal = Number((valorTotal / 2).toFixed(2));

  const resPed = await db.run(`
    INSERT INTO pedidos (
      usuario_id, cliente_id, data_entrega, horario_entrega, tipo_entrega, endereco_entrega,
      status, valor_produtos, taxa_entrega, desconto, valor_total, valor_sinal,
      status_pagamento, forma_pagamento, observacoes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    uid1, clienteId, '2026-10-15', '16:00', 'entrega', 'Rua das Flores, 123 - Jardins',
    'orcamento', subtotalProd, taxaEntrega, desconto, valorTotal, valorSinal,
    'sinal_pago', 'Pix', 'Entregar na portaria'
  ]);
  const pedidoId = resPed.lastInsertRowid;

  // Inserir itens: 1 produto da fábrica + 1 item avulso (topo de bolo)
  await db.run(`
    INSERT INTO pedido_itens (pedido_id, produto_id, descricao, quantidade, preco_unitario, subtotal, observacao)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [pedidoId, prodId, 'Bolo Red Velvet', qtd, valorUnitario, subtotalProd, 'Tema Primavera']);

  await db.run(`
    INSERT INTO pedido_itens (pedido_id, produto_id, descricao, quantidade, preco_unitario, subtotal, observacao)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [pedidoId, null, 'Topo de Bolo Personalizado', 1, 25.00, 25.00, 'Escrita: Parabéns Ju']);

  // 6. Validar itens inseridos
  const itens = await db.all('SELECT * FROM pedido_itens WHERE pedido_id = ? ORDER BY id ASC', [pedidoId]);
  assert.strictEqual(itens.length, 2, 'Pedido deve conter exatamente 2 itens');
  assert.strictEqual(itens[0].descricao, 'Bolo Red Velvet');
  assert.strictEqual(itens[0].produto_id, prodId);
  assert.strictEqual(itens[1].descricao, 'Topo de Bolo Personalizado');
  assert.strictEqual(itens[1].produto_id, null);
  console.log('✅ Pedido criado com produtos da fábrica e itens avulsos com sucesso');

  // 7. Testar geração de texto para WhatsApp
  const pedidoCompleto = await db.get(`
    SELECT p.*, c.nome AS cliente_cadastrado_nome, c.telefone AS cliente_cadastrado_telefone
    FROM pedidos p
    LEFT JOIN clientes c ON c.id = p.cliente_id
    WHERE p.id = ?
  `, [pedidoId]);

  const textoWhats = gerarTextoWhatsApp(pedidoCompleto, itens);
  assert.ok(textoWhats.includes('Bolo Red Velvet'), 'Texto WhatsApp deve conter o produto');
  assert.ok(textoWhats.includes('Topo de Bolo Personalizado'), 'Texto WhatsApp deve conter o item avulso');
  assert.ok(textoWhats.includes('Juliana Paes'), 'Texto WhatsApp deve conter o nome da cliente');
  assert.ok(textoWhats.includes('15/10/2026'), 'Texto WhatsApp deve conter a data formatada');
  assert.ok(textoWhats.includes('Sinal / Entrada'), 'Texto WhatsApp deve conter o sinal');
  console.log('✅ Geração de texto profissional para WhatsApp validada com sucesso');

  // 8. Testar avanço de status
  await db.run("UPDATE pedidos SET status = 'confirmado' WHERE id = ?", [pedidoId]);
  let pStatus = (await db.get('SELECT status FROM pedidos WHERE id = ?', [pedidoId])).status;
  assert.strictEqual(pStatus, 'confirmado');

  await db.run("UPDATE pedidos SET status = 'producao' WHERE id = ?", [pedidoId]);
  pStatus = (await db.get('SELECT status FROM pedidos WHERE id = ?', [pedidoId])).status;
  assert.strictEqual(pStatus, 'producao');

  await db.run("UPDATE pedidos SET status = 'entregue' WHERE id = ?", [pedidoId]);
  pStatus = (await db.get('SELECT status FROM pedidos WHERE id = ?', [pedidoId])).status;
  assert.strictEqual(pStatus, 'entregue');
  console.log('✅ Fluxo de avanço de status (Orçamento -> Confirmado -> Produção -> Entregue) validado');

  // 9. Testar isolamento multi-tenant
  const pedidosClara = await db.all('SELECT * FROM pedidos WHERE usuario_id = ?', [uid1]);
  const pedidosDenise = await db.all('SELECT * FROM pedidos WHERE usuario_id = ?', [uid2]);
  assert.strictEqual(pedidosClara.length, 1, 'Clara deve ver seu 1 pedido');
  assert.strictEqual(pedidosDenise.length, 0, 'Denise não deve ver pedidos de Clara');
  console.log('✅ Isolamento multi-tenant de pedidos validado com sucesso');

  // 10. Testar filtros de período de entrega
  const pedidosOutubro = await db.all('SELECT * FROM pedidos WHERE usuario_id = ? AND data_entrega BETWEEN ? AND ?', [uid1, '2026-10-01', '2026-10-31']);
  assert.strictEqual(pedidosOutubro.length, 1, 'Deve encontrar o pedido em Outubro/2026');

  const pedidosNovembro = await db.all('SELECT * FROM pedidos WHERE usuario_id = ? AND data_entrega BETWEEN ? AND ?', [uid1, '2026-11-01', '2026-11-30']);
  assert.strictEqual(pedidosNovembro.length, 0, 'Não deve encontrar pedidos em Novembro/2026');
  console.log('✅ Filtros de período e datas de entrega validados com sucesso');

  // 11. Testar exclusão com integridade referencial
  await db.run('DELETE FROM pedidos WHERE id = ?', [pedidoId]);
  const itensAposExclusao = await db.all('SELECT * FROM pedido_itens WHERE pedido_id = ?', [pedidoId]);
  assert.strictEqual(itensAposExclusao.length, 0, 'Itens do pedido devem ser excluídos em cascata');
  console.log('✅ Exclusão segura em cascata validada');

  // Limpeza final
  await db.run('DELETE FROM usuarios WHERE id IN (?, ?)', [uid1, uid2]);
  console.log('🎉 Todos os testes de Pedidos & Orçamentos foram concluídos com 100% de sucesso!');
}

run().catch(err => {
  console.error('❌ Falha nos testes de pedidos:', err);
  process.exit(1);
});
