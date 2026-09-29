require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const helmet = require('helmet');
const db = require('./db');

const app = express();
const producao = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
const sessionSecret = process.env.SESSION_SECRET || 'confeitaria_super_secreta_padrao_2026';

if (producao) {
  app.set('trust proxy', 1);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Configuração do Helmet com CSP amigável a estilos/fontes e scripts inline de cálculo
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"]
    }
  }
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SqliteStore({ client: db }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: producao,
    maxAge: 1000 * 60 * 60 * 8 // 8 horas
  }
}));

// Disponibiliza o usuário logado e utilitários de formatação para todas as views
app.use((req, res, next) => {
  res.locals.usuario = req.session.usuario || null;
  res.locals.formatMoney = (val) => {
    const num = Number(val) || 0;
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };
  res.locals.formatPercent = (val) => {
    const num = Number(val) || 0;
    return (num * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  };
  next();
});

// Rotas do sistema
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/painel'));
app.use('/custos', require('./routes/custos'));
app.use('/produtos', require('./routes/produtos'));
app.use('/ingredientes', require('./routes/ingredientes'));
app.use('/clientes', require('./routes/clientes'));

// Rota 404
app.use((req, res) => {
  res.status(404).render('erro_404', {
    mensagem: 'Página não encontrada.',
    activeNav: ''
  });
});

// Middleware de tratamento global de erro
app.use((err, req, res, next) => {
  console.error('Erro na aplicação:', err);
  res.status(500).send('Ocorreu um erro no servidor. Tente novamente mais tarde.');
});

module.exports = app;

function encerrarGracioso() {
  try {
    if (db && typeof db.close === 'function') {
      db.close();
    }
  } catch (_) {}
  process.exit(0);
}

process.on('SIGINT', encerrarGracioso);
process.on('SIGTERM', encerrarGracioso);

if (!process.env.VERCEL) {
  const porta = process.env.PORT || 3000;
  app.listen(porta, () => {
    console.log(`🧁 Confeitaria rodando em http://localhost:${porta}`);
  });
}
