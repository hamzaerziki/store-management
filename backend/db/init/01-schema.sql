-- Safari Store Opening Tracker — schema
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(200) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(10) NOT NULL CHECK (role IN ('admin','IT','MG','RMG','CDG','CG','DD','DD-IT','DD-MG','DG'))
,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE stores (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  city VARCHAR(100) NOT NULL,
  opening_date DATE NOT NULL,
  status VARCHAR(20) DEFAULT 'planning' CHECK (status IN ('planning','on_track','at_risk','late','ready')),
  status_override VARCHAR(20) CHECK (status_override IS NULL OR status_override IN ('on_track','at_risk','late','ready')),
  budget NUMERIC(14,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  owner_role VARCHAR(10) NOT NULL CHECK (owner_role IN ('IT','MG','BOTH'))
);

CREATE TABLE item_templates (
  id SERIAL PRIMARY KEY,
  category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  default_quantity INT DEFAULT 1,
  default_budget NUMERIC(14,2) DEFAULT 0,
  owner_role VARCHAR(10) NOT NULL CHECK (owner_role IN ('IT','MG')),
  UNIQUE (category_id, name)
);

CREATE TABLE suppliers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  contact VARCHAR(200),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE items (
  id SERIAL PRIMARY KEY,
  store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  category_id INT NOT NULL REFERENCES categories(id),
  name VARCHAR(200) NOT NULL,
  is_service BOOLEAN NOT NULL DEFAULT false,
  quantity INT DEFAULT 1,
  estimated_budget NUMERIC(14,2) DEFAULT 0,
  status VARCHAR(25) DEFAULT 'to_quote' CHECK (status IN
    ('to_quote','quotes_received','compared','validated','approved','ordered','delivered','installed')),
  owner_role VARCHAR(10) NOT NULL CHECK (owner_role IN ('IT','MG')),
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE quotes (
  id SERIAL PRIMARY KEY,
  item_id INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  supplier_id INT NOT NULL REFERENCES suppliers(id),
  amount_ht NUMERIC(14,2) NOT NULL,
  amount_ttc NUMERIC(14,2) NOT NULL,
  currency VARCHAR(5) DEFAULT 'MAD',
  delivery_days INT,
  validity_date DATE,
  payment_terms VARCHAR(200),
  warranty_months INT DEFAULT 0,
  reliability_score INT DEFAULT 3 CHECK (reliability_score BETWEEN 1 AND 5),
  file_url VARCHAR(500),
  notes TEXT,
  extracted_data JSONB DEFAULT '{}'::jsonb,
  uploaded_by INT REFERENCES users(id),
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE comparisons (
  id SERIAL PRIMARY KEY,
  item_id INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  selected_quote_id INT REFERENCES quotes(id),
  justification TEXT,
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN
    ('draft','pending_cdg','pending_dd','pending_dg','validated','rejected')),
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE comparison_quotes (
  comparison_id INT NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
  quote_id INT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  PRIMARY KEY (comparison_id, quote_id)
);

CREATE TABLE validations (
  id SERIAL PRIMARY KEY,
  comparison_id INT NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
  validator_id INT REFERENCES users(id),
  validator_role VARCHAR(10) NOT NULL,
  decision VARCHAR(10) NOT NULL CHECK (decision IN ('approved','rejected')),
  comment TEXT,
  decided_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  user_name VARCHAR(150),
  action VARCHAR(80) NOT NULL,
  entity VARCHAR(60) NOT NULL,
  entity_id INT,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  type VARCHAR(30) DEFAULT 'info',
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_items_store ON items(store_id);
CREATE INDEX idx_items_status ON items(status);
CREATE INDEX idx_quotes_item ON quotes(item_id);
CREATE INDEX idx_comparisons_status ON comparisons(status);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX idx_notif_user ON notifications(user_id, read);
