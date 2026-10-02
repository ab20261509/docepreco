require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const db = require('./db');

const app = express();
const producao = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);
const sessionSecret = process.env.SESSION_SECRET || 'confeitaria_super_secreta_padrao_2026';

if (producao || process.env.RENDER) {
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
  store: db.createSessionStore(session),
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
app.use(async (req, res, next) => {
  res.locals.usuario = req.session.usuario || null;
  res.locals.formatMoney = (val) => {
    const num = Number(val) || 0;
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };
  res.locals.formatPercent = (val) => {
    const num = Number(val) || 0;
    return (num * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  };

  // Carregar banner de aviso global se configurado
  try {
    const avisoRow = await db.get("SELECT valor FROM configuracoes_globais WHERE chave = 'aviso_geral_banner'");
    res.locals.avisoGeralBanner = avisoRow && avisoRow.valor ? avisoRow.valor : '';
    const nomeSisRow = await db.get("SELECT valor FROM configuracoes_globais WHERE chave = 'nome_sistema'");
    res.locals.nomeSistema = nomeSisRow && nomeSisRow.valor ? nomeSisRow.valor : 'DocePreço';
  } catch (_) {
    res.locals.avisoGeralBanner = '';
    res.locals.nomeSistema = 'DocePreço';
  }

  next();
});

// Middleware de Permissões Granulares por Módulo (RBAC)
app.use(require('./middleware/auth').carregarPermissoes);

// Rotas do sistema
app.use('/', require('./routes/auth'));
app.use('/master', require('./routes/master'));
app.use('/', require('./routes/painel'));
app.use('/custos', require('./routes/custos'));
app.use('/produtos', require('./routes/produtos'));
app.use('/ingredientes', require('./routes/ingredientes'));
app.use('/clientes', require('./routes/clientes'));
app.use('/pedidos', require('./routes/pedidos'));
app.use('/agenda', require('./routes/agenda'));
app.use('/compras', require('./routes/compras').router);
app.use('/producao', require('./routes/producao'));
app.use('/assistente', require('./routes/assistente'));
app.use('/onboarding', require('./routes/onboarding'));

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

async function iniciarServidor() {
  try {
    await db.rodarMigracoes();
    console.log('✅ Banco de dados sincronizado e migrações aplicadas com sucesso.');
  } catch (err) {
    console.error('❌ Erro ao rodar migrações:', err);
  }

  const porta = process.env.PORT || 3000;
  const host = process.env.HOST || '0.0.0.0';
  app.listen(porta, host, () => {
    console.log(`🧁 Confeitaria rodando em http://${host}:${porta}`);
  });
}

if (require.main === module) {
  iniciarServidor();
}
