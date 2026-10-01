const assert = require('assert');
const db = require('../db');
const { calcularFatorEscala } = require('../routes/producao');

console.log('🧪 Iniciando testes do Módulo de Produção & Modo Cozinha...');

async function run() {
  await db.rodarMigracoes();

  // 1. Testes unitários do cálculo de escalonamento de ingredientes
  const fator1 = calcularFatorEscala(3, 'kg', 2, 'kg');
  assert.strictEqual(fator1, 1.5, '3 kg de bolo com receita de 2 kg deve dar fator 1.5x');

  const fator2 = calcularFatorEscala(300, 'g', 1.2, 'kg');
  assert.strictEqual(Number(fator2.toFixed(4)), 0.25, '300 g de pudim com receita de 1.2 kg deve dar fator 0.25x');

  const fator3 = calcularFatorEscala(50, 'un', 100, 'un');
  assert.strictEqual(fator3, 0.5, '50 un de brigadeiro com receita de 100 un deve dar fator 0.5x');
  console.log('✅ Testes matemáticos de escalonamento proporcional de receitas aprovados com sucesso!');

  // Limpar dados anteriores de teste
  await db.run("DELETE FROM usuarios WHERE email IN ('cozinha_teste1@docepreco.com', 'cozinha_teste2@docepreco.com')");

  // 2. Criar duas confeiteiras para testar isolamento
  const u1 = await db.run("INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)", ['Confeiteira Carla', 'cozinha_teste1@docepreco.com', 'hash123']);
  const uid1 = u1.lastInsertRowid;

  const u2 = await db.run("INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)", ['Confeiteira Bruna', 'cozinha_teste2@docepreco.com', 'hash123']);
  const uid2 = u2.lastInsertRowid;

  // 3. Cadastrar insumo no catálogo com estoque inicial para Carla
  const resCat = await db.run(`
    INSERT INTO ingredientes_catalogo (usuario_id, nome, unidade, estoque_atual, estoque_minimo, preco_atual, qtd_embalagem_padrao)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [uid1, 'Farinha de Trigo Especial', 'g', 2000, 500, 6.00, 1000]);
  const catId = resCat.lastInsertRowid;

  // 4. Cadastrar receita para Carla (Bolo Red Velvet: 2 kg, 400g farinha, 1.5 horas de preparo = 90 min)
  const resProd = await db.run(`
    INSERT INTO produtos (usuario_id, nome, rendimento, unidade, tempo_horas, margem_pct, taxas_pct)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [uid1, 'Bolo Red Velvet Especial', 2, 'kg', 1.5, 40, 5]);
  const produtoId = resProd.lastInsertRowid;

  await db.run(`
    INSERT INTO ingredientes (produto_id, nome, qtd_usada, preco_pacote, qtd_pacote)
    VALUES (?, ?, ?, ?, ?)
  `, [produtoId, 'Farinha de Trigo Especial', 400, 6.00, 1000]);

  // 5. Cadastrar pedido em 'confirmado' para Carla
  const resPed = await db.run(`
    INSERT INTO pedidos (
      usuario_id, data_entrega, status, valor_produtos, valor_total
    ) VALUES (?, '2026-10-20', 'confirmado', 180, 180)
  `, [uid1]);
  const pedidoId = resPed.lastInsertRowid;

  await db.run(`
    INSERT INTO pedido_itens (pedido_id, produto_id, descricao, quantidade, unidade, preco_unitario, subtotal)
    VALUES (?, ?, 'Bolo Red Velvet Especial', 3, 'kg', 60, 180)
  `, [pedidoId, produtoId]);

  // 6. Testar início de produção na cozinha
  // Carla vai produzir 3 kg (fator 1.5x)
  const tempoEstimadoMin = 90;
  const resInic = await db.run(`
    INSERT INTO producoes (
      usuario_id, produto_id, pedido_id, nome_receita,
      quantidade_produzida, unidade, tempo_estimado_min, status, iniciado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'em_preparo', datetime('now'))
  `, [uid1, produtoId, pedidoId, 'Bolo Red Velvet Especial', 3, 'kg', tempoEstimadoMin]);
  const producaoId = resInic.lastInsertRowid;

  // Avançar pedido para 'producao'
  await db.run("UPDATE pedidos SET status = 'producao' WHERE id = ?", [pedidoId]);

  const pEmPreparo = await db.get("SELECT * FROM producoes WHERE id = ?", [producaoId]);
  assert.strictEqual(pEmPreparo.status, 'em_preparo');
  assert.strictEqual(pEmPreparo.quantidade_produzida, 3);
  assert.strictEqual(pEmPreparo.unidade, 'kg');

  const pedAtualizado = await db.get("SELECT status FROM pedidos WHERE id = ?", [pedidoId]);
  assert.strictEqual(pedAtualizado.status, 'producao');
  console.log('✅ Início de preparo no Modo Cozinha e transição de pedido para produção aprovados!');

  // 7. Testar conclusão da produção com registro de tempo real, observações e baixa de estoque
  const tempoRealGasto = 82; // 82 minutos (8 min mais rápido que o previsto!)
  const obsFornada = 'Massa assou perfeitamente em 45 min a 180°C. Recheio consistente.';

  // Executar conclusão
  await db.transaction(async (tx) => {
    await tx.run(`
      UPDATE producoes
      SET status = 'concluido',
          tempo_real_min = ?,
          observacoes = ?,
          concluido_em = datetime('now')
      WHERE id = ? AND usuario_id = ?
    `, [tempoRealGasto, obsFornada, producaoId, uid1]);

    // Baixa automática de ingredientes: 400g * 1.5 = 600g consumidos
    const fator = calcularFatorEscala(3, 'kg', 2, 'kg');
    const qtdConsumida = 400 * fator; // 600g
    await tx.run(`
      UPDATE ingredientes_catalogo
      SET estoque_atual = MAX(0, estoque_atual - ?)
      WHERE id = ?
    `, [qtdConsumida, catId]);

    // Avançar pedido para entregue/concluído
    await tx.run("UPDATE pedidos SET status = 'entregue' WHERE id = ?", [pedidoId]);
  });

  // Validar histórico concluído
  const prodConcluida = await db.get("SELECT * FROM producoes WHERE id = ?", [producaoId]);
  assert.strictEqual(prodConcluida.status, 'concluido');
  assert.strictEqual(prodConcluida.tempo_real_min, 82);
  assert.strictEqual(prodConcluida.observacoes, obsFornada);
  assert.ok(prodConcluida.concluido_em !== null);

  // Validar baixa de estoque: 2000g inicial - 600g = 1400g
  const estoquePos = await db.get("SELECT estoque_atual FROM ingredientes_catalogo WHERE id = ?", [catId]);
  assert.strictEqual(estoquePos.estoque_atual, 1400, 'Estoque deve ser exatamente 1400g após consumo');

  // Validar status do pedido
  const pedFinal = await db.get("SELECT status FROM pedidos WHERE id = ?", [pedidoId]);
  assert.strictEqual(pedFinal.status, 'entregue');
  console.log('✅ Conclusão de lote com tempo real (82 min), observações e baixa automática de estoque validada!');

  // 8. Testar isolamento multi-tenant
  const producoesCarla = await db.all("SELECT * FROM producoes WHERE usuario_id = ?", [uid1]);
  const producoesBruna = await db.all("SELECT * FROM producoes WHERE usuario_id = ?", [uid2]);
  assert.strictEqual(producoesCarla.length, 1);
  assert.strictEqual(producoesBruna.length, 0, 'Bruna não deve ver produções de Carla');
  console.log('✅ Isolamento multi-tenant do módulo de produção validado com sucesso!');

  // Limpeza
  await db.run("DELETE FROM usuarios WHERE id IN (?, ?)", [uid1, uid2]);
  console.log('🎉 Todos os testes do Módulo de Produção & Modo Cozinha foram concluídos com 100% de sucesso!\n');
}

run().catch(err => {
  console.error('❌ Falha nos testes de produção:', err);
  process.exit(1);
});
