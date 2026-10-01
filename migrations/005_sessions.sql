-- Migração 005: Armazenamento persistente de sessões de login

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expire TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);
