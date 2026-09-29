# Doce Preço 🧁 — Sistema de Precificação e Gestão para Confeitaria

Sistema completo para confeiteiras gerenciarem sua precificação, fichas técnicas, controle de estoque de insumos com validade, custos fixos e clientes.

## 🚀 Como Executar Localmente

1. Clone o repositório:
`ash
git clone https://github.com/ab20261509/DocePreco.git
cd DocePreco
`

2. Instale as dependências:
`ash
npm install
`

3. Configure o arquivo .env:
`ash
cp .env.example .env
`

4. Execute os testes automatizados:
`ash
npm test
`

5. Inicie a aplicação:
`ash
npm start
`
Acesse em: **http://localhost:3000**

---

## ☁️ Instruções para Deploy

### Opção 1: Vercel (Configurado)
O projeto inclui ercel.json e pi/index.js para execução como Serverless Function.

> ⚠️ **Atenção sobre SQLite na Vercel**: 
> A Vercel opera em arquitetura **Serverless** (funções efêmeras sem disco persistente). O banco SQLite local no /tmp é recriado a cada reinicialização da função, o que significa que cadastros de novos produtos e clientes não persistem permanentemente entre reinicializações na Vercel. 
> Para persistência permanente na nuvem, recomendamos a **Opção 2 (Render/Railway)** ou conectar a um banco serverless externo como **Turso (libSQL)** ou **Neon/Supabase**.

### Opção 2: Render.com ou Railway (Recomendado para SQLite com Disco Persistente)
Essas plataformas executam Node.js continuamente com suporte a disco persistente, mantendo o banco SQLite e todos os dados intactos:
1. Conecte o repositório no [Render.com](https://render.com) como **Web Service**.
2. Build Command: 
pm install
3. Start Command: 
pm start
4. Adicione um Persistent Disk apontando para /data.
