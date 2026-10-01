-- Usuárias do sistema
CREATE TABLE IF NOT EXISTS usuarios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nome        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  senha_hash  TEXT NOT NULL,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Horas trabalhadas por mês (uma linha por usuária)
CREATE TABLE IF NOT EXISTS configuracoes (
  usuario_id  INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  horas_mes   REAL NOT NULL DEFAULT 160 CHECK (horas_mes > 0)
);

-- Parte 1: custos fixos mensais
CREATE TABLE IF NOT EXISTS custos_fixos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  item          TEXT NOT NULL,
  valor_mensal  REAL NOT NULL DEFAULT 0 CHECK (valor_mensal >= 0)
);

-- Parte 2/3: produtos
CREATE TABLE IF NOT EXISTS produtos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL,
  rendimento      REAL NOT NULL CHECK (rendimento > 0),   -- unidades por lote
  tempo_horas     REAL NOT NULL DEFAULT 0 CHECK (tempo_horas >= 0),
  mao_obra_extra  REAL NOT NULL DEFAULT 0 CHECK (mao_obra_extra >= 0), -- item D
  margem_pct      REAL NOT NULL DEFAULT 40 CHECK (margem_pct >= 0),
  taxas_pct       REAL NOT NULL DEFAULT 5  CHECK (taxas_pct >= 0),
  unidade         TEXT NOT NULL DEFAULT 'un',
  atualizado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ingredientes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id    INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  qtd_usada     REAL NOT NULL CHECK (qtd_usada >= 0),
  preco_pacote  REAL NOT NULL CHECK (preco_pacote >= 0),
  qtd_pacote    REAL NOT NULL CHECK (qtd_pacote > 0)
);

CREATE TABLE IF NOT EXISTS complementos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id  INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  custo_lote  REAL NOT NULL CHECK (custo_lote >= 0)
);

CREATE INDEX IF NOT EXISTS idx_custos_usuario   ON custos_fixos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_produtos_usuario ON produtos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_ingr_produto     ON ingredientes(produto_id);
CREATE INDEX IF NOT EXISTS idx_comp_produto     ON complementos(produto_id);

-- Catálogo de Insumos / Ingredientes com Controle de Estoque
CREATE TABLE IF NOT EXISTS ingredientes_catalogo (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id            INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nome                  TEXT NOT NULL,
  unidade               TEXT NOT NULL DEFAULT 'g' CHECK (unidade IN ('g', 'ml', 'un')),
  estoque_atual         REAL NOT NULL DEFAULT 0 CHECK (estoque_atual >= 0),
  estoque_minimo        REAL NOT NULL DEFAULT 0 CHECK (estoque_minimo >= 0),
  preco_atual           REAL NOT NULL DEFAULT 0 CHECK (preco_atual >= 0),
  qtd_embalagem_padrao  REAL NOT NULL DEFAULT 1 CHECK (qtd_embalagem_padrao > 0),
  atualizado_em         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Grade / Histórico de Compras e Entradas de Estoque com Validade
CREATE TABLE IF NOT EXISTS ingredientes_compras (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  ingrediente_id          INTEGER NOT NULL REFERENCES ingredientes_catalogo(id) ON DELETE CASCADE,
  usuario_id              INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  data_compra             TEXT NOT NULL DEFAULT (date('now')),
  data_validade           TEXT NULL,
  qtd_embalagens          REAL NOT NULL CHECK (qtd_embalagens > 0),
  qtd_por_embalagem       REAL NOT NULL CHECK (qtd_por_embalagem > 0),
  valor_unitario_embalagem REAL NOT NULL CHECK (valor_unitario_embalagem >= 0),
  valor_total             REAL NOT NULL CHECK (valor_total >= 0),
  status                  TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'descartado', 'utilizado')),
  motivo_baixa            TEXT NULL,
  criado_em               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cat_ingr_usuario    ON ingredientes_catalogo(usuario_id);
CREATE INDEX IF NOT EXISTS idx_compras_ingrediente ON ingredientes_compras(ingrediente_id);
CREATE INDEX IF NOT EXISTS idx_compras_usuario     ON ingredientes_compras(usuario_id);

-- ============================================================================
-- MÓDULO COMERCIAL
-- ============================================================================

-- 1. Clientes
CREATE TABLE IF NOT EXISTS clientes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  telefone      TEXT, -- WhatsApp
  email         TEXT,
  endereco      TEXT,
  bairro        TEXT,
  cidade        TEXT,
  observacoes   TEXT,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clientes_usuario ON clientes(usuario_id);

-- 2. Pedidos e Orçamentos
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

-- 3. Itens do Pedido
CREATE TABLE IF NOT EXISTS pedido_itens (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id      INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id     INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
  item_pai_id    INTEGER REFERENCES pedido_itens(id) ON DELETE CASCADE,
  tipo_item      TEXT NOT NULL DEFAULT 'produto',
  descricao      TEXT NOT NULL,
  quantidade     REAL NOT NULL CHECK (quantidade > 0),
  unidade        TEXT NOT NULL DEFAULT 'un',
  preco_unitario REAL NOT NULL CHECK (preco_unitario >= 0),
  subtotal       REAL NOT NULL CHECK (subtotal >= 0),
  observacao     TEXT
);

CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido  ON pedido_itens(pedido_id);
CREATE INDEX IF NOT EXISTS idx_pedido_itens_produto ON pedido_itens(produto_id);
CREATE INDEX IF NOT EXISTS idx_pedido_itens_pai     ON pedido_itens(item_pai_id);
CREATE INDEX IF NOT EXISTS idx_pedido_itens_tipo    ON pedido_itens(tipo_item);



