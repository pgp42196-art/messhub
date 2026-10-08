CREATE TABLE IF NOT EXISTS stores (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🍽️',
  note TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  role TEXT NOT NULL,
  login TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  room TEXT,
  credit_limit INT NOT NULL DEFAULT 0, -- 0 = no limit
  owed INT NOT NULL DEFAULT 0,
  store_id INT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  price INT NOT NULL,
  veg BOOLEAN NOT NULL DEFAULT TRUE,
  available BOOLEAN NOT NULL DEFAULT TRUE,
  store_id INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  store_id INT NOT NULL DEFAULT 1,
  type TEXT NOT NULL,
  room TEXT,
  status TEXT NOT NULL DEFAULT 'placed',
  otp TEXT,
  total INT NOT NULL,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'app',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_user ON orders (user_id, id DESC);
CREATE INDEX IF NOT EXISTS orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS orders_created ON orders (created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id INT,
  name TEXT NOT NULL,
  price INT NOT NULL,
  qty INT NOT NULL
);
CREATE INDEX IF NOT EXISTS oi_order ON order_items (order_id);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  amount INT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pay_user ON payments (user_id);

-- upgrades for databases created before multi-store
ALTER TABLE users ADD COLUMN IF NOT EXISTS store_id INT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS store_id INT NOT NULL DEFAULT 1;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS store_id INT NOT NULL DEFAULT 1;
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_category_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS items_store_cat_name ON items (store_id, category, name);
CREATE INDEX IF NOT EXISTS orders_store ON orders (store_id, status);

