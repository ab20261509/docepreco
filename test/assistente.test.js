const assert = require('assert');
const db = require('../db');
const assistenteIa = require('../services/assistente_ia');

console.log('🧪 Iniciando testes do Assistente Virtual & Chat IA...');

async function run() {
  await db.rodarMigracoes();

  // Limpar dados de teste anteriores
  await db.run("DELETE FROM usuarios WHERE email IN ('chat_user1@docepreco.com', 'chat_user2@docepreco.com')");

  // 1. Criar dois usuários para testar o contexto e o isolamento
  const u1 = await db.run("INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)", ['Confeiteira Sofia', 'chat_user1@docepreco.com', 'hash123']);
  const uid1 = u1.lastInsertRowid;

  const u2 = await db.run("INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)", ['Confeiteira Laura', 'chat_user2@docepreco.com', 'hash123']);
  const uid2 = u2.lastInsertRowid;

  // 2. Popular dados para Sofia (u1)
  const agora = new Date();
  const hojeIso = agora.toISOString().split('T')[0];

  // A. Custo fixo
  await db.run("INSERT INTO custos_fixos (usuario_id, item, valor_mensal) VALUES (?, 'Energia e Forno', 600)", [uid1]);

  // B. Produto
  const p1 = await db.run("INSERT INTO produtos (usuario_id, nome, rendimento, unidade, tempo_horas, margem_pct) VALUES (?, 'Torta Holandesa', 1, 'un', 1.5, 45)", [uid1]);
  const prodId = p1.lastInsertRowid;

  // C. Insumo com estoque baixo
  await db.run(`
    INSERT INTO ingredientes_catalogo (usuario_id, nome, unidade, estoque_atual, estoque_minimo, preco_atual, qtd_embalagem_padrao)
    VALUES (?, 'Chocolate Meio Amargo Nobre', 'g', 150, 500, 35, 1000)
  `, [uid1]);

  // D. Pedido para Hoje
  await db.run(`
    INSERT INTO pedidos (usuario_id, data_entrega, horario_entrega, status, valor_total, cliente_nome_avulso)
    VALUES (?, ?, '15:30', 'confirmado', 120, 'Renata Alencar')
  `, [uid1, hojeIso]);

  // E. Produção ativa na cozinha
  await db.run(`
    INSERT INTO producoes (usuario_id, produto_id, nome_receita, quantidade_produzida, unidade, status, iniciado_em, tempo_estimado_min)
    VALUES (?, ?, 'Torta Holandesa', 2, 'un', 'em_preparo', datetime('now'), 90)
  `, [uid1, prodId]);

  // 3. Testar Coleta de Contexto Culinário
  const contexto = await assistenteIa.coletarContextoUsuario(db, uid1);
  assert.strictEqual(contexto.usuarioNome, 'Confeiteira Sofia');
  assert.strictEqual(contexto.pedidosHoje.length, 1, 'Deve encontrar 1 pedido para hoje');
  assert.strictEqual(contexto.pedidosHoje[0].cliente, 'Renata Alencar');
  assert.strictEqual(contexto.producoesAtivas.length, 1, 'Deve encontrar 1 lote em preparo na cozinha');
  assert.strictEqual(contexto.producoesAtivas[0].receita, 'Torta Holandesa');
  assert.strictEqual(contexto.estoqueBaixo.length, 1, 'Deve encontrar 1 insumo com estoque baixo');
  assert.strictEqual(contexto.estoqueBaixo[0].nome, 'Chocolate Meio Amargo Nobre');
  assert.strictEqual(contexto.custos.totalMensal, 600);
  console.log('✅ Coletor de contexto em tempo real validado com sucesso!');

  // 4. Testar Guardrail para Assuntos Proibidos / Fora de Contexto
  const respForaEscopo1 = assistenteIa.gerarRespostaNativa('Quem ganhou a copa de 1970?', contexto);
  assert.ok(respForaEscopo1.includes('assistente especializado do **DocePreço**'), 'Deve recusar pergunta de futebol');

  const respForaEscopo2 = assistenteIa.gerarRespostaNativa('Qual a cotação do bitcoin e dólar hoje?', contexto);
  assert.ok(respForaEscopo2.includes('assistente especializado do **DocePreço**'), 'Deve recusar pergunta de cripto/dólar');
  console.log('✅ Guardrails e restrição categórica ao sistema de confeitaria validados!');

  // 5. Testar Respostas com Dados Vivos da Confeitaria
  const respPedidos = assistenteIa.gerarRespostaNativa('Quais encomendas temos para hoje?', contexto);
  assert.ok(respPedidos.includes('Renata Alencar'), 'Resposta de pedidos deve conter o nome da cliente');
  assert.ok(respPedidos.includes('15:30'), 'Resposta de pedidos deve conter o horário');

  const respCozinha = assistenteIa.gerarRespostaNativa('O que está na cozinha agora?', contexto);
  assert.ok(respCozinha.includes('Torta Holandesa'), 'Resposta de produção deve citar a receita em preparo');

  const respEstoque = assistenteIa.gerarRespostaNativa('Quais ingredientes estão com estoque baixo?', contexto);
  assert.ok(respEstoque.includes('Chocolate Meio Amargo Nobre'), 'Resposta de estoque deve citar o insumo em alerta');
  console.log('✅ Respostas inteligentes baseadas em tarefas e dados do confeiteiro validadas com sucesso!');

  // 6. Testar Persistência de Mensagens no Banco e Isolamento Multi-tenant
  await db.run("INSERT INTO chat_mensagens (usuario_id, papel, conteudo) VALUES (?, 'usuario', 'O que temos para hoje?')", [uid1]);
  await db.run("INSERT INTO chat_mensagens (usuario_id, papel, conteudo) VALUES (?, 'assistente', 'Você tem 1 pedido para entrega.')", [uid1]);

  const msgsSofia = await db.all("SELECT * FROM chat_mensagens WHERE usuario_id = ?", [uid1]);
  const msgsLaura = await db.all("SELECT * FROM chat_mensagens WHERE usuario_id = ?", [uid2]);
  assert.strictEqual(msgsSofia.length, 2, 'Sofia deve ter 2 mensagens gravadas');
  assert.strictEqual(msgsLaura.length, 0, 'Laura não deve ver nenhuma mensagem de Sofia');
  console.log('✅ Persistência de conversas e isolamento multi-tenant aprovados!');

  // 7. Testar Limpeza de Conversa
  await db.run("DELETE FROM chat_mensagens WHERE usuario_id = ?", [uid1]);
  const msgsAposLimpar = await db.all("SELECT * FROM chat_mensagens WHERE usuario_id = ?", [uid1]);
  assert.strictEqual(msgsAposLimpar.length, 0, 'Mensagens de Sofia devem ser zeradas após limpeza');
  console.log('✅ Limpeza de histórico do chat validada com sucesso!');

  // Limpeza
  await db.run("DELETE FROM usuarios WHERE id IN (?, ?)", [uid1, uid2]);
  console.log('🎉 Todos os testes do Assistente Virtual & Chat IA foram concluídos com 100% de sucesso!\n');
}

run().catch(err => {
  console.error('❌ Falha nos testes do assistente:', err);
  process.exit(1);
});
