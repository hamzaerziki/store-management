CREATE TABLE IF NOT EXISTS demands (
  id SERIAL PRIMARY KEY,
  store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  lot_id INT REFERENCES lots(id) ON DELETE SET NULL,
  item_id INT REFERENCES items(id) ON DELETE SET NULL,
  owner_role VARCHAR(10) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending_cdg',
  rejection_reason TEXT,
  created_by INT NOT NULL REFERENCES users(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validated_cdg_at TIMESTAMPTZ,
  validated_dd_at TIMESTAMPTZ,
  validated_dg_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT demands_status_check CHECK (status IN ('draft','pending_cdg','pending_dd','pending_dg','approved','rejected')),
  CONSTRAINT demands_owner_role_check CHECK (owner_role IN ('IT','MG','RMG'))
);

CREATE TABLE IF NOT EXISTS demand_validations (
  id SERIAL PRIMARY KEY,
  demand_id INT NOT NULL REFERENCES demands(id) ON DELETE CASCADE,
  validator_id INT REFERENCES users(id),
  validator_role VARCHAR(10) NOT NULL,
  decision VARCHAR(10) NOT NULL CHECK (decision IN ('approved','rejected')),
  comment TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (demand_id, validator_role)
);

CREATE INDEX IF NOT EXISTS idx_demands_store ON demands(store_id, status);
CREATE INDEX IF NOT EXISTS idx_demands_owner ON demands(owner_role, created_by);
CREATE INDEX IF NOT EXISTS idx_demand_validations_demand ON demand_validations(demand_id);
