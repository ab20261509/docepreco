/**
 * services/assistente_ia.js
 * Assistente Virtual Inteligente Especializado para o Sistema DocePreço.
 * 
 * Restrito ao escopo do sistema de confeitaria e aos processos em execução do usuário.
 * Suporta Google Gemini API (gemini-1.5-flash) com fallback nativo inteligente.
 */

/**
 * Coleta em tempo real o contexto completo de tarefas e dados do usuário
 */
async function coletarContextoUsuario(db, usuarioId) {
  const agora = new Date();
  const hojeIso = agora.toISOString().split('T')[0];

  // 1. Dados do Usuário e Custos
  const usuario = await db.get('SELECT id, nome, email FROM usuarios WHERE id = ?', [usuarioId]);
  const config = await db.get('SELECT horas_mes FROM configuracoes WHERE usuario_id = ?', [usuarioId]);
  const custosFixos = await db.all('SELECT item, valor_mensal FROM custos_fixos WHERE usuario_id = ?', [usuarioId]);
  const totalCustosMensal = custosFixos.reduce((acc, c) => acc + (c.valor_mensal || 0), 0);
  const horasMes = config && config.horas_mes > 0 ? config.horas_mes : 160;
  const custoHora = totalCustosMensal / horasMes;

  // 2. Receitas / Produtos Cadastrados
  const produtos = await db.all(`
    SELECT id, nome, rendimento, unidade, tempo_horas, margem_pct
    FROM produtos
    WHERE usuario_id = ?
    ORDER BY nome ASC
  `, [usuarioId]);

  // 3. Pedidos para Hoje e Em Aberto
  const pedidosHoje = await db.all(`
    SELECT 
      p.id, p.data_entrega, p.horario_entrega, p.status, p.valor_total,
      c.nome AS cliente_nome, p.cliente_nome_avulso
    FROM pedidos p
    LEFT JOIN clientes c ON c.id = p.cliente_id
    WHERE p.usuario_id = ? AND p.data_entrega = ? AND p.status IN ('confirmado', 'producao', 'orcamento')
    ORDER BY p.horario_entrega ASC
  `, [usuarioId, hojeIso]);

  const pedidosAbertos = await db.all(`
    SELECT 
      p.id, p.data_entrega, p.status, p.valor_total,
      c.nome AS cliente_nome, p.cliente_nome_avulso
    FROM pedidos p
    LEFT JOIN clientes c ON c.id = p.cliente_id
    WHERE p.usuario_id = ? AND p.status IN ('confirmado', 'producao')
    ORDER BY p.data_entrega ASC
    LIMIT 10
  `, [usuarioId]);

  // 4. Modo Cozinha: Produções em Andamento e Recentes
  const producoesAtivas = await db.all(`
    SELECT id, nome_receita, quantidade_produzida, unidade, status, iniciado_em, tempo_estimado_min
    FROM producoes
    WHERE usuario_id = ? AND status = 'em_preparo'
    ORDER BY iniciado_em DESC
  `, [usuarioId]);

  const ultimasProducoes = await db.all(`
    SELECT id, nome_receita, quantidade_produzida, unidade, status, tempo_real_min, concluido_em
    FROM producoes
    WHERE usuario_id = ? AND status = 'concluido'
    ORDER BY concluido_em DESC
    LIMIT 3
  `, [usuarioId]);

  // 5. Insumos em Estoque Baixo
  const itensEstoqueBaixo = await db.all(`
    SELECT nome, estoque_atual, estoque_minimo, unidade
    FROM ingredientes_catalogo
    WHERE usuario_id = ? AND estoque_atual <= estoque_minimo
    ORDER BY estoque_atual ASC
  `, [usuarioId]);

  // 6. Lotes a Vencer ou Vencidos
  let lotesRisco = [];
  try {
    const dataLimite = new Date(agora.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    lotesRisco = await db.all(`
      SELECT ic.nome, l.lote_codigo, l.quantidade_atual, ic.unidade, l.data_validade
      FROM compras_lotes l
      JOIN ingredientes_catalogo ic ON ic.id = l.ingrediente_id
      WHERE ic.usuario_id = ? AND l.quantidade_atual > 0 AND l.data_validade <= ?
      ORDER BY l.data_validade ASC
    `, [usuarioId, dataLimite]);
  } catch (_) {}

  return {
    usuarioNome: usuario ? usuario.nome : 'Confeiteira',
    dataHoje: hojeIso,
    custos: {
      totalMensal: totalCustosMensal,
      horasMes,
      custoHora: Number(custoHora.toFixed(2)),
      itensCount: custosFixos.length
    },
    produtos: produtos.map(p => ({
      nome: p.nome,
      rendimento: `${p.rendimento} ${p.unidade || 'un'}`,
      tempoHoras: p.tempo_horas,
      margemPct: p.margem_pct
    })),
    pedidosHoje: pedidosHoje.map(p => ({
      id: p.id,
      cliente: p.cliente_nome || p.cliente_nome_avulso || 'Cliente',
      horario: p.horario_entrega || 'Sem horário',
      status: p.status,
      valor: p.valor_total
    })),
    pedidosAbertosCount: pedidosAbertos.length,
    producoesAtivas: producoesAtivas.map(pa => ({
      id: pa.id,
      receita: pa.nome_receita,
      lote: `${pa.quantidade_produzida} ${pa.unidade}`,
      iniciadoEm: pa.iniciado_em,
      tempoEstimadoMin: pa.tempo_estimado_min
    })),
    ultimasProducoes: ultimasProducoes.map(up => ({
      receita: up.nome_receita,
      lote: `${up.quantidade_produzida} ${up.unidade}`,
      tempoGastoMin: up.tempo_real_min,
      concluidoEm: up.concluido_em
    })),
    estoqueBaixo: itensEstoqueBaixo.map(eb => ({
      nome: eb.nome,
      atual: `${eb.estoque_atual} ${eb.unidade}`,
      minimo: `${eb.estoque_minimo} ${eb.unidade}`
    })),
    lotesRisco: lotesRisco.map(lr => ({
      nome: lr.nome,
      qtd: `${lr.quantidade_atual} ${lr.unidade}`,
      validade: lr.data_validade
    }))
  };
}

/**
 * Resposta Nativa Estruturada (Fallback quando não há API Key ou em caso de falha de conexão)
 */
function gerarRespostaNativa(mensagem, contexto) {
  const msgLower = (mensagem || '').toLowerCase().trim();

  // Testar Guardrail para assuntos fora do contexto
  const assuntosProibidos = ['política', 'politica', 'futebol', 'jogo', 'time', 'presidente', 'deputado', 'filme', 'série', 'novela', 'fofoca', 'código python', 'código c++', 'astronomia', 'copa', 'musica', 'música', 'cantor', 'ator', 'eleição', 'eleicao', 'bitcoin', 'dólar'];
  if (assuntosProibidos.some(termo => msgLower.includes(termo))) {
    return 'Sou o assistente especializado do **DocePreço** para confeitaria e gestão da sua fábrica. Posso te ajudar exclusivamente com dúvidas sobre o sistema, suas receitas, encomendas, estoque e processos de produção da sua confeitaria. 🧁 Como posso ajudar na sua bancada hoje?';
  }

  // 1. Pedidos do Dia / Encomendas
  if (msgLower.includes('pedido') || msgLower.includes('encomenda') || msgLower.includes('hoje') || msgLower.includes('entrega')) {
    if (contexto.pedidosHoje.length === 0) {
      return `📅 **Hoje (${contexto.dataHoje}):** Você não possui encomendas agendadas para entrega hoje. Há um total de **${contexto.pedidosAbertosCount} pedidos** em andamento para os próximos dias na sua [Agenda](/agenda).`;
    }
    const lista = contexto.pedidosHoje.map(p => `• **Pedido #${p.id}** (${p.cliente}) às ${p.horario} - Status: *${p.status}* - R$ ${p.valor.toFixed(2)}`).join('\n');
    return `📅 **Encomendas para Hoje (${contexto.dataHoje}):**\nVocê tem **${contexto.pedidosHoje.length} pedido(s)** para entrega hoje:\n\n${lista}\n\nVocê pode acompanhar os horários na tela de [Agenda de Entregas](/agenda).`;
  }

  // 2. Produção & Modo Cozinha
  if (msgLower.includes('cozinha') || msgLower.includes('produção') || msgLower.includes('producao') || msgLower.includes('preparo') || msgLower.includes('forno') || msgLower.includes('timer')) {
    if (contexto.producoesAtivas.length === 0) {
      let txt = `🍳 **Modo Cozinha:** Nenhuma receita está sendo preparada no momento.\n\nPara iniciar uma fornada com pesagem na balança, timers integrados e sequência inteligente de misturas, acesse o [Modo Cozinha & Produção](/producao).`;
      if (contexto.ultimasProducoes.length > 0) {
        const ult = contexto.ultimasProducoes[0];
        txt += `\n\n*Última produção concluída:* **${ult.receita}** (${ult.lote}) em ${ult.tempoGastoMin || 0} min.`;
      }
      return txt;
    }
    const ativas = contexto.producoesAtivas.map(pa => `• **${pa.receita}** - Lote: ${pa.lote} (Iniciado em: ${pa.iniciadoEm})`).join('\n');
    return `🍳 **Lotes em Preparo na Cozinha Agora:**\n${ativas}\n\nAcesse o [Modo Cozinha](/producao) para acompanhar os timers e a pesagem da bancada!`;
  }

  // 3. Estoque Baixo / Insumos em Falta
  if (msgLower.includes('estoque') || msgLower.includes('falta') || msgLower.includes('comprar') || msgLower.includes('insumo') || msgLower.includes('ingrediente')) {
    if (contexto.estoqueBaixo.length === 0) {
      return `✓ **Estoque em Dia:** Nenhum ingrediente está abaixo do estoque mínimo no momento! Todos os seus insumos cadastrados possuem saldo seguro. Você pode conferir tudo em [Insumos & Estoque](/ingredientes).`;
    }
    const lista = contexto.estoqueBaixo.map(i => `• **${i.nome}**: saldo atual ${i.atual} (mínimo desejado: ${i.minimo})`).join('\n');
    return `⚠️ **Atenção ao Estoque Baixo (${contexto.estoqueBaixo.length} itens):**\n\n${lista}\n\nRecomendamos gerar a [Lista de Compras Inteligente](/compras) para repor esses itens antes das próximas encomendas!`;
  }

  // 4. Validade e Lotes a Vencer
  if (msgLower.includes('validade') || msgLower.includes('vencer') || msgLower.includes('vencido') || msgLower.includes('lote')) {
    if (contexto.lotesRisco.length === 0) {
      return `✓ **Validades Seguras:** Não há nenhum lote com prazo de validade vencido ou vencendo nos próximos 7 dias.`;
    }
    const lista = contexto.lotesRisco.map(l => `• **${l.nome}** (Qtd: ${l.qtd}) - Vence em: ${l.validade}`).join('\n');
    return `⏰ **Lotes com Validade Próxima ou Vencida (${contexto.lotesRisco.length}):**\n\n${lista}\n\nPriorize o uso desses insumos nos preparos de hoje para evitar desperdício! Veja em [Insumos](/ingredientes).`;
  }

  // 5. Custos Fixos & Custo por Hora
  if (msgLower.includes('custo') || msgLower.includes('hora') || msgLower.includes('fixo') || msgLower.includes('salário') || msgLower.includes('pro-labore')) {
    return `🏢 **Seus Custos Fixos Mensais:**\n• Total mensal: **R$ ${contexto.custos.totalMensal.toFixed(2)}** (${contexto.custos.itensCount} despesas cadastradas)\n• Carga horária: **${contexto.custos.horasMes} horas/mês**\n• Custo operacional por hora: **R$ ${contexto.custos.custoHora.toFixed(2)}/h**\n\nEsse valor é somado automaticamente no cálculo do preço das suas receitas com base no tempo de preparo. Você pode ajustar em [Custos Fixos](/custos).`;
  }

  // 6. Receitas & Precificação
  if (msgLower.includes('receita') || msgLower.includes('produto') || msgLower.includes('preço') || msgLower.includes('preco') || msgLower.includes('margem')) {
    return `🧁 **Suas Receitas Cadastradas (${contexto.produtos.length}):**\nVocê possui **${contexto.produtos.length} produtos** cadastrados no sistema. Cada produto combina o custo dos ingredientes pesados, embalagens, custo/hora proporcional e margem de lucro para formar o preço sugerido ideal.\n\nConsulte suas receitas em [Produtos & Precificação](/produtos).`;
  }

  // Resposta Padrão / Ajuda Geral
  return `Olá, **${contexto.usuarioNome}**! 👋 Sou seu Assistente Virtual no **DocePreço**.\n\nPosso te ajudar com dúvidas sobre o sistema e com informações em tempo real da sua confeitaria:\n\n• 📅 **"Quais pedidos temos para hoje?"**\n• 🍳 **"O que está em preparo na cozinha agora?"**\n• ⚠️ **"Quais ingredientes estão com estoque baixo?"**\n• ⏰ **"Temos lotes próximos da validade?"**\n• 🏢 **"Como está meu custo por hora e custos fixos?"**\n• 🧁 **"Como o sistema calcula o preço sugerido das receitas?"**\n\nO que você gostaria de consultar ou conferir agora?`;
}

/**
 * Responde dúvidas utilizando a Google Gemini API (quando GEMINI_API_KEY estiver configurada)
 */
async function responderDuvidaSistema(mensagem, historicoRecente, contexto, apiKey) {
  // Se não houver chave, responde imediatamente pelo motor nativo
  if (!apiKey) {
    return gerarRespostaNativa(mensagem, contexto);
  }

  // Formatar resumo compacto dos dados do usuário para o prompt
  const dadosContextoPrompt = `
DADOS ATUAIS DA CONFEITARIA DO USUÁRIO (${contexto.usuarioNome}):
- Data de Hoje: ${contexto.dataHoje}
- Encomendas para Hoje: ${contexto.pedidosHoje.length > 0 ? JSON.stringify(contexto.pedidosHoje) : 'Nenhuma encomenda para hoje'}
- Total de Pedidos em Andamento nos próximos dias: ${contexto.pedidosAbertosCount}
- Produções Ativas na Cozinha (status 'em_preparo'): ${contexto.producoesAtivas.length > 0 ? JSON.stringify(contexto.producoesAtivas) : 'Nenhuma produção ativa no momento'}
- Últimas Produções Concluídas: ${JSON.stringify(contexto.ultimasProducoes)}
- Insumos em Estoque Baixo (abaixo do mínimo): ${contexto.estoqueBaixo.length > 0 ? JSON.stringify(contexto.estoqueBaixo) : 'Nenhum, estoque em dia'}
- Lotes com Validade em Risco (vencendo em até 7 dias): ${contexto.lotesRisco.length > 0 ? JSON.stringify(contexto.lotesRisco) : 'Nenhum lote em risco'}
- Custos Fixos Mensais: Total R$ ${contexto.custos.totalMensal.toFixed(2)}, ${contexto.custos.horasMes} horas/mês, Custo/Hora: R$ ${contexto.custos.custoHora.toFixed(2)}/h
- Receitas Cadastradas (${contexto.produtos.length}): ${contexto.produtos.map(p => `${p.nome} (${p.rendimento})`).slice(0, 10).join(', ')}
`;

  const systemInstruction = `Você é a DoceIA, a assistente virtual especializada e amigável do sistema "DocePreço" (Software de Gestão, Precificação e Produção para Confeitarias e Panificações artesanais).

OBJETIVO PRINCIPAL:
Ajudar o confeiteiro(a) com dúvidas práticas sobre como usar as ferramentas do sistema DocePreço e consultar os processos e tarefas em execução na sua confeitaria.

MAPA DE ROTAS E RECURSOS DO SISTEMA:
1. / (Início): Painel rápido com alertas de pedidos de hoje, estoque baixo e acesso a todos os módulos.
2. /producao (Modo Cozinha & Produção): Preparo de receitas com pesagem guiada na balança, timers para forno e eletrodomésticos, alarme sonoro e histórico de fornadas com tempo real.
3. /produtos (Produtos & Precificação): Fichas técnicas, cálculo automático de custo de ingredientes, custo da hora de trabalho, margem de lucro (%) e taxas de cartão para gerar o Preço Sugerido de Venda.
4. /ingredientes (Insumos & Estoque): Cadastro de ingredientes, saldo atual, estoque mínimo, histórico de compras e controle de validade de lotes.
5. /custos (Custos Fixos): Cadastro de despesas mensais (aluguel, energia, gás, pró-labore) e horas trabalhadas para apurar o Custo Operacional por Hora.
6. /pedidos (Pedidos & Orçamentos): Controle de orçamentos, sinal de 50%, avanço de status (Orçamento -> Confirmado -> Produção -> Entregue) e mensagem para WhatsApp.
7. /agenda (Agenda de Entregas): Calendário de encomendas do dia e visão semanal/mensal de entregas.
8. /compras (Planejamento de Compras): Lista inteligente de mercado gerada por encomendas pendentes ou estoque mínimo com exportação para WhatsApp.
9. /clientes: Cadastro de clientes com histórico de compras e WhatsApp rápido.

GUARDRAILS E LIMITES ESTRITOS (REGRA INEGOCIÁVEL):
1. Você responde EXCLUSIVAMENTE sobre o sistema DocePreço, a gestão da confeitaria e os dados do usuário.
2. Se o usuário perguntar sobre assuntos fora deste escopo (como política, esportes/futebol, celebridades, códigos de programação genéricos, receitas que não estejam no sistema, redações escolares ou curiosidades aleatórias), RECUSE EDUCADAMENTE:
   "Sou a assistente virtual especializada do DocePreço. Meu foco é exclusivamente te ajudar com dúvidas sobre o sistema, suas receitas, estoque, pedidos e tarefas da sua confeitaria. 🧁 Como posso te ajudar na sua produção hoje?"
3. NUNCA invente dados fictícios de pedidos ou estoque. Use estritamente as informações reais injetadas no contexto do usuário.
4. Mantenha um tom acolhedor, profissional, encorajador e direto ao ponto. Use formatação markdown limpa (tópicos, negrito).

${dadosContextoPrompt}`;

  // Montar histórico no padrão do Gemini
  const contents = [];

  if (Array.isArray(historicoRecente) && historicoRecente.length > 0) {
    for (const h of historicoRecente.slice(-6)) {
      contents.push({
        role: h.papel === 'usuario' ? 'user' : 'model',
        parts: [{ text: h.conteudo }]
      });
    }
  }

  contents.push({
    role: 'user',
    parts: [{ text: mensagem }]
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }]
        },
        contents,
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1024
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Gemini API HTTP ${response.status}`);
    }

    const data = await response.json();
    const texto = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!texto) {
      throw new Error('Nenhum texto retornado pelo Gemini');
    }

    return texto.trim();
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn(`[Assistente IA] Falha na chamada da Gemini API (${err.message}). Utilizando fallback nativo.`);
    return gerarRespostaNativa(mensagem, contexto);
  }
}

module.exports = {
  coletarContextoUsuario,
  gerarRespostaNativa,
  responderDuvidaSistema
};
