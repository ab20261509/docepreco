# 🧁 Manual Oficial de Operação & Regras de Negócio — DocePreço

Este documento é a base oficial de conhecimento do sistema **DocePreço**, desenvolvido para gestão, precificação profissional, controle de estoque e assistência de preparo para confeitarias e panificações artesanais.

---

## 1. Visão Geral & Início
- **Painel Inicial (`/`):** Ponto de partida do confeiteiro. Exibe alertas rápidos em destaque:
  - 📅 **Entregas de Hoje:** Quantidade de encomendas marcadas para o dia atual.
  - ⚠️ **Estoque Baixo:** Quantidade de insumos com saldo atual igual ou inferior ao estoque mínimo.
  - ⏰ **Validade em Risco:** Lotes de insumos vencidos ou com vencimento nos próximos 7 dias.
- **Acesso Rápido:** Botões em cards para todos os módulos da fábrica e do comercial.
- **DoceIA Assistente:** Botão flutuante no canto superior direito para tirar dúvidas sobre o sistema e tarefas em tempo real.

---

## 2. Custos Fixos Mensais & Configurações (`/custos`)
- **Conceito:** Custos fixos são as despesas que existem todo mês independentemente da quantidade de bolos vendidos (ex: energia elétrica, gás, aluguel, internet, água, pró-labore/salário da confeiteira, manutenção).
- **Carga Horária Mensal (`horas_mes`):** Total de horas que a confeiteira trabalha por mês (padrão: 160 horas, correspondendo a 8h/dia em 20 dias úteis).
- **Fórmula do Custo Operacional por Hora:**
  $$\text{Custo por Hora} = \frac{\text{Total de Custos Fixos Mensais}}{\text{Horas Trabalhadas no Mês}}$$
- **Aplicação prática:** Se o custo fixo mensal for R$ 3.200,00 e a carga for 160h, cada hora de forno/trabalho custa R$ 20,00. Esse valor é somado ao custo de cada receita de acordo com o tempo de preparo (`tempo_horas`).

---

## 3. Produtos & Precificação Profissional (`/produtos`)
- **Ficha Técnica:** Cada produto cadastrado possui:
  - **Rendimento Base:** Quantidade produzida por fornada/lote padrão (ex: 1 bolo de 2 kg, 50 unidades de brigadeiro, 1 cento de salgados).
  - **Unidades Suportadas:** `kg` (quilograma), `g` (grama), `un` (unidade avulsa), `cento` (100 unidades).
  - **Ingredientes Pesados:** Lista de ingredientes com nome, quantidade usada na receita, preço do pacote de compra e peso/volume do pacote.
  - **Embalagens & Complementos:** Caixas, fitas, pratos descartáveis e toppers.
  - **Tempo de Preparo (`tempo_horas`):** Tempo em horas (ex: 1.5h para 1h30min) que consome o custo fixo por hora.
  - **Mão de Obra Extra:** Custo financeiro adicional para ajudantes temporários por lote.
  - **Margem de Lucro Desejada (%):** Percentual de lucro líquido pretendido (padrão recomendado: 35% a 50%).
  - **Taxas de Cartão/Impostos (%):** Percentual descontado pelas maquininhas ou impostos (ex: 4% a 6%).
- **Fórmulas Matemáticas de Precificação:**
  1. $\text{Custo dos Ingredientes} = \sum \left( \frac{\text{Preço do Pacote}}{\text{Qtd do Pacote}} \times \text{Qtd Usada} \right)$
  2. $\text{Custo Fixo do Lote} = \text{Tempo em Horas} \times \text{Custo por Hora}$
  3. $\text{Custo Total do Lote} = \text{Ingredientes} + \text{Complementos} + \text{Custo Fixo} + \text{Mão de Obra Extra}$
  4. $\text{Custo Unitário Base} = \frac{\text{Custo Total do Lote}}{\text{Rendimento Base}}$
  5. $\text{Preço de Venda Sugerido} = \frac{\text{Custo Unitário Base} \times (1 + \text{Margem \%})}{1 - \text{Taxas \%}}$
- **Unidades Dinâmicas:** Para produtos vendidos por peso (ex: R$ 60,00 / kg), o sistema calcula o preço proporcional para qualquer peso informado na encomenda (ex: bolo de 3.2 kg).

---

## 4. Insumos, Catálogo & Gestão de Estoque (`/ingredientes`)
- **Catálogo Central:** Cadastro de insumos com nome padronizado, unidade de controle (`g`, `ml`, `un`), saldo atual em estoque, estoque mínimo de segurança e último preço pago.
- **Histórico de Compras & Entrada de Lotes:** Registro de compras com fornecedor, nota/recibo, código do lote, data de compra e data de validade.
- **Gestão de Validades:**
  - Status `Vencido`: produtos cuja validade é anterior ao dia de hoje (alerta vermelho).
  - Status `Vencendo em até 7 dias`: produtos próximos do vencimento que devem ser priorizados nas produções da semana (alerta amarelo).
- **Descarte de Lotes com Redução de Estoque:** Ao registrar o descarte de um insumo estragado ou vencido, o sistema reduz o saldo atual do estoque automaticamente com registro de auditoria.

---

## 5. Módulo Comercial: Clientes (`/clientes`)
- **Cadastro:** Nome completo, telefone/celular com formatação brasileira, e-mail, bairro e endereço de entrega.
- **WhatsApp Direto:** Botão para abrir conversa no WhatsApp Web ou aplicativo com 1 clique.
- **Histórico de Encomendas:** Relação de todos os pedidos já feitos pelo cliente com valores e datas.

---

## 6. Pedidos & Orçamentos (`/pedidos`)
- **Ciclo de Vida do Pedido (Status):**
  1. `orcamento`: Orçamento criado, aguardando aprovação do cliente.
  2. `confirmado`: Cliente aprovou e realizou o pagamento do sinal (geralmente 50%).
  3. `producao`: Encomenda enviada para a bancada e forno no Modo Cozinha.
  4. `entregue`: Encomenda finalizada, entregue ao cliente e valor restante quitado.
  5. `cancelado`: Encomenda cancelada.
- **Itens do Pedido:** Suporte a produtos da fábrica por peso (`kg`), volume ou unidade, além de **Itens Extras / Personalizados** (ex: topo de bolo personalizado, vela decorada, caixa de presente, taxa de entrega).
- **Mensagem para WhatsApp:** Botão que gera uma mensagem formatada profissionalmente com resumo do pedido, sinal pago, saldo restante e data de entrega.

---

## 7. Agenda de Entregas & Calendário (`/agenda`)
- **Visão Diária:** Encomendas com entrega prevista para **Hoje**, ordenadas por horário de entrega com status operacional e botão de avanço rápido.
- **Visão de Curto Prazo:** Encomendas de **Amanhã** e dos **Próximos 7 Dias** para planejamento da produção.
- **Calendário Mensal:** Grade visual do mês destacando os dias com maior concentração de entregas para evitar sobrecarga de forno.

---

## 8. Planejamento de Compras Inteligente (`/compras`)
- **Cálculo Automático de Necessidade:** O sistema analisa:
  - Opção A: Insumos necessários para atender **somente as encomendas pendentes** confirmadas na agenda.
  - Opção B: Insumos necessários para **repor o estoque mínimo** de segurança.
  - Opção C: Necessidade unificada (Encomendas + Reposição de Estoque Mínimo).
- **Abatimento do Estoque Atual:** O sistema desconta o que já existe na despensa e gera apenas a quantidade líquida que falta comprar.
- **Lista de Mercado para WhatsApp:** Botão que copia a lista organizada para enviar diretamente ao supermercado ou fornecedor.

---

## 9. Modo Cozinha & Assistente de Preparo (`/producao`)
- **Layout em Tela Dividida (Split Screen):**
  - **Coluna Esquerda (Controle Fixo / Bancada):**
    - Timers ativos apitando em tempo real com barra regressiva e alarme sonoro sintetizado (Web Audio API).
    - Atalhos para eletrodomésticos com modal pop-up: 🔥 **Forno**, ❄️ **Geladeira**, 🥣 **Batedeira**, 🌪️ **Liquidificador**, 🍳 **Fogão** e ⏳ **Descanso**.
    - Painel de **Separação & Pesagem dos Ingredientes** na balança com checklist interativo.
  - **Coluna Direita (Fluxo Culinário do Chef):**
    - Sequência inteligente de misturas estruturada por etapas cronológicas.
    - Cada etapa conecta os **ingredientes específicos** que entram naquela mistura com as quantidades já escalonadas para o lote atual.
    - Indicação do **equipamento** e velocidade necessária.
    - Botão `▶ Disparar Timer` que inicia a contagem no painel lateral ao vivo.
    - Ponto visual esperado e Dica de Ouro do Chef.
- **Finalização & Baixa no Estoque:**
  - Registro do tempo real gasto na cozinha (em minutos).
  - Baixa automática dos ingredientes pesados no catálogo de estoque.
  - Avanço automático da encomenda para `entregue` se vinculada a um pedido.

---

## 10. DoceIA — Assistente Virtual Especializado
- **Escopo e Guardrails:** O assistente responde **exclusivamente** sobre a utilização do sistema DocePreço e tarefas da confeitaria do usuário. Assuntos externos (política, futebol, celebridades, receitas fora da loja) são recusados com gentileza.
- **Auditoria de Estoque em Tempo Real:** O assistente tem visão integral do banco de dados da loja e analisa se uma receita ou lote em preparo possui ingredientes suficientes, detalhando exatamente quanto há no estoque e o que falta comprar.
- **Sessões e Memória Contínua:** Ao clicar em **Encerrar Atendimento**, o assistente sintetiza o diálogo, documenta as lições e usa esse aprendizado nas conversas futuras.
- **Feedback de Qualidade:** O usuário pode avaliar cada resposta com 👍 (útil) ou 👎 (não ajudou), aprimorando continuamente as orientações do agente.
