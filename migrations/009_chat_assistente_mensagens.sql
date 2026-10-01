-- Migração 009: Tabela para histórico de mensagens e respostas do assistente inteligente
CREATE TABLE IF NOT EXISTS chat_mensagens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  papel      TEXT NOT NULL,
  conteudo   TEXT NOT NULL,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_usuario ON chat_mensagens(usuario_id);
