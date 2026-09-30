# Doce Preço 🧁 — Sistema de Precificação e Gestão para Confeitaria

Sistema completo para confeiteiras gerenciarem sua precificação, fichas técnicas, controle de estoque de insumos com validade, custos fixos, clientes, orçamentos, agenda de entregas e lista inteligente de compras.

## 🚀 Como Executar Localmente

1. Clone o repositório:
```bash
git clone https://github.com/ab20261509/docepreco.git
cd docepreco
```

2. Instale as dependências:
```bash
npm install
```

3. Configure o arquivo .env:
```bash
cp .env.example .env
```

4. Execute os testes automatizados:
```bash
npm test
```

5. Inicie a aplicação:
```bash
npm start
```
Acesse em: **http://localhost:3000**

---

## ☁️ Deploy no Render.com (com Disco Persistente & Migrações)

O **Doce Preço** foi arquitetado para rodar no [Render.com](https://render.com) com persistência permanente de dados e migrações versionadas automáticas.

### Passo a Passo no Render:

1. **Crie um novo Web Service**:
   - Conecte seu repositório do GitHub: `https://github.com/ab20261509/docepreco`.
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

2. **Adicione um Disco Persistente (Persistent Disk)**:
   - No menu do seu serviço no Render, vá em **Disks** ➔ **Add Disk**.
   - **Name**: `confeitaria-data`
   - **Mount Path**: `/data`
   - **Size**: 1 GB (mais que suficiente para centenas de milhares de registros).

3. **Configure as Variáveis de Ambiente (Environment Variables)**:
   - `DATA_DIR`: `/data` (faz o banco SQLite gravar diretamente no disco persistente).
   - `SESSION_SECRET`: Uma frase longa e aleatória para segurança das sessões.
   - `NODE_ENV`: `production`

4. **Como funcionam as atualizações e novos commits**:
   - Toda vez que você enviar melhorias (`git push`), o Render compila e sobe a nova versão do código.
   - O disco montado em `/data` **permanece 100% intacto**, mantendo todos os seus produtos, receitas, clientes e pedidos salvos.
   - O **Sistema de Migrações Versionadas** (`migrations/`) detecta automaticamente novas tabelas ou colunas e as aplica com segurança sem nunca resetar nem recriar o seu banco de dados.
