const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Garante que o teste use o banco e os módulos reais
const db = require('../db');
const bcrypt = require('bcryptjs');
const { custoFixoHora, calcularProduto } = require('../calculo');

console.log('🧪 Iniciando testes de integração com o banco SQLite...');

// Limpar dados anteriores de teste se existirem
db.prepare("DELETE FROM usuarios WHERE email IN ('maria@confeitaria.com', 'joana@doces.com')").run();

// 1. Teste de Cadastro de Usuária (Maria)
const hashSenha = bcrypt.hashSync('senhaSegura123', 10);
const resUser1 = db.prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)').run(
  'Maria Confeiteira',
  'maria@confeitaria.com',
  hashSenha
);
const mariaId = resUser1.lastInsertRowid;
assert(mariaId > 0, 'Usuária Maria deve ter sido criada');

// Configuração padrão
db.prepare('INSERT INTO configuracoes (usuario_id, horas_mes) VALUES (?, 160)').run(mariaId);

// 9 itens padrão de custos fixos
const itensPadrao = [
  'Aluguel do espaço / Cozinha',
  'Água e Esgoto',
  'Energia elétrica',
  'Gás (encanado / botijão)',
  'Internet e Telefone',
  'Produtos de limpeza e higiene',
  'Salário / Pró-labore',
  'Equipamentos / Depreciação',
  'Outros custos fixos'
];

const stmtCusto = db.prepare('INSERT INTO custos_fixos (usuario_id, item, valor_mensal) VALUES (?, ?, ?)');
for (const item of itensPadrao) {
  stmtCusto.run(mariaId, item, 0);
}

const custosMaria = db.prepare('SELECT * FROM custos_fixos WHERE usuario_id = ?').all(mariaId);
assert.strictEqual(custosMaria.length, 9, 'Maria deve ter exatamente os 9 custos fixos padrão criados');
console.log('✅ Usuária Maria criada com os 9 itens padrão de custos fixos');

// 2. Atualizar custos fixos para totalizar R$ 3.310 e 160h
// Exemplo: Salário R$ 2.000, Aluguel R$ 600, Energia R$ 300, Água R$ 100, Gás R$ 150, Internet R$ 100, Limpeza R$ 60 = 3310
db.prepare('UPDATE custos_fixos SET valor_mensal = 2000 WHERE usuario_id = ? AND item = ?').run(mariaId, 'Salário / Pró-labore');
db.prepare('UPDATE custos_fixos SET valor_mensal = 600 WHERE usuario_id = ? AND item = ?').run(mariaId, 'Aluguel do espaço / Cozinha');
db.prepare('UPDATE custos_fixos SET valor_mensal = 300 WHERE usuario_id = ? AND item = ?').run(mariaId, 'Energia elétrica');
db.prepare('UPDATE custos_fixos SET valor_mensal = 100 WHERE usuario_id = ? AND item = ?').run(mariaId, 'Água e Esgoto');
db.prepare('UPDATE custos_fixos SET valor_mensal = 150 WHERE usuario_id = ? AND item = ?').run(mariaId, 'Gás (encanado / botijão)');
db.prepare('UPDATE custos_fixos SET valor_mensal = 100 WHERE usuario_id = ? AND item = ?').run(mariaId, 'Internet e Telefone');
db.prepare('UPDATE custos_fixos SET valor_mensal = 60 WHERE usuario_id = ? AND item = ?').run(mariaId, 'Produtos de limpeza e higiene');

const totalFixosRow = db.prepare('SELECT SUM(valor_mensal) as t FROM custos_fixos WHERE usuario_id = ?').get(mariaId);
assert.strictEqual(totalFixosRow.t, 3310, 'Total de custos fixos deve ser 3.310');

const cfHora = custoFixoHora(totalFixosRow.t, 160);
assert.strictEqual(cfHora.toFixed(2), '20.69', 'Custo por hora deve ser 20.69');
console.log(`✅ Custos fixos de Maria atualizados: Total R$ ${totalFixosRow.t}, Custo/Hora: R$ ${cfHora.toFixed(2)}`);

// 3. Cadastrar Produto: Brigadeiro Gourmet Tradicional
const resProd = db.prepare(`
  INSERT INTO produtos (usuario_id, nome, rendimento, tempo_horas, mao_obra_extra, margem_pct, taxas_pct)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(mariaId, 'Brigadeiro Gourmet Tradicional', 30, 1.0, 0, 40, 5);
const prodId = resProd.lastInsertRowid;

// Ingredientes
const stmtIng = db.prepare('INSERT INTO ingredientes (produto_id, nome, qtd_usada, preco_pacote, qtd_pacote) VALUES (?, ?, ?, ?, ?)');
stmtIng.run(prodId, 'Leite Condensado 395g', 395, 6.50, 395);
stmtIng.run(prodId, 'Creme de Leite 200g', 200, 4.50, 200);
stmtIng.run(prodId, 'Chocolate Nobre 50%', 100, 50.00, 1000);
stmtIng.run(prodId, 'Granulado Belga', 150, 80.00, 500);

// Complementos
const stmtComp = db.prepare('INSERT INTO complementos (produto_id, nome, custo_lote) VALUES (?, ?, ?)');
stmtComp.run(prodId, 'Forminhas 4 pétalas e caixa para 30 brigadeiros', 7.7125);

// Testar cálculo do produto
const produtoBanco = db.prepare('SELECT * FROM produtos WHERE id = ?').get(prodId);
const ingredientesBanco = db.prepare('SELECT * FROM ingredientes WHERE produto_id = ?').all(prodId);
const complementosBanco = db.prepare('SELECT * FROM complementos WHERE produto_id = ?').all(prodId);

const calc = calcularProduto(produtoBanco, ingredientesBanco, complementosBanco, cfHora);
console.log(`✅ Produto gravado e calculado:`);
console.log(`   - Custo Unitário: R$ ${calc.custoUnit.toFixed(2)}`);
console.log(`   - Preço Sugerido: R$ ${calc.preco.toFixed(2)}`);
console.log(`   - Lucro Unitário: R$ ${calc.lucroUnit.toFixed(2)}`);
console.log(`   - % de Lucro: ${(calc.percLucro * 100).toFixed(1)}%`);

assert.strictEqual(calc.custoUnit.toFixed(2), '2.28');
assert.strictEqual((calc.percLucro * 100).toFixed(1), '45.0');

// 4. Teste de Isolamento entre Usuários (Multi-tenant)
const resUser2 = db.prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)').run(
  'Joana Doces',
  'joana@doces.com',
  hashSenha
);
const joanaId = resUser2.lastInsertRowid;

// Joana tenta carregar o produto de Maria com filtro por usuario_id
const produtoDaMariaVistoPorJoana = db.prepare('SELECT * FROM produtos WHERE id = ? AND usuario_id = ?').get(prodId, joanaId);
assert.strictEqual(produtoDaMariaVistoPorJoana, undefined, 'Joana NÃO pode conseguir consultar produtos de Maria!');

// Joana tenta excluir o produto de Maria
const deleteInvasivo = db.prepare('DELETE FROM produtos WHERE id = ? AND usuario_id = ?').run(prodId, joanaId);
assert.strictEqual(deleteInvasivo.changes, 0, 'Joana NÃO pode conseguir excluir produtos de Maria!');

const produtoAindaExiste = db.prepare('SELECT * FROM produtos WHERE id = ?').get(prodId);
assert(produtoAindaExiste, 'O produto de Maria continua seguro');

console.log('✅ Teste de isolamento entre usuárias aprovado com sucesso!');

// Limpeza de testes
db.prepare('DELETE FROM usuarios WHERE id IN (?, ?)').run(mariaId, joanaId);
console.log('🎉 Todos os testes de integração e segurança foram concluídos com 100% de sucesso!');
