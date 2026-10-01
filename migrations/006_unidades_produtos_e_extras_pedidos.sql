-- Migração 006: Unidades de Medida de Produtos e Gestão de Itens Extras/Personalizados nos Pedidos

-- 1. Adicionar unidade à tabela de produtos (padrão 'un')
ALTER TABLE produtos ADD COLUMN unidade TEXT NOT NULL DEFAULT 'un';

-- 2. Adicionar unidade à tabela de pedido_itens (padrão 'un')
ALTER TABLE pedido_itens ADD COLUMN unidade TEXT NOT NULL DEFAULT 'un';

-- 3. Adicionar tipo_item à tabela de pedido_itens ('produto', 'avulso', 'extra')
ALTER TABLE pedido_itens ADD COLUMN tipo_item TEXT NOT NULL DEFAULT 'produto';

-- 4. Adicionar item_pai_id à tabela de pedido_itens para vincular extras ao produto fabricado
ALTER TABLE pedido_itens ADD COLUMN item_pai_id INTEGER REFERENCES pedido_itens(id) ON DELETE CASCADE;

-- 5. Índices de performance
CREATE INDEX IF NOT EXISTS idx_pedido_itens_pai ON pedido_itens(item_pai_id);
CREATE INDEX IF NOT EXISTS idx_pedido_itens_tipo ON pedido_itens(tipo_item);
