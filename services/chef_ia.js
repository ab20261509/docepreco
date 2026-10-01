/**
 * services/chef_ia.js
 * Módulo de Inteligência Culinária para Confeitaria & Panificação.
 * 
 * Suporta:
 * 1. Google Gemini API (quando GEMINI_API_KEY estiver configurada no .env / Render).
 * 2. Motor Heurístico Culinário Nativo (fallback 100% offline, sem custo e instantâneo).
 */

const fs = require('fs');

/**
 * Heurística Culinária Nativa (Offline / Sem API Key)
 * Conhece métodos clássicos de confeitaria (Cremoso, Espumoso, Liquidificador, Brigadeiro/Panela).
 */
function gerarSequenciaNativa(produto, ingredientes, rendimento, fator = 1) {
  const nomeLower = (produto.nome || '').toLowerCase();
  
  // Categorizar ingredientes pelos nomes
  const nomesIngredientes = ingredientes.map(i => (i.nome || '').toLowerCase());
  
  const temOvos = nomesIngredientes.some(n => n.includes('ovo') || n.includes('gema') || n.includes('clara'));
  const temAcucar = nomesIngredientes.some(n => n.includes('açúcar') || n.includes('acucar') || n.includes('mel'));
  const temFarinhaSecos = ingredientes.filter(i => {
    const n = (i.nome || '').toLowerCase();
    return n.includes('farinha') || n.includes('amido') || n.includes('maizena') || n.includes('cacau') || n.includes('chocolate em pó') || n.includes('fubá') || n.includes('aveia');
  });
  const temFermento = ingredientes.find(i => {
    const n = (i.nome || '').toLowerCase();
    return n.includes('fermento') || n.includes('bicarbonato');
  });
  const temGordura = ingredientes.filter(i => {
    const n = (i.nome || '').toLowerCase();
    return n.includes('manteiga') || n.includes('margarina') || n.includes('óleo') || n.includes('oleo');
  });
  const temLiquidos = ingredientes.filter(i => {
    const n = (i.nome || '').toLowerCase();
    return n.includes('leite') || n.includes('água') || n.includes('agua') || n.includes('suco') || n.includes('iogurte');
  });
  const temLeiteCondensado = nomesIngredientes.some(n => n.includes('condensado'));
  const temCremeLeite = nomesIngredientes.some(n => n.includes('creme de leite'));
  const temCenoura = nomesIngredientes.some(n => n.includes('cenoura') || n.includes('milho') || n.includes('banana'));

  const passos = [];

  // Arquétipo 1: Doces de Panela / Brigadeiros / Coberturas
  if ((temLeiteCondensado || temCremeLeite) && (nomeLower.includes('brigadeiro') || nomeLower.includes('recheio') || nomeLower.includes('calda') || nomeLower.includes('caramelo') || nomeLower.includes('doce de'))) {
    passos.push({
      ordem: 1,
      titulo: '1. Dissolução a Frio na Panela',
      instrucao: 'Em uma panela de fundo grosso, adicione o leite condensado, a manteiga e o cacau/chocolate. Misture muito bem com o fogo ainda desligado até ficar homogêneo e sem grumos.',
      equipamento: 'fogao',
      tempo_timer_min: null,
      temperatura: null,
      ponto_visual: 'Creme liso, sem pelotas de pó de cacau.',
      dica_chef: 'Misturar com o fogo desligado evita que o chocolate queime no fundo antes de dissolver.'
    });

    passos.push({
      ordem: 2,
      titulo: '2. Cocção em Ponto de Fogo (Fogo Médio para Baixo)',
      instrucao: 'Ligue o fogão em fogo médio-baixo e mexa sem parar com espátula de silicone (pão duro), raspando bem as laterais e o fundo da panela para não pegar.',
      equipamento: 'fogao',
      tempo_timer_min: 15,
      temperatura: 'Fogo Médio/Baixo',
      ponto_visual: 'Massa borbulhando mais pesada e se desprendendo completamente do fundo da panela ao inclinar (ponto de bloco/queda em fita).',
      dica_chef: 'Não aumente o fogo para acelerar, pois pode açucarar ou queimar o fundo.'
    });

    passos.push({
      ordem: 3,
      titulo: '3. Resfriamento & Descanso com Filme Plástico',
      instrucao: 'Transfira o doce quente imediatamente para um prato ou travessa rasa e cubra com filme plástico em contato direto com a massa (sem deixar ar). Deixe esfriar em temperatura ambiente ou geladeira.',
      equipamento: 'geladeira',
      tempo_timer_min: 60,
      temperatura: 'Geladeira ou Temperatura Ambiente',
      ponto_visual: 'Massa firme, acetinada e fria para manuseio ou enrolar.',
      dica_chef: 'O plástico em contato impede a formação de casquinha seca ou cristais de açúcar na superfície.'
    });

    return {
      fonte: 'heuristica',
      tipo_receita: 'Doce / Brigadeiro / Ponto de Panela',
      tempo_preparo_min: 30,
      passos
    };
  }

  // Arquétipo 2: Bolo de Liquidificador (cenoura, milho, rápida)
  if (temCenoura || nomeLower.includes('liquidificador') || (nomeLower.includes('cenoura') && temOvos)) {
    passos.push({
      ordem: 1,
      titulo: '1. Pré-aquecimento do Forno e Untar Formas',
      instrucao: 'Ligue o forno a 180°C para pré-aquecer. Unte e enfarinhe a forma desejada (ou utilize desmoldante culinário).',
      equipamento: 'forno',
      tempo_timer_min: 10,
      temperatura: '180°C',
      ponto_visual: 'Forno quente e forma pronta antes de bater a massa.',
      dica_chef: 'Colocar o bolo em forno frio prejudica o crescimento e faz a massa solar.'
    });

    passos.push({
      ordem: 2,
      titulo: '2. Emulsão no Liquidificador',
      instrucao: 'No copo do liquidificador, bata os ovos, o óleo/gordura, o açúcar e os ingredientes úmidos (ex: cenoura picada) por cerca de 3 a 4 minutos em velocidade alta até obter um creme perfeitamente liso e aveludado.',
      equipamento: 'liquidificador',
      tempo_timer_min: 4,
      temperatura: null,
      ponto_visual: 'Creme alaranjado, homogêneo e sem pedacinhos sólidos visíveis.',
      dica_chef: 'Bata bastante nessa etapa para emulsificar bem o óleo com os ovos.'
    });

    passos.push({
      ordem: 3,
      titulo: '3. Incorporação dos Secos Peneirados',
      instrucao: 'Despeje o creme do liquidificador em uma tigela grande. Adicione a farinha de trigo peneirada aos poucos, incorporando delicadamente com um fuê (batedor de arame) apenas até homogeneizar.',
      equipamento: null,
      tempo_timer_min: null,
      temperatura: null,
      ponto_visual: 'Massa lisa e brilhante, sem bater com força para não ativar o glúten.',
      dica_chef: 'Nunca bata a farinha no liquidificador! Isso desenvolve o glúten e deixa o bolo pesado e borrachudo.'
    });

    if (temFermento) {
      passos.push({
        ordem: 4,
        titulo: '4. Toque Final: Fermento Químico',
        instrucao: `Adicione o fermento (${temFermento.nome}) peneirado e misture muito suavemente com o fuê em movimentos circulares de baixo para cima, apenas para distribuir.`,
        equipamento: null,
        tempo_timer_min: null,
        temperatura: null,
        ponto_visual: 'Pequenas bolinhas de aeração começam a se formar na massa.',
        dica_chef: 'O fermento começa a agir no momento do contato com a umidade; leve a massa imediatamente ao forno.'
      });
    }

    passos.push({
      ordem: passos.length + 1,
      titulo: '5. Cocção no Forno',
      instrucao: 'Despeje a massa na forma e asse a 180°C por cerca de 40 a 45 minutos. Não abra o forno antes de 30 minutos.',
      equipamento: 'forno',
      tempo_timer_min: 40,
      temperatura: '180°C',
      ponto_visual: 'Topo dourado, bordas soltando levemente da forma e palito saindo limpo no centro.',
      dica_chef: 'Faça o teste do palito no centro do bolo. Se sair sequinho, retire e deixe amornar antes de desenformar.'
    });

    return {
      fonte: 'heuristica',
      tipo_receita: 'Massa Direta de Liquidificador',
      tempo_preparo_min: 50,
      passos
    };
  }

  // Arquétipo 3: Massas Finas, Bolos de Batedeira (Método Cremoso / Espumoso)
  passos.push({
    ordem: 1,
    titulo: '1. Mise en Place & Pré-aquecimento',
    instrucao: 'Pré-aqueça o forno a 180°C. Prepare as formas com manteiga e farinha ou papel manteiga. Peneire todos os ingredientes secos (farinha, cacau, amido) em um recipiente e reserve.',
    equipamento: 'forno',
    tempo_timer_min: 10,
    temperatura: '180°C',
    ponto_visual: 'Ingredientes todos pesados à temperatura ambiente (ovos e manteiga não devem estar gelados).',
    dica_chef: 'Ingredientes em temperatura ambiente emulsificam muito melhor e garantem volume à massa.'
  });

  if (temOvos && temAcucar) {
    passos.push({
      ordem: 2,
      titulo: '2. Emulsão & Aeração na Batedeira',
      instrucao: 'Na tigela da batedeira, bata os ovos com o açúcar em velocidade média-alta por cerca de 5 a 8 minutos, até triplicar de volume e formar uma espuma clara e fofa (ponto de fita).',
      equipamento: 'batedeira',
      tempo_timer_min: 7,
      temperatura: null,
      ponto_visual: 'Creme esbranquiçado, aerado e espesso, que cai do batedor formando fitas.',
      dica_chef: 'Essa aeração é a alma de um bolo leve e macio. Não economize no tempo de batimento dos ovos!'
    });
  }

  if (temGordura.length > 0 || temLiquidos.length > 0) {
    passos.push({
      ordem: 3,
      titulo: '3. Adição dos Líquidos & Gorduras',
      instrucao: 'Diminua a velocidade da batedeira para o mínimo e adicione os líquidos (leite/óleo/manteiga derretida) em fio contínuo pela lateral da tigela, misturando apenas o suficiente para incorporar.',
      equipamento: 'batedeira',
      tempo_timer_min: 2,
      temperatura: null,
      ponto_visual: 'Líquidos integrados sem perder o ar da mistura.',
      dica_chef: 'Misture rapidamente para não perder as bolhas de ar criadas na etapa anterior.'
    });
  }

  if (temFarinhaSecos.length > 0) {
    passos.push({
      ordem: passos.length + 1,
      titulo: '4. Incorporação Delicada dos Secos',
      instrucao: 'Retire a tigela da batedeira. Adicione a mistura de secos peneirados em 2 ou 3 partes, incorporando delicadamente com um fuê de baixo para cima, do centro para as bordas.',
      equipamento: null,
      tempo_timer_min: null,
      temperatura: null,
      ponto_visual: 'Massa acetinada, sem pelotas de farinha e bem aerada.',
      dica_chef: 'Nunca bata com vigor nessa fase para não desenvolver o glúten.'
    });
  }

  if (temFermento) {
    passos.push({
      ordem: passos.length + 1,
      titulo: '5. Agente de Crescimento (Fermento)',
      instrucao: `Incorpore o ${temFermento.nome} peneirado com movimentos muito delicados com o fuê ou espátula.`,
      equipamento: null,
      tempo_timer_min: null,
      temperatura: null,
      ponto_visual: 'Massa uniforme pronta para a assadeira.',
      dica_chef: 'O fermento é sempre o último ingrediente a entrar.'
    });
  }

  passos.push({
    ordem: passos.length + 1,
    titulo: '6. Forneamento & Ponto de Cocção',
    instrucao: 'Despeje a massa na forma nivelando com a espátula. Asse em forno a 180°C por 35 a 45 minutos até que esteja dourado e firme ao toque.',
    equipamento: 'forno',
    tempo_timer_min: 40,
    temperatura: '180°C',
    ponto_visual: 'Bordas levemente soltas e teste do palito saindo seco.',
    dica_chef: 'Deixe o bolo descansar por 10 a 15 minutos na forma antes de desenformar em uma grade para não quebrar.'
  });

  return {
    fonte: 'heuristica',
    tipo_receita: 'Confeitaria / Método Batido Tradicional',
    tempo_preparo_min: 60,
    passos
  };
}

/**
 * Chamada à API Google Gemini (quando GEMINI_API_KEY estiver configurada)
 */
async function gerarSequenciaComGemini(produto, ingredientes, rendimento, fator = 1, apiKey) {
  const listaIngredientesTexto = ingredientes.map(i => {
    const qtdEscalada = Number((i.qtd_usada * fator).toFixed(2));
    return `- ${i.nome}: ${qtdEscalada} (${i.unidade || 'g'})`;
  }).join('\n');

  const prompt = `Você é um renomado Mestre Confeiteiro e Chef de Panificação profissional.
Analise a receita abaixo e monte o passo a passo exato e detalhado da sequência das misturas para o preparo na cozinha.

DADOS DA RECEITA:
- Nome do Produto: ${produto.nome}
- Rendimento da Receita Base: ${produto.rendimento}
- Lote Atual a Produzir (Fator de Escala): ${fator.toFixed(2)}x
- Ingredientes Pesados:
${listaIngredientesTexto}

INSTRUÇÕES:
Retorne ESTRITAMENTE um objeto JSON válido (sem tags markdown de bloco de código, sem formatação extra, apenas o JSON puro) com a seguinte estrutura:
{
  "tipo_receita": "Bolo Fofo / Pão de Ló / Brigadeiro / Torta / etc",
  "tempo_preparo_min": 45,
  "passos": [
    {
      "ordem": 1,
      "titulo": "1. Nome curto da etapa (ex: Mise en Place & Pré-aquecimento)",
      "instrucao": "Descrição clara, profissional e prática de como bater, misturar ou incorporar os ingredientes nesta fase.",
      "equipamento": "forno" | "geladeira" | "batedeira" | "liquidificador" | "fogao" | "descanso" | null,
      "tempo_timer_min": 40 | null,
      "temperatura": "180°C" | null,
      "ponto_visual": "Como o confeiteiro sabe que atingiu o ponto correto nesta etapa",
      "dica_chef": "Uma dica de ouro profissional para não errar ou solar"
    }
  ]
}

REGRAS CULINÁRIAS OBRIGATÓRIAS:
1. Indique a ordem correta das misturas (ex: emulsão de ovos/açúcar primeiro, secos peneirados depois, fermento por último).
2. Se houver etapa de forno, geladeira, batedeira ou fogo, preencha o campo "equipamento" e o tempo sugerido em "tempo_timer_min".
3. Seja didático, claro e focado na prática da bancada de confeitaria.`;

  // Timeout de 12 segundos para não prender a resposta
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json'
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[Gemini API] Resposta HTTP ${response.status}: ${errText}`);
      throw new Error(`Gemini API HTTP ${response.status}`);
    }

    const data = await response.json();
    const candidate = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidate) {
      throw new Error('Nenhum texto retornado pelo Gemini');
    }

    // Limpar possíveis delimitadores markdown de código se a API devolver
    let jsonLimpo = candidate.trim();
    if (jsonLimpo.startsWith('```json')) {
      jsonLimpo = jsonLimpo.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    } else if (jsonLimpo.startsWith('```')) {
      jsonLimpo = jsonLimpo.replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    }

    const resultado = JSON.parse(jsonLimpo);
    resultado.fonte = 'gemini_ia';
    return resultado;
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn(`[Chef IA] Falha na chamada da Gemini API (${err.message}). Ativando fallback heurístico culinário.`);
    // Fallback gracioso para a heurística
    const fallback = gerarSequenciaNativa(produto, ingredientes, rendimento, fator);
    fallback.fallback_motivo = err.message;
    return fallback;
  }
}

/**
 * Função Principal de Obtenção da Sequência Inteligente
 */
async function obterSequenciaPreparo(produto, ingredientes, rendimento, fator = 1) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (apiKey) {
    return await gerarSequenciaComGemini(produto, ingredientes, rendimento, fator, apiKey);
  }
  return gerarSequenciaNativa(produto, ingredientes, rendimento, fator);
}

module.exports = {
  obterSequenciaPreparo,
  gerarSequenciaNativa,
  gerarSequenciaComGemini
};
