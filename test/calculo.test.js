const assert = require('assert');
const { custoFixoHora, calcularProduto } = require('../calculo');

console.log('🧪 Iniciando testes de calculo.js...');

// Teste 1: Custo fixo por hora
const cfH = custoFixoHora(3310, 160);
console.log(`Custo fixo/hora: R$ ${cfH.toFixed(2)} (esperado: R$ 20.69)`);
assert.strictEqual(cfH.toFixed(2), '20.69', 'Custo fixo/hora deve ser 20.69');

// Teste 2: Produto com custo unitário R$ 2.28, rendimento 30, margem 40%, taxas 5%
// Custo do lote = 2.28 * 30 = 68.40
// Por exemplo: A (ingredientes) = 40.00, B (embalagens) = 7.7125, C (1h * 20.6875) = 20.6875, D = 0 => Total = 68.40
const produto = {
  rendimento: 30,
  tempo_horas: 1,
  mao_obra_extra: 0,
  margem_pct: 40,
  taxas_pct: 5
};

const ingredientes = [
  { qtd_usada: 395, qtd_pacote: 395, preco_pacote: 6.50 }, // Leite condensado
  { qtd_usada: 200, qtd_pacote: 200, preco_pacote: 4.50 }, // Creme de leite
  { qtd_usada: 100, qtd_pacote: 1000, preco_pacote: 50.00 }, // Chocolate nobre (5.00)
  { qtd_usada: 150, qtd_pacote: 500, preco_pacote: 80.00 } // Granulado belga (24.00) => Total A = 40.00
];

const complementos = [
  { custo_lote: 7.7125 } // Forminhas e caixas
];

const res = calcularProduto(produto, ingredientes, complementos, cfH);

console.log(`Custo do lote: R$ ${res.custoLote.toFixed(2)}`);
console.log(`Custo por unidade: R$ ${res.custoUnit.toFixed(2)} (esperado: R$ 2.28)`);
console.log(`Preço sugerido: R$ ${res.preco.toFixed(2)} (esperado: R$ 4.14 ou 4.15)`);
console.log(`Lucro por unidade: R$ ${res.lucroUnit.toFixed(2)} (esperado: R$ 1.86 ou 1.87)`);
console.log(`% de Lucro: ${(res.percLucro * 100).toFixed(1)}% (esperado: 45.0%)`);

assert.strictEqual(res.custoUnit.toFixed(2), '2.28', 'Custo unitário deve ser 2.28');
assert.strictEqual((res.percLucro * 100).toFixed(1), '45.0', '% de lucro deve ser 45.0%');

// Teste 3: Margem + taxas >= 100% deve lançar erro
assert.throws(() => {
  calcularProduto({ rendimento: 10, margem_pct: 70, taxas_pct: 30 }, [], [], 10);
}, /Margem \+ taxas precisam somar menos de 100%/);

console.log('✅ Todos os testes de cálculo passaram com sucesso!');
