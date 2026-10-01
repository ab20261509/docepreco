-- Migração 008: Adiciona campo modo_preparo para inteligência culinária e persistência de passos
ALTER TABLE produtos ADD COLUMN modo_preparo TEXT;
