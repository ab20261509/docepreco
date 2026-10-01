const assert = require('assert');
const http = require('http');
const db = require('../db');
const app = require('../server');
const { exigirMaster, exigirPermissao, carregarPermissoes } = require('../middleware/auth');

console.log('🧪 Iniciando testes de Usuário Master, RBAC e Configurações Globais...');

async function run() {
  await db.rodarMigracoes();

  // 1. Limpeza de dados de teste anteriores
  await db.run("DELETE FROM usuarios WHERE email IN ('master_test@confeitaria.com', 'confeiteiro_test@confeitaria.com', 'bloqueado_test@confeitaria.com')");

  // 2. Criar Usuário Master
  const resMaster = await db.run(`
    INSERT INTO usuarios (nome, email, senha_hash, perfil, status)
    VALUES ('Admin Master', 'master_test@confeitaria.com', 'hash_master', 'master', 'ativo')
  `);
  const masterId = resMaster.lastInsertRowid;
  assert(masterId > 0, 'Usuário Master deve ser criado');

  // 3. Criar Confeiteiro Comum
  const resConf = await db.run(`
    INSERT INTO usuarios (nome, email, senha_hash, perfil, status)
    VALUES ('Chef Confeiteiro', 'confeiteiro_test@confeitaria.com', 'hash_conf', 'confeiteiro', 'ativo')
  `);
  const confId = resConf.lastInsertRowid;
  assert(confId > 0, 'Usuário Confeiteiro deve ser criado');

  // 4. Criar Usuário Bloqueado
  const resBloq = await db.run(`
    INSERT INTO usuarios (nome, email, senha_hash, perfil, status)
    VALUES ('Bloqueado Silva', 'bloqueado_test@confeitaria.com', 'hash_bloq', 'confeiteiro', 'bloqueado')
  `);
  const bloqId = resBloq.lastInsertRowid;
  assert(bloqId > 0, 'Usuário Bloqueado deve ser criado');

  console.log('✅ Usuários de teste criados (Master, Confeiteiro, Bloqueado)');

  // 5. Testar Tabela de Configurações Globais
  const configs = await db.all('SELECT chave, valor FROM configuracoes_globais');
  assert(configs.length >= 4, 'Configurações globais padrão devem estar presentes');
  const nomeSistema = configs.find(c => c.chave === 'nome_sistema');
  assert(nomeSistema, 'Chave nome_sistema deve existir');
  console.log('✅ Configurações globais verificadas no banco');

  // 6. Testar Middleware exigirMaster
  {
    // Cenário A: Usuário não logado
    let statusCalled = null;
    let redirectedTo = null;
    const reqAnon = { session: {} };
    const resAnon = {
      redirect: (url) => { redirectedTo = url; }
    };
    exigirMaster(reqAnon, resAnon, () => {});
    assert.strictEqual(redirectedTo, '/login', 'Usuário anônimo deve ser redirecionado para /login');

    // Cenário B: Usuário confeiteiro comum tentando acessar área master
    let forbiddenRendered = false;
    let forbiddenStatus = null;
    const reqConf = { session: { usuario: { id: confId, perfil: 'confeiteiro' } } };
    const resConfMock = {
      status: (code) => {
        forbiddenStatus = code;
        return {
          render: (view) => {
            if (view === 'erro_403') forbiddenRendered = true;
          }
        };
      }
    };
    exigirMaster(reqConf, resConfMock, () => {});
    assert.strictEqual(forbiddenStatus, 403, 'Confeiteiro comum deve receber status HTTP 403 na área master');
    assert.strictEqual(forbiddenRendered, true, 'Deve renderizar a view erro_403');

    // Cenário C: Usuário Master
    let nextCalled = false;
    const reqMaster = { session: { usuario: { id: masterId, perfil: 'master' } } };
    const resMasterMock = {};
    exigirMaster(reqMaster, resMasterMock, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true, 'Usuário Master deve ter acesso liberado');
    console.log('✅ Middleware exigirMaster testado e aprovado');
  }

  // 7. Testar carregarPermissoes e RBAC
  {
    // Usuário Master tem permissão irrestrita
    const reqM = { session: { usuario: { id: masterId, perfil: 'master' } } };
    const resM = { locals: {} };
    await carregarPermissoes(reqM, resM, () => {});
    assert.strictEqual(reqM.pode('produtos', 'excluir'), true, 'Master pode excluir produtos');
    assert.strictEqual(reqM.pode('master', 'ver'), true, 'Master pode ver master');
    assert.strictEqual(resM.locals.pode('qualquer_coisa', 'qualquer_acao'), true, 'Master pode tudo em res.locals');

    // Confeiteiro com permissões padrão
    const reqC = { session: { usuario: { id: confId, perfil: 'confeiteiro' } } };
    const resC = { locals: {} };
    await carregarPermissoes(reqC, resC, () => {});
    assert.strictEqual(reqC.pode('produtos', 'ver'), true, 'Confeiteiro padrão pode ver produtos');
    assert.strictEqual(reqC.pode('produtos', 'excluir'), true, 'Confeiteiro padrão pode excluir produtos');
    assert.strictEqual(reqC.pode('master', 'ver'), false, 'Confeiteiro padrão NÃO pode ver master');

    // Customizar permissão do confeiteiro: revogar permissão de excluir produtos
    await db.run(`
      INSERT INTO permissoes_usuario (usuario_id, modulo, pode_ver, pode_criar, pode_editar, pode_excluir)
      VALUES (?, 'produtos', 1, 1, 1, 0)
    `, [confId]);

    const reqCustom = { session: { usuario: { id: confId, perfil: 'confeiteiro' } } };
    const resCustom = { locals: {} };
    await carregarPermissoes(reqCustom, resCustom, () => {});
    assert.strictEqual(reqCustom.pode('produtos', 'ver'), true, 'Confeiteiro pode ver produtos');
    assert.strictEqual(reqCustom.pode('produtos', 'criar'), true, 'Confeiteiro pode criar produtos');
    assert.strictEqual(reqCustom.pode('produtos', 'editar'), true, 'Confeiteiro pode editar produtos');
    assert.strictEqual(reqCustom.pode('produtos', 'excluir'), false, 'Confeiteiro NÃO pode mais excluir produtos');
    console.log('✅ Permissões granulares no banco e injeção do método pode() validadas');

    // 8. Testar middleware exigirPermissao
    let blockedCode = null;
    let blockedView = null;
    const resBlockedMock = {
      status: (code) => {
        blockedCode = code;
        return {
          render: (view) => { blockedView = view; }
        };
      }
    };
    const middlewareExcluir = exigirPermissao('produtos', 'excluir');
    middlewareExcluir(reqCustom, resBlockedMock, () => {
      assert.fail('Não deveria passar se permissão foi revogada');
    });
    assert.strictEqual(blockedCode, 403, 'exigirPermissao deve retornar HTTP 403');
    assert.strictEqual(blockedView, 'erro_403', 'exigirPermissao deve renderizar erro_403');
    console.log('✅ Middleware exigirPermissao barrou operação não autorizada com 403');
  }

  // 9. Testar Presets de Permissão (somente_leitura, padrao, total)
  {
    // Aplicar preset somente leitura
    const modulos = ['produtos', 'ingredientes', 'custos', 'producao', 'pedidos', 'agenda', 'compras', 'clientes', 'assistente'];
    for (const mod of modulos) {
      await db.run(`
        INSERT INTO permissoes_usuario (usuario_id, modulo, pode_ver, pode_criar, pode_editar, pode_excluir)
        VALUES (?, ?, 1, 0, 0, 0)
        ON CONFLICT(usuario_id, modulo) DO UPDATE SET
          pode_ver = 1, pode_criar = 0, pode_editar = 0, pode_excluir = 0
      `, [confId, mod]);
    }

    const reqLeitura = { session: { usuario: { id: confId, perfil: 'confeiteiro' } } };
    const resLeitura = { locals: {} };
    await carregarPermissoes(reqLeitura, resLeitura, () => {});
    assert.strictEqual(reqLeitura.pode('clientes', 'ver'), true);
    assert.strictEqual(reqLeitura.pode('clientes', 'criar'), false);
    assert.strictEqual(reqLeitura.pode('clientes', 'editar'), false);
    assert.strictEqual(reqLeitura.pode('clientes', 'excluir'), false);
    assert.strictEqual(reqLeitura.pode('pedidos', 'criar'), false);
    console.log('✅ Preset Somente Leitura verificado com sucesso');
  }

  // 10. Testar persistência via rota /master/usuarios/:id/permissoes
  {
    const masterRouter = require('../routes/master');
    const reqPost = {
      params: { id: String(confId) },
      session: { usuario: { id: masterId, perfil: 'master' } },
      body: {
        perfil: 'confeiteiro',
        status: 'ativo',
        permissoes: {
          produtos: { ver: '1', criar: '0', editar: ['0', '1'], excluir: '0' },
          pedidos: { ver: ['0', '1'], criar: ['0', '1'], editar: '0', excluir: '0' }
        }
      }
    };
    let redirectedUrl = null;
    const resPost = {
      redirect: (url) => { redirectedUrl = url; },
      status: () => resPost,
      render: () => {}
    };

    // Obter handler do POST /usuarios/:id/permissoes
    const layer = masterRouter.stack.find(l => l.route && l.route.path === '/usuarios/:id/permissoes' && l.route.methods.post);
    assert(layer, 'Rota POST /usuarios/:id/permissoes deve existir');
    const handler = layer.route.stack[0].handle;

    await handler(reqPost, resPost, (err) => { if (err) throw err; });
    assert(redirectedUrl && redirectedUrl.includes('sucesso=1'), 'Deve redirecionar com sucesso=1');

    // Verificar se persistiu no banco
    const perms = await db.all('SELECT modulo, pode_ver, pode_criar, pode_editar, pode_excluir FROM permissoes_usuario WHERE usuario_id = ?', [confId]);
    const prod = perms.find(p => p.modulo === 'produtos');
    assert.strictEqual(prod.pode_ver, 1, 'produtos pode_ver deve ser 1');
    assert.strictEqual(prod.pode_editar, 1, 'produtos pode_editar deve ser 1 (mesmo vindo como array)');
    assert.strictEqual(prod.pode_criar, 0, 'produtos pode_criar deve ser 0');
    assert.strictEqual(prod.pode_excluir, 0, 'produtos pode_excluir deve ser 0');

    const ped = perms.find(p => p.modulo === 'pedidos');
    assert.strictEqual(ped.pode_ver, 1, 'pedidos pode_ver deve ser 1');
    assert.strictEqual(ped.pode_criar, 1, 'pedidos pode_criar deve ser 1');

    console.log('✅ Persistência da rota POST /master/usuarios/:id/permissoes validada com sucesso');
  }

  // 11. Validação de visibilidade condicional do Chat Drawer Flutuante no Rodapé
  {
    const ejs = require('ejs');
    const path = require('path');
    const rodapePath = path.join(__dirname, '../views/partials/rodape.ejs');

    // Usuário sem permissão para o assistente
    const htmlSemPermissao = await ejs.renderFile(rodapePath, {
      usuario: { id: 999, nome: 'Teste' },
      pode: (modulo, acao) => modulo === 'assistente' ? false : true
    });
    assert(!htmlSemPermissao.includes('btn-flutuante-assistente'), 'Botão flutuante do assistente NÃO deve aparecer quando permissão for revogada');

    // Usuário com permissão para o assistente
    const htmlComPermissao = await ejs.renderFile(rodapePath, {
      usuario: { id: 999, nome: 'Teste' },
      pode: (modulo, acao) => true
    });
    assert(htmlComPermissao.includes('btn-flutuante-assistente'), 'Botão flutuante do assistente DEVE aparecer quando permissão estiver ativa');
    console.log('✅ Visibilidade condicional do botão flutuante do assistente no rodapé validada com sucesso');
  }

  // 12. Limpeza final dos dados de teste
  await db.run("DELETE FROM usuarios WHERE email IN ('master_test@confeitaria.com', 'confeiteiro_test@confeitaria.com', 'bloqueado_test@confeitaria.com')");
  console.log('🧹 Limpeza dos dados de teste concluída');

  console.log('\n🎉 TODOS OS TESTES DO MÓDULO MASTER E RBAC FORAM APROVADOS COM SUCESSO!\n');
}

run().catch((err) => {
  console.error('❌ Falha nos testes de Master/RBAC:', err);
  process.exit(1);
});
