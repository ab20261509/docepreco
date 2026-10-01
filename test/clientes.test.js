const assert = require('assert');
const db = require('../db');
const { gerarLinkWhatsApp, formatarTelefone } = require('../routes/clientes');

console.log('🧪 Iniciando testes do Módulo Comercial: Clientes...');

async function run() {
  await db.rodarMigracoes();

  // Limpar dados de teste anteriores
  await db.run("DELETE FROM usuarios WHERE email IN ('cliente_test1@confeitaria.com', 'cliente_test2@confeitaria.com')");

  // 1. Criar duas usuárias de teste para validação de isolamento multi-tenant
  const u1 = await db.run('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
    ['Confeiteira Ana', 'cliente_test1@confeitaria.com', 'hash_fake']);
  const uid1 = u1.lastInsertRowid;

  const u2 = await db.run('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
    ['Confeiteira Beatriz', 'cliente_test2@confeitaria.com', 'hash_fake']);
  const uid2 = u2.lastInsertRowid;

  // 2. Testar funções auxiliares de formatação de telefone e link de WhatsApp
  assert.strictEqual(formatarTelefone('11987654321'), '(11) 98765-4321');
  assert.strictEqual(formatarTelefone('1133334444'), '(11) 3333-4444');
  assert.strictEqual(gerarLinkWhatsApp('11987654321'), 'https://wa.me/5511987654321');
  assert.strictEqual(gerarLinkWhatsApp('5511987654321'), 'https://wa.me/5511987654321');
  assert.strictEqual(gerarLinkWhatsApp(''), null);
  assert.strictEqual(gerarLinkWhatsApp('123'), null);
  console.log('✅ Helpers de formatação de WhatsApp e telefone validados');

  // 3. Cadastrar clientes para a usuária 1
  const resC1 = await db.run(`
    INSERT INTO clientes (usuario_id, nome, telefone, email, endereco, bairro, cidade, observacoes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [uid1, 'Mariana Oliveira', '11998877665', 'mariana@email.com', 'Rua das Palmeiras, 45', 'Pinheiros', 'São Paulo', 'Prefere bolo de chocolate sem nozes']);
  const c1Id = resC1.lastInsertRowid;

  const resC2 = await db.run(`
    INSERT INTO clientes (usuario_id, nome, telefone, email, endereco, bairro, cidade, observacoes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [uid1, 'Carlos Eduardo', '11912345678', 'carlos@email.com', 'Av. Paulista, 1000 - Apto 82', 'Bela Vista', 'São Paulo', 'Cliente corporativo']);
  const c2Id = resC2.lastInsertRowid;

  // Cadastrar cliente para a usuária 2
  const resC3 = await db.run(`
    INSERT INTO clientes (usuario_id, nome, telefone, email, endereco, bairro, cidade, observacoes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [uid2, 'Fernanda Costa', '21988887777', 'fernanda@email.com', 'Rua Barata Ribeiro, 200', 'Copacabana', 'Rio de Janeiro', null]);
  const c3Id = resC3.lastInsertRowid;

  // 4. Testar listagem e isolamento multi-tenant
  const clientesAna = await db.all('SELECT * FROM clientes WHERE usuario_id = ? ORDER BY nome ASC', [uid1]);
  assert.strictEqual(clientesAna.length, 2, 'Ana deve visualizar apenas seus 2 clientes');
  assert.strictEqual(clientesAna[0].nome, 'Carlos Eduardo');
  assert.strictEqual(clientesAna[1].nome, 'Mariana Oliveira');

  const clientesBeatriz = await db.all('SELECT * FROM clientes WHERE usuario_id = ? ORDER BY nome ASC', [uid2]);
  assert.strictEqual(clientesBeatriz.length, 1, 'Beatriz deve visualizar apenas seu 1 cliente');
  assert.strictEqual(clientesBeatriz[0].nome, 'Fernanda Costa');
  console.log('✅ Isolamento multi-tenant de clientes validado com sucesso');

  // 5. Testar edição de cliente
  await db.run(`
    UPDATE clientes 
    SET nome = ?, telefone = ?, bairro = ?, observacoes = ? 
    WHERE id = ? AND usuario_id = ?
  `, ['Mariana Oliveira Santos', '11999990000', 'Vila Madalena', 'Adora brigadeiro de pistache', c1Id, uid1]);

  const c1Atualizado = await db.get('SELECT * FROM clientes WHERE id = ?', [c1Id]);
  assert.strictEqual(c1Atualizado.nome, 'Mariana Oliveira Santos');
  assert.strictEqual(c1Atualizado.telefone, '11999990000');
  assert.strictEqual(c1Atualizado.bairro, 'Vila Madalena');
  assert.strictEqual(c1Atualizado.observacoes, 'Adora brigadeiro de pistache');
  console.log('✅ Edição de dados do cliente aprovada');

  // 6. Testar busca / autocomplete
  const termo = 'Vila';
  const busca = await db.all(`
    SELECT id, nome, telefone, endereco, bairro, cidade 
    FROM clientes 
    WHERE usuario_id = ? AND (nome LIKE ? OR telefone LIKE ? OR bairro LIKE ?)
  `, [uid1, `%${termo}%`, `%${termo}%`, `%${termo}%`]);

  assert.strictEqual(busca.length, 1);
  assert.strictEqual(busca[0].id, c1Id);
  console.log('✅ Busca rápida por nome/telefone/bairro aprovada');

  // 7. Testar exclusão de cliente
  await db.run('DELETE FROM clientes WHERE id = ? AND usuario_id = ?', [c2Id, uid1]);
  const clientesRestantes = await db.all('SELECT * FROM clientes WHERE usuario_id = ?', [uid1]);
  assert.strictEqual(clientesRestantes.length, 1, 'Após excluir, Ana deve ter apenas 1 cliente');
  assert.strictEqual(clientesRestantes[0].id, c1Id);
  console.log('✅ Exclusão de cliente aprovada com segurança');

  // Limpeza pós-teste
  await db.run("DELETE FROM usuarios WHERE email IN ('cliente_test1@confeitaria.com', 'cliente_test2@confeitaria.com')");

  console.log('🎉 Todos os testes de Clientes foram concluídos com 100% de sucesso!\n');
}

run().catch(err => {
  console.error('❌ Falha nos testes de clientes:', err);
  process.exit(1);
});
