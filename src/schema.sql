CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  balance NUMERIC(14,4) NOT NULL DEFAULT 0,
  referred_by BIGINT,
  banned BOOLEAN NOT NULL DEFAULT FALSE,
  blocked_bot BOOLEAN NOT NULL DEFAULT FALSE,
  state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  kind TEXT NOT NULL,                -- product | game
  product_id TEXT NOT NULL,
  product_name TEXT,
  quantity INT NOT NULL DEFAULT 1,
  cost NUMERIC(14,4),                -- lo que te cobra KOKORO
  price NUMERIC(14,4) NOT NULL,      -- lo que pagó tu cliente
  status TEXT NOT NULL,              -- pending | processing | action_required | delivered | refunded | failed
  external_order_id TEXT NOT NULL UNIQUE,
  kokoro_order_id TEXT,
  delivery TEXT,
  input JSONB,
  action_required JSONB,
  failure_reason TEXT,
  refunded BOOLEAN NOT NULL DEFAULT FALSE,
  referral_paid BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id, id DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  amount NUMERIC(14,4) NOT NULL,
  type TEXT NOT NULL,                -- recharge | purchase | refund | adjust | referral
  note TEXT,
  order_id INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_user_idx ON transactions (user_id, id DESC);

CREATE TABLE IF NOT EXISTS recharges (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  amount NUMERIC(14,4) NOT NULL,
  proof_file_id TEXT,
  proof_type TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  handled_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  handled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS recharges_status_idx ON recharges (status);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Ajustes por producto / juego / pack: margen propio, precio fijo u ocultar
CREATE TABLE IF NOT EXISTS overrides (
  item_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                -- product | game | pack
  name TEXT,
  markup NUMERIC(8,2),
  fixed_price NUMERIC(14,4),
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Productos destacados (aparecen en "Más vendidos" del bot)
ALTER TABLE overrides ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT FALSE;

-- Recargas en pesos (lo que pagó el cliente) y fidelización
ALTER TABLE recharges ADD COLUMN IF NOT EXISTS amount_cop NUMERIC(14,0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cashback_paid BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS renew_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reminded BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS orders_renew_idx ON orders (renew_at) WHERE reminded = FALSE;

-- Idioma elegido por el cliente (es / en). NULL = aún no lo eligió
ALTER TABLE users ADD COLUMN IF NOT EXISTS lang TEXT;

-- Recargas automáticas con Bold
ALTER TABLE recharges ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE recharges ADD COLUMN IF NOT EXISTS bold_link TEXT;
ALTER TABLE recharges ADD COLUMN IF NOT EXISTS bold_url TEXT;
ALTER TABLE recharges ADD COLUMN IF NOT EXISTS bold_ref TEXT;
ALTER TABLE recharges ADD COLUMN IF NOT EXISTS bold_total NUMERIC(14,0);
CREATE INDEX IF NOT EXISTS recharges_bold_link_idx ON recharges (bold_link);

-- Recargas automáticas con Binance (ID de la orden o TxID, único para no acreditar dos veces)
ALTER TABLE recharges ADD COLUMN IF NOT EXISTS ext_tx TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS recharges_ext_tx_uq ON recharges (ext_tx) WHERE ext_tx IS NOT NULL;
