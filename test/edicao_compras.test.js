const assert = require('assert');
const db = require('../db');

console.log('🧪 Iniciando testes de Edição de Ingredientes e Compras...');

async function run() {
  await db.rodarMigracoes();

  // 1. Criar usuário temporário para teste
  const resUser = await db.run('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)',
    ['Teste Edição', 'teste_edicao@confeitaria.com', 'hash_fake']);
  const uid = resUser.lastInsertRowid;

  // 2. Cadastrar Ingrediente inicial
  const resIng = await db.run(`
    INSERT INTO ingredientes_catalogo (usuario_id, nome, unidade, estoque_atual, estoque_minimo, preco_atual, qtd_embalagem_padrao)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [uid, 'Manteiga Sem Sal', 'g', 1000, 200, 12.00, 200]);
  const ingId = resIng.lastInsertRowid;

  // 3. Cadastrar uma compra ativa: 5 embalagens de 200g (1000g total) por R$ 12,00 cada
  const resCompra = await db.run(`
    INSERT INTO ingredientes_compras 
    (ingrediente_id, usuario_id, data_compra, data_validade, qtd_embalagens, qtd_por_embalagem, valor_unitario_embalagem, valor_total, status, criado_em)
    VALUES (?, ?, '2026-09-29', '2026-10-29', 5, 200, 12.00, 60.00, 'ativo', datetime('now'))
  `, [ingId, uid]);
  const compraId = resCompra.lastInsertRowid;

  // 4. Testar Edição da Compra: Alterar de 5 para 8 embalagens de 200g (de 1000g para 1600g -> diferenca = +600g) e preço para 12.50
  const compraAntes = await db.get('SELECT * FROM ingredientes_compras WHERE id = ?', [compraId]);
  const novaQtdEmb = 8;
  const novaQtdPorEmb = 200;
  const novoPreco = 12.50;
  const novoTotal = novaQtdEmb * novoPreco;

  await db.transaction(async (tx) => {
    if (compraAntes.status === 'ativo') {
      const volumeAntigo = compraAntes.qtd_embalagens * compraAntes.qtd_por_embalagem;
      const volumeNovo = novaQtdEmb * novaQtdPorEmb;
      const diferenca = volumeNovo - volumeAntigo;

      await tx.run(`
        UPDATE ingredientes_catalogo
        SET estoque_atual = MAX(0, estoque_atual + ?),
            preco_atual = ?,
            qtd_embalagem_padrao = ?,
            atualizado_em = datetime('now')
        WHERE id = ? AND usuario_id = ?
      `, [diferenca, novoPreco, novaQtdPorEmb, compraAntes.ingrediente_id, uid]);
    }

    await tx.run(`
      UPDATE ingredientes_compras
      SET data_compra = ?,
          data_validade = ?,
          qtd_embalagens = ?,
          qtd_por_embalagem = ?,
          valor_unitario_embalagem = ?,
          valor_total = ?
      WHERE id = ? AND usuario_id = ?
    `, ['2026-09-29', '2026-11-15', novaQtdEmb, novaQtdPorEmb, novoPreco, novoTotal, compraId, uid]);
  });

  // Validação pós-edição
  const ingAposEdicao = await db.get('SELECT * FROM ingredientes_catalogo WHERE id = ?', [ingId]);
  const compraAposEdicao = await db.get('SELECT * FROM ingredientes_compras WHERE id = ?', [compraId]);

  assert.strictEqual(ingAposEdicao.estoque_atual, 1600, 'Estoque deve ter subido de 1000 para 1600 (+600g)');
  assert.strictEqual(ingAposEdicao.preco_atual, 12.50, 'Preço deve ter sido atualizado para 12.50');
  assert.strictEqual(compraAposEdicao.qtd_embalagens, 8, 'Qtd de embalagens na compra deve ser 8');
  assert.strictEqual(compraAposEdicao.valor_total, 100.00, 'Valor total da compra deve ser 100.00');

  // 5. Testar Edição do Ingrediente: alterar nome, estoque mínimo, etc.
  await db.run(`
    UPDATE ingredientes_catalogo
    SET nome = ?, unidade = ?, estoque_minimo = ?, qtd_embalagem_padrao = ?, preco_atual = ?, atualizado_em = datetime('now')
    WHERE id = ? AND usuario_id = ?
  `, ['Manteiga Extra Especial', 'g', 300, 200, 13.00, ingId, uid]);

  const ingModificado = await db.get('SELECT * FROM ingredientes_catalogo WHERE id = ?', [ingId]);
  assert.strictEqual(ingModificado.nome, 'Manteiga Extra Especial', 'Nome deve ser atualizado');
  assert.strictEqual(ingModificado.estoque_minimo, 300, 'Estoque mínimo deve ser 300');
  assert.strictEqual(ingModificado.preco_atual, 13.00, 'Preço deve ser 13.00');

  // 6. Testar Exclusão da Compra
  await db.transaction(async (tx) => {
    const compraParaExcluir = await tx.get('SELECT * FROM ingredientes_compras WHERE id = ?', [compraId]);
    if (compraParaExcluir && compraParaExcluir.status === 'ativo') {
      const volume = compraParaExcluir.qtd_embalagens * compraParaExcluir.qtd_por_embalagem;
      await tx.run(`
        UPDATE ingredientes_catalogo
        SET estoque_atual = MAX(0, estoque_atual - ?),
            atualizado_em = datetime('now')
        WHERE id = ? AND usuario_id = ?
      `, [volume, compraParaExcluir.ingrediente_id, uid]);
    }

    await tx.run('DELETE FROM ingredientes_compras WHERE id = ? AND usuario_id = ?', [compraId, uid]);
  });

  const ingAposExclusao = await db.get('SELECT * FROM ingredientes_catalogo WHERE id = ?', [ingId]);
  const compraExiste = await db.get('SELECT * FROM ingredientes_compras WHERE id = ?', [compraId]);

  assert.strictEqual(ingAposExclusao.estoque_atual, 0, 'Estoque deve voltar a 0 após excluir a compra ativa de 1600g');
  assert.ok(!compraExiste, 'Compra não deve mais existir no banco de dados');

  // Limpeza
  await db.run('DELETE FROM usuarios WHERE id = ?', [uid]);

  console.log('✅ Todos os testes de Edição de Ingredientes e Compras passaram com sucesso!');
}

run().catch(err => {
  console.error('❌ Falha nos testes de edição de compras:', err);
  process.exit(1);
});
