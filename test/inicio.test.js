const assert = require('assert');
const db = require('../db');
const { carregarDadosPrecificacao } = require('../routes/painel');

console.log('🧪 Iniciando testes da Página Inicial (Botões Agrupados & Painel de Precificação)...');

async function run() {
  await db.rodarMigracoes();

  // Limpar usuário de teste anterior
  await db.run("DELETE FROM usuarios WHERE email = 'inicio_test@confeitaria.com'");

  const u = await db.run('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
    ['Luciana Bolos', 'inicio_test@confeitaria.com', 'hash123']);
  const uid = u.lastInsertRowid;

  // Inserir dados para apuração dos indicadores e precificação
  const p = await db.run("INSERT INTO produtos (usuario_id, nome, rendimento, unidade, tempo_horas, margem_pct) VALUES (?, 'Torta de Limão', 1, 'un', 1, 40)", [uid]);
  const prodId = p.lastInsertRowid;

  await db.run("INSERT INTO clientes (usuario_id, nome, telefone) VALUES (?, 'Paula Cliente', '11999998888')", [uid]);
  await db.run("INSERT INTO custos_fixos (usuario_id, item, valor_mensal) VALUES (?, 'Internet', 120)", [uid]);
  await db.run("INSERT INTO ingredientes_catalogo (usuario_id, nome, estoque_atual, estoque_minimo, preco_atual, qtd_embalagem_padrao) VALUES (?, 'Limão Taiti', 2, 10, 5, 1)", [uid]);
  await db.run("INSERT INTO ingredientes (produto_id, nome, qtd_usada, preco_pacote, qtd_pacote) VALUES (?, 'Limão Taiti', 2, 5, 1)", [prodId]);

  const agora = new Date();
  const hoje = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
  await db.run("INSERT INTO pedidos (usuario_id, data_pedido, data_entrega, status, valor_total) VALUES (?, ?, ?, 'confirmado', 85.00)", [uid, hoje, hoje]);

  // 1. Executar a apuração de estatísticas da tela inicial
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

  assert.strictEqual(stats.totalProdutos, 1, 'Deve ter 1 produto');
  assert.strictEqual(stats.totalClientes, 1, 'Deve ter 1 cliente');
  assert.strictEqual(stats.pedidosHoje, 1, 'Deve ter 1 entrega hoje');
  assert.strictEqual(stats.pedidosAbertos, 1, 'Deve ter 1 pedido aberto');
  assert.strictEqual(stats.totalCustosFixos, 120, 'Custos fixos devem somar R$ 120');
  assert.strictEqual(stats.itensEstoqueBaixo, 1, 'Deve detectar 1 insumo com estoque baixo');

  console.log('✅ Apuração de métricas da Página Inicial aprovada com sucesso');

  // 2. Validar integração do Painel de Precificação na Página Inicial
  assert.strictEqual(precificacao.totalFixos, 120, 'Total de custos fixos deve ser 120');
  assert.strictEqual(precificacao.horasMes, 160, 'Horas do mês padrão deve ser 160');
  assert.strictEqual(precificacao.cfHora, 0.75, 'Custo fixo por hora deve ser 120 / 160 = 0.75');
  assert.strictEqual(precificacao.resumo.length, 1, 'Deve retornar 1 receita no resumo de precificação');
  assert.strictEqual(precificacao.resumo[0].produto.nome, 'Torta de Limão');
  assert.ok(precificacao.resumo[0].calculo, 'Cálculo de precificação deve ser executado com sucesso');
  assert.ok(precificacao.resumo[0].calculo.preco > 0, 'Preço sugerido deve ser maior que zero');

  console.log('✅ Visão do Painel de Precificação integrada à Página Inicial validada com sucesso');

  // Limpeza
  await db.run('DELETE FROM usuarios WHERE id = ?', [uid]);

  console.log('🎉 Todos os testes da Página Inicial (Botões Agrupados & Painel de Precificação) foram aprovados!\n');
}

run().catch(err => {
  console.error('❌ Falha nos testes da página inicial:', err);
  process.exit(1);
});
