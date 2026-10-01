-- Migração 012: Garantir a existência do usuário Master padrão e permissões master
INSERT INTO usuarios (nome, email, senha_hash, perfil, status)
VALUES ('Administrador Master', 'admin@docepreco.com', '$2a$10$KJEX02B58EN0aXOk2huva.QekSU2PIdLJFdq8wM10fwJMdbsG4ZZu', 'master', 'ativo')
ON CONFLICT(email) DO UPDATE SET
  perfil = 'master',
  status = 'ativo',
  senha_hash = '$2a$10$KJEX02B58EN0aXOk2huva.QekSU2PIdLJFdq8wM10fwJMdbsG4ZZu';

UPDATE usuarios SET perfil = 'master' WHERE email = 'antonybr@live.com';
