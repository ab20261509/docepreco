/**
 * services/assistente_ia.js
 * Assistente Virtual Inteligente Especializado para o Sistema DocePreço.
 * 
 * - Restrito ao escopo do sistema de confeitaria e aos processos em execução do usuário.
 * - Possui visão integral do banco de dados da loja/usuário (estoque completo, fichas técnicas, produções e pedidos).
 * - Carrega e consulta o Manual Oficial do Sistema (docs/MANUAL_DO_SISTEMA.md).
 * - Suporta sessões de atendimento com documentação de aprendizado contínuo e feedback (👍 / 👎).
 * - Suporta Google Gemini API (gemini-1.5-flash) com auditoria de estoque e fallback nativo.
 */

const fs = require('fs');
const path = require('path');

// Carregar Manual Oficial do Sistema em cache
let manualSistemaCache = '';
try {
  const caminhoManual = path.join(__dirname, '../docs/MANUAL_DO_SISTEMA.md');
  if (fs.existsSync(caminhoManual)) {
    manualSistemaCache = fs.readFileSync(caminhoManual, 'utf8');
  }
} catch (err) {
  console.warn('[Assistente IA] Não foi possível ler docs/MANUAL_DO_SISTEMA.md:', err.message);
}

function calcularFatorEscala(qtdPedida, unPedida, rendimentoBase, unBase) {
  const qPed = Math.max(0.001, parseFloat(qtdPedida) || 1);
  const rBase = Math.max(0.001, parseFloat(rendimentoBase) || 1);
  const uPed = (unPedida || 'un').toLowerCase();
  const uBase = (unBase || 'un').toLowerCase();

  let pesoPedGramas = null;
  let pesoBaseGramas = null;

  if (uPed === 'kg') pesoPedGramas = qPed * 1000;
  else if (uPed === 'g' || uPed === 'gramas' || uPed === 'gr') pesoPedGramas = qPed;

  if (uBase === 'kg') pesoBaseGramas = rBase * 1000;
  else if (uBase === 'g' || uBase === 'gramas' || uBase === 'gr') pesoBaseGramas = rBase;

  if (pesoPedGramas !== null && pesoBaseGramas !== null) {
    return pesoPedGramas / pesoBaseGramas;
  }
  return qPed / rBase;
}

/**
 * Coleta em tempo real a visão integral do banco de dados da loja do usuário autenticado
 */
async function coletarContextoUsuario(db, usuarioId) {
  const agora = new Date();
  const hojeIso = agora.toISOString().split('T')[0];

  // 1. Dados do Usuário e Custos Operacionais
  const usuario = await db.get('SELECT id, nome, email FROM usuarios WHERE id = ?', [usuarioId]);
  const config = await db.get('SELECT horas_mes FROM configuracoes WHERE usuario_id = ?', [usuarioId]);
  const custosFixos = await db.all('SELECT item, valor_mensal FROM custos_fixos WHERE usuario_id = ?', [usuarioId]);
  const totalCustosMensal = custosFixos.reduce((acc, c) => acc + (c.valor_mensal || 0), 0);
  const horasMes = config && config.horas_mes > 0 ? config.horas_mes : 160;
  const custoHora = totalCustosMensal / horasMes;

  // 2. Estoque Completo da Loja (Todos os ingredientes cadastrados)
  const catalogoCompleto = await db.all(`
    SELECT id, nome, estoque_atual, unidade, estoque_minimo, preco_atual
    FROM ingredientes_catalogo
    WHERE usuario_id = ?
    ORDER BY nome ASC
  `, [usuarioId]);

  const mapaEstoque = {};
  catalogoCompleto.forEach(item => {
    mapaEstoque[item.nome.trim().toLowerCase()] = item;
  });

  // 3. Receitas / Produtos com Ficha Técnica Completa (Ingredientes)
  const produtosRaw = await db.all(`
    SELECT p.id, p.nome, p.rendimento, p.unidade, p.tempo_horas, p.margem_pct
    FROM produtos p
    WHERE p.usuario_id = ?
    ORDER BY p.nome ASC
  `, [usuarioId]);

  const produtosCompletos = [];
  for (const prod of produtosRaw) {
    const ingredientes = await db.all(`
      SELECT id, nome, qtd_usada, preco_pacote, qtd_pacote
      FROM ingredientes
      WHERE produto_id = ?
      ORDER BY id ASC
    `, [prod.id]);

    produtosCompletos.push({
      id: prod.id,
      nome: prod.nome,
      rendimento: `${prod.rendimento} ${prod.unidade || 'un'}`,
      rendimentoNum: prod.rendimento,
      unidade: prod.unidade || 'un',
      tempoHoras: prod.tempo_horas,
      margemPct: prod.margem_pct,
      ingredientes: ingredientes.map(i => ({
        nome: i.nome,
        qtdUsada: i.qtd_usada
      }))
    });
  }

  // 4. Pedidos para Hoje e Em Aberto
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

  // 5. Modo Cozinha: Produções Ativas com Auditoria Detalhada de Estoque
  const producoesAtivasRaw = await db.all(`
    SELECT id, produto_id, nome_receita, quantidade_produzida, unidade, status, iniciado_em, tempo_estimado_min
    FROM producoes
    WHERE usuario_id = ? AND status = 'em_preparo'
    ORDER BY iniciado_em DESC
  `, [usuarioId]);

  const producoesAtivasAuditadas = [];
  for (const pa of producoesAtivasRaw) {
    const prodRelacionado = produtosCompletos.find(p => p.id === pa.produto_id) || null;
    const auditoria = {
      id: pa.id,
      receita: pa.nome_receita,
      lote: `${pa.quantidade_produzida} ${pa.unidade}`,
      iniciadoEm: pa.iniciado_em,
      tempoEstimadoMin: pa.tempo_estimado_min,
      temEstoqueSuficiente: true,
      insumosFaltantes: [],
      insumosSuficientes: []
    };

    if (prodRelacionado && prodRelacionado.ingredientes.length > 0) {
      const fator = calcularFatorEscala(pa.quantidade_produzida, pa.unidade, prodRelacionado.rendimentoNum, prodRelacionado.unidade);
      
      for (const ing of prodRelacionado.ingredientes) {
        const qtdNecessaria = Number((ing.qtdUsada * fator).toFixed(2));
        const itemEstoque = mapaEstoque[ing.nome.trim().toLowerCase()] || null;
        const saldoAtual = itemEstoque ? itemEstoque.estoque_atual : 0;
        const unidade = itemEstoque ? itemEstoque.unidade : 'g/ml';

        if (saldoAtual >= qtdNecessaria) {
          auditoria.insumosSuficientes.push({
            nome: ing.nome,
            necessario: qtdNecessaria,
            disponivel: saldoAtual,
            unidade
          });
        } else {
          auditoria.temEstoqueSuficiente = false;
          auditoria.insumosFaltantes.push({
            nome: ing.nome,
            necessario: qtdNecessaria,
            disponivel: saldoAtual,
            falta: Number((qtdNecessaria - saldoAtual).toFixed(2)),
            unidade
          });
        }
      }
    }

    producoesAtivasAuditadas.push(auditoria);
  }

  // 6. Últimas Produções Concluídas
  const ultimasProducoes = await db.all(`
    SELECT id, nome_receita, quantidade_produzida, unidade, status, tempo_real_min, concluido_em
    FROM producoes
    WHERE usuario_id = ? AND status = 'concluido'
    ORDER BY concluido_em DESC
    LIMIT 3
  `, [usuarioId]);

  // 7. Insumos em Estoque Baixo (abaixo do mínimo)
  const itensEstoqueBaixo = catalogoCompleto.filter(c => c.estoque_atual <= c.estoque_minimo);

  // 8. Lotes a Vencer ou Vencidos
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

  // 9. Histórico de Aprendizados de Sessões Anteriores Encerradas (Memória Contínua)
  let aprendizadosPassados = [];
  try {
    aprendizadosPassados = await db.all(`
      SELECT id, titulo, aprendizado_resumo, encerrada_em
      FROM chat_sessoes
      WHERE usuario_id = ? AND status = 'encerrada' AND aprendizado_resumo IS NOT NULL
      ORDER BY encerrada_em DESC
      LIMIT 5
    `, [usuarioId]);
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
    catalogoCompleto: catalogoCompleto.map(c => ({
      nome: c.nome,
      estoqueAtual: c.estoque_atual,
      unidade: c.unidade,
      estoqueMinimo: c.estoque_minimo,
      preco: c.preco_atual
    })),
    produtos: produtosCompletos,
    pedidosHoje: pedidosHoje.map(p => ({
      id: p.id,
      cliente: p.cliente_nome || p.cliente_nome_avulso || 'Cliente',
      horario: p.horario_entrega || 'Sem horário',
      status: p.status,
      valor: p.valor_total
    })),
    pedidosAbertosCount: pedidosAbertos.length,
    producoesAtivas: producoesAtivasAuditadas,
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
    })),
    aprendizadosPassados: aprendizadosPassados.map(ap => ({
      sessaoId: ap.id,
      titulo: ap.titulo || 'Atendimento Concluído',
      resumo: ap.aprendizado_resumo,
      data: ap.encerrada_em
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
    return 'Sou o assistente especializado do **DocePreço** para confeitaria e gestão da sua fábrica. Posso te ajudar exclusivamente com dúvidas sobre o uso do sistema, suas receitas, encomendas, estoque e processos de produção da sua confeitaria. 🧁 Como posso ajudar na sua bancada hoje?';
  }

  // 1. Dúvidas sobre o Manual do Sistema e Como Usar as Telas
  // 1.1 Precificação e Cálculo de Preço de Venda
  if (
    (msgLower.includes('como') || msgLower.includes('funciona') || msgLower.includes('calcula') || msgLower.includes('calcular')) &&
    (msgLower.includes('preço') || msgLower.includes('preco') || msgLower.includes('precificar') || msgLower.includes('margem') || msgLower.includes('venda'))
  ) {
    return `🧁 **Como o DocePreço calcula o Preço de Venda Sugerido:**\n\n` +
      `De acordo com a metodologia oficial do sistema, o preço final de cada produto é a soma de quatro pilares:\n\n` +
      `1. **Custo de Insumos:** Soma proporcional do peso/quantidade de cada ingrediente usado na receita.\n` +
      `2. **Embalagens & Extras:** Custos diretos de caixas, laços, pratos e descartáveis.\n` +
      `3. **Mão de Obra Operacional:** \`(Tempo de Preparo em Horas) × (Custo da sua Hora Operacional)\`. Esse custo da hora é obtido na tela de [Custos Fixos](/custos).\n` +
      `4. **Margem de Lucro (%):** Aplicada sobre o custo total de produção:\n` +
      `   *Fórmula:* \`Preço Sugerido = Custo Total × (1 + Margem / 100)\`\n\n` +
      `Você pode cadastrar e recalcular suas fichas técnicas na tela de [Produtos & Precificação](/produtos).`;
  }

  // 1.2 Modo Cozinha & Tela Dividida & Sequência Inteligente
  if (
    msgLower.includes('tela dividida') || msgLower.includes('modo cozinha') || 
    (msgLower.includes('como') && (msgLower.includes('cozinha') || msgLower.includes('preparo') || msgLower.includes('sequência') || msgLower.includes('sequencia') || msgLower.includes('mistura')))
  ) {
    return `🍳 **Como funciona o Modo Cozinha (Motor de Preparo com Tela Dividida):**\n\n` +
      `O Modo Cozinha foi desenhado para uso prático direto na bancada da confeitaria (celular, tablet ou computador):\n\n` +
      `• **Layout em Tela Dividida:** No lado esquerdo, você acompanha o passo a passo da receita, com a **Sequência Inteligente de Misturas** (etapas de bater secos, líquidos, descansar ou assar). No lado direito, você tem a pesagem na balança digital e os cronômetros múltiplos de forno/batedeira.\n` +
      `• **Preparo de Ingredientes:** Cada etapa indica exatamente os ingredientes pesados e os equipamentos necessários para evitar esquecimentos.\n` +
      `• **Baixa Automática:** Ao finalizar o lote, o sistema calcula o consumo real e baixa o estoque dos insumos proporcionalmente ao rendimento produzido.\n\n` +
      `Para testar na prática, acesse o [Modo Cozinha & Produção](/producao).`;
  }

  // 1.3 Custo por Hora e Custos Fixos
  if (
    (msgLower.includes('como') || msgLower.includes('o que') || msgLower.includes('onde')) &&
    (msgLower.includes('custo fixo') || msgLower.includes('custo por hora') || msgLower.includes('pro-labore') || msgLower.includes('hora'))
  ) {
    return `🏢 **Como configurar Custos Fixos e Custo por Hora:**\n\n` +
      `No DocePreço, a mão de obra da confeiteira é valorizada de forma justa:\n\n` +
      `1. Acesse o menu [Custos Fixos](/custos).\n` +
      `2. Cadastre todas as despesas mensais da fábrica (energia, aluguel, gás, água, internet e o seu salário/pró-labore desejado).\n` +
      `3. Defina as **Horas Trabalhadas no Mês** (padrão de 160h para 40h semanais).\n` +
      `4. O sistema calcula automaticamente: \`Custo/Hora = Total de Despesas Mensais ÷ Horas Mensais\`.\n\n` +
      `*Seus dados atuais:* Total mensal de **R$ ${contexto.custos.totalMensal.toFixed(2)}** com **${contexto.custos.horasMes}h/mês**, resultando em **R$ ${contexto.custos.custoHora.toFixed(2)}/h**.`;
  }

  // 1.4 Planejamento de Compras
  if (
    (msgLower.includes('como') || msgLower.includes('o que')) &&
    (msgLower.includes('compras') || msgLower.includes('planejamento') || msgLower.includes('repor') || msgLower.includes('lista de compras'))
  ) {
    return `🛒 **Como funciona o Planejamento de Compras:**\n\n` +
      `O DocePreço analisa automaticamente suas encomendas futuras e seu estoque atual para criar a lista de compras perfeita:\n\n` +
      `• Ele cruza as encomendas agendadas na [Agenda](/agenda) com as fichas técnicas das receitas.\n` +
      `• Calcula quanto de cada insumo será gasto nos próximos dias.\n` +
      `• Compara com o saldo em estoque e gera a **Lista de Compras Inteligente** com a quantidade exata em falta para evitar compras em excesso ou falta de insumos.\n\n` +
      `Consulte e gere sua lista na tela de [Planejamento de Compras](/compras).`;
  }

  // 1.5 Encerramento de Atendimento e Aprendizado
  if (msgLower.includes('encerrar') || msgLower.includes('atendimento') || msgLower.includes('fechar chat') || msgLower.includes('sessão') || msgLower.includes('sessao')) {
    return `🔴 **Encerramento de Atendimento e Aprendizado:**\n\n` +
      `Você pode encerrar este atendimento a qualquer momento clicando no botão **"🔴 Encerrar Atendimento"** no topo deste painel.\n\n` +
      `Ao encerrar:\n` +
      `1. Eu analiso tudo o que conversamos e os feedbacks (👍/👎) que você deu nas respostas.\n` +
      `2. Registro uma síntese de aprendizado contínuo para memorizar suas preferências e resolver dúvidas futuras com ainda mais precisão.\n` +
      `3. A sessão é arquivada e um novo atendimento zerado fica pronto para você!`;
  }

  // 2. Auditoria de Estoque para Produção / Preparo (Pergunta específica sobre disponibilidade)
  const perguntaEstoqueProducao = (
    msgLower.includes('estoque') || msgLower.includes('ingrediente') || msgLower.includes('disponível') || 
    msgLower.includes('disponivel') || msgLower.includes('falta') || msgLower.includes('suficiente')
  ) && (
    msgLower.includes('produção') || msgLower.includes('producao') || msgLower.includes('preparo') || 
    msgLower.includes('preparar') || msgLower.includes('fazer') || msgLower.includes('produzir')
  );

  if (perguntaEstoqueProducao) {
    if (contexto.producoesAtivas.length === 0) {
      const prodCitado = contexto.produtos.find(p => msgLower.includes(p.nome.toLowerCase()));
      if (prodCitado) {
        const faltantes = [];
        const suficientes = [];
        for (const ing of prodCitado.ingredientes) {
          const itemEstoque = contexto.catalogoCompleto.find(c => c.nome.toLowerCase() === ing.nome.toLowerCase());
          const saldo = itemEstoque ? itemEstoque.estoqueAtual : 0;
          const un = itemEstoque ? itemEstoque.unidade : 'g';
          if (saldo >= ing.qtdUsada) {
            suficientes.push(`• **${ing.nome}**: precisa de ${ing.qtdUsada} ${un} (você tem ${saldo} ${un})`);
          } else {
            faltantes.push(`• **${ing.nome}**: precisa de ${ing.qtdUsada} ${un}, mas há apenas ${saldo} ${un} (faltam ${(ing.qtdUsada - saldo).toFixed(2)} ${un})`);
          }
        }

        if (faltantes.length === 0) {
          return `✓ **Sim! Você tem estoque suficiente para preparar ${prodCitado.nome} (${prodCitado.rendimento}):**\n\nTodos os ${suficientes.length} ingredientes necessários estão com saldo disponível:\n${suficientes.join('\n')}\n\nPode iniciar o preparo no [Modo Cozinha](/producao)!`;
        } else {
          return `⚠️ **Atenção: NÃO há estoque suficiente para preparar ${prodCitado.nome} (${prodCitado.rendimento})!**\n\nFaltam os seguintes ingredientes:\n${faltantes.join('\n')}\n\nIngredientes disponíveis:\n${suficientes.join('\n')}\n\nRecomendamos repor os itens faltantes pelo [Planejamento de Compras](/compras).`;
        }
      }

      return `No momento não há nenhuma produção ativa na cozinha para auditar o estoque. Para verificar se há estoque disponível, você pode citar o nome da receita (ex: *"Temos estoque para fazer o Bolo de Cenoura?"*) ou iniciar o lote no [Modo Cozinha](/producao).`;
    }

    const respostas = contexto.producoesAtivas.map(pa => {
      if (pa.temEstoqueSuficiente) {
        const itens = pa.insumosSuficientes.map(i => `  ✓ ${i.nome}: precisa de ${i.necessario} ${i.unidade} (disponível: ${i.disponivel} ${i.unidade})`).join('\n');
        return `✅ **Produção #${pa.id} (${pa.receita} - Lote: ${pa.lote}):**\n**Sim! Há estoque suficiente** para concluir este lote na cozinha. Consumo previsto:\n${itens}`;
      } else {
        const faltas = pa.insumosFaltantes.map(i => `  ❌ **${i.nome}**: precisa de ${i.necessario} ${i.unidade}, mas o saldo atual é ${i.disponivel} ${i.unidade} (**faltam ${i.falta} ${i.unidade}**)`).join('\n');
        return `⚠️ **Produção #${pa.id} (${pa.receita} - Lote: ${pa.lote}):**\n**NÃO há estoque suficiente no momento!** Faltam insumos essenciais:\n${faltas}`;
      }
    });

    return `🔍 **Auditoria de Estoque para as Produções da Cozinha:**\n\n${respostas.join('\n\n')}\n\nVocê pode gerar a reposição dos insumos faltantes no [Planejamento de Compras](/compras) ou pesar no [Modo Cozinha](/producao).`;
  }

  // 3. Pedidos do Dia / Encomendas
  if (msgLower.includes('pedido') || msgLower.includes('encomenda') || msgLower.includes('hoje') || msgLower.includes('entrega')) {
    if (contexto.pedidosHoje.length === 0) {
      return `📅 **Hoje (${contexto.dataHoje}):** Você não possui encomendas agendadas para entrega hoje. Há um total de **${contexto.pedidosAbertosCount} pedidos** em andamento para os próximos dias na sua [Agenda](/agenda).`;
    }
    const lista = contexto.pedidosHoje.map(p => `• **Pedido #${p.id}** (${p.cliente}) às ${p.horario} - Status: *${p.status}* - R$ ${p.valor.toFixed(2)}`).join('\n');
    return `📅 **Encomendas para Hoje (${contexto.dataHoje}):**\nVocê tem **${contexto.pedidosHoje.length} pedido(s)** para entrega hoje:\n\n${lista}\n\nVocê pode acompanhar os horários na tela de [Agenda de Entregas](/agenda).`;
  }

  // 4. Produção Geral & Modo Cozinha (sem pergunta de estoque)
  if (msgLower.includes('cozinha') || msgLower.includes('produção') || msgLower.includes('producao') || msgLower.includes('preparo') || msgLower.includes('forno') || msgLower.includes('timer')) {
    if (contexto.producoesAtivas.length === 0) {
      let txt = `🍳 **Modo Cozinha:** Nenhuma receita está sendo preparada no momento.\n\nPara iniciar uma fornada com pesagem na balança, timers integrados e sequência inteligente de misturas, acesse o [Modo Cozinha & Produção](/producao).`;
      if (contexto.ultimasProducoes.length > 0) {
        const ult = contexto.ultimasProducoes[0];
        txt += `\n\n*Última produção concluída:* **${ult.receita}** (${ult.lote}) em ${ult.tempoGastoMin || 0} min.`;
      }
      return txt;
    }
    const ativas = contexto.producoesAtivas.map(pa => `• **${pa.receita}** - Lote: ${pa.lote} (${pa.temEstoqueSuficiente ? '✓ Estoque OK' : '⚠️ Falta Estoque'}) - Iniciado em: ${pa.iniciadoEm}`).join('\n');
    return `🍳 **Lotes em Preparo na Cozinha Agora:**\n${ativas}\n\nAcesse o [Modo Cozinha](/producao) para acompanhar os timers e a pesagem da bancada!`;
  }

  // 5. Estoque Baixo / Insumos em Falta
  if (msgLower.includes('estoque') || msgLower.includes('falta') || msgLower.includes('comprar') || msgLower.includes('insumo') || msgLower.includes('ingrediente')) {
    if (contexto.estoqueBaixo.length === 0) {
      return `✓ **Estoque em Dia:** Nenhum ingrediente está abaixo do estoque mínimo no momento! Todos os seus ${contexto.catalogoCompleto.length} insumos cadastrados possuem saldo seguro. Você pode conferir tudo em [Insumos & Estoque](/ingredientes).`;
    }
    const lista = contexto.estoqueBaixo.map(i => `• **${i.nome}**: saldo atual ${i.atual} (mínimo desejado: ${i.minimo})`).join('\n');
    return `⚠️ **Atenção ao Estoque Baixo (${contexto.estoqueBaixo.length} itens):**\n\n${lista}\n\nRecomendamos gerar a [Lista de Compras Inteligente](/compras) para repor esses itens antes das próximas encomendas!`;
  }

  // 6. Validade e Lotes a Vencer
  if (msgLower.includes('validade') || msgLower.includes('vencer') || msgLower.includes('vencido') || msgLower.includes('lote')) {
    if (contexto.lotesRisco.length === 0) {
      return `✓ **Validades Seguras:** Não há nenhum lote com prazo de validade vencido ou vencendo nos próximos 7 dias.`;
    }
    const lista = contexto.lotesRisco.map(l => `• **${l.nome}** (Qtd: ${l.qtd}) - Vence em: ${l.validade}`).join('\n');
    return `⏰ **Lotes com Validade Próxima ou Vencida (${contexto.lotesRisco.length}):**\n\n${lista}\n\nPriorize o uso desses insumos nos preparos de hoje para evitar desperdício! Veja em [Insumos](/ingredientes).`;
  }

  // 7. Custos Fixos & Custo por Hora
  if (msgLower.includes('custo') || msgLower.includes('hora') || msgLower.includes('fixo') || msgLower.includes('salário') || msgLower.includes('pro-labore')) {
    return `🏢 **Seus Custos Fixos Mensais:**\n• Total mensal: **R$ ${contexto.custos.totalMensal.toFixed(2)}** (${contexto.custos.itensCount} despesas cadastradas)\n• Carga horária: **${contexto.custos.horasMes} horas/mês**\n• Custo operacional por hora: **R$ ${contexto.custos.custoHora.toFixed(2)}/h**\n\nEsse valor é somado automaticamente no cálculo do preço das suas receitas com base no tempo de preparo. Você pode ajustar em [Custos Fixos](/custos).`;
  }

  // 8. Receitas & Precificação
  if (msgLower.includes('receita') || msgLower.includes('produto') || msgLower.includes('preço') || msgLower.includes('preco') || msgLower.includes('margem')) {
    return `🧁 **Suas Receitas Cadastradas (${contexto.produtos.length}):**\nVocê possui **${contexto.produtos.length} produtos** cadastrados com fichas técnicas detalhadas. Cada produto combina o custo dos ingredientes pesados, embalagens, custo/hora proporcional e margem de lucro para formar o preço sugerido ideal.\n\nConsulte suas receitas em [Produtos & Precificação](/produtos).`;
  }

  // Resposta Padrão / Ajuda Geral
  return `Olá, **${contexto.usuarioNome}**! 👋 Sou a DoceIA, sua Assistente Virtual no **DocePreço**.\n\nPosso te ajudar com dúvidas sobre o uso do sistema e com consultas em tempo real da sua confeitaria:\n\n• 📖 **"Como o sistema calcula o preço de venda sugerido?"**\n• 🍳 **"Como funciona a tela dividida no Modo Cozinha?"**\n• 🔍 **"A produção em andamento possui estoque disponível?"**\n• 📅 **"Quais pedidos temos para hoje?"**\n• ⚠️ **"Quais ingredientes estão com estoque baixo?"**\n• ⏰ **"Temos lotes próximos da validade?"**\n• 🛒 **"Como funciona o Planejamento de Compras?"**\n\nVocê também pode avaliar minhas respostas com 👍 ou 👎 para me ajudar a aprender com o seu dia a dia! Como posso te ajudar agora?`;
}

/**
 * Responde dúvidas utilizando a Google Gemini API (quando GEMINI_API_KEY estiver configurada)
 */
async function responderDuvidaSistema(mensagem, historicoRecente, contexto, apiKey) {
  if (!apiKey) {
    return gerarRespostaNativa(mensagem, contexto);
  }

  const dadosContextoPrompt = `
DADOS VIVOS DO BANCO DE DADOS DA CONFEITARIA DO USUÁRIO (${contexto.usuarioNome}):
- Data de Hoje: ${contexto.dataHoje}

1. ESTOQUE ATUAL COMPLETO DA LOJA (Todos os insumos cadastrados com saldo em tempo real):
${JSON.stringify(contexto.catalogoCompleto)}

2. AUDITORIA DE DISPONIBILIDADE DE ESTOQUE PARA AS PRODUÇÕES EM ANDAMENTO:
${JSON.stringify(contexto.producoesAtivas)}

3. RECEITAS CADASTRADAS COM FICHAS TÉCNICAS E INGREDIENTES:
${JSON.stringify(contexto.produtos)}

4. ENCOMENDAS E PEDIDOS:
- Pedidos para Hoje: ${contexto.pedidosHoje.length > 0 ? JSON.stringify(contexto.pedidosHoje) : 'Nenhuma encomenda para hoje'}
- Total de Pedidos em Aberto nos próximos dias: ${contexto.pedidosAbertosCount}

5. HISTÓRICO DE PRODUÇÃO RECENTE:
${JSON.stringify(contexto.ultimasProducoes)}

6. CUSTOS FIXOS E OPERACIONAIS:
- Total Mensal: R$ ${contexto.custos.totalMensal.toFixed(2)}
- Carga Horária: ${contexto.custos.horasMes} horas/mês
- Custo Operacional por Hora: R$ ${contexto.custos.custoHora.toFixed(2)}/h

7. APRENDIZADOS E PREFERÊNCIAS DE ATENDIMENTOS PASSADOS (MEMÓRIA CONTÍNUA):
${contexto.aprendizadosPassados && contexto.aprendizadosPassados.length > 0 ? JSON.stringify(contexto.aprendizadosPassados) : 'Primeira sessão com o usuário.'}
`;

  const manualDocumentacaoPrompt = manualSistemaCache
    ? `\n\nMANUAL OFICIAL DO SISTEMA DOCEPREÇO (CONSULTE PARA EXPLICAR REGRAS, TELAS E FÓRMULAS):\n${manualSistemaCache}\n`
    : '';

  const systemInstruction = `Você é a DoceIA, a assistente virtual inteligente e especializada do sistema "DocePreço" (Software de Gestão, Precificação, Controle de Estoque e Produção para Confeitarias artesanais).

OBJETIVO PRINCIPAL:
Ajudar a confeiteira com dúvidas práticas sobre como usar as ferramentas do sistema DocePreço (com base estrita no Manual Oficial do Sistema) e consultar os processos, tarefas, receitas e estoque da sua loja em tempo real.

TREINAMENTO ESPECÍFICO DE AUDITORIA DE ESTOQUE E PRODUÇÃO:
Se o usuário perguntar se uma produção ou receita possui estoque disponível para ser preparada (ex: "a produção possui estoque disponível?", "temos estoque para fazer o bolo X?", "consigo produzir Y?"):
1. VOCÊ DEVE RESPONDER CATEGORICAMENTE se HÁ ou NÃO HÁ estoque suficiente.
2. Consulte a seção "AUDITORIA DE DISPONIBILIDADE DE ESTOQUE PARA AS PRODUÇÕES EM ANDAMENTO" ou cruze a lista de ingredientes da receita com o "ESTOQUE ATUAL COMPLETO DA LOJA".
3. Se faltar qualquer insumo:
   - Afirme claramente: "⚠️ No momento, NÃO há estoque suficiente para preparar esta produção."
   - Liste exatamente cada ingrediente faltante: quanto a receita precisa, quanto há no estoque e a quantidade exata que falta comprar.
4. Se houver estoque suficiente de todos os ingredientes:
   - Afirme claramente: "✅ Sim! Você possui estoque disponível para preparar esta produção."
   - Liste os ingredientes que serão consumidos e o saldo que restará.
5. NUNCA apenas repita os dados da produção sem responder com clareza sobre a disponibilidade de estoque!

DÚVIDAS SOBRE O USO DO SISTEMA:
Use o "MANUAL OFICIAL DO SISTEMA DOCEPREÇO" fornecido abaixo para esclarecer procedimentos:
- Como funciona a precificação e a margem de lucro.
- Como cadastrar insumos, lotes e datas de validade.
- Como operar o Modo Cozinha em tela dividida (receita, pesagem e timers).
- Como funciona o cálculo de custo por hora e custos fixos.
- Como o sistema gera a lista de compras automática.

GUARDRAILS E LIMITES ESTRITOS (REGRA INEGOCIÁVEL):
1. Você responde EXCLUSIVAMENTE sobre o sistema DocePreço, a gestão da confeitaria e os dados da loja do usuário.
2. Se o usuário perguntar sobre assuntos fora deste escopo (como política, futebol, celebridades, códigos de programação genéricos, receitas que não estejam no sistema, redações escolares ou curiosidades aleatórias), RECUSE EDUCADAMENTE:
   "Sou a assistente virtual especializada do DocePreço. Meu foco é exclusivamente te ajudar com dúvidas sobre o sistema, suas receitas, estoque, pedidos e tarefas da sua confeitaria. 🧁 Como posso te ajudar na sua produção hoje?"
3. NUNCA invente dados fictícios de pedidos ou estoque. Use estritamente as informações reais do banco de dados da loja injetadas no contexto.
4. Mantenha um tom acolhedor, profissional, ágil e encorajador. Use formatação markdown limpa (negrito, tópicos).

${manualDocumentacaoPrompt}
${dadosContextoPrompt}`;

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
          temperature: 0.2,
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

/**
 * Sintetiza o atendimento ao encerrar a sessão:
 * Analisa as dúvidas do usuário, as respostas dadas e os feedbacks (👍/👎),
 * gerando um título e um aprendizado documentado para o agente reter em atendimentos futuros.
 */
async function sintetizarAprendizadoSessao(mensagens, feedbacksStats, apiKey) {
  // Caso de fallback rápido quando não há mensagens suficientes
  if (!Array.isArray(mensagens) || mensagens.length === 0) {
    return {
      titulo: 'Atendimento Concluído',
      aprendizadoResumo: 'Sessão aberta sem trocas de mensagens registrada.'
    };
  }

  const likes = feedbacksStats ? (feedbacksStats.likes || 0) : 0;
  const dislikes = feedbacksStats ? (feedbacksStats.dislikes || 0) : 0;

  // Se houver Gemini API Key configurada, gerar síntese profunda com IA
  if (apiKey) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const historicoTexto = mensagens.map(m => {
        const fb = m.feedback === 1 ? ' [Feedback do usuário: 👍 Útil]' : (m.feedback === -1 ? ' [Feedback do usuário: 👎 Insatisfatório]' : '');
        return `${m.papel === 'usuario' ? 'Usuário' : 'DoceIA'}: ${m.conteudo}${fb}`;
      }).join('\n');

      const promptSintese = `Você é o sintetizador de aprendizado do assistente DocePreço.
Analise a conversa de atendimento abaixo entre a confeiteira e a assistente virtual:

${historicoTexto}

Gere OBRIGATORIAMENTE um JSON válido com o seguinte formato:
{
  "titulo": "Título curto de 3 a 6 palavras resumindo o assunto principal (ex: Dúvidas de Estoque e Forno, Precificação de Bolo)",
  "aprendizado": "Resumo de 2 a 4 linhas descrevendo o que foi esclarecido, preferências ou dúvidas recorrentes desta confeiteira e lições aprendidas (especialmente considerando se houve respostas avaliadas com 👍 ou 👎)."
}

Responda APENAS o JSON puro, sem crases de código e sem texto adicional.`;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: promptSintese }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 350
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (resp.ok) {
        const data = await resp.json();
        let raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        raw = raw.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
        const parsed = JSON.parse(raw);
        if (parsed.titulo && parsed.aprendizado) {
          return {
            titulo: parsed.titulo.trim(),
            aprendizadoResumo: parsed.aprendizado.trim()
          };
        }
      }
    } catch (e) {
      clearTimeout(timeoutId);
      console.warn('[Assistente IA] Falha na síntese via Gemini, usando síntese nativa:', e.message);
    }
  }

  // Síntese Nativa Heurística (Sem API Key ou em caso de falha de conexão)
  const textoGeral = mensagens.map(m => m.conteudo.toLowerCase()).join(' ');
  const temas = [];
  if (textoGeral.includes('estoque') || textoGeral.includes('ingrediente')) temas.push('Estoque e Insumos');
  if (textoGeral.includes('produção') || textoGeral.includes('producao') || textoGeral.includes('cozinha') || textoGeral.includes('preparo')) temas.push('Modo Cozinha & Produção');
  if (textoGeral.includes('pedido') || textoGeral.includes('encomenda') || textoGeral.includes('entrega')) temas.push('Encomendas & Pedidos');
  if (textoGeral.includes('preço') || textoGeral.includes('preco') || textoGeral.includes('custo') || textoGeral.includes('margem')) temas.push('Custos e Precificação');
  if (textoGeral.includes('compras') || textoGeral.includes('comprar')) temas.push('Planejamento de Compras');

  const tituloTema = temas.length > 0 ? temas.slice(0, 2).join(' e ') : 'Dúvidas Operacionais do Sistema';
  let resumo = `Atendimento com ${mensagens.length} mensagem(ns) focado em ${tituloTema}. `;
  if (likes > 0) resumo += `O usuário avaliou positivamente (${likes} 👍) as orientações fornecidas. `;
  if (dislikes > 0) resumo += `Houve ${dislikes} resposta(s) marcada(s) como insatisfatória(s) (👎), demandando mais detalhes nas próximas orientações. `;
  resumo += `Aprendizado arquivado para guiar o contexto dos próximos atendimentos.`;

  return {
    titulo: `Atendimento: ${tituloTema}`,
    aprendizadoResumo: resumo
  };
}

module.exports = {
  coletarContextoUsuario,
  gerarRespostaNativa,
  responderDuvidaSistema,
  sintetizarAprendizadoSessao
};
