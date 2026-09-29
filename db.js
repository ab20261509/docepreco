const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = process.env.VERCEL ? '/tmp' : path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'confeitaria.db');
const db = new Database(dbPath);

try {
  db.pragma('journal_mode = WAL');
} catch (e) {
  try { db.pragma('journal_mode = DELETE'); } catch (_) {}
}
db.pragma('foreign_keys = ON');

const schemaPath = path.join(__dirname, 'schema.sql');
if (fs.existsSync(schemaPath)) {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
}

// Migrações seguras para tabelas existentes
try { db.exec("ALTER TABLE ingredientes_compras ADD COLUMN data_validade TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE ingredientes_compras ADD COLUMN status TEXT NOT NULL DEFAULT 'ativo'"); } catch (e) {}
try { db.exec("ALTER TABLE ingredientes_compras ADD COLUMN motivo_baixa TEXT"); } catch (e) {}

module.exports = db;
