-- Migração 007: Módulo de Produção & Assistente de Cozinha (Histórico de Preparos e Timers)

CREATE TABLE IF NOT EXISTS producoes (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id            INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  produto_id            INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
  pedido_id             INTEGER REFERENCES pedidos(id) ON DELETE SET NULL,
  nome_receita          TEXT NOT NULL,
  quantidade_produzida  REAL NOT NULL DEFAULT 1,
  unidade               TEXT NOT NULL DEFAULT 'un',
  tempo_estimado_min    REAL NOT NULL DEFAULT 0,
  tempo_real_min        REAL DEFAULT NULL,
  status                TEXT NOT NULL DEFAULT 'em_preparo' CHECK (status IN ('em_preparo', 'concluido', 'cancelado')),
  observacoes           TEXT,
  iniciado_em           TEXT NOT NULL DEFAULT (datetime('now')),
  concluido_em          TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_producoes_usuario ON producoes(usuario_id);
CREATE INDEX IF NOT EXISTS idx_producoes_produto ON producoes(produto_id);
CREATE INDEX IF NOT EXISTS idx_producoes_pedido  ON producoes(pedido_id);
CREATE INDEX IF NOT EXISTS idx_producoes_status  ON producoes(status);
