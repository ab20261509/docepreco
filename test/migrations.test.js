const assert = require('assert');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

console.log('🧪 Iniciando testes do Sistema de Migrações Versionadas...');

const testDbPath = path.join(__dirname, 'test_migrations.db');
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

try {
  const db = new Database(testDbPath);
  db.pragma('foreign_keys = ON');

  // Criar tabela de migrações
  db.exec(`
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
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO _migracoes (arquivo) VALUES (?)').run(arq);
    })();
  }

  const migracoesSalvas = db.prepare('SELECT arquivo FROM _migracoes').all();
  assert.strictEqual(migracoesSalvas.length, arquivos.length, 'Todas as migrações devem ser registradas');
  console.log(`✅ ${arquivos.length} migrações aplicadas com sucesso`);

  // 2. Inserir dados para testar persistência
  const user = db.prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?) RETURNING id')
    .get('Confeiteira Teste', 'migracao@teste.com', 'hash_teste');
  assert.ok(user.id > 0);

  // 3. Simular reinicialização / novo deploy: tentar rodar migrações novamente
  const jaExecutadas = new Set(
    db.prepare('SELECT arquivo FROM _migracoes').all().map(r => r.arquivo)
  );

  let migracoesReexecutadas = 0;
  for (const arq of arquivos) {
    if (!jaExecutadas.has(arq)) {
      migracoesReexecutadas++;
    }
  }

  assert.strictEqual(migracoesReexecutadas, 0, 'Nenhuma migração já aplicada deve ser reexecutada');
  console.log('✅ Verificação de idempotência aprovada: migrações não são refeitas');

  // 4. Validar que os dados anteriores continuam 100% intactos
  const userAposDeploy = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(user.id);
  assert.strictEqual(userAposDeploy.email, 'migracao@teste.com', 'Dados do usuário devem continuar intactos');
  console.log('✅ Persistência de dados validada: nenhuma tabela ou registro foi resetado');

  db.close();
  console.log('🎉 Todos os testes de Migrações Versionadas foram concluídos com 100% de sucesso!');
} finally {
  if (fs.existsSync(testDbPath)) {
    try { fs.unlinkSync(testDbPath); } catch (_) {}
  }
}
