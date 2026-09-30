const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// No Render com Persistent Disk, use DATA_DIR=/data ou o diretório padrão data/
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DB_PATH || path.join(dataDir, 'confeitaria.db');
const db = new Database(dbPath);

try {
  db.pragma('journal_mode = WAL');
} catch (e) {
  try { db.pragma('journal_mode = DELETE'); } catch (_) {}
}
db.pragma('foreign_keys = ON');

/**
 * Runner de Migrações Versionadas
 * Garante que a estrutura do banco evolua de forma segura e incremental sem nunca
 * apagar ou recriar tabelas existentes ao subir novos commits ou fazer deploy.
 */
function rodarMigracoes(banco) {
  banco.exec(`
    CREATE TABLE IF NOT EXISTS _migracoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      arquivo TEXT NOT NULL UNIQUE,
      executada_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const arquivos = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const jaExecutadas = new Set(
    banco.prepare('SELECT arquivo FROM _migracoes').all().map(r => r.arquivo)
  );

  for (const arq of arquivos) {
    if (!jaExecutadas.has(arq)) {
      const sql = fs.readFileSync(path.join(migrationsDir, arq), 'utf8');
      const aplicar = banco.transaction(() => {
        banco.exec(sql);
        banco.prepare('INSERT INTO _migracoes (arquivo) VALUES (?)').run(arq);
      });
      aplicar();
      console.log(`📦 [Migrações] Aplicada com sucesso: ${arq}`);
    }
  }
}

rodarMigracoes(db);

module.exports = db;
