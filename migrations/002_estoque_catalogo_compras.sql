-- Migração 002: Catálogo de Insumos e Histórico de Compras com Validade

CREATE TABLE IF NOT EXISTS ingredientes_catalogo (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id            INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nome                  TEXT NOT NULL,
  unidade               TEXT NOT NULL DEFAULT 'g' CHECK (unidade IN ('g', 'ml', 'un')),
  estoque_atual         REAL NOT NULL DEFAULT 0 CHECK (estoque_atual >= 0),
  estoque_minimo        REAL NOT NULL DEFAULT 0 CHECK (estoque_minimo >= 0),
  preco_atual           REAL NOT NULL DEFAULT 0 CHECK (preco_atual >= 0),
  qtd_embalagem_padrao  REAL NOT NULL DEFAULT 1 CHECK (qtd_embalagem_padrao > 0),
  atualizado_em         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ingredientes_compras (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  ingrediente_id          INTEGER NOT NULL REFERENCES ingredientes_catalogo(id) ON DELETE CASCADE,
  usuario_id              INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  data_compra             TEXT NOT NULL DEFAULT (date('now')),
  data_validade           TEXT NULL,
  qtd_embalagens          REAL NOT NULL CHECK (qtd_embalagens > 0),
  qtd_por_embalagem       REAL NOT NULL CHECK (qtd_por_embalagem > 0),
  valor_unitario_embalagem REAL NOT NULL CHECK (valor_unitario_embalagem >= 0),
  valor_total             REAL NOT NULL CHECK (valor_total >= 0),
  status                  TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'descartado', 'utilizado')),
  motivo_baixa            TEXT NULL,
  criado_em               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cat_ingr_usuario    ON ingredientes_catalogo(usuario_id);
CREATE INDEX IF NOT EXISTS idx_compras_ingrediente ON ingredientes_compras(ingrediente_id);
CREATE INDEX IF NOT EXISTS idx_compras_usuario     ON ingredientes_compras(usuario_id);
