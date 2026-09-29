const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'confeitaria.db');

// Fechar e redefinir o arquivo do banco se existir
if (fs.existsSync(dbPath)) {
  try {
    fs.unlinkSync(dbPath);
    console.log('🗑️ Arquivo de banco de dados antigo removido.');
  } catch (err) {
    // Se estiver bloqueado por outro processo, limpar as tabelas
    console.log('⚠️ Arquivo em uso, limpando tabelas via SQL...');
    const db = new Database(dbPath);
    db.pragma('foreign_keys = OFF');
    const tabelas = ['clientes', 'ingredientes_compras', 'ingredientes_catalogo', 'complementos', 'ingredientes', 'produtos', 'custos_fixos', 'configuracoes', 'usuarios', 'sessions'];
    tabelas.forEach(t => {
      try { db.exec(`DROP TABLE IF EXISTS ${t}`); } catch (e) {}
    });
    db.pragma('foreign_keys = ON');
    db.close();
  }
}

// Inicializar banco limpo com schema.sql
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);
db.close();

console.log('✅ Banco de dados resetado com sucesso! Estrutura limpa e pronta para uso.');
