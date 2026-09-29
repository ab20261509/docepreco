# 🧁 Guia: Site de Precificação para Confeitaria (com Banco SQL e Login)

Este guia transforma a planilha de precificação em um **site com login e banco de dados SQL**. Cada confeiteira cria sua conta, cadastra custos fixos e produtos, e vê o preço de venda calculado automaticamente.

---

## 1. Visão geral

| Aba da planilha | Vira, no site | Tabela SQL |
|---|---|---|
| Custos_Fixos (Parte 1) | Tela "Custos Fixos" | `custos_fixos` + `configuracoes` |
| Produto_N — Ficha Técnica (Parte 2) | Tela "Produto" | `produtos`, `ingredientes`, `complementos` |
| Produto_N — Preço e Lucro (Parte 3) | Bloco de resultado dentro do produto | calculado no código |
| Resumo (Parte 4) | Tela "Painel / Resumo" | calculado no código |
| — | **Login / Cadastro** | `usuarios` |

**Vantagens sobre a planilha:** produtos ilimitados, acesso pelo celular, dados de cada usuária isolados, e o Resumo sempre atualizado.

---

## 2. Escolhas de tecnologia

| Camada | Escolha | Por quê |
|---|---|---|
| Servidor | **Node.js + Express** | Simples e muito documentado |
| Telas | **EJS** (HTML gerado no servidor) | Sem framework de front-end para aprender |
| Banco | **SQLite** (via `better-sqlite3`) | SQL de verdade, sem instalar servidor de banco |
| Senhas | **bcryptjs** | Guarda apenas o hash, nunca a senha |
| Sessão de login | **express-session** com cookie seguro | Padrão do mercado |

> 💡 **Crescendo depois?** O SQL deste guia funciona com poucas mudanças no **PostgreSQL**. Migre quando tiver muitos usuários simultâneos.

---

## 3. Pré-requisitos

- Node.js 20 ou superior (`node -v` para conferir)
- Editor de código (VS Code)
- Git (opcional, mas recomendado)
- Conhecimento básico de terminal

---

## 4. Estrutura de pastas

```
precificacao/
├── package.json
├── schema.sql
├── server.js
├── db.js
├── calculo.js
├── middleware/
│   └── auth.js
├── routes/
│   ├── auth.js
│   ├── custos.js
│   ├── produtos.js
│   └── painel.js
├── views/
│   ├── login.ejs
│   ├── cadastro.ejs
│   ├── painel.ejs
│   ├── custos.ejs
│   ├── produto.ejs
│   └── partials/ (topo.ejs, rodape.ejs)
├── public/
│   └── estilo.css
└── data/            (o arquivo do banco fica aqui — NÃO vai para o Git)
```

---

## 5. Passo 1 — Criar o projeto

```bash
mkdir precificacao && cd precificacao
npm init -y
npm install express ejs better-sqlite3 bcryptjs express-session better-sqlite3-session-store helmet express-rate-limit dotenv
mkdir data middleware routes views views/partials public
```

Crie o arquivo `.gitignore`:

```
node_modules/
data/
.env
```

Crie o arquivo `.env`:

```
SESSION_SECRET=troque-por-uma-frase-longa-e-aleatoria
NODE_ENV=development
```

---

## 6. Passo 2 — Banco de dados (SQL)

Crie o arquivo `schema.sql`:

```sql
-- Usuárias do sistema
CREATE TABLE IF NOT EXISTS usuarios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nome        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  senha_hash  TEXT NOT NULL,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Horas trabalhadas por mês (uma linha por usuária)
CREATE TABLE IF NOT EXISTS configuracoes (
  usuario_id  INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  horas_mes   REAL NOT NULL DEFAULT 160 CHECK (horas_mes > 0)
);

-- Parte 1: custos fixos mensais
CREATE TABLE IF NOT EXISTS custos_fixos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  item          TEXT NOT NULL,
  valor_mensal  REAL NOT NULL DEFAULT 0 CHECK (valor_mensal >= 0)
);

-- Parte 2/3: produtos
CREATE TABLE IF NOT EXISTS produtos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL,
  rendimento      REAL NOT NULL CHECK (rendimento > 0),   -- unidades por lote
  tempo_horas     REAL NOT NULL DEFAULT 0 CHECK (tempo_horas >= 0),
  mao_obra_extra  REAL NOT NULL DEFAULT 0 CHECK (mao_obra_extra >= 0), -- item D
  margem_pct      REAL NOT NULL DEFAULT 40 CHECK (margem_pct >= 0),
  taxas_pct       REAL NOT NULL DEFAULT 5  CHECK (taxas_pct >= 0),
  atualizado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ingredientes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id    INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  qtd_usada     REAL NOT NULL CHECK (qtd_usada >= 0),
  preco_pacote  REAL NOT NULL CHECK (preco_pacote >= 0),
  qtd_pacote    REAL NOT NULL CHECK (qtd_pacote > 0)
);

CREATE TABLE IF NOT EXISTS complementos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id  INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  custo_lote  REAL NOT NULL CHECK (custo_lote >= 0)
);

CREATE INDEX IF NOT EXISTS idx_custos_usuario   ON custos_fixos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_produtos_usuario ON produtos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_ingr_produto     ON ingredientes(produto_id);
CREATE INDEX IF NOT EXISTS idx_comp_produto     ON complementos(produto_id);
```

Crie o arquivo `db.js`:

```js
const fs = require('fs');
const Database = require('better-sqlite3');

const db = new Database('data/confeitaria.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');   // obrigatório no SQLite para respeitar as chaves estrangeiras
db.exec(fs.readFileSync('schema.sql', 'utf8'));

module.exports = db;
```

> ⚠️ **Regra de ouro:** toda tabela de dados da usuária tem `usuario_id` (direto ou via `produto_id`). **Toda consulta deve filtrar por ele**, senão uma usuária pode ver os dados de outra.

---

## 7. Passo 3 — 🔐 Sessão de Login e Cadastro

### 7.1 Como funciona

1. **Cadastro:** a usuária informa nome, e-mail e senha. O sistema guarda o **hash** da senha (bcrypt), nunca a senha em si.
2. **Login:** o sistema compara a senha digitada com o hash. Se bater, cria uma **sessão** e envia um cookie seguro ao navegador.
3. **Páginas protegidas:** um middleware verifica a sessão antes de mostrar qualquer tela de dados.
4. **Logout:** a sessão é destruída.

### 7.2 Configuração do servidor — `server.js`

```js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const helmet = require('helmet');
const db = require('./db');

const app = express();
const producao = process.env.NODE_ENV === 'production';

if (!process.env.SESSION_SECRET) throw new Error('Defina SESSION_SECRET no .env');
if (producao) app.set('trust proxy', 1);   // necessário atrás de proxy HTTPS (Render, Railway, Nginx...)

app.set('view engine', 'ejs');
app.use(helmet());
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));

app.use(session({
  store: new SqliteStore({ client: db }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,                 // JavaScript do navegador não lê o cookie
    sameSite: 'lax',                // reduz risco de CSRF
    secure: producao,               // só HTTPS em produção
    maxAge: 1000 * 60 * 60 * 8      // 8 horas
  }
}));

// Disponibiliza a usuária logada para todas as views
app.use((req, res, next) => {
  res.locals.usuario = req.session.usuario || null;
  next();
});

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/painel'));
app.use('/custos', require('./routes/custos'));
app.use('/produtos', require('./routes/produtos'));

const porta = process.env.PORT || 3000;
app.listen(porta, () => console.log(`Rodando em http://localhost:${porta}`));
```

### 7.3 Middleware de proteção — `middleware/auth.js`

```js
function exigirLogin(req, res, next) {
  if (!req.session.usuario) return res.redirect('/login');
  next();
}
module.exports = { exigirLogin };
```

### 7.4 Rotas de cadastro, login e logout — `routes/auth.js`

```js
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');

const router = express.Router();

// Máximo de 10 tentativas por 15 min por IP (freia adivinhação de senha)
const limiteLogin = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

router.get('/cadastro', (req, res) => res.render('cadastro', { erro: null }));

router.post('/cadastro', limiteLogin, (req, res) => {
  const nome = (req.body.nome || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const senha = req.body.senha || '';

  if (!nome || !/^\S+@\S+\.\S+$/.test(email))
    return res.render('cadastro', { erro: 'Informe nome e um e-mail válido.' });
  if (senha.length < 8)
    return res.render('cadastro', { erro: 'A senha deve ter pelo menos 8 caracteres.' });

  const existe = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
  if (existe) return res.render('cadastro', { erro: 'Não foi possível concluir o cadastro.' });

  const hash = bcrypt.hashSync(senha, 12);
  const info = db.prepare('INSERT INTO usuarios (nome, email, senha_hash) VALUES (?, ?, ?)')
                 .run(nome, email, hash);
  db.prepare('INSERT INTO configuracoes (usuario_id) VALUES (?)').run(info.lastInsertRowid);

  req.session.regenerate(() => {            // nova sessão evita "session fixation"
    req.session.usuario = { id: info.lastInsertRowid, nome };
    res.redirect('/');
  });
});

router.get('/login', (req, res) => res.render('login', { erro: null }));

router.post('/login', limiteLogin, (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const senha = req.body.senha || '';
  const u = db.prepare('SELECT id, nome, senha_hash FROM usuarios WHERE email = ?').get(email);

  // Mensagem genérica: não revela se o e-mail existe
  if (!u || !bcrypt.compareSync(senha, u.senha_hash))
    return res.status(401).render('login', { erro: 'E-mail ou senha incorretos.' });

  req.session.regenerate(() => {
    req.session.usuario = { id: u.id, nome: u.nome };
    res.redirect('/');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
```

### 7.5 Telas — `views/login.ejs`

```html
<%- include('partials/topo') %>
<main class="cartao">
  <h1>Entrar</h1>
  <% if (erro) { %><p class="erro"><%= erro %></p><% } %>
  <form method="POST" action="/login">
    <label>E-mail <input type="email" name="email" required autocomplete="email"></label>
    <label>Senha <input type="password" name="senha" required autocomplete="current-password"></label>
    <button type="submit">Entrar</button>
  </form>
  <p>Ainda não tem conta? <a href="/cadastro">Cadastre-se</a></p>
</main>
<%- include('partials/rodape') %>
```

`views/cadastro.ejs` segue o mesmo modelo, com os campos **nome**, **e-mail** e **senha** (`autocomplete="new-password"`), enviando para `POST /cadastro`.

> Use sempre `<%= %>` (com escape) e nunca `<%- %>` para exibir dados digitadas pela usuária, evitando ataques XSS.

### 7.6 Checklist do login

- [ ] Senha guardada só como hash (bcrypt, custo 12)
- [ ] Sessão regenerada após login e cadastro
- [ ] Cookie com `httpOnly`, `sameSite` e `secure` (em produção)
- [ ] Limite de tentativas em `/login` e `/cadastro`
- [ ] Mensagem de erro genérica no login
- [ ] `logout` via `POST`, destruindo a sessão
- [ ] Todas as rotas de dados protegidas com `exigirLogin`

---

## 8. Passo 4 — Regras de cálculo (as fórmulas da planilha)

Crie `calculo.js`. Ele reproduz **exatamente** a lógica da planilha:

```js
// Custo fixo por hora = total de custos fixos ÷ horas trabalhadas por mês
function custoFixoHora(totalFixos, horasMes) {
  return horasMes > 0 ? totalFixos / horasMes : 0;
}

function calcularProduto(p, ingredientes, complementos, cfHora) {
  // A: ingredientes — Qtd usada ÷ Qtd do pacote × Preço do pacote
  const A = ingredientes.reduce((s, i) => s + (i.qtd_usada / i.qtd_pacote) * i.preco_pacote, 0);
  // B: complementos (embalagem, descartáveis)
  const B = complementos.reduce((s, c) => s + c.custo_lote, 0);
  // C: custo fixo alocado = tempo × custo fixo/hora
  const C = p.tempo_horas * cfHora;
  // D: mão de obra separada (deixe 0 se o salário já está nos custos fixos)
  const D = p.mao_obra_extra;

  const custoLote = A + B + C + D;
  const custoUnit = custoLote / p.rendimento;

  // Fator = 1 − (margem% + taxas%) ; preço = custo unitário ÷ fator
  const fator = 1 - (p.margem_pct + p.taxas_pct) / 100;
  if (fator <= 0) throw new Error('Margem + taxas precisam somar menos de 100%.');

  const preco = custoUnit / fator;
  const lucroUnit = preco - custoUnit;

  return {
    A, B, C, D, custoLote, custoUnit, fator, preco,
    lucroUnit,
    lucroLote: lucroUnit * p.rendimento,
    percLucro: lucroUnit / preco          // % sobre o preço de venda
  };
}

module.exports = { custoFixoHora, calcularProduto };
```

**Teste com o exemplo da planilha** (brigadeiro gourmet, 30 unidades, custos fixos de R$ 3.310 e 160 h):

| Item | Valor esperado |
|---|---|
| Custo fixo/hora | R$ 20,69 |
| Custo por unidade | R$ 2,28 |
| Preço sugerido (40% + 5%) | R$ 4,14 |
| Lucro por unidade | R$ 1,86 |
| % de lucro | 45,0% |

Se o código reproduzir esses números, o cálculo está fiel à planilha.

---

## 9. Passo 5 — Rotas e telas

| Rota | Função | Protegida |
|---|---|---|
| `GET /login`, `POST /login` | Entrar | Não |
| `GET /cadastro`, `POST /cadastro` | Criar conta | Não |
| `POST /logout` | Sair | Sim |
| `GET /` | Painel/Resumo (Parte 4) | Sim |
| `GET /custos`, `POST /custos` | Custos fixos + horas/mês (Parte 1) | Sim |
| `GET /produtos/novo`, `POST /produtos` | Criar produto | Sim |
| `GET /produtos/:id` | Ver ficha + preço (Partes 2 e 3) | Sim |
| `POST /produtos/:id` | Editar produto, ingredientes, complementos | Sim |
| `POST /produtos/:id/excluir` | Excluir produto | Sim |

### Exemplo: painel/resumo — `routes/painel.js`

```js
const express = require('express');
const db = require('../db');
const { exigirLogin } = require('../middleware/auth');
const { custoFixoHora, calcularProduto } = require('../calculo');

const router = express.Router();

router.get('/', exigirLogin, (req, res) => {
  const uid = req.session.usuario.id;

  const total = db.prepare('SELECT COALESCE(SUM(valor_mensal),0) AS t FROM custos_fixos WHERE usuario_id = ?').get(uid).t;
  const horas = db.prepare('SELECT horas_mes FROM configuracoes WHERE usuario_id = ?').get(uid).horas_mes;
  const cfHora = custoFixoHora(total, horas);

  const produtos = db.prepare('SELECT * FROM produtos WHERE usuario_id = ? ORDER BY nome').all(uid);
  const resumo = produtos.map(p => {
    const ing  = db.prepare('SELECT * FROM ingredientes WHERE produto_id = ?').all(p.id);
    const comp = db.prepare('SELECT * FROM complementos WHERE produto_id = ?').all(p.id);
    return { produto: p, ...calcularProduto(p, ing, comp, cfHora) };
  });

  res.render('painel', { resumo, cfHora });
});

module.exports = router;
```

### Proteção contra acesso a dados alheios (exemplo em `routes/produtos.js`)

```js
router.get('/:id', exigirLogin, (req, res) => {
  const produto = db.prepare('SELECT * FROM produtos WHERE id = ? AND usuario_id = ?')
                    .get(req.params.id, req.session.usuario.id);   // <- filtro por usuária
  if (!produto) return res.status(404).send('Produto não encontrado');
  // ...carregar ingredientes/complementos, calcular e renderizar
});
```

> Sempre use **consultas parametrizadas** (`?`). Nunca monte SQL concatenando texto digitado pela usuária (evita SQL Injection).

---

## 10. Passo 6 — Telas (layout)

- **Painel:** tabela idêntica à Parte 4 (Produto, Custo/unid, Preço, Lucro/unid, % Lucro, Lucro/lote) e o custo fixo/hora no topo.
- **Custos Fixos:** lista editável com valor mensal, total e campo "horas por mês". Já venha com os itens padrão (aluguel, água, energia, gás, internet, limpeza, salário, equipamentos, outros) criados no cadastro.
- **Produto:** formulário com nome, rendimento, tempo; tabela de ingredientes (adicionar/remover linhas); complementos; margem e taxas; e, à direita/abaixo, o **resultado ao vivo** (custo por unidade, preço sugerido, lucro).
- **Mobile primeiro:** use `<meta name="viewport" content="width=device-width, initial-scale=1">` e tabelas dentro de um container com `overflow-x: auto`.

**Dica:** para os itens padrão de custos fixos, no `POST /cadastro`, após criar a usuária, insira as 9 linhas com valor 0.

---

## 11. Passo 7 — Segurança (revisão obrigatória)

| Risco | Proteção |
|---|---|
| Senha vazada | Hash bcrypt; nunca registrar senhas em logs |
| Adivinhação de senha | `express-rate-limit` no login e cadastro |
| Roubo de sessão | Cookie `httpOnly` + `secure` + HTTPS |
| SQL Injection | Consultas parametrizadas (`?`) |
| XSS | EJS com `<%= %>` (escape automático) + `helmet` |
| Acesso a dados de outra usuária | Filtro `usuario_id` em **toda** consulta |
| CSRF | `sameSite: 'lax'`; para reforçar, adicione tokens CSRF em formulários (ex.: pacote `csrf-csrf`) |
| Validação | Validar números no servidor (positivos; margem + taxas < 100%) |
| Segredos | `SESSION_SECRET` só no `.env`, fora do Git |

**LGPD:** você guarda nome e e-mail. Publique uma política de privacidade simples e ofereça a opção de **excluir a conta** (o `ON DELETE CASCADE` apaga todos os dados dela).

---

## 12. Passo 8 — Testar

1. `node server.js` e acesse `http://localhost:3000`.
2. Cadastre-se, faça logout e login de novo.
3. Cadastre os custos fixos e o brigadeiro do exemplo; confira se os números batem com a tabela do Passo 4.
4. **Teste de isolamento:** crie duas contas e confirme que uma não abre `/produtos/ID` da outra.
5. Tente uma senha errada 11 vezes e confirme o bloqueio temporário.
6. Tente margem 70% + taxas 30%: o sistema deve recusar.

---

## 13. Passo 9 — Publicar (deploy)

1. Suba o código para um repositório Git (sem `.env` e sem `data/`).
2. Escolha uma hospedagem com suporte a Node.js (Render, Railway, Fly.io ou um VPS).
3. Configure as variáveis: `NODE_ENV=production`, `SESSION_SECRET` e, se necessário, `PORT`.
4. **Disco persistente:** o SQLite grava em arquivo, então a hospedagem precisa de um volume que sobreviva a reinícios. Sem isso, você perde os dados a cada deploy. Se não houver, use PostgreSQL gerenciado.
5. Ative **HTTPS** (a maioria das hospedagens faz isso automaticamente) e, se quiser, aponte um domínio próprio.
6. Configure **backup automático** do arquivo `data/confeitaria.db` (cópia diária para outro local).

> Confira os planos e limites atuais de cada hospedagem antes de escolher, pois mudam com frequência.

---

## 14. Próximos passos (roadmap)

- [ ] Recuperação de senha por e-mail
- [ ] Exportar o resumo para Excel/PDF
- [ ] Histórico de preços dos ingredientes (para ver quanto subiu)
- [ ] Ingredientes reutilizáveis entre produtos (cadastro único de insumos)
- [ ] Alerta quando o custo de um ingrediente mudar e o preço do produto ficar defasado
- [ ] Gráficos de lucro por produto
- [ ] Migração para PostgreSQL

---

## 15. Checklist final

- [ ] Projeto criado e dependências instaladas
- [ ] `schema.sql` aplicado e `foreign_keys = ON`
- [ ] Cadastro, login e logout funcionando
- [ ] Todas as rotas de dados exigem login e filtram por `usuario_id`
- [ ] Cálculo confere com a planilha (tabela do Passo 4)
- [ ] Painel mostra o resumo de todos os produtos
- [ ] Segurança do Passo 7 revisada
- [ ] HTTPS ativo, disco persistente e backup configurados

---

*Guia baseado na planilha de precificação para confeitaria (Custos Fixos → Ficha Técnica → Preço de Venda → Resumo).*
