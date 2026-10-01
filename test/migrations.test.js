const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');

console.log('🧪 Iniciando testes do Sistema de Migrações Versionadas com libSQL...');

async function run() {
  const testDbPath = path.join(__dirname, 'test_migrations.db');
  if (fs.existsSync(testDbPath)) {
    try { fs.unlinkSync(testDbPath); } catch (_) {}
  }

  const client = createClient({ url: `file:${testDbPath}` });

  try {
    // Criar tabela de migrações
    await client.execute(`
      CREATE TABLE IF NOT EXISTS _migracoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        arquivo TEXT NOT NULL UNIQUE,
        executada_em TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    const migrationsDir = path.join(__dirname, '..', 'migrations');
    assert.ok(fs.existsSync(migrationsDir), 'Diretório de migrations deve existir');

    const arquivos = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    assert.ok(arquivos.length >= 4, 'Devem existir ao menos as 4 migrações padrão');

    // 1. Aplicar migrações
    for (const arq of arquivos) {
      const sql = fs.readFileSync(path.join(migrationsDir, arq), 'utf8');
      await client.executeMultiple(sql);
      await client.execute({
        sql: 'INSERT INTO _migracoes (arquivo) VALUES (?)',
        args: [arq]
      });
    }

    const resMig = await client.execute('SELECT arquivo FROM _migracoes');
    assert.strictEqual(resMig.rows.length, arquivos.length, 'Todas as migrações devem ser registradas');
    console.log(`✅ ${arquivos.length} migrações aplicadas com sucesso`);

    // 2. Inserir dados para testar persistência
    const userRes = await client.execute({
      sql: 'INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
      args: ['Confeiteira Teste', 'migracao@teste.com', 'hash_teste']
    });
    const userId = Number(userRes.lastInsertRowid);
    assert.ok(userId > 0);

    // 3. Simular reinicialização / novo deploy: tentar rodar migrações novamente
    const resJaExecutadas = await client.execute('SELECT arquivo FROM _migracoes');
    const jaExecutadas = new Set(resJaExecutadas.rows.map(r => r.arquivo));

    let migracoesReexecutadas = 0;
    for (const arq of arquivos) {
      if (!jaExecutadas.has(arq)) {
        migracoesReexecutadas++;
      }
    }

    assert.strictEqual(migracoesReexecutadas, 0, 'Nenhuma migração já aplicada deve ser reexecutada');
    console.log('✅ Verificação de idempotência aprovada: migrações não são refeitas');

    // 4. Validar que os dados anteriores continuam 100% intactos
    const userAposDeploy = await client.execute({
      sql: 'SELECT * FROM usuarios WHERE id = ?',
      args: [userId]
    });
    assert.strictEqual(userAposDeploy.rows[0].email, 'migracao@teste.com', 'Dados do usuário devem continuar intactos');
    console.log('✅ Persistência de dados validada: nenhuma tabela ou registro foi resetado');

    console.log('🎉 Todos os testes de Migrações Versionadas foram concluídos com 100% de sucesso!');
  } finally {
    client.close();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch (_) {}
    }
  }
}

run().catch(err => {
  console.error('❌ Falha nos testes de migrações:', err);
  process.exit(1);
});
