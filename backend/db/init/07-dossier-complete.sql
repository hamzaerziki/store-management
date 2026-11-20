ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_owner_role_check;
ALTER TABLE item_templates DROP CONSTRAINT IF EXISTS item_templates_owner_role_check;
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_owner_role_check;

ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','IT','MG','RMG','CDG','CG','DD','DD-IT','DD-MG','DG'))
;
ALTER TABLE categories ADD CONSTRAINT categories_owner_role_check CHECK (owner_role IN ('IT','MG','RMG','BOTH'));
ALTER TABLE item_templates ADD CONSTRAINT item_templates_owner_role_check CHECK (owner_role IN ('IT','MG','RMG'));
ALTER TABLE items ADD CONSTRAINT items_owner_role_check CHECK (owner_role IN ('IT','MG','RMG'));

CREATE TABLE IF NOT EXISTS brands (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  code VARCHAR(30),
  active BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO brands (name, code) VALUES ('Safari Import', 'SI'), ('Safari Export', 'SE')
ON CONFLICT (name) DO NOTHING;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS brand_id INT REFERENCES brands(id);
UPDATE stores SET brand_id = (SELECT id FROM brands WHERE name = 'Safari Import')
WHERE brand_id IS NULL;

CREATE TABLE IF NOT EXISTS enterprises (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL UNIQUE,
  kind VARCHAR(60) DEFAULT 'Entreprise',
  contact VARCHAR(200),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO enterprises (name, kind, contact, notes)
SELECT name, 'Entreprise', contact, notes FROM suppliers
ON CONFLICT (name) DO NOTHING;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS enterprise_id INT REFERENCES enterprises(id);
UPDATE suppliers SET enterprise_id = (SELECT id FROM enterprises WHERE enterprises.name = suppliers.name)
WHERE enterprise_id IS NULL;

ALTER TABLE stores ADD COLUMN IF NOT EXISTS project_state VARCHAR(30) NOT NULL DEFAULT 'preparation';
ALTER TABLE stores ADD COLUMN IF NOT EXISTS state_reason TEXT;

CREATE TABLE IF NOT EXISTS lots (
  id SERIAL PRIMARY KEY,
  store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(150) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'brouillon',
  owner_role VARCHAR(10),
  budget NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, code)
);
ALTER TABLE lots ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id);
INSERT INTO lots (store_id, code, name, owner_role, budget)
SELECT id, 'LOT-01', 'Lot principal', 'RMG', budget FROM stores
ON CONFLICT (store_id, code) DO NOTHING;
ALTER TABLE items ADD COLUMN IF NOT EXISTS lot_id INT REFERENCES lots(id) ON DELETE SET NULL;
UPDATE items SET lot_id = (SELECT l.id FROM lots l WHERE l.store_id = items.store_id ORDER BY l.id LIMIT 1)
WHERE lot_id IS NULL;

CREATE TABLE IF NOT EXISTS budgets (
  id SERIAL PRIMARY KEY,
  store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  lot_id INT REFERENCES lots(id) ON DELETE SET NULL,
  label VARCHAR(200) NOT NULL,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  state VARCHAR(30) NOT NULL DEFAULT 'brouillon',
  rejection_reason TEXT,
  created_by INT REFERENCES users(id),
  submitted_at TIMESTAMPTZ,
  validated_cdg_at TIMESTAMPTZ,
  validated_dd_at TIMESTAMPTZ,
  validated_dg_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, lot_id, label)
);
INSERT INTO budgets (store_id, lot_id, label, amount, state, created_by)
SELECT id, (SELECT l.id FROM lots l WHERE l.store_id = stores.id ORDER BY l.id LIMIT 1),
       'Budget initial ' || name, budget, 'brouillon', NULL FROM stores
ON CONFLICT (store_id, lot_id, label) DO NOTHING;

CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  lot_id INT REFERENCES lots(id) ON DELETE SET NULL,
  supplier_id INT REFERENCES suppliers(id),
  item_id INT REFERENCES items(id) ON DELETE SET NULL,
  reference VARCHAR(100) NOT NULL,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  state VARCHAR(30) NOT NULL DEFAULT 'brouillon',
  ordered_at DATE,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  lot_id INT REFERENCES lots(id) ON DELETE SET NULL,
  supplier_id INT REFERENCES suppliers(id),
  purchase_order_id INT REFERENCES purchase_orders(id) ON DELETE SET NULL,
  reference VARCHAR(100) NOT NULL,
  amount_ht NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_ttc NUMERIC(14,2) NOT NULL DEFAULT 0,
  state VARCHAR(30) NOT NULL DEFAULT 'recue',
  invoice_date DATE,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  invoice_id INT REFERENCES invoices(id) ON DELETE SET NULL,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  method VARCHAR(60),
  reference VARCHAR(100),
  paid_at DATE,
  recorded_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS risks (
  id SERIAL PRIMARY KEY,
  store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  lot_id INT REFERENCES lots(id) ON DELETE SET NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  severity VARCHAR(30) DEFAULT 'moyen',
  probability VARCHAR(30) DEFAULT 'possible',
  state VARCHAR(30) NOT NULL DEFAULT 'ouvert',
  owner_role VARCHAR(10),
  due_date DATE,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS receptions (
  id SERIAL PRIMARY KEY,
  store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  lot_id INT REFERENCES lots(id) ON DELETE SET NULL,
  item_id INT REFERENCES items(id) ON DELETE SET NULL,
  reference VARCHAR(100) NOT NULL,
  received_at DATE,
  conform BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  recorded_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS planning_tasks (
  id SERIAL PRIMARY KEY,
  store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  lot_id INT REFERENCES lots(id) ON DELETE SET NULL,
  title VARCHAR(200) NOT NULL,
  start_date DATE,
  end_date DATE,
  state VARCHAR(30) NOT NULL DEFAULT 'a_faire',
  owner_role VARCHAR(10),
  progress INT NOT NULL DEFAULT 0,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delegations (
  id SERIAL PRIMARY KEY,
  from_user_id INT REFERENCES users(id),
  to_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(10) NOT NULL,
  store_id INT REFERENCES stores(id) ON DELETE CASCADE,
  lot_id INT REFERENCES lots(id) ON DELETE CASCADE,
  starts_at DATE NOT NULL DEFAULT CURRENT_DATE,
  ends_at DATE NOT NULL DEFAULT CURRENT_DATE + INTERVAL '30 days',
  active BOOLEAN NOT NULL DEFAULT true,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS state_transitions (
  id SERIAL PRIMARY KEY,
  entity VARCHAR(60) NOT NULL,
  entity_id INT NOT NULL,
  from_state VARCHAR(40),
  to_state VARCHAR(40) NOT NULL,
  actor_id INT REFERENCES users(id),
  actor_role VARCHAR(10),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lots_store ON lots(store_id);
CREATE INDEX IF NOT EXISTS idx_budgets_store ON budgets(store_id, state);
CREATE INDEX IF NOT EXISTS idx_po_store ON purchase_orders(store_id);
CREATE INDEX IF NOT EXISTS idx_invoices_store ON invoices(store_id);
CREATE INDEX IF NOT EXISTS idx_payments_store ON payments(store_id);
CREATE INDEX IF NOT EXISTS idx_risks_store ON risks(store_id, state);
CREATE INDEX IF NOT EXISTS idx_receptions_store ON receptions(store_id);
CREATE INDEX IF NOT EXISTS idx_planning_store ON planning_tasks(store_id);
CREATE INDEX IF NOT EXISTS idx_transitions_entity ON state_transitions(entity, entity_id);
