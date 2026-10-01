const assert = require('assert');
const db = require('../db');

console.log('🧪 Iniciando testes da Página Inicial (Menu de Acesso Rápido)...');

async function run() {
  await db.rodarMigracoes();

  // Limpar usuário de teste anterior
  await db.run("DELETE FROM usuarios WHERE email = 'inicio_test@confeitaria.com'");

  const u = await db.run('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
    ['Luciana Bolos', 'inicio_test@confeitaria.com', 'hash123']);
  const uid = u.lastInsertRowid;

  // Inserir alguns dados para alimentar os indicadores
  await db.run("INSERT INTO produtos (usuario_id, nome, rendimento, tempo_horas, margem_pct) VALUES (?, 'Torta de Limão', 1, 1, 40)", [uid]);
  await db.run("INSERT INTO clientes (usuario_id, nome, telefone) VALUES (?, 'Paula Cliente', '11999998888')", [uid]);
  await db.run("INSERT INTO custos_fixos (usuario_id, item, valor_mensal) VALUES (?, 'Internet', 120)", [uid]);
  await db.run("INSERT INTO ingredientes_catalogo (usuario_id, nome, estoque_atual, estoque_minimo, preco_atual, qtd_embalagem_padrao) VALUES (?, 'Limão Taiti', 2, 10, 5, 1)", [uid]);

  const agora = new Date();
  const hoje = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
  await db.run("INSERT INTO pedidos (usuario_id, data_pedido, data_entrega, status, valor_total) VALUES (?, ?, ?, 'confirmado', 85.00)", [uid, hoje, hoje]);

  // Executar a apuração de estatísticas da tela inicial
  const [
    produtosCount,
    clientesCount,
    pedidosHojeCount,
    pedidosAbertosCount,
    custosTotalRow,
    estoqueBaixoRow,
    lotesRiscoRow
  ] = await Promise.all([
    db.get('SELECT COUNT(*) as t FROM produtos WHERE usuario_id = ?', [uid]),
    db.get('SELECT COUNT(*) as t FROM clientes WHERE usuario_id = ?', [uid]),
    db.get("SELECT COUNT(*) as t FROM pedidos WHERE usuario_id = ? AND data_entrega = ? AND status != 'cancelado'", [uid, hoje]),
    db.get("SELECT COUNT(*) as t FROM pedidos WHERE usuario_id = ? AND status IN ('orcamento', 'confirmado', 'producao')", [uid]),
    db.get('SELECT COALESCE(SUM(valor_mensal), 0) AS t FROM custos_fixos WHERE usuario_id = ?', [uid]),
    db.get('SELECT COUNT(*) as t FROM ingredientes_catalogo WHERE usuario_id = ? AND ((estoque_minimo > 0 AND estoque_atual <= estoque_minimo) OR estoque_atual <= 0)', [uid]),
    db.get("SELECT COUNT(*) as t FROM ingredientes_compras WHERE usuario_id = ? AND status = 'ativo' AND data_validade IS NOT NULL AND data_validade <= date('now', '+7 days')", [uid])
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

  assert.strictEqual(stats.totalProdutos, 1, 'Deve ter 1 produto');
  assert.strictEqual(stats.totalClientes, 1, 'Deve ter 1 cliente');
  assert.strictEqual(stats.pedidosHoje, 1, 'Deve ter 1 entrega hoje');
  assert.strictEqual(stats.pedidosAbertos, 1, 'Deve ter 1 pedido aberto');
  assert.strictEqual(stats.totalCustosFixos, 120, 'Custos fixos devem somar R$ 120');
  assert.strictEqual(stats.itensEstoqueBaixo, 1, 'Deve detectar 1 insumo com estoque baixo');

  console.log('✅ Apuração de métricas da Página Inicial aprovada com sucesso');

  // Limpeza
  await db.run('DELETE FROM usuarios WHERE id = ?', [uid]);

  console.log('🎉 Testes da Página Inicial concluídos com 100% de sucesso!');
}

run().catch(err => {
  console.error('❌ Falha nos testes da página inicial:', err);
  process.exit(1);
});
