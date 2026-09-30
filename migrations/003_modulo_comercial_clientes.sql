-- Migração 003: Módulo Comercial - Gestão de Clientes

CREATE TABLE IF NOT EXISTS clientes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  telefone      TEXT,
  email         TEXT,
  endereco      TEXT,
  bairro        TEXT,
  cidade        TEXT,
  observacoes   TEXT,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clientes_usuario ON clientes(usuario_id);
