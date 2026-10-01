const assert = require('assert');
const path = require('path');
const fs = require('fs');

const db = require('../db');
const bcrypt = require('bcryptjs');
const { custoFixoHora, calcularProduto } = require('../calculo');

console.log('🧪 Iniciando testes de integração com o banco SQLite/Turso...');

async function run() {
  await db.rodarMigracoes();

  // Limpar dados anteriores de teste se existirem
  await db.run("DELETE FROM usuarios WHERE email IN ('maria@confeitaria.com', 'joana@doces.com')");

  // 1. Teste de Cadastro de Usuária (Maria)
  const hashSenha = bcrypt.hashSync('senhaSegura123', 10);
  const resUser1 = await db.run('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)', [
    'Maria Confeiteira',
    'maria@confeitaria.com',
    hashSenha
  ]);
  const mariaId = resUser1.lastInsertRowid;
  assert(mariaId > 0, 'Usuária Maria deve ter sido criada');

  // Configuração padrão
  await db.run('INSERT INTO configuracoes (usuario_id, horas_mes) VALUES (?, 160)', [mariaId]);

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

  for (const item of itensPadrao) {
    await db.run('INSERT INTO custos_fixos (usuario_id, item, valor_mensal) VALUES (?, ?, ?)', [mariaId, item, 0]);
  }

  const custosMaria = await db.all('SELECT * FROM custos_fixos WHERE usuario_id = ?', [mariaId]);
  assert.strictEqual(custosMaria.length, 9, 'Maria deve ter exatamente os 9 custos fixos padrão criados');
  console.log('✅ Usuária Maria criada com os 9 itens padrão de custos fixos');

  // 2. Atualizar custos fixos para totalizar R$ 3.310 e 160h
  await db.run('UPDATE custos_fixos SET valor_mensal = 2000 WHERE usuario_id = ? AND item = ?', [mariaId, 'Salário / Pró-labore']);
  await db.run('UPDATE custos_fixos SET valor_mensal = 600 WHERE usuario_id = ? AND item = ?', [mariaId, 'Aluguel do espaço / Cozinha']);
  await db.run('UPDATE custos_fixos SET valor_mensal = 300 WHERE usuario_id = ? AND item = ?', [mariaId, 'Energia elétrica']);
  await db.run('UPDATE custos_fixos SET valor_mensal = 100 WHERE usuario_id = ? AND item = ?', [mariaId, 'Água e Esgoto']);
  await db.run('UPDATE custos_fixos SET valor_mensal = 150 WHERE usuario_id = ? AND item = ?', [mariaId, 'Gás (encanado / botijão)']);
  await db.run('UPDATE custos_fixos SET valor_mensal = 100 WHERE usuario_id = ? AND item = ?', [mariaId, 'Internet e Telefone']);
  await db.run('UPDATE custos_fixos SET valor_mensal = 60 WHERE usuario_id = ? AND item = ?', [mariaId, 'Produtos de limpeza e higiene']);

  const totalFixosRow = await db.get('SELECT SUM(valor_mensal) as t FROM custos_fixos WHERE usuario_id = ?', [mariaId]);
  assert.strictEqual(totalFixosRow.t, 3310, 'Total de custos fixos deve ser 3.310');

  const cfHora = custoFixoHora(totalFixosRow.t, 160);
  assert.strictEqual(cfHora.toFixed(2), '20.69', 'Custo por hora deve ser 20.69');
  console.log(`✅ Custos fixos de Maria atualizados: Total R$ ${totalFixosRow.t}, Custo/Hora: R$ ${cfHora.toFixed(2)}`);

  // 3. Cadastrar Produto: Brigadeiro Gourmet Tradicional
  const resProd = await db.run(`
    INSERT INTO produtos (usuario_id, nome, rendimento, tempo_horas, mao_obra_extra, margem_pct, taxas_pct)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [mariaId, 'Brigadeiro Gourmet Tradicional', 30, 1.0, 0, 40, 5]);
  const prodId = resProd.lastInsertRowid;

  // Ingredientes
  await db.run('INSERT INTO ingredientes (produto_id, nome, qtd_usada, preco_pacote, qtd_pacote) VALUES (?, ?, ?, ?, ?)', [prodId, 'Leite Condensado 395g', 395, 6.50, 395]);
  await db.run('INSERT INTO ingredientes (produto_id, nome, qtd_usada, preco_pacote, qtd_pacote) VALUES (?, ?, ?, ?, ?)', [prodId, 'Creme de Leite 200g', 200, 4.50, 200]);
  await db.run('INSERT INTO ingredientes (produto_id, nome, qtd_usada, preco_pacote, qtd_pacote) VALUES (?, ?, ?, ?, ?)', [prodId, 'Chocolate Nobre 50%', 100, 50.00, 1000]);
  await db.run('INSERT INTO ingredientes (produto_id, nome, qtd_usada, preco_pacote, qtd_pacote) VALUES (?, ?, ?, ?, ?)', [prodId, 'Granulado Belga', 150, 80.00, 500]);

  // Complementos
  await db.run('INSERT INTO complementos (produto_id, nome, custo_lote) VALUES (?, ?, ?)', [prodId, 'Forminhas 4 pétalas e caixa para 30 brigadeiros', 7.7125]);

  // Testar cálculo do produto
  const produtoBanco = await db.get('SELECT * FROM produtos WHERE id = ?', [prodId]);
  const ingredientesBanco = await db.all('SELECT * FROM ingredientes WHERE produto_id = ?', [prodId]);
  const complementosBanco = await db.all('SELECT * FROM complementos WHERE produto_id = ?', [prodId]);

  const calc = calcularProduto(produtoBanco, ingredientesBanco, complementosBanco, cfHora);
  console.log(`✅ Produto gravado e calculado:`);
  console.log(`   - Custo Unitário: R$ ${calc.custoUnit.toFixed(2)}`);
  console.log(`   - Preço Sugerido: R$ ${calc.preco.toFixed(2)}`);
  console.log(`   - Lucro Unitário: R$ ${calc.lucroUnit.toFixed(2)}`);
  console.log(`   - % de Lucro: ${(calc.percLucro * 100).toFixed(1)}%`);

  assert.strictEqual(calc.custoUnit.toFixed(2), '2.28');
  assert.strictEqual((calc.percLucro * 100).toFixed(1), '45.0');

  // 4. Teste de Isolamento entre Usuários (Multi-tenant)
  const resUser2 = await db.run('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)', [
    'Joana Doces',
    'joana@doces.com',
    hashSenha
  ]);
  const joanaId = resUser2.lastInsertRowid;

  // Joana tenta carregar o produto de Maria com filtro por usuario_id
  const produtoDaMariaVistoPorJoana = await db.get('SELECT * FROM produtos WHERE id = ? AND usuario_id = ?', [prodId, joanaId]);
  assert.ok(!produtoDaMariaVistoPorJoana, 'Joana NÃO pode conseguir consultar produtos de Maria!');

  // Joana tenta excluir o produto de Maria
  const deleteInvasivo = await db.run('DELETE FROM produtos WHERE id = ? AND usuario_id = ?', [prodId, joanaId]);
  assert.strictEqual(deleteInvasivo.changes, 0, 'Joana NÃO pode conseguir excluir produtos de Maria!');

  const produtoAindaExiste = await db.get('SELECT * FROM produtos WHERE id = ?', [prodId]);
  assert.ok(produtoAindaExiste, 'O produto de Maria continua seguro');

  console.log('✅ Teste de isolamento entre usuárias aprovado com sucesso!');

  // Limpeza de testes
  await db.run('DELETE FROM usuarios WHERE id IN (?, ?)', [mariaId, joanaId]);
  console.log('🎉 Todos os testes de integração e segurança foram concluídos com 100% de sucesso!');
}

run().catch(err => {
  console.error('❌ Falha nos testes de integração:', err);
  process.exit(1);
});
