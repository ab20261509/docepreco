const assert = require('assert');
const db = require('../db');

console.log('🧪 Iniciando testes de Gestão de Validade e Descarte de Lotes...');

async function run() {
  await db.rodarMigracoes();

  // Limpar usuário de teste anterior se existir
  await db.run("DELETE FROM usuarios WHERE email = 'validade_test@confeitaria.com'");

  // 1. Criar usuária temporária para testes
  const resUser = await db.run('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
    ['Teste Validade', 'validade_test@confeitaria.com', 'hash_fake']);
  const uid = resUser.lastInsertRowid;

  // 2. Cadastrar Insumo: Creme de Leite Fresco (unidade ml, 500ml)
  const resIng = await db.run(`
    INSERT INTO ingredientes_catalogo (usuario_id, nome, unidade, estoque_atual, estoque_minimo, preco_atual, qtd_embalagem_padrao)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [uid, 'Creme de Leite Fresco', 'ml', 0, 500, 12.00, 500]);
  const ingId = resIng.lastInsertRowid;

  const hoje = new Date();
  const formatData = (d) => d.toISOString().split('T')[0];

  const dataOntem = new Date(hoje);
  dataOntem.setDate(dataOntem.getDate() - 3);

  const dataEmBreve = new Date(hoje);
  dataEmBreve.setDate(dataEmBreve.getDate() + 4);

  const dataFutura = new Date(hoje);
  dataFutura.setDate(dataFutura.getDate() + 45);

  // 3. Inserir os 3 lotes
  // Lote 1: Vencido há 3 dias (2 garrafas de 500ml = 1000ml, R$ 12,00 cada)
  const c1 = await db.run(`
    INSERT INTO ingredientes_compras 
    (ingrediente_id, usuario_id, data_compra, data_validade, qtd_embalagens, qtd_por_embalagem, valor_unitario_embalagem, valor_total, status)
    VALUES (?, ?, date('now'), ?, 2, 500, 12.00, 24.00, 'ativo')
  `, [ingId, uid, formatData(dataOntem)]);
  const c1Id = c1.lastInsertRowid;

  // Lote 2: Vencendo em 4 dias (1 garrafa de 500ml = 500ml)
  const c2 = await db.run(`
    INSERT INTO ingredientes_compras 
    (ingrediente_id, usuario_id, data_compra, data_validade, qtd_embalagens, qtd_por_embalagem, valor_unitario_embalagem, valor_total, status)
    VALUES (?, ?, date('now'), ?, 1, 500, 12.50, 12.50, 'ativo')
  `, [ingId, uid, formatData(dataEmBreve)]);
  const c2Id = c2.lastInsertRowid;

  // Lote 3: Vencendo em 45 dias (3 garrafas de 500ml = 1500ml)
  const c3 = await db.run(`
    INSERT INTO ingredientes_compras 
    (ingrediente_id, usuario_id, data_compra, data_validade, qtd_embalagens, qtd_por_embalagem, valor_unitario_embalagem, valor_total, status)
    VALUES (?, ?, date('now'), ?, 3, 500, 13.00, 39.00, 'ativo')
  `, [ingId, uid, formatData(dataFutura)]);
  const c3Id = c3.lastInsertRowid;

  // Estoque total inicial = 1000 + 500 + 1500 = 3000ml
  await db.run('UPDATE ingredientes_catalogo SET estoque_atual = 3000 WHERE id = ?', [ingId]);

  // 4. Teste de Identificação dos Lotes em Risco
  function calcularDias(dataVal) {
    const dVal = new Date(dataVal.split('-')[0], dataVal.split('-')[1] - 1, dataVal.split('-')[2]);
    const h = new Date();
    h.setHours(0, 0, 0, 0);
    dVal.setHours(0, 0, 0, 0);
    return Math.round((dVal - h) / (1000 * 60 * 60 * 24));
  }

  const comprasAtivas = await db.all("SELECT * FROM ingredientes_compras WHERE ingrediente_id = ? AND status = 'ativo'", [ingId]);
  const vencidos = comprasAtivas.filter(c => calcularDias(c.data_validade) < 0);
  const vencendo = comprasAtivas.filter(c => calcularDias(c.data_validade) >= 0 && calcularDias(c.data_validade) <= 7);

  assert.strictEqual(vencidos.length, 1, 'Deve haver 1 lote vencido');
  assert.strictEqual(vencidos[0].id, c1Id);

  assert.strictEqual(vencendo.length, 1, 'Deve haver 1 lote vencendo em breve');
  assert.strictEqual(vencendo[0].id, c2Id);

  console.log('✅ Identificação de validades (vencidos e a vencer) confirmada');

  // 5. Teste de Descarte do Lote Vencido (Lote 1)
  const volumeDescarte = vencidos[0].qtd_embalagens * vencidos[0].qtd_por_embalagem; // 1000ml
  assert.strictEqual(volumeDescarte, 1000);

  await db.transaction(async (tx) => {
    await tx.run(`
      UPDATE ingredientes_compras 
      SET status = 'descartado', motivo_baixa = 'Vencido - Descarte de Segurança' 
      WHERE id = ? AND usuario_id = ?
    `, [c1Id, uid]);

    await tx.run(`
      UPDATE ingredientes_catalogo 
      SET estoque_atual = MAX(0, estoque_atual - ?) 
      WHERE id = ? AND usuario_id = ?
    `, [volumeDescarte, ingId, uid]);
  });

  const c1Atualizada = await db.get('SELECT * FROM ingredientes_compras WHERE id = ?', [c1Id]);
  assert.strictEqual(c1Atualizada.status, 'descartado', 'Lote 1 deve constar como descartado');
  assert.strictEqual(c1Atualizada.motivo_baixa, 'Vencido - Descarte de Segurança');

  const ingAtualizado = await db.get('SELECT * FROM ingredientes_catalogo WHERE id = ?', [ingId]);
  assert.strictEqual(ingAtualizado.estoque_atual, 2000, 'Estoque deve ter caído de 3000ml para 2000ml');

  console.log('✅ Descarte de lote com redução de estoque validado');

  // 6. Teste de Sugestão de Receitas
  // Criar produto "Ganache de Chocolate Nobre" que usa "Creme de Leite Fresco"
  const resProd = await db.run(`
    INSERT INTO produtos (usuario_id, nome, rendimento, tempo_horas, mao_obra_extra, margem_pct, taxas_pct)
    VALUES (?, 'Ganache Nobre', 1, 0.5, 0, 40, 5)
  `, [uid]);
  const prodId = resProd.lastInsertRowid;

  await db.run(`
    INSERT INTO ingredientes (produto_id, nome, qtd_usada, preco_pacote, qtd_pacote)
    VALUES (?, 'Creme de Leite Fresco', 200, 12.00, 500)
  `, [prodId]);

  const receitasRelacionadas = await db.all(`
    SELECT DISTINCT p.id, p.nome 
    FROM produtos p 
    JOIN ingredientes i ON i.produto_id = p.id 
    WHERE LOWER(i.nome) LIKE '%' || LOWER(?) || '%' AND p.usuario_id = ?
  `, ['Creme de Leite Fresco', uid]);

  assert.strictEqual(receitasRelacionadas.length, 1, 'Deve encontrar a receita que usa este insumo');
  assert.strictEqual(receitasRelacionadas[0].nome, 'Ganache Nobre');

  console.log('✅ Sugestão de receitas para insumo a vencer validada com sucesso');

  // Limpeza
  await db.run('DELETE FROM usuarios WHERE id = ?', [uid]);

  console.log('🎉 Todos os testes de Gestão de Validade foram concluídos com sucesso!');
}

run().catch(err => {
  console.error('❌ Falha nos testes de validade:', err);
  process.exit(1);
});
