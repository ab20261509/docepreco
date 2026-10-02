-- Migração 013: Tabela de Controle de Onboardings e Guias por Usuário
CREATE TABLE IF NOT EXISTS usuario_onboardings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  modulo TEXT NOT NULL, -- 'geral', 'custos', 'ingredientes', 'produtos', 'pedidos'
  status TEXT NOT NULL DEFAULT 'pendente', -- 'pendente', 'concluido', 'dispensado'
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(usuario_id, modulo)
);

CREATE INDEX IF NOT EXISTS idx_usuario_onboardings_uid ON usuario_onboardings(usuario_id);
