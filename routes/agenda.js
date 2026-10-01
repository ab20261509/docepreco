const express = require('express');
const db = require('../db');
const { exigirLogin } = require('../middleware/auth');
const { formatarTelefone } = require('./clientes');

const router = express.Router();

function formatarMoeda(val) {
  const num = Number(val) || 0;
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarDataBR(dataIso) {
  if (!dataIso) return '';
  const partes = dataIso.split('-');
  if (partes.length === 3) return partes[2] + '/' + partes[1] + '/' + partes[0];
  return dataIso;
}

function obterHojeLocal() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function adicionarDias(dataIso, dias) {
  const partes = dataIso.split('-').map(Number);
  const d = new Date(partes[0], partes[1] - 1, partes[2]);
  d.setDate(d.getDate() + dias);
  const resAno = d.getFullYear();
  const resMes = String(d.getMonth() + 1).padStart(2, '0');
  const resDia = String(d.getDate()).padStart(2, '0');
  return `${resAno}-${resMes}-${resDia}`;
}

function obterDiaSemana(dataIso) {
  const partes = dataIso.split('-').map(Number);
  const d = new Date(partes[0], partes[1] - 1, partes[2]);
  const dias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  return dias[d.getDay()];
}

function gerarLinkWhatsApp(telefone, textoMensagem) {
  if (!telefone) return null;
  const digitos = telefone.replace(/\D/g, '');
  if (!digitos || digitos.length < 10) return null;
  const ddi = digitos.length <= 11 ? '55' : '';
  const msgEncoded = encodeURIComponent(textoMensagem || '');
  return `https://wa.me/${ddi}${digitos}?text=${msgEncoded}`;
}

function gerarMensagemPronto(pedido) {
  const clienteNome = pedido.cliente_cadastrado_nome || pedido.cliente_nome_avulso || 'Cliente';
  const tipo = pedido.tipo_entrega === 'entrega' 
    ? '🚗 Seu pedido está pronto para entrega e sairá em breve!' 
    : '🏬 Seu pedido está prontinho e embalado, já disponível para retirada no local!';
  
  const saldo = Math.max(0, pedido.valor_total - pedido.valor_sinal);
  let texto = `Olá, *${clienteNome}*! 🧁 Tudo bem?\n\nPassando para avisar que sua encomenda *#${pedido.id}* da *Doce Preço* está finalizada com todo carinho!\n\n${tipo}\n`;
  
  if (saldo > 0 && pedido.status_pagamento !== 'pago') {
    texto += `\n💳 *Saldo a acertar*: ${formatarMoeda(saldo)}.\n`;
  }
  
  texto += `\nQualquer dúvida estamos à disposição. Muito obrigado! ❤️`;
  return texto;
}

async function anexarItensEFormatacao(pedidos) {
  return Promise.all(pedidos.map(async (p) => {
    const itens = await db.all('SELECT * FROM pedido_itens WHERE pedido_id = ? ORDER BY id ASC', [p.id]);
    const clienteNome = p.cliente_cadastrado_nome || p.cliente_nome_avulso || 'Cliente Avulso';
    const clienteTelefone = p.cliente_cadastrado_telefone || p.cliente_telefone_avulso || '';
    const saldo = Math.max(0, p.valor_total - p.valor_sinal);
    const msgPronto = gerarMensagemPronto({ ...p, cliente_cadastrado_nome: clienteNome });
    const waLink = gerarLinkWhatsApp(clienteTelefone, msgPronto);

    return {
      ...p,
      clienteNome,
      clienteTelefone: formatarTelefone(clienteTelefone),
      saldoPendente: saldo,
      saldoFormatado: formatarMoeda(saldo),
      totalFormatado: formatarMoeda(p.valor_total),
      dataEntregaFmt: formatarDataBR(p.data_entrega),
      diaSemana: obterDiaSemana(p.data_entrega),
      itens,
      waLinkPronto: waLink
    };
  }));
}

// 1. Painel Principal da Agenda
router.get('/', exigirLogin, async (req, res, next) => {
  try {
    const uid = req.session.usuario.id;
    const hoje = obterHojeLocal();
    const amanha = adicionarDias(hoje, 1);
    const daqui7dias = adicionarDias(hoje, 7);

    const mesParam = (req.query.mes || '').trim();
    const mesAtual = /^\d{4}-\d{2}$/.test(mesParam) ? mesParam : hoje.slice(0, 7);
    const dataSelecionada = (req.query.data || '').trim();
    const abaAtiva = req.query.aba === 'mes' ? 'mes' : 'operacional';

    // 1. Pedidos de Hoje
    const rawHoje = await db.all(`
      SELECT p.*, c.nome AS cliente_cadastrado_nome, c.telefone AS cliente_cadastrado_telefone
      FROM pedidos p
      LEFT JOIN clientes c ON p.cliente_id = c.id
      WHERE p.usuario_id = ? AND p.data_entrega = ? AND p.status != 'cancelado'
      ORDER BY CASE WHEN p.horario_entrega IS NULL OR p.horario_entrega = '' THEN '99:99' ELSE p.horario_entrega END ASC
    `, [uid, hoje]);
    const pedidosHoje = await anexarItensEFormatacao(rawHoje);

    // 2. Pedidos de Amanhã
    const rawAmanha = await db.all(`
      SELECT p.*, c.nome AS cliente_cadastrado_nome, c.telefone AS cliente_cadastrado_telefone
      FROM pedidos p
      LEFT JOIN clientes c ON p.cliente_id = c.id
      WHERE p.usuario_id = ? AND p.data_entrega = ? AND p.status != 'cancelado'
      ORDER BY CASE WHEN p.horario_entrega IS NULL OR p.horario_entrega = '' THEN '99:99' ELSE p.horario_entrega END ASC
    `, [uid, amanha]);
    const pedidosAmanha = await anexarItensEFormatacao(rawAmanha);

    // 3. Pedidos dos Próximos 7 Dias (após amanhã até hoje + 7)
    const rawSemana = await db.all(`
      SELECT p.*, c.nome AS cliente_cadastrado_nome, c.telefone AS cliente_cadastrado_telefone
      FROM pedidos p
      LEFT JOIN clientes c ON p.cliente_id = c.id
      WHERE p.usuario_id = ? AND p.data_entrega > ? AND p.data_entrega <= ? AND p.status != 'cancelado'
      ORDER BY p.data_entrega ASC, CASE WHEN p.horario_entrega IS NULL OR p.horario_entrega = '' THEN '99:99' ELSE p.horario_entrega END ASC
    `, [uid, amanha, daqui7dias]);
    const pedidosSemana = await anexarItensEFormatacao(rawSemana);

    // Agrupar semana por data para facilitar exibição
    const gruposSemana = {};
    pedidosSemana.forEach(p => {
      if (!gruposSemana[p.data_entrega]) {
        gruposSemana[p.data_entrega] = {
          data: p.data_entrega,
          dataFmt: p.dataEntregaFmt,
          diaSemana: p.diaSemana,
          pedidos: []
        };
      }
      gruposSemana[p.data_entrega].pedidos.push(p);
    });
    const listaGruposSemana = Object.values(gruposSemana);

    // KPIs
    const totalHoje = pedidosHoje.length;
    const concluidosHoje = pedidosHoje.filter(p => p.status === 'entregue').length;
    const saldoReceberHoje = pedidosHoje
      .filter(p => p.status !== 'entregue' && p.status_pagamento !== 'pago')
      .reduce((acc, p) => acc + p.saldoPendente, 0);

    const totalSemana = totalHoje + pedidosAmanha.length + pedidosSemana.length;

    // 4. Calendário Mensal
    const [anoStr, numMesStr] = mesAtual.split('-');
    const ano = parseInt(anoStr, 10);
    const mesIdx = parseInt(numMesStr, 10) - 1;

    // Primeiro e último dia do mês
    const primeiroDia = new Date(ano, mesIdx, 1);
    const ultimoDia = new Date(ano, mesIdx + 1, 0);
    const totalDiasMes = ultimoDia.getDate();
    const diaSemanaInicio = primeiroDia.getDay(); // 0 = Domingo

    // Navegação meses
    const mesAnteriorDate = new Date(ano, mesIdx - 1, 1);
    const mesAnterior = `${mesAnteriorDate.getFullYear()}-${String(mesAnteriorDate.getMonth() + 1).padStart(2, '0')}`;
    const mesSeguinteDate = new Date(ano, mesIdx + 1, 1);
    const mesSeguinte = `${mesSeguinteDate.getFullYear()}-${String(mesSeguinteDate.getMonth() + 1).padStart(2, '0')}`;

    const nomesMeses = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    const rotuloMesAno = `${nomesMeses[mesIdx]} de ${ano}`;

    // Buscar agrupamento de pedidos do mês
    const pedidosMesAgrupados = await db.all(`
      SELECT 
        p.data_entrega,
        COUNT(*) AS total,
        SUM(CASE WHEN p.status = 'entregue' THEN 1 ELSE 0 END) AS concluidos,
        SUM(CASE WHEN p.status IN ('confirmado', 'producao') THEN 1 ELSE 0 END) AS em_producao,
        SUM(CASE WHEN p.status = 'orcamento' THEN 1 ELSE 0 END) AS orcamentos,
        SUM(p.valor_total) AS total_valor
      FROM pedidos p
      WHERE p.usuario_id = ? AND strftime('%Y-%m', p.data_entrega) = ? AND p.status != 'cancelado'
      GROUP BY p.data_entrega
    `, [uid, mesAtual]);

    const mapaDiasMes = {};
    pedidosMesAgrupados.forEach(row => {
      mapaDiasMes[row.data_entrega] = {
        total: row.total,
        concluidos: row.concluidos,
        em_producao: row.em_producao,
        orcamentos: row.orcamentos,
        total_valor: row.total_valor,
        totalValorFmt: formatarMoeda(row.total_valor)
      };
    });

    // Montar grade de semanas
    const gradeDias = [];
    // Espaços do mês anterior
    for (let i = 0; i < diaSemanaInicio; i++) {
      gradeDias.push({ dia: null, dataIso: null });
    }
    // Dias do mês atual
    for (let d = 1; d <= totalDiasMes; d++) {
      const dStr = String(d).padStart(2, '0');
      const dataIso = `${mesAtual}-${dStr}`;
      gradeDias.push({
        dia: d,
        dataIso,
        eHoje: dataIso === hoje,
        selecionada: dataIso === dataSelecionada,
        resumo: mapaDiasMes[dataIso] || null
      });
    }

    // Se houver uma data selecionada no calendário, buscar seus pedidos
    let pedidosDataSelecionada = null;
    let dataSelecionadaFmt = '';
    if (dataSelecionada) {
      const rawData = await db.all(`
        SELECT p.*, c.nome AS cliente_cadastrado_nome, c.telefone AS cliente_cadastrado_telefone
        FROM pedidos p
        LEFT JOIN clientes c ON p.cliente_id = c.id
        WHERE p.usuario_id = ? AND p.data_entrega = ? AND p.status != 'cancelado'
        ORDER BY CASE WHEN p.horario_entrega IS NULL OR p.horario_entrega = '' THEN '99:99' ELSE p.horario_entrega END ASC
      `, [uid, dataSelecionada]);
      pedidosDataSelecionada = await anexarItensEFormatacao(rawData);
      dataSelecionadaFmt = `${formatarDataBR(dataSelecionada)} (${obterDiaSemana(dataSelecionada)})`;
    }

    res.render('agenda', {
      activeNav: 'agenda',
      activeModulo: 'comercial',
      hoje,
      hojeFmt: `${formatarDataBR(hoje)} (${obterDiaSemana(hoje)})`,
      amanhaFmt: `${formatarDataBR(amanha)} (${obterDiaSemana(amanha)})`,
      pedidosHoje,
      pedidosAmanha,
      listaGruposSemana,
      totalHoje,
      concluidosHoje,
      saldoReceberHoje: formatarMoeda(saldoReceberHoje),
      totalSemana,
      abaAtiva,
      mesAtual,
      mesAnterior,
      mesSeguinte,
      rotuloMesAno,
      gradeDias,
      dataSelecionada,
      dataSelecionadaFmt,
      pedidosDataSelecionada
    });
  } catch (err) {
    next(err);
  }
});

// 2. Avanço Rápido de Status direto pela Agenda
router.post('/:id/status', exigirLogin, async (req, res, next) => {
  try {
    const uid = req.session.usuario.id;
    const pedidoId = parseInt(req.params.id, 10);
    const novoStatus = (req.body.status || '').trim();
    const redirectTo = req.body.redirect_to || '/agenda';

    const statusPermitidos = ['orcamento', 'confirmado', 'producao', 'entregue', 'cancelado'];
    if (!statusPermitidos.includes(novoStatus)) {
      return res.status(400).send('Status inválido.');
    }

    const pedido = await db.get('SELECT id FROM pedidos WHERE id = ? AND usuario_id = ?', [pedidoId, uid]);
    if (!pedido) {
      return res.status(404).send('Pedido não encontrado.');
    }

    await db.run(`
      UPDATE pedidos 
      SET status = ?, atualizado_em = datetime('now')
      WHERE id = ? AND usuario_id = ?
    `, [novoStatus, pedidoId, uid]);

    res.redirect(redirectTo);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
