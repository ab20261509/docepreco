-- Migração 011: Perfil Master, Configurações Globais e Controle Granular de Permissões (RBAC)

ALTER TABLE usuarios ADD COLUMN perfil TEXT NOT NULL DEFAULT 'confeiteiro';
ALTER TABLE usuarios ADD COLUMN status TEXT NOT NULL DEFAULT 'ativo';

CREATE INDEX IF NOT EXISTS idx_usuarios_perfil ON usuarios(perfil);
CREATE INDEX IF NOT EXISTS idx_usuarios_status ON usuarios(status);

CREATE TABLE IF NOT EXISTS permissoes_usuario (
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  modulo        TEXT NOT NULL,
  pode_ver      INTEGER NOT NULL DEFAULT 1,
  pode_criar    INTEGER NOT NULL DEFAULT 1,
  pode_editar   INTEGER NOT NULL DEFAULT 1,
  pode_excluir  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (usuario_id, modulo)
);

CREATE INDEX IF NOT EXISTS idx_permissoes_usuario_mod ON permissoes_usuario(usuario_id, modulo);

CREATE TABLE IF NOT EXISTS configuracoes_globais (
  chave         TEXT PRIMARY KEY,
  valor         TEXT NOT NULL,
  descricao     TEXT,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO configuracoes_globais (chave, valor, descricao) VALUES ('nome_sistema', 'DocePreço', 'Nome exibido no cabeçalho e relatórios');
INSERT OR IGNORE INTO configuracoes_globais (chave, valor, descricao) VALUES ('modo_manutencao', '0', 'Bloqueia acesso geral exceto Master');
INSERT OR IGNORE INTO configuracoes_globais (chave, valor, descricao) VALUES ('permite_cadastros', '1', 'Permite que novos usuários criem conta pública');
INSERT OR IGNORE INTO configuracoes_globais (chave, valor, descricao) VALUES ('aviso_geral_banner', '', 'Banner exibido no topo para todas as confeitarias');
INSERT OR IGNORE INTO configuracoes_globais (chave, valor, descricao) VALUES ('gemini_api_key_global', '', 'Chave de API do Google Gemini para a DoceIA');
