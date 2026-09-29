const assert = require('assert');
const db = require('../db');

console.log('🧪 Iniciando testes de Estoque e Grade de Compras...');

// 1. Criar usuário temporário para teste
const resUser = db.prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)')
  .run('Teste Estoque', 'estoque_test@confeitaria.com', 'hash_fake');
const uid = resUser.lastInsertRowid;

// 2. Cadastrar Ingrediente no Catálogo
const resIng = db.prepare(`
  INSERT INTO ingredientes_catalogo (usuario_id, nome, unidade, estoque_atual, estoque_minimo, preco_atual, qtd_embalagem_padrao)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(uid, 'Leite Condensado Piracanjuba', 'g', 0, 500, 0, 395);
const ingId = resIng.lastInsertRowid;

assert(ingId > 0, 'Ingrediente deve ser cadastrado com sucesso');

// 3. Primeira Compra: 4 pacotes de 395g por R$ 6,20 cada
const qtd1 = 4;
const emb1 = 395;
const val1 = 6.20;
const total1 = qtd1 * val1;

db.transaction(() => {
  db.prepare(`
    INSERT INTO ingredientes_compras 
    (ingrediente_id, usuario_id, data_compra, qtd_embalagens, qtd_por_embalagem, valor_unitario_embalagem, valor_total)
    VALUES (?, ?, date('now'), ?, ?, ?, ?)
  `).run(ingId, uid, qtd1, emb1, val1, total1);

  db.prepare(`
    UPDATE ingredientes_catalogo 
    SET estoque_atual = estoque_atual + ?, preco_atual = ?, qtd_embalagem_padrao = ?
    WHERE id = ? AND usuario_id = ?
  `).run(qtd1 * emb1, val1, emb1, ingId, uid);
})();

let ingBanco = db.prepare('SELECT * FROM ingredientes_catalogo WHERE id = ?').get(ingId);
assert.strictEqual(ingBanco.estoque_atual, 1580, 'Estoque deve ser 4 * 395 = 1580g');
assert.strictEqual(ingBanco.preco_atual, 6.20, 'Preço deve ser 6.20');

// 4. Segunda Compra: 2 pacotes de 395g por R$ 6,80 (preço subiu)
const qtd2 = 2;
const val2 = 6.80;
const total2 = qtd2 * val2;

db.transaction(() => {
  db.prepare(`
    INSERT INTO ingredientes_compras 
    (ingrediente_id, usuario_id, data_compra, qtd_embalagens, qtd_por_embalagem, valor_unitario_embalagem, valor_total)
    VALUES (?, ?, date('now'), ?, ?, ?, ?)
  `).run(ingId, uid, qtd2, emb1, val2, total2);

  db.prepare(`
    UPDATE ingredientes_catalogo 
    SET estoque_atual = estoque_atual + ?, preco_atual = ?, qtd_embalagem_padrao = ?
    WHERE id = ? AND usuario_id = ?
  `).run(qtd2 * emb1, val2, emb1, ingId, uid);
})();

ingBanco = db.prepare('SELECT * FROM ingredientes_catalogo WHERE id = ?').get(ingId);
assert.strictEqual(ingBanco.estoque_atual, 2370, 'Estoque deve ser 1580 + 790 = 2370g');
assert.strictEqual(ingBanco.preco_atual, 6.80, 'Preço atual deve ser atualizado para o mais recente (6.80)');

// 5. Histórico de compras deve conter as 2 compras
const compras = db.prepare('SELECT * FROM ingredientes_compras WHERE ingrediente_id = ?').all(ingId);
assert.strictEqual(compras.length, 2, 'Histórico deve conter 2 compras');

// 6. Ajuste manual de estoque (ex: 200g usados ou perdidos -> sobra 2170g)
db.prepare('UPDATE ingredientes_catalogo SET estoque_atual = ? WHERE id = ? AND usuario_id = ?').run(2170, ingId, uid);
ingBanco = db.prepare('SELECT * FROM ingredientes_catalogo WHERE id = ?').get(ingId);
assert.strictEqual(ingBanco.estoque_atual, 2170, 'Estoque após ajuste deve ser 2170g');

// 7. Isolamento de usuário
const resUserOutro = db.prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)')
  .run('Outro Usuário', 'outro_user@confeitaria.com', 'hash_fake');
const uidOutro = resUserOutro.lastInsertRowid;

const itemVistoPorOutro = db.prepare('SELECT * FROM ingredientes_catalogo WHERE id = ? AND usuario_id = ?')
  .get(ingId, uidOutro);
assert.strictEqual(itemVistoPorOutro, undefined, 'Outro usuário NÃO pode ver o ingrediente');

// Limpeza
db.prepare('DELETE FROM usuarios WHERE id IN (?, ?)').run(uid, uidOutro);

console.log('✅ Todos os testes de Estoque e Grade de Compras foram aprovados!');
