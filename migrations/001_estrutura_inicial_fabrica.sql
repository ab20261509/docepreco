-- Migração 001: Estrutura Inicial da Fábrica (Usuários, Custos Fixos e Produtos)

CREATE TABLE IF NOT EXISTS usuarios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nome        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  senha_hash  TEXT NOT NULL,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS configuracoes (
  usuario_id  INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  horas_mes   REAL NOT NULL DEFAULT 160 CHECK (horas_mes > 0)
);

CREATE TABLE IF NOT EXISTS custos_fixos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  item          TEXT NOT NULL,
  valor_mensal  REAL NOT NULL DEFAULT 0 CHECK (valor_mensal >= 0)
);

CREATE TABLE IF NOT EXISTS produtos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL,
  rendimento      REAL NOT NULL CHECK (rendimento > 0),
  tempo_horas     REAL NOT NULL DEFAULT 0 CHECK (tempo_horas >= 0),
  mao_obra_extra  REAL NOT NULL DEFAULT 0 CHECK (mao_obra_extra >= 0),
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
