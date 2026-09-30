-- Migração 004: Módulo Comercial - Gestão de Pedidos e Orçamentos

CREATE TABLE IF NOT EXISTS pedidos (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id              INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  cliente_id              INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_nome_avulso     TEXT,
  cliente_telefone_avulso TEXT,
  data_pedido             TEXT NOT NULL DEFAULT (date('now')),
  data_entrega            TEXT NOT NULL,
  horario_entrega         TEXT,
  tipo_entrega            TEXT NOT NULL DEFAULT 'retirada' CHECK (tipo_entrega IN ('retirada', 'entrega')),
  endereco_entrega        TEXT,
  status                  TEXT NOT NULL DEFAULT 'orcamento' CHECK (status IN ('orcamento', 'confirmado', 'producao', 'entregue', 'cancelado')),
  valor_produtos          REAL NOT NULL DEFAULT 0 CHECK (valor_produtos >= 0),
  taxa_entrega            REAL NOT NULL DEFAULT 0 CHECK (taxa_entrega >= 0),
  desconto                REAL NOT NULL DEFAULT 0 CHECK (desconto >= 0),
  valor_total             REAL NOT NULL DEFAULT 0 CHECK (valor_total >= 0),
  valor_sinal             REAL NOT NULL DEFAULT 0 CHECK (valor_sinal >= 0),
  status_pagamento        TEXT NOT NULL DEFAULT 'pendente' CHECK (status_pagamento IN ('pendente', 'sinal_pago', 'pago')),
  forma_pagamento         TEXT,
  observacoes             TEXT,
  criado_em               TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pedidos_usuario      ON pedidos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente      ON pedidos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_data_entrega ON pedidos(data_entrega);
CREATE INDEX IF NOT EXISTS idx_pedidos_status       ON pedidos(status);

CREATE TABLE IF NOT EXISTS pedido_itens (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id      INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id     INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
  descricao      TEXT NOT NULL,
  quantidade     REAL NOT NULL CHECK (quantidade > 0),
  preco_unitario REAL NOT NULL CHECK (preco_unitario >= 0),
  subtotal       REAL NOT NULL CHECK (subtotal >= 0),
  observacao     TEXT
);

CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido  ON pedido_itens(pedido_id);
CREATE INDEX IF NOT EXISTS idx_pedido_itens_produto ON pedido_itens(produto_id);
