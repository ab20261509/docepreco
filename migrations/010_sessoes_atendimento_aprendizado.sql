-- Migração 010: Sessões de atendimento e aprendizado contínuo com feedback do assistente
CREATE TABLE IF NOT EXISTS chat_sessoes (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id          INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo              TEXT,
  status              TEXT NOT NULL DEFAULT 'aberta', -- 'aberta', 'encerrada'
  aprendizado_resumo  TEXT,
  iniciada_em         TEXT NOT NULL DEFAULT (datetime('now')),
  encerrada_em        TEXT
);

CREATE INDEX IF NOT EXISTS idx_chat_sessoes_usuario ON chat_sessoes(usuario_id);

ALTER TABLE chat_mensagens ADD COLUMN sessao_id INTEGER REFERENCES chat_sessoes(id) ON DELETE CASCADE;
ALTER TABLE chat_mensagens ADD COLUMN feedback INTEGER DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_msg_sessao ON chat_mensagens(sessao_id);
