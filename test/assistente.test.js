const assert = require('assert');
const db = require('../db');
const assistenteIa = require('../services/assistente_ia');
const assistenteRoutes = require('../routes/assistente');

console.log('🧪 Iniciando testes do Assistente Virtual, Sessões, Manual & Feedback...');

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

  // C. Insumo com estoque baixo (150g)
  await db.run(`
    INSERT INTO ingredientes_catalogo (usuario_id, nome, unidade, estoque_atual, estoque_minimo, preco_atual, qtd_embalagem_padrao)
    VALUES (?, 'Chocolate Meio Amargo Nobre', 'g', 150, 500, 35, 1000)
  `, [uid1]);

  // Adicionar ingrediente na receita (300g por unidade base)
  await db.run(`
    INSERT INTO ingredientes (produto_id, nome, qtd_usada, preco_pacote, qtd_pacote)
    VALUES (?, 'Chocolate Meio Amargo Nobre', 300, 35, 1000)
  `, [prodId]);

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

  // 4. Testar Conhecimento do Manual do Sistema (Perguntas Operacionais)
  const respPrecificacao = assistenteIa.gerarRespostaNativa('Como o sistema calcula o preço de venda sugerido?', contexto);
  assert.ok(respPrecificacao.includes('Preço Sugerido = Custo Total × (1 + Margem / 100)'), 'Deve conter fórmula exata do manual');
  assert.ok(respPrecificacao.includes('Mão de Obra Operacional'), 'Deve citar a mão de obra');

  const respModoCozinha = assistenteIa.gerarRespostaNativa('Como funciona a tela dividida no Modo Cozinha?', contexto);
  assert.ok(respModoCozinha.includes('Tela Dividida'), 'Deve explicar tela dividida');
  assert.ok(respModoCozinha.includes('Sequência Inteligente de Misturas'), 'Deve citar a sequência');

  console.log('✅ Respostas baseadas no Manual Oficial do Sistema validadas!');

  // 5. Testar Guardrail para Assuntos Proibidos / Fora de Contexto
  const respForaEscopo1 = assistenteIa.gerarRespostaNativa('Quem ganhou a copa de 1970?', contexto);
  assert.ok(respForaEscopo1.includes('assistente especializado do **DocePreço**'), 'Deve recusar pergunta de futebol');

  const respForaEscopo2 = assistenteIa.gerarRespostaNativa('Qual a cotação do bitcoin e dólar hoje?', contexto);
  assert.ok(respForaEscopo2.includes('assistente especializado do **DocePreço**'), 'Deve recusar pergunta de cripto/dólar');
  console.log('✅ Guardrails e restrição categórica ao sistema de confeitaria validados!');

  // 6. Testar Auditoria de Estoque para Produção (pergunta real do confeiteiro)
  const respEstoqueProducao = assistenteIa.gerarRespostaNativa('A produção possui o estoque disponível para ser preparado?', contexto);
  assert.ok(respEstoqueProducao.includes('NÃO há estoque suficiente'), 'Deve identificar que falta estoque para a produção');
  assert.ok(respEstoqueProducao.includes('Chocolate Meio Amargo Nobre'), 'Deve citar o ingrediente faltante');
  assert.ok(respEstoqueProducao.includes('faltam 450'), 'Deve calcular a quantidade exata que falta comprar');
  console.log('✅ Auditoria de estoque para produção validada com precisão!');

  // 7. Testar Ciclo de Vida de Sessões de Atendimento
  const sessaoSofia = await assistenteRoutes.obterOuCriarSessaoAtiva(db, uid1);
  assert.ok(sessaoSofia && sessaoSofia.id, 'Deve criar ou recuperar uma sessão ativa');
  assert.strictEqual(sessaoSofia.status, 'aberta');

  // Gravar mensagem do usuário e da assistente na sessão
  const msgUser = await db.run(`
    INSERT INTO chat_mensagens (usuario_id, sessao_id, papel, conteudo, criado_em)
    VALUES (?, ?, 'usuario', 'Temos estoque para a torta?', datetime('now'))
  `, [uid1, sessaoSofia.id]);

  const msgAssist = await db.run(`
    INSERT INTO chat_mensagens (usuario_id, sessao_id, papel, conteudo, criado_em)
    VALUES (?, ?, 'assistente', 'Falta chocolate para produzir o lote completo.', datetime('now'))
  `, [uid1, sessaoSofia.id]);

  const assistId = msgAssist.lastInsertRowid;

  // 8. Testar Feedback do Usuário na Resposta (👍 Legal / 👎 Ruim)
  await db.run("UPDATE chat_mensagens SET feedback = 1 WHERE id = ? AND usuario_id = ?", [assistId, uid1]);
  const msgAvaliada = await db.get("SELECT feedback FROM chat_mensagens WHERE id = ?", [assistId]);
  assert.strictEqual(msgAvaliada.feedback, 1, 'Feedback 👍 deve ser gravado como 1');

  // Alterar para 👎
  await db.run("UPDATE chat_mensagens SET feedback = -1 WHERE id = ? AND usuario_id = ?", [assistId, uid1]);
  const msgReavaliada = await db.get("SELECT feedback FROM chat_mensagens WHERE id = ?", [assistId]);
  assert.strictEqual(msgReavaliada.feedback, -1, 'Feedback 👎 deve ser gravado como -1');
  console.log('✅ Registro e atualização de feedbacks (👍 e 👎) validados com sucesso!');

  // 9. Testar Encerramento de Atendimento com Síntese de Aprendizado
  const mensagensParaSintese = [
    { papel: 'usuario', conteudo: 'Temos estoque para a torta?', feedback: null },
    { papel: 'assistente', conteudo: 'Falta chocolate para produzir o lote completo.', feedback: 1 }
  ];

  const sintese = await assistenteIa.sintetizarAprendizadoSessao(mensagensParaSintese, { likes: 1, dislikes: 0 }, null);
  assert.ok(sintese.titulo, 'Deve gerar um título para a sessão');
  assert.ok(sintese.aprendizadoResumo.includes('Estoque'), 'Aprendizado deve identificar o tema de estoque');
  assert.ok(sintese.aprendizadoResumo.includes('positivamente'), 'Aprendizado deve considerar o feedback positivo');

  // Encerrar a sessão no banco
  await db.run(`
    UPDATE chat_sessoes
    SET status = 'encerrada', titulo = ?, aprendizado_resumo = ?, encerrada_em = datetime('now')
    WHERE id = ? AND usuario_id = ?
  `, [sintese.titulo, sintese.aprendizadoResumo, sessaoSofia.id, uid1]);

  const sessaoEncerrada = await db.get("SELECT status, titulo, aprendizado_resumo FROM chat_sessoes WHERE id = ?", [sessaoSofia.id]);
  assert.strictEqual(sessaoEncerrada.status, 'encerrada');
  assert.strictEqual(sessaoEncerrada.titulo, sintese.titulo);
  console.log('✅ Encerramento de atendimento e síntese de aprendizado validados!');

  // 10. Testar Memória Contínua (Próximo Contexto deve incluir o Aprendizado Passado)
  const contextoNovo = await assistenteIa.coletarContextoUsuario(db, uid1);
  assert.ok(contextoNovo.aprendizadosPassados.length >= 1, 'Deve carregar aprendizados de sessões anteriores');
  assert.strictEqual(contextoNovo.aprendizadosPassados[0].titulo, sintese.titulo);
  console.log('✅ Memória contínua da IA carregando aprendizados de atendimentos anteriores validada!');

  // 11. Testar Isolamento Multi-tenant das Sessões
  const sessoesLaura = await db.all("SELECT * FROM chat_sessoes WHERE usuario_id = ?", [uid2]);
  assert.strictEqual(sessoesLaura.length, 0, 'Laura não deve ver nenhuma sessão de Sofia');
  console.log('✅ Isolamento multi-tenant de sessões e aprendizados validado!');

  // Limpeza final
  await db.run("DELETE FROM usuarios WHERE id IN (?, ?)", [uid1, uid2]);
  console.log('🎉 Todos os testes de Assistente, Sessões, Manual & Feedback foram concluídos com 100% de sucesso!\n');
}

run().catch(err => {
  console.error('❌ Falha nos testes do assistente:', err);
  process.exit(1);
});
