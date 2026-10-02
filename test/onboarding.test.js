const assert = require('assert');
const bcrypt = require('bcryptjs');
const db = require('../db');
const onboardingService = require('../services/onboarding');
const onboardingRouter = require('../routes/onboarding');
const masterRouter = require('../routes/master');

async function run() {
  console.log('🧪 Iniciando testes do Sistema de Onboarding e Guias de Aprendizado...');

  // 1. Garantir migrações aplicadas
  await db.rodarMigracoes();

  // 2. Criar usuário temporário para os testes
  const hash = bcrypt.hashSync('Teste123@#', 10);
  const infoUser = await db.run(`
    INSERT INTO usuarios (nome, email, senha_hash, perfil, status)
    VALUES ('Confeiteira Onboarding', 'onboarding_test@confeitaria.com', ?, 'confeiteiro', 'ativo')
  `, [hash]);
  const userId = infoUser.lastInsertRowid;

  try {
    // 3. Teste de Progresso Real: Inicial (0%)
    let prog = await onboardingService.obterProgressoReal(db, userId);
    assert.strictEqual(prog.percentual, 0, 'Inicial deve ser 0%');
    assert.strictEqual(prog.totalConcluidos, 0, 'Inicial deve ter 0 concluídos');
    assert.strictEqual(prog.estaCompleto, false);
    assert.strictEqual(prog.proximoPasso.id, 'custos');
    console.log('✅ Progresso real inicial (0%) validado');

    // 4. Adicionar Custos Fixos -> 25%
    await db.run('INSERT INTO custos_fixos (usuario_id, item, valor_mensal) VALUES (?, ?, ?)', [userId, 'Gás', 150]);
    prog = await onboardingService.obterProgressoReal(db, userId);
    assert.strictEqual(prog.percentual, 25, 'Com custos deve ser 25%');
    assert.strictEqual(prog.passos.passo1_custos, true);
    assert.strictEqual(prog.proximoPasso.id, 'ingredientes');
    console.log('✅ Passo 1 (Custos Fixos -> 25%) validado');

    // 5. Adicionar Ingredientes -> 50%
    await db.run(`
      INSERT INTO ingredientes_catalogo (usuario_id, nome, unidade, preco_atual, estoque_atual, estoque_minimo)
      VALUES (?, 'Leite Condensado', 'g', 0.016, 2000, 500)
    `, [userId]);
    prog = await onboardingService.obterProgressoReal(db, userId);
    assert.strictEqual(prog.percentual, 50, 'Com ingredientes deve ser 50%');
    assert.strictEqual(prog.passos.passo2_ingredientes, true);
    assert.strictEqual(prog.proximoPasso.id, 'produtos');
    console.log('✅ Passo 2 (Insumos -> 50%) validado');

    // 6. Adicionar Produto -> 75%
    const infoProd = await db.run(`
      INSERT INTO produtos (usuario_id, nome, rendimento, unidade, tempo_horas, margem_pct)
      VALUES (?, 'Bolo de Cenoura', 10, 'fatias', 1.5, 50)
    `, [userId]);
    prog = await onboardingService.obterProgressoReal(db, userId);
    assert.strictEqual(prog.percentual, 75, 'Com produto deve ser 75%');
    assert.strictEqual(prog.passos.passo3_produtos, true);
    assert.strictEqual(prog.proximoPasso.id, 'pedidos');
    console.log('✅ Passo 3 (Receitas -> 75%) validado');

    // 7. Adicionar Cliente / Venda -> 100%
    await db.run(`
      INSERT INTO clientes (usuario_id, nome, telefone)
      VALUES (?, 'Cliente Teste', '11999999999')
    `, [userId]);
    prog = await onboardingService.obterProgressoReal(db, userId);
    assert.strictEqual(prog.percentual, 100, 'Com cliente deve ser 100%');
    assert.strictEqual(prog.passos.passo4_vendas, true);
    assert.strictEqual(prog.estaCompleto, true);
    assert.strictEqual(prog.proximoPasso, null);
    console.log('✅ Passo 4 (Vendas -> 100% Completo) validado');

    // 8. Teste de Ciclo de Status de Guias (Pendente -> Concluído -> Dispensado -> Reativar)
    let statusMap = await onboardingService.obterStatusGuias(db, userId);
    assert.strictEqual(statusMap.geral, 'pendente');
    assert.strictEqual(statusMap.custos, 'pendente');

    // Concluir guia geral
    await onboardingService.atualizarStatusGuia(db, userId, 'geral', 'concluido');
    statusMap = await onboardingService.obterStatusGuias(db, userId);
    assert.strictEqual(statusMap.geral, 'concluido');

    // Dispensar guia de custos
    await onboardingService.atualizarStatusGuia(db, userId, 'custos', 'dispensado');
    statusMap = await onboardingService.obterStatusGuias(db, userId);
    assert.strictEqual(statusMap.custos, 'dispensado');

    // Reativar individualmente guia de custos
    await onboardingService.reativarGuia(db, userId, 'custos');
    statusMap = await onboardingService.obterStatusGuias(db, userId);
    assert.strictEqual(statusMap.custos, 'pendente');

    // Reiniciar todos os guias
    await onboardingService.reiniciarTodosGuias(db, userId);
    statusMap = await onboardingService.obterStatusGuias(db, userId);
    assert.strictEqual(statusMap.geral, 'pendente');
    assert.strictEqual(statusMap.custos, 'pendente');
    assert.strictEqual(statusMap.ingredientes, 'pendente');
    assert.strictEqual(statusMap.produtos, 'pendente');
    assert.strictEqual(statusMap.pedidos, 'pendente');
    console.log('✅ Gestão de estados de guias e persistência no banco validada');

    // 9. Teste dos Endpoints do Usuário Comum (routes/onboarding.js)
    {
      const reqConcluir = {
        session: { usuario: { id: userId } },
        params: { modulo: 'ingredientes' }
      };
      let jsonResp = null;
      const resConcluir = {
        json: (data) => { jsonResp = data; }
      };

      const layer = onboardingRouter.stack.find(l => l.route && l.route.path === '/:modulo/concluir');
      assert(layer, 'Rota POST /onboarding/:modulo/concluir deve existir');
      const handler = layer.route.stack[layer.route.stack.length - 1].handle;
      await handler(reqConcluir, resConcluir);
      assert(jsonResp && jsonResp.sucesso && jsonResp.status === 'concluido');

      const checkStatus = await onboardingService.obterStatusGuias(db, userId);
      assert.strictEqual(checkStatus.ingredientes, 'concluido');
      console.log('✅ Endpoint POST /onboarding/:modulo/concluir validado com sucesso');
    }

    // 10. Teste dos Endpoints do Usuário Master (routes/master.js)
    {
      // Consultar onboarding via Master
      const reqMasterGet = {
        session: { usuario: { id: 760, perfil: 'master' } },
        params: { id: String(userId) }
      };
      let masterGetJson = null;
      const resMasterGet = {
        json: (d) => { masterGetJson = d; }
      };

      const layerGet = masterRouter.stack.find(l => l.route && l.route.path === '/usuarios/:id/onboarding' && l.route.methods.get);
      assert(layerGet, 'Rota GET /master/usuarios/:id/onboarding deve existir');
      await layerGet.route.stack[layerGet.route.stack.length - 1].handle(reqMasterGet, resMasterGet, () => {});
      assert(masterGetJson && masterGetJson.sucesso, 'Master deve obter JSON com dados do usuário');
      assert.strictEqual(masterGetJson.statusGuias.ingredientes, 'concluido');

      // Reativar módulo específico via Master
      const reqReativar = {
        session: { usuario: { id: 760, perfil: 'master' } },
        params: { id: String(userId), modulo: 'ingredientes' },
        xhr: true,
        headers: { accept: 'application/json' },
        get: () => '/master/usuarios'
      };
      let reativarJson = null;
      const resReativar = {
        json: (d) => { reativarJson = d; },
        redirect: () => {}
      };

      const layerReativar = masterRouter.stack.find(l => l.route && l.route.path === '/usuarios/:id/onboarding/:modulo/reativar' && l.route.methods.post);
      assert(layerReativar, 'Rota POST /master/usuarios/:id/onboarding/:modulo/reativar deve existir');
      await layerReativar.route.stack[layerReativar.route.stack.length - 1].handle(reqReativar, resReativar, () => {});
      assert(reativarJson && reativarJson.sucesso && reativarJson.status === 'pendente');

      const checkReativado = await onboardingService.obterStatusGuias(db, userId);
      assert.strictEqual(checkReativado.ingredientes, 'pendente', 'Master deve conseguir reativar o onboarding para o usuário');
      console.log('✅ Master reativando onboarding individualmente validado com sucesso');

      // Reiniciar todos via Master
      const reqReiniciarTodos = {
        session: { usuario: { id: 760, perfil: 'master' } },
        params: { id: String(userId) },
        xhr: true,
        headers: { accept: 'application/json' },
        get: () => '/master/usuarios'
      };
      let reiniciarTodosJson = null;
      const resReiniciarTodos = {
        json: (d) => { reiniciarTodosJson = d; },
        redirect: () => {}
      };

      const layerTodos = masterRouter.stack.find(l => l.route && l.route.path === '/usuarios/:id/onboarding/reiniciar-todos' && l.route.methods.post);
      assert(layerTodos, 'Rota POST /master/usuarios/:id/onboarding/reiniciar-todos deve existir');
      await layerTodos.route.stack[layerTodos.route.stack.length - 1].handle(reqReiniciarTodos, resReiniciarTodos, () => {});
      assert(reiniciarTodosJson && reiniciarTodosJson.sucesso);

      const checkTodos = await onboardingService.obterStatusGuias(db, userId);
      assert(Object.values(checkTodos).every(s => s === 'pendente'), 'Todos os módulos devem estar pendentes após o Master reiniciar');
      console.log('✅ Master reiniciando todos os onboardings validado com sucesso');
    }

  } finally {
    // 11. Limpeza do usuário de teste
    await db.run('DELETE FROM custos_fixos WHERE usuario_id = ?', [userId]);
    await db.run('DELETE FROM ingredientes_catalogo WHERE usuario_id = ?', [userId]);
    await db.run('DELETE FROM produtos WHERE usuario_id = ?', [userId]);
    await db.run('DELETE FROM clientes WHERE usuario_id = ?', [userId]);
    await db.run('DELETE FROM usuario_onboardings WHERE usuario_id = ?', [userId]);
    await db.run('DELETE FROM usuarios WHERE id = ?', [userId]);
    console.log('🧹 Limpeza dos dados de teste concluída');
  }

  console.log('\n🎉 TODOS OS TESTES DE ONBOARDING FORAM APROVADOS COM 100% DE SUCESSO!\n');
}

run().catch(err => {
  console.error('❌ Falha nos testes de Onboarding:', err);
  process.exit(1);
});
