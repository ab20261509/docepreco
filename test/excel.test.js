const assert = require('assert');
const XLSX = require('xlsx');

console.log('🧪 Iniciando teste do importador e modelo Excel...');

// 1. Criar dados de teste com as colunas solicitadas
const dados = [
  {
    'Ingrediente': 'Leite Condensado Moça',
    'Qtd Usada (g/ml/un)': 395,
    'Preço Pacote (R$)': 'R$ 7,20',
    'Qtd Pacote (g/ml/un)': 395
  },
  {
    'Ingrediente': 'Cacau em Pó 100%',
    'Qtd Usada (g/ml/un)': '50',
    'Preço Pacote (R$)': '32,50',
    'Qtd Pacote (g/ml/un)': '1000'
  }
];

const ws = XLSX.utils.json_to_sheet(dados);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Ingredientes');

const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
assert(buffer && buffer.length > 0, 'Buffer da planilha Excel deve ser gerado');

// 2. Simular a leitura como no navegador
const workbookLido = XLSX.read(buffer, { type: 'buffer' });
const sheetName = workbookLido.SheetNames[0];
assert.strictEqual(sheetName, 'Ingredientes', 'Aba deve ser Ingredientes');

const rows = XLSX.utils.sheet_to_json(workbookLido.Sheets[sheetName]);
assert.strictEqual(rows.length, 2, 'Deve ter lido 2 linhas');

function parseValorNumerico(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  let str = String(val).trim().replace(/[R$\s]/gi, '');
  if (str.includes(',')) {
    str = str.replace(/\./g, '').replace(',', '.');
  }
  const n = parseFloat(str);
  return isNaN(n) ? 0 : n;
}

// 3. Validar a extração dos valores
assert.strictEqual(rows[0]['Ingrediente'], 'Leite Condensado Moça');
assert.strictEqual(parseValorNumerico(rows[0]['Qtd Usada (g/ml/un)']), 395);
assert.strictEqual(parseValorNumerico(rows[0]['Preço Pacote (R$)']), 7.20);
assert.strictEqual(parseValorNumerico(rows[0]['Qtd Pacote (g/ml/un)']), 395);

assert.strictEqual(rows[1]['Ingrediente'], 'Cacau em Pó 100%');
assert.strictEqual(parseValorNumerico(rows[1]['Qtd Usada (g/ml/un)']), 50);
assert.strictEqual(parseValorNumerico(rows[1]['Preço Pacote (R$)']), 32.50);
assert.strictEqual(parseValorNumerico(rows[1]['Qtd Pacote (g/ml/un)']), 1000);

console.log('✅ Teste do importador Excel concluído com sucesso!');
