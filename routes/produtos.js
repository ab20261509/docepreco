const express = require('express');
const XLSX = require('xlsx');
const db = require('../db');
const { exigirLogin } = require('../middleware/auth');
const { custoFixoHora, calcularProduto } = require('../calculo');

const router = express.Router();

// Rota para download da planilha modelo em Excel para importação
router.get('/modelo-excel', exigirLogin, (req, res) => {
  const dados = [
    {
      'Ingrediente': 'Leite Condensado 395g',
      'Qtd Usada (g/ml/un)': 395,
      'Preço Pacote (R$)': 6.50,
      'Qtd Pacote (g/ml/un)': 395
    },
    {
      'Ingrediente': 'Creme de Leite 200g',
      'Qtd Usada (g/ml/un)': 200,
      'Preço Pacote (R$)': 4.50,
      'Qtd Pacote (g/ml/un)': 200
    },
    {
      'Ingrediente': 'Chocolate Nobre 50%',
      'Qtd Usada (g/ml/un)': 100,
      'Preço Pacote (R$)': 50.00,
      'Qtd Pacote (g/ml/un)': 1000
    },
    {
      'Ingrediente': 'Granulado Belga',
      'Qtd Usada (g/ml/un)': 150,
      'Preço Pacote (R$)': 80.00,
      'Qtd Pacote (g/ml/un)': 500
    }
  ];

  const ws = XLSX.utils.json_to_sheet(dados);
  ws['!cols'] = [
    { wch: 30 },
    { wch: 22 },
    { wch: 20 },
    { wch: 22 }
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ingredientes');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', 'attachment; filename="modelo_ingredientes_confeitaria.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

async function getCustoFixoHoraUsuario(uid) {
  const totalFixosRow = await db.get('SELECT COALESCE(SUM(valor_mensal), 0) AS t FROM custos_fixos WHERE usuario_id = ?', [uid]);
  const totalFixos = totalFixosRow ? totalFixosRow.t : 0;
  const configRow = await db.get('SELECT horas_mes FROM configuracoes WHERE usuario_id = ?', [uid]);
  const horasMes = configRow && configRow.horas_mes > 0 ? configRow.horas_mes : 160;
  return { cfHora: custoFixoHora(totalFixos, horasMes), totalFixos, horasMes };
}

// Tela de cadastro de novo produto
router.get('/novo', exigirLogin, async (req, res, next) => {
  try {
    const uid = req.session.usuario.id;
    const { cfHora } = await getCustoFixoHoraUsuario(uid);
    const catalogoIngredientes = await db.all(`
      SELECT id, nome, unidade, preco_atual, qtd_embalagem_padrao, estoque_atual 
      FROM ingredientes_catalogo 
      WHERE usuario_id = ? 
      ORDER BY nome ASC
    `, [uid]);

    const produtoVazio = {
      id: null,
      nome: '',
      rendimento: 1,
      unidade: 'un',
      tempo_horas: 0,
      mao_obra_extra: 0,
      margem_pct: 40,
      taxas_pct: 5
    };

    res.render('produto', {
      produto: produtoVazio,
      ingredientes: [],
      complementos: [],
      catalogoIngredientes,
      calculo: null,
      cfHora,
      erro: null,
      modo: 'novo',
      activeNav: 'novo_produto'
    });
  } catch (err) {
    next(err);
  }
});

// Processar criação de produto
router.post('/', exigirLogin, async (req, res, next) => {
  try {
    const uid = req.session.usuario.id;
    const { cfHora } = await getCustoFixoHoraUsuario(uid);

    const nome = (req.body.nome || '').trim();
    const rendimento = parseFloat(req.body.rendimento) || 1;
    const unidadeValida = ['un', 'kg', 'g', 'fatia'];
    const unidade = unidadeValida.includes(req.body.unidade) ? req.body.unidade : 'un';
    let tempoHoras = parseFloat(req.body.tempo_horas);
    if (isNaN(tempoHoras) || tempoHoras < 0) {
      const th = Math.max(0, parseFloat(req.body.tempo_horas_parte) || 0);
      const tm = Math.max(0, parseFloat(req.body.tempo_minutos_parte) || 0);
      tempoHoras = th + (tm / 60);
    }
    const maoObraExtra = parseFloat(req.body.mao_obra_extra) || 0;
    const margemPct = parseFloat(req.body.margem_pct) || 0;
    const taxasPct = parseFloat(req.body.taxas_pct) || 0;

    if (!nome) {
      return res.status(400).render('produto', {
        produto: { id: null, nome, rendimento, unidade, tempo_horas: tempoHoras, mao_obra_extra: maoObraExtra, margem_pct: margemPct, taxas_pct: taxasPct },
        ingredientes: [],
        complementos: [],
        calculo: null,
        cfHora,
        erro: 'Informe o nome do produto.',
        modo: 'novo',
        activeNav: 'novo_produto'
      });
    }

    if (rendimento <= 0) {
      return res.status(400).render('produto', {
        produto: { id: null, nome, rendimento, unidade, tempo_horas: tempoHoras, mao_obra_extra: maoObraExtra, margem_pct: margemPct, taxas_pct: taxasPct },
        ingredientes: [],
        complementos: [],
        calculo: null,
        cfHora,
        erro: 'O rendimento do lote deve ser maior que zero.',
        modo: 'novo',
        activeNav: 'novo_produto'
      });
    }

    if (margemPct + taxasPct >= 100) {
      return res.status(400).render('produto', {
        produto: { id: null, nome, rendimento, unidade, tempo_horas: tempoHoras, mao_obra_extra: maoObraExtra, margem_pct: margemPct, taxas_pct: taxasPct },
        ingredientes: [],
        complementos: [],
        calculo: null,
        cfHora,
        erro: 'A soma de Margem de Lucro (%) e Taxas (%) deve ser menor que 100%.',
        modo: 'novo',
        activeNav: 'novo_produto'
      });
    }

    // Processar listas dinâmicas de ingredientes
    const ingNomes = Array.isArray(req.body.ing_nome) ? req.body.ing_nome : (req.body.ing_nome ? [req.body.ing_nome] : []);
    const ingQtdUsada = Array.isArray(req.body.ing_qtd_usada) ? req.body.ing_qtd_usada : (req.body.ing_qtd_usada ? [req.body.ing_qtd_usada] : []);
    const ingPrecoPacote = Array.isArray(req.body.ing_preco_pacote) ? req.body.ing_preco_pacote : (req.body.ing_preco_pacote ? [req.body.ing_preco_pacote] : []);
    const ingQtdPacote = Array.isArray(req.body.ing_qtd_pacote) ? req.body.ing_qtd_pacote : (req.body.ing_qtd_pacote ? [req.body.ing_qtd_pacote] : []);

    // Processar complementos
    const compNomes = Array.isArray(req.body.comp_nome) ? req.body.comp_nome : (req.body.comp_nome ? [req.body.comp_nome] : []);
    const compCustos = Array.isArray(req.body.comp_custo) ? req.body.comp_custo : (req.body.comp_custo ? [req.body.comp_custo] : []);

    const novoProdutoId = await db.transaction(async (tx) => {
      const info = await tx.run(`
        INSERT INTO produtos (usuario_id, nome, rendimento, unidade, tempo_horas, mao_obra_extra, margem_pct, taxas_pct, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `, [uid, nome, rendimento, unidade, tempoHoras, maoObraExtra, margemPct, taxasPct]);

      const produtoId = Number(info.lastInsertRowid);

      for (let i = 0; i < ingNomes.length; i++) {
        const ingNome = (ingNomes[i] || '').trim();
        const qtdUsada = parseFloat(ingQtdUsada[i]) || 0;
        const precoPacote = parseFloat(ingPrecoPacote[i]) || 0;
        const qtdPacote = parseFloat(ingQtdPacote[i]) || 0;

        if (ingNome && qtdPacote > 0) {
          await tx.run(`
            INSERT INTO ingredientes (produto_id, nome, qtd_usada, preco_pacote, qtd_pacote)
            VALUES (?, ?, ?, ?, ?)
          `, [produtoId, ingNome, Math.max(0, qtdUsada), Math.max(0, precoPacote), qtdPacote]);
        }
      }

      for (let i = 0; i < compNomes.length; i++) {
        const compNome = (compNomes[i] || '').trim();
        const custoLote = parseFloat(compCustos[i]) || 0;

        if (compNome) {
          await tx.run(`
            INSERT INTO complementos (produto_id, nome, custo_lote)
            VALUES (?, ?, ?)
          `, [produtoId, compNome, Math.max(0, custoLote)]);
        }
      }

      return produtoId;
    });

    res.redirect(`/produtos/${novoProdutoId}?salvo=1`);
  } catch (err) {
    console.error('Erro ao cadastrar produto:', err);
    res.status(500).send('Erro ao salvar produto.');
  }
});

// Ver e editar produto existente
router.get('/:id', exigirLogin, async (req, res, next) => {
  try {
    const uid = req.session.usuario.id;
    const id = parseInt(req.params.id, 10);

    const produto = await db.get('SELECT * FROM produtos WHERE id = ? AND usuario_id = ?', [id, uid]);
    if (!produto) {
      return res.status(404).render('erro_404', { mensagem: 'Produto não encontrado ou você não tem permissão para acessá-lo.' });
    }

    const { cfHora } = await getCustoFixoHoraUsuario(uid);
    const catalogoIngredientes = await db.all(`
      SELECT id, nome, unidade, preco_atual, qtd_embalagem_padrao, estoque_atual 
      FROM ingredientes_catalogo 
      WHERE usuario_id = ? 
      ORDER BY nome ASC
    `, [uid]);
    const ingredientes = await db.all('SELECT * FROM ingredientes WHERE produto_id = ? ORDER BY id ASC', [id]);
    const complementos = await db.all('SELECT * FROM complementos WHERE produto_id = ? ORDER BY id ASC', [id]);

    let calculo = null;
    let erro = null;
    try {
      calculo = calcularProduto(produto, ingredientes, complementos, cfHora);
    } catch (err) {
      erro = err.message;
    }

    res.render('produto', {
      produto,
      ingredientes,
      complementos,
      catalogoIngredientes,
      calculo,
      cfHora,
      erro,
      sucesso: req.query.salvo === '1',
      modo: 'editar',
      activeNav: 'produtos'
    });
  } catch (err) {
    next(err);
  }
});

// Atualizar produto existente
router.post('/:id', exigirLogin, async (req, res, next) => {
  try {
    const uid = req.session.usuario.id;
    const id = parseInt(req.params.id, 10);

    const produto = await db.get('SELECT * FROM produtos WHERE id = ? AND usuario_id = ?', [id, uid]);
    if (!produto) {
      return res.status(404).send('Produto não encontrado');
    }

    const { cfHora } = await getCustoFixoHoraUsuario(uid);

    const nome = (req.body.nome || '').trim();
    const rendimento = parseFloat(req.body.rendimento) || 1;
    const unidadeValida = ['un', 'kg', 'g', 'fatia'];
    const unidade = unidadeValida.includes(req.body.unidade) ? req.body.unidade : 'un';
    let tempoHoras = parseFloat(req.body.tempo_horas);
    if (isNaN(tempoHoras) || tempoHoras < 0) {
      const th = Math.max(0, parseFloat(req.body.tempo_horas_parte) || 0);
      const tm = Math.max(0, parseFloat(req.body.tempo_minutos_parte) || 0);
      tempoHoras = th + (tm / 60);
    }
    const maoObraExtra = parseFloat(req.body.mao_obra_extra) || 0;
    const margemPct = parseFloat(req.body.margem_pct) || 0;
    const taxasPct = parseFloat(req.body.taxas_pct) || 0;

    if (!nome || rendimento <= 0 || margemPct + taxasPct >= 100) {
      const ingredientes = await db.all('SELECT * FROM ingredientes WHERE produto_id = ?', [id]);
      const complementos = await db.all('SELECT * FROM complementos WHERE produto_id = ?', [id]);
      return res.status(400).render('produto', {
        produto: { id, nome, rendimento, unidade, tempo_horas: tempoHoras, mao_obra_extra: maoObraExtra, margem_pct: margemPct, taxas_pct: taxasPct },
        ingredientes,
        complementos,
        calculo: null,
        cfHora,
        erro: 'Dados inválidos. Verifique o nome, rendimento (> 0) e a soma da margem + taxas (< 100%).',
        modo: 'editar',
        activeNav: 'produtos'
      });
    }

    const ingNomes = Array.isArray(req.body.ing_nome) ? req.body.ing_nome : (req.body.ing_nome ? [req.body.ing_nome] : []);
    const ingQtdUsada = Array.isArray(req.body.ing_qtd_usada) ? req.body.ing_qtd_usada : (req.body.ing_qtd_usada ? [req.body.ing_qtd_usada] : []);
    const ingPrecoPacote = Array.isArray(req.body.ing_preco_pacote) ? req.body.ing_preco_pacote : (req.body.ing_preco_pacote ? [req.body.ing_preco_pacote] : []);
    const ingQtdPacote = Array.isArray(req.body.ing_qtd_pacote) ? req.body.ing_qtd_pacote : (req.body.ing_qtd_pacote ? [req.body.ing_qtd_pacote] : []);

    const compNomes = Array.isArray(req.body.comp_nome) ? req.body.comp_nome : (req.body.comp_nome ? [req.body.comp_nome] : []);
    const compCustos = Array.isArray(req.body.comp_custo) ? req.body.comp_custo : (req.body.comp_custo ? [req.body.comp_custo] : []);

    await db.transaction(async (tx) => {
      await tx.run(`
        UPDATE produtos
        SET nome = ?, rendimento = ?, unidade = ?, tempo_horas = ?, mao_obra_extra = ?, margem_pct = ?, taxas_pct = ?, atualizado_em = datetime('now')
        WHERE id = ? AND usuario_id = ?
      `, [nome, rendimento, unidade, tempoHoras, maoObraExtra, margemPct, taxasPct, id, uid]);

      // Substituição de ingredientes
      await tx.run('DELETE FROM ingredientes WHERE produto_id = ?', [id]);
      for (let i = 0; i < ingNomes.length; i++) {
        const ingNome = (ingNomes[i] || '').trim();
        const qtdUsada = parseFloat(ingQtdUsada[i]) || 0;
        const precoPacote = parseFloat(ingPrecoPacote[i]) || 0;
        const qtdPacote = parseFloat(ingQtdPacote[i]) || 0;
        if (ingNome && qtdPacote > 0) {
          await tx.run(`
            INSERT INTO ingredientes (produto_id, nome, qtd_usada, preco_pacote, qtd_pacote)
            VALUES (?, ?, ?, ?, ?)
          `, [id, ingNome, Math.max(0, qtdUsada), Math.max(0, precoPacote), qtdPacote]);
        }
      }

      // Substituição de complementos
      await tx.run('DELETE FROM complementos WHERE produto_id = ?', [id]);
      for (let i = 0; i < compNomes.length; i++) {
        const compNome = (compNomes[i] || '').trim();
        const custoLote = parseFloat(compCustos[i]) || 0;
        if (compNome) {
          await tx.run(`
            INSERT INTO complementos (produto_id, nome, custo_lote)
            VALUES (?, ?, ?)
          `, [id, compNome, Math.max(0, custoLote)]);
        }
      }
    });

    res.redirect(`/produtos/${id}?salvo=1`);
  } catch (err) {
    console.error('Erro ao atualizar produto:', err);
    res.status(500).send('Erro ao atualizar produto.');
  }
});

// Excluir produto
router.post('/:id/excluir', exigirLogin, async (req, res, next) => {
  try {
    const uid = req.session.usuario.id;
    const id = parseInt(req.params.id, 10);

    await db.run('DELETE FROM produtos WHERE id = ? AND usuario_id = ?', [id, uid]);
    res.redirect('/produtos');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
