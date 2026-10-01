const fs = require('fs');
const path = require('path');
const db = require('./db');

async function reset() {
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const tabelas = [
    '_migracoes', 'sessions', 'pedido_itens', 'pedidos', 'clientes',
    'ingredientes_compras', 'ingredientes_catalogo', 'complementos',
    'ingredientes', 'produtos', 'custos_fixos', 'configuracoes', 'usuarios'
  ];

  for (const t of tabelas) {
    try {
      await db.run(`DROP TABLE IF EXISTS ${t}`);
    } catch (e) {}
  }

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await db.exec(schema);

  await db.rodarMigracoes();

  console.log('✅ Banco de dados resetado com sucesso! Estrutura limpa e pronta para uso.');
}

if (require.main === module) {
  reset().catch(err => {
    console.error('Erro ao resetar DB:', err);
    process.exit(1);
  });
}

module.exports = reset;
