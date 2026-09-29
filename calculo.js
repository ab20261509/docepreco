// Custo fixo por hora = total de custos fixos ÷ horas trabalhadas por mês
function custoFixoHora(totalFixos, horasMes) {
  return horasMes > 0 ? totalFixos / horasMes : 0;
}

function calcularProduto(p, ingredientes = [], complementos = [], cfHora = 0) {
  // A: ingredientes — Qtd usada ÷ Qtd do pacote × Preço do pacote
  const A = ingredientes.reduce((s, i) => {
    const qtdPacote = Number(i.qtd_pacote) || 0;
    const qtdUsada = Number(i.qtd_usada) || 0;
    const precoPacote = Number(i.preco_pacote) || 0;
    return s + (qtdPacote > 0 ? (qtdUsada / qtdPacote) * precoPacote : 0);
  }, 0);

  // B: complementos (embalagens, forminhas, fitas, descartáveis)
  const B = complementos.reduce((s, c) => s + (Number(c.custo_lote) || 0), 0);

  // C: custo fixo alocado = tempo em horas × custo fixo por hora
  const tempoHoras = Number(p.tempo_horas) || 0;
  const C = tempoHoras * cfHora;

  // D: mão de obra separada / adicional
  const D = Number(p.mao_obra_extra) || 0;

  const custoLote = A + B + C + D;
  const rendimento = Number(p.rendimento) > 0 ? Number(p.rendimento) : 1;
  const custoUnit = custoLote / rendimento;

  const margemPct = Number(p.margem_pct) || 0;
  const taxasPct = Number(p.taxas_pct) || 0;

  // Fator = 1 - (margem% + taxas%) / 100
  const fator = 1 - (margemPct + taxasPct) / 100;
  if (fator <= 0) {
    throw new Error('Margem + taxas precisam somar menos de 100%.');
  }

  const preco = custoUnit / fator;
  const lucroUnit = preco - custoUnit;

  return {
    A,
    B,
    C,
    D,
    custoLote,
    custoUnit,
    fator,
    preco,
    lucroUnit,
    lucroLote: lucroUnit * rendimento,
    percLucro: preco > 0 ? (lucroUnit / preco) : 0
  };
}

module.exports = { custoFixoHora, calcularProduto };
