const assert = require('assert');
const db = require('../db');
const { calcularPlanejamentoCompras } = require('../routes/compras');

console.log('🧪 Iniciando testes do Módulo Operacional: Planejamento & Compras Inteligente (Onda 4)...');

// Limpar dados de testes anteriores
db.prepare("DELETE FROM usuarios WHERE email IN ('compras_test1@confeitaria.com', 'compras_test2@confeitaria.com')").run();

try {
  // 1. Criar duas usuárias de teste
  const u1 = db.prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)')
    .run('Confeiteira Carla', 'compras_test1@confeitaria.com', 'hash_carla');
  const u2 = db.prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)')
    .run('Confeiteira Diana', 'compras_test2@confeitaria.com', 'hash_diana');

  const u1Id = u1.lastInsertRowid;
  const u2Id = u2.lastInsertRowid;

  // 2. Criar catálogo de insumos para Carla (u1Id)
  const catLC = db.prepare(`
    INSERT INTO ingredientes_catalogo (usuario_id, nome, unidade, estoque_atual, estoque_minimo, preco_atual, qtd_embalagem_padrao)
    VALUES (?, 'Leite Condensado', 'g', 500, 1000, 6.00, 395)
  `).run(u1Id);
  const lcId = catLC.lastInsertRowid;

  const catFT = db.prepare(`
    INSERT INTO ingredientes_catalogo (usuario_id, nome, unidade, estoque_atual, estoque_minimo, preco_atual, qtd_embalagem_padrao)
    VALUES (?, 'Farinha de Trigo', 'g', 2000, 1000, 5.00, 1000)
  `).run(u1Id);
  const ftId = catFT.lastInsertRowid;

  const catCP = db.prepare(`
    INSERT INTO ingredientes_catalogo (usuario_id, nome, unidade, estoque_atual, estoque_minimo, preco_atual, qtd_embalagem_padrao)
    VALUES (?, 'Chocolate em Pó', 'g', 0, 200, 12.00, 200)
  `).run(u1Id);
  const cpId = catCP.lastInsertRowid;

  // Histórico de última compra de Leite Condensado (4 caixas de 395g = 1580g)
  db.prepare(`
    INSERT INTO ingredientes_compras (
      ingrediente_id, usuario_id, data_compra, qtd_embalagens, qtd_por_embalagem,
      valor_unitario_embalagem, valor_total, status
    ) VALUES (?, ?, date('now', '-5 days'), 4, 395, 6.00, 24.00, 'ativo')
  `).run(lcId, u1Id);

  // 3. Criar receitas e produtos na fábrica para Carla
  // Produto 1: Brigadeiro Gourmet (Rende 30 unidades) -> usa 395g LC e 50g CP
  const resProd1 = db.prepare(`
    INSERT INTO produtos (usuario_id, nome, rendimento, tempo_horas, margem_pct)
    VALUES (?, 'Brigadeiro Gourmet', 30, 1, 40)
  `).run(u1Id);
  const prod1Id = resProd1.lastInsertRowid;

  db.prepare(`
    INSERT INTO ingredientes (produto_id, nome, qtd_usada, preco_pacote, qtd_pacote)
    VALUES (?, 'Leite Condensado', 395, 6.00, 395),
           (?, 'Chocolate em Pó', 50, 12.00, 200)
  `).run(prod1Id, prod1Id);

  // Produto 2: Bolo Simples (Rende 1 unidade) -> usa 300g Farinha de Trigo
  const resProd2 = db.prepare(`
    INSERT INTO produtos (usuario_id, nome, rendimento, tempo_horas, margem_pct)
    VALUES (?, 'Bolo Simples', 1, 1, 40)
  `).run(u1Id);
  const prod2Id = resProd2.lastInsertRowid;

  db.prepare(`
    INSERT INTO ingredientes (produto_id, nome, qtd_usada, preco_pacote, qtd_pacote)
    VALUES (?, 'Farinha de Trigo', 300, 5.00, 1000)
  `).run(prod2Id);

  // 4. Criar encomendas confirmadas para Carla
  const cliente = db.prepare(`INSERT INTO clientes (usuario_id, nome, telefone) VALUES (?, 'Mariana', '11988887777')`).run(u1Id);
  const clienteId = cliente.lastInsertRowid;

  // Encomenda 1: 60 Brigadeiros (2 lotes! Logo: 790g LC e 100g CP)
  const ped1 = db.prepare(`
    INSERT INTO pedidos (usuario_id, cliente_id, data_pedido, data_entrega, status, valor_total)
    VALUES (?, ?, date('now'), date('now'), 'confirmado', 120.00)
  `).run(u1Id, clienteId);
  const ped1Id = ped1.lastInsertRowid;

  db.prepare(`
    INSERT INTO pedido_itens (pedido_id, produto_id, descricao, quantidade, preco_unitario, subtotal)
    VALUES (?, ?, 'Cento Brigadeiro', 60, 2.00, 120.00)
  `).run(ped1Id, prod1Id);

  // Encomenda 2: 1 Bolo Simples (300g Farinha)
  const ped2 = db.prepare(`
    INSERT INTO pedidos (usuario_id, cliente_id, data_pedido, data_entrega, status, valor_total)
    VALUES (?, ?, date('now'), date('now', '+2 days'), 'confirmado', 45.00)
  `).run(u1Id, clienteId);
  const ped2Id = ped2.lastInsertRowid;

  db.prepare(`
    INSERT INTO pedido_itens (pedido_id, produto_id, descricao, quantidade, preco_unitario, subtotal)
    VALUES (?, ?, 'Bolo Caseiro', 1, 45.00, 45.00)
  `).run(ped2Id, prod2Id);

  // Inserir pedido para a Usuária Diana (para testar isolamento multi-tenant)
  const pedDiana = db.prepare(`
    INSERT INTO pedidos (usuario_id, data_pedido, data_entrega, status, valor_total)
    VALUES (?, date('now'), date('now'), 'confirmado', 200.00)
  `).run(u2Id);

  // =========================================================================
  // TESTE 1: Cálculo Somente com Vendas Pendentes (sem mínimo, sem últimas)
  // =========================================================================
  const calcVendas = calcularPlanejamentoCompras(u1Id, {
    incluirVendas: true,
    incluirMinimo: false,
    incluirUltimas: false,
    periodo: 'semana'
  });

  assert.strictEqual(calcVendas.totalPedidos, 2, 'Deve incluir os 2 pedidos confirmados da semana');

  const itemLC = calcVendas.itensPlanejamento.find(i => i.nome === 'Leite Condensado');
  assert.ok(itemLC, 'Deve conter Leite Condensado no planejamento');
  assert.strictEqual(itemLC.V, 790, 'Demanda de vendas de LC deve ser 790g (2 lotes x 395g)');
  assert.strictEqual(itemLC.estoqueAtual, 500, 'Estoque atual deve ser 500g');
  assert.strictEqual(itemLC.faltaLiquida, 290, 'Falta líquida deve ser 290g (790 - 500)');
  assert.strictEqual(itemLC.pacotesAComprar, 1, 'Deve sugerir 1 embalagem de 395g (cobre 290g)');
  assert.strictEqual(itemLC.custoEstimado, 6.00, 'Custo estimado de 1 pct deve ser R$ 6.00');

  const itemFT = calcVendas.itensPlanejamento.find(i => i.nome === 'Farinha de Trigo');
  assert.ok(itemFT);
  assert.strictEqual(itemFT.V, 300, 'Demanda de Farinha deve ser 300g');
  assert.strictEqual(itemFT.estoqueAtual, 2000, 'Estoque de Farinha é 2000g');
  assert.strictEqual(itemFT.faltaLiquida, 0, 'Falta de Farinha deve ser 0');
  assert.strictEqual(itemFT.situacao, 'suficiente', 'Farinha deve ter status suficiente');

  const itemCP = calcVendas.itensPlanejamento.find(i => i.nome === 'Chocolate em Pó');
  assert.ok(itemCP);
  assert.strictEqual(itemCP.V, 100, 'Demanda de Chocolate deve ser 100g');
  assert.strictEqual(itemCP.estoqueAtual, 0, 'Estoque de Chocolate é 0g');
  assert.strictEqual(itemCP.pacotesAComprar, 1, 'Deve sugerir 1 pacote de 200g');
  assert.strictEqual(itemCP.custoEstimado, 12.00, 'Custo do Chocolate deve ser R$ 12.00');

  console.log('✅ Teste 1: Cálculo Somente Vendas Pendentes aprovado com sucesso!');

  // =========================================================================
  // TESTE 2: Cálculo Somente com Estoque Mínimo (sem vendas)
  // =========================================================================
  const calcMinimo = calcularPlanejamentoCompras(u1Id, {
    incluirVendas: false,
    incluirMinimo: true,
    incluirUltimas: false,
    periodo: 'semana'
  });

  const itemLCMin = calcMinimo.itensPlanejamento.find(i => i.nome === 'Leite Condensado');
  assert.strictEqual(itemLCMin.V, 0, 'Demanda de vendas deve ser zero com o toggle desligado');
  assert.strictEqual(itemLCMin.M, 1000, 'Estoque mínimo deve ser 1000g');
  assert.strictEqual(itemLCMin.faltaLiquida, 500, 'Falta líquida para atingir mínimo deve ser 500g (1000 - 500)');
  assert.strictEqual(itemLCMin.pacotesAComprar, 2, 'Deve sugerir 2 embalagens de 395g para cobrir 500g (790g)');
  assert.strictEqual(itemLCMin.custoEstimado, 12.00, 'Custo deve ser R$ 12.00');

  console.log('✅ Teste 2: Cálculo Somente Estoque Mínimo aprovado com sucesso!');

  // =========================================================================
  // TESTE 3: Cálculo Unificado (Vendas + Estoque Mínimo)
  // =========================================================================
  const calcUnificado = calcularPlanejamentoCompras(u1Id, {
    incluirVendas: true,
    incluirMinimo: true,
    incluirUltimas: false,
    periodo: 'semana'
  });

  const itemLCUni = calcUnificado.itensPlanejamento.find(i => i.nome === 'Leite Condensado');
  assert.strictEqual(itemLCUni.necessidadeBruta, 1790, 'Necessidade bruta deve ser 790 (vendas) + 1000 (mínimo) = 1790g');
  assert.strictEqual(itemLCUni.faltaLiquida, 1290, 'Falta líquida deve ser 1790 - 500 = 1290g');
  // 1290 / 395 = 3.26 -> arredonda para cima = 4 embalagens
  assert.strictEqual(itemLCUni.pacotesAComprar, 4, 'Deve sugerir 4 embalagens de 395g');
  assert.strictEqual(itemLCUni.custoEstimado, 24.00, 'Custo total de 4 embalagens deve ser R$ 24.00');

  console.log('✅ Teste 3: Cálculo Unificado (Vendas + Mínimo) aprovado com sucesso!');

  // =========================================================================
  // TESTE 4: Mensagem Formatada para WhatsApp / Supermercado
  // =========================================================================
  assert.ok(calcUnificado.textoWhatsApp.includes('LISTA DE COMPRAS'), 'Texto deve conter título formatado');
  assert.ok(calcUnificado.textoWhatsApp.includes('Leite Condensado'), 'Texto deve conter Leite Condensado');
  assert.ok(calcUnificado.textoWhatsApp.includes('Custo Total Estimado'), 'Texto deve conter resumo financeiro');
  console.log('✅ Teste 4: Geração de Lista de Mercado para WhatsApp aprovada!');

  // =========================================================================
  // TESTE 5: Baixa Transacional de Produção no Estoque
  // =========================================================================
  // Simular a baixa executando a lógica transacional
  const transacao = db.transaction(() => {
    calcVendas.itensPlanejamento.forEach(item => {
      if (item.catalogoId && item.V > 0) {
        db.prepare(`
          UPDATE ingredientes_catalogo
          SET estoque_atual = MAX(0, estoque_atual - ?)
          WHERE id = ? AND usuario_id = ?
        `).run(item.V, item.catalogoId, u1Id);
      }
    });

    calcVendas.pedidos.forEach(p => {
      db.prepare(`UPDATE pedidos SET status = 'producao' WHERE id = ?`).run(p.id);
    });
  });

  transacao();

  // Verificar estoque após a baixa
  const lcPosBaixa = db.prepare('SELECT estoque_atual FROM ingredientes_catalogo WHERE id = ?').get(lcId);
  // Estava 500g e consumiu 790g -> MAX(0, -290) = 0g
  assert.strictEqual(lcPosBaixa.estoque_atual, 0, 'Estoque de LC deve ficar 0 após baixa');

  const ftPosBaixa = db.prepare('SELECT estoque_atual FROM ingredientes_catalogo WHERE id = ?').get(ftId);
  // Estava 2000g e consumiu 300g -> 1700g
  assert.strictEqual(ftPosBaixa.estoque_atual, 1700, 'Estoque de Farinha deve ficar 1700g após baixa');

  const ped1PosBaixa = db.prepare('SELECT status FROM pedidos WHERE id = ?').get(ped1Id);
  assert.strictEqual(ped1PosBaixa.status, 'producao', 'Pedido 1 deve ter avançado para producao');

  console.log('✅ Teste 5: Baixa atômica de produção no estoque aprovada com sucesso!');

  // =========================================================================
  // TESTE 6: Isolamento Multi-tenant
  // =========================================================================
  const calcDiana = calcularPlanejamentoCompras(u2Id, {
    incluirVendas: true,
    incluirMinimo: true,
    incluirUltimas: true
  });
  // Diana não possui insumos cadastrados no catálogo nem receitas nos seus pedidos
  assert.strictEqual(calcDiana.itensPlanejamento.length, 0, 'Diana não deve ver insumos da Carla');
  console.log('✅ Teste 6: Isolamento multi-tenant aprovado com sucesso!');

  console.log('🎉 Todos os testes de Planejamento & Compras Inteligente foram concluídos com 100% de sucesso!');
} finally {
  // Limpar usuários de teste
  db.prepare("DELETE FROM usuarios WHERE email IN ('compras_test1@confeitaria.com', 'compras_test2@confeitaria.com')").run();
}
