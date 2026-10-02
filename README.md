# DocePreço 🧁 — Sistema de Gestão & Precificação para Confeitaria

[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.21-lightgrey.svg)](https://expressjs.com)
[![libSQL / Turso](https://img.shields.io/badge/Database-libSQL%20%7C%20Turso-blue.svg)](https://turso.tech)
[![Tests](https://img.shields.io/badge/Tests-16%20Passing%20(100%25)-brightgreen.svg)]()
[![Gemini AI](https://img.shields.io/badge/AI-Google%20Gemini-orange.svg)](https://ai.google.dev)

O **DocePreço** é uma solução completa desenvolvida sob medida para confeiteiras, docerias artesanais e ateliês de bolos. O sistema profissionaliza toda a jornada da confeitaria: desde o cálculo preciso do custo por hora e margem de lucro real até a gestão de compras, controle de estoque com validade, modo cozinha guiado e atendimento com inteligência artificial.

📖 **Consulte a documentação completa**: [DOCUMENTACAO_COMPLETA.md](./DOCUMENTACAO_COMPLETA.md)

---

## 🌟 Principais Recursos

- 🏢 **Custos Fixos & Mão de Obra**: Rateio proporcional das despesas mensais e cálculo exato do custo por hora trabalhada (`cfHora`).
- 🥣 **Insumos & Controle de Estoque com Validade**: Histórico de compras, preço por grama/ml, alertas de lotes vencidos e a vencer nos próximos 7 dias, e importador/exportador de planilhas Excel (`.xlsx`).
- 🎂 **Fichas Técnicas & Precificação Inteligente**: Cálculo do custo do lote, custo por unidade e preço de venda sugerido com margem de lucro líquida garantida.
- 👥 **Módulo Comercial (Clientes)**: Gestão de clientes com endereços e início de conversa no WhatsApp em 1 clique.
- 🛍️ **Pedidos, Orçamentos & Propostas**: Suporte a produtos por peso/fatia, extras personalizados aninhados, controle de sinal pago e gerador de mensagem profissional para WhatsApp.
- 📅 **Agenda de Entregas & Calendário**: Cronograma diário (Hoje / Amanhã), carga semanal, calendário mensal e apuração de saldos pendentes.
- 🛒 **Planejamento & Compras Inteligente**: Leitura automática de encomendas confirmadas, cálculo de insumos necessários, geração de lista de mercado para WhatsApp e baixa atômica no estoque.
- 🍳 **Modo Cozinha & Produção**: Escalonamento proporcional de receitas, pesagem guiada de insumos, timers sonoros múltiplos e sequenciamento de misturas.
- 💬 **DoceIA (Assistente Virtual)**: Inteligência artificial baseada no Manual Oficial do Sistema, auditoria de estoque em tempo real, feedbacks (👍/👎), consolidação de aprendizado contínuo e drawer flutuante no canto da tela.
- 🛡️ **Painel de Controle Master & RBAC Granular**: Controle administrativo com métricas globais 360°, gestão de perfis (`master` / `confeiteiro`), suspensão de contas, redefinição de senhas, configurações globais e matriz com 4 ações granulares por módulo.
- 🎓 **Onboarding & Trilha Guiada de Primeiros Passos**: Checklist interativo em 4 passos na Página Inicial com apuração automática de progresso (0% a 100%), modal de boas-vindas e ferramenta exclusiva para o Master **reativar ou reiniciar guias** para qualquer confeiteiro.

---

## 🚀 Como Executar Localmente

### Pré-requisitos
- Node.js 20 ou superior
- Git

### Passo a Passo:
```bash
# 1. Clone o repositório
git clone https://github.com/ab20261509/docepreco.git
cd docepreco

# 2. Instale as dependências
npm install

# 3. Configure as variáveis de ambiente
cp .env.example .env

# 4. Execute a suíte de testes automatizados (16 suítes)
npm test

# 5. Inicie o servidor
npm start
```
Acesse a aplicação no seu navegador: **http://localhost:3000**

---

## 🔑 Credenciais Padrão Inicializadas

- **Usuário Master (Administrador)**: `admin@docepreco.com` | Senha: `Admin123@#`
- **Usuário Confeiteiro**: `antonybr@live.com` | Senha: `Admin123@#`

*(Você também pode utilizar o botão "Criar Conta" na tela inicial para registrar uma nova confeitaria).*

---

## ☁️ Deploy no Render.com

O **DocePreço** está preparado para deploy no [Render.com](https://render.com) com persistência permanente e migrações versionadas:

1. **Crie um Web Service** apontando para o seu repositório no GitHub.
2. **Build Command**: `npm install`
3. **Start Command**: `npm start`
4. **Adicione um Disco Persistente**:
   - Menu **Disks** ➔ **Add Disk**
   - **Name**: `confeitaria-data`
   - **Mount Path**: `/data`
   - **Size**: 1 GB
5. **Variáveis de Ambiente Recomendadas**:
   - `DATA_DIR`: `/data` (faz o SQLite gravar no disco persistente)
   - `SESSION_SECRET`: Chave secreta longa para sessões
   - `NODE_ENV`: `production`
   - `GEMINI_API_KEY`: *(Opcional)* Chave de API do Google Gemini para recursos avançados de IA
   - `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN`: *(Opcional)* Se desejar utilizar o banco de dados Turso na nuvem.

O servidor vincula-se explicitamente a `0.0.0.0` e ativa o trust proxy automaticamente para evitar o erro `502 Bad Gateway`.

---

## 🧪 Qualidade & Testes Automatizados

O sistema conta com **16 suítes de testes automatizados** cobrindo todos os módulos:

```bash
npm test
```

- `calculo.test.js` — Cálculos matemáticos de custo/hora, lote, margem e preço sugerido.
- `integration.test.js` — Isolamento multi-tenant entre diferentes contas.
- `excel.test.js` — Importação e exportação de planilhas Excel.
- `estoque.test.js` — Movimentações de estoque e histórico de compras.
- `validade.test.js` — Gestão de validade e descarte de insumos.
- `edicao_compras.test.js` — Atualização de preços e recalculo.
- `clientes.test.js` — Higienização de WhatsApp e dados de clientes.
- `pedidos.test.js` — Orçamentos, produtos por peso e extras aninhados.
- `agenda.test.js` — Agrupamento diário, semanal e calendário.
- `compras.test.js` — Planejamento de compras para encomendas e baixa atômica.
- `migrations.test.js` — Idempotência e integridade das 13 migrações versionadas.
- `inicio.test.js` — KPIs da Página Inicial e painel de precificação.
- `producao.test.js` — Modo Cozinha, pesagem guiada, timers e heurística culinária.
- `assistente.test.js` — Guardrails da DoceIA, auditoria de estoque e aprendizado contínuo.
- `master.test.js` — Painel Master, RBAC granular, bloqueios e configurações globais.
- `onboarding.test.js` — Régua de progresso em 4 passos e reativação de guias pelo Master.

---

## 📄 Licença

Distribuído sob a licença ISC. Consulte `LICENSE` para mais detalhes.
