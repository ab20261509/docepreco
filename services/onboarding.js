const MODULOS_ONBOARDING = [
  {
    id: 'geral',
    icone: '🧁',
    titulo: 'Primeiros Passos & Boas-Vindas',
    rota: '/',
    descricao: 'Apresentação geral da plataforma e checklist interativo na Página Inicial.'
  },
  {
    id: 'custos',
    icone: '🏢',
    titulo: 'Custos Fixos & Mão de Obra',
    rota: '/custos',
    descricao: 'Configuração das despesas da cozinha e cálculo automático do custo por hora.'
  },
  {
    id: 'ingredientes',
    icone: '🥣',
    titulo: 'Insumos, Embalagens & Estoque',
    rota: '/ingredientes',
    descricao: 'Cadastro de matéria-prima, saldos de estoque e importação via planilha Excel.'
  },
  {
    id: 'produtos',
    icone: '🎂',
    titulo: 'Fichas Técnicas & Precificação',
    rota: '/produtos/novo',
    descricao: 'Criação de receitas completas com margem de lucro e preço sugerido ideal.'
  },
  {
    id: 'pedidos',
    icone: '🛍️',
    titulo: 'Comercial, Pedidos & WhatsApp',
    rota: '/pedidos/novo',
    descricao: 'Gestão de clientes, orçamentos e mensagens automáticas para WhatsApp.'
  }
];

/**
 * Apura o progresso real dos cadastros do usuário no banco de dados
 */
async function obterProgressoReal(dbInstance, usuarioId) {
  const [custosRow, ingredientesRow, produtosRow, comercialRow] = await Promise.all([
    dbInstance.get('SELECT COALESCE(SUM(valor_mensal), 0) AS t FROM custos_fixos WHERE usuario_id = ?', [usuarioId]),
    dbInstance.get('SELECT COUNT(*) AS t FROM ingredientes_catalogo WHERE usuario_id = ?', [usuarioId]),
    dbInstance.get('SELECT COUNT(*) AS t FROM produtos WHERE usuario_id = ?', [usuarioId]),
    dbInstance.get(`
      SELECT 
        (SELECT COUNT(*) FROM pedidos WHERE usuario_id = ?) +
        (SELECT COUNT(*) FROM clientes WHERE usuario_id = ?) AS t
    `, [usuarioId, usuarioId])
  ]);

  const passo1_custos = Boolean(custosRow && custosRow.t > 0);
  const passo2_ingredientes = Boolean(ingredientesRow && ingredientesRow.t > 0);
  const passo3_produtos = Boolean(produtosRow && produtosRow.t > 0);
  const passo4_vendas = Boolean(comercialRow && comercialRow.t > 0);

  let concluidos = 0;
  if (passo1_custos) concluidos++;
  if (passo2_ingredientes) concluidos++;
  if (passo3_produtos) concluidos++;
  if (passo4_vendas) concluidos++;

  const percentual = Math.round((concluidos / 4) * 100);

  let proximoPasso = null;
  if (!passo1_custos) {
    proximoPasso = { numero: 1, id: 'custos', nome: 'Custos Fixos', rota: '/custos' };
  } else if (!passo2_ingredientes) {
    proximoPasso = { numero: 2, id: 'ingredientes', nome: 'Insumos & Ingredientes', rota: '/ingredientes' };
  } else if (!passo3_produtos) {
    proximoPasso = { numero: 3, id: 'produtos', nome: 'Primeira Receita', rota: '/produtos/novo' };
  } else if (!passo4_vendas) {
    proximoPasso = { numero: 4, id: 'pedidos', nome: 'Primeiro Pedido ou Cliente', rota: '/pedidos/novo' };
  }

  return {
    passos: {
      passo1_custos,
      passo2_ingredientes,
      passo3_produtos,
      passo4_vendas
    },
    totalConcluidos: concluidos,
    percentual,
    estaCompleto: concluidos === 4,
    proximoPasso
  };
}

/**
 * Consulta o status de cada guia/onboarding na tabela usuario_onboardings
 */
async function obterStatusGuias(dbInstance, usuarioId) {
  const rows = await dbInstance.all(`
    SELECT modulo, status, atualizado_em
    FROM usuario_onboardings
    WHERE usuario_id = ?
  `, [usuarioId]);

  const mapa = {};
  MODULOS_ONBOARDING.forEach(m => {
    mapa[m.id] = 'pendente'; // padrão para novos módulos
  });

  rows.forEach(r => {
    mapa[r.modulo] = r.status;
  });

  return mapa;
}

/**
 * Atualiza o status de um guia (pendente, concluido, dispensado)
 */
async function atualizarStatusGuia(dbInstance, usuarioId, modulo, novoStatus) {
  const statusPermitidos = ['pendente', 'concluido', 'dispensado'];
  if (!statusPermitidos.includes(novoStatus)) {
    throw new Error(`Status de onboarding inválido: ${novoStatus}`);
  }

  // SQLite / LibSQL UPSERT
  await dbInstance.run(`
    INSERT INTO usuario_onboardings (usuario_id, modulo, status, atualizado_em)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(usuario_id, modulo) DO UPDATE SET
      status = excluded.status,
      atualizado_em = datetime('now')
  `, [usuarioId, modulo, novoStatus]);

  return { sucesso: true, usuarioId, modulo, status: novoStatus };
}

/**
 * Reativa um guia específico para o usuário (define como 'pendente')
 */
async function reativarGuia(dbInstance, usuarioId, modulo) {
  return atualizarStatusGuia(dbInstance, usuarioId, modulo, 'pendente');
}

/**
 * Reinicia todos os guias de onboarding para o usuário
 */
async function reiniciarTodosGuias(dbInstance, usuarioId) {
  for (const m of MODULOS_ONBOARDING) {
    await reativarGuia(dbInstance, usuarioId, m.id);
  }
  return { sucesso: true, usuarioId, total: MODULOS_ONBOARDING.length };
}

module.exports = {
  MODULOS_ONBOARDING,
  obterProgressoReal,
  obterStatusGuias,
  atualizarStatusGuia,
  reativarGuia,
  reiniciarTodosGuias
};
