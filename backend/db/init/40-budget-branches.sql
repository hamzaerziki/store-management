-- Dynamic budget branches per store
CREATE TABLE IF NOT EXISTS budget_branches (
  id SERIAL PRIMARY KEY,
  store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  code VARCHAR(20) NOT NULL,
  label VARCHAR(120) NOT NULL,
  color VARCHAR(20) NOT NULL DEFAULT '#0E7A5F',
  allocated_budget NUMERIC(14,2) NOT NULL DEFAULT 0,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, code)
);

INSERT INTO budget_branches (store_id, code, label, color, position, allocated_budget)
SELECT s.id, 'IT', 'IT', '#0E7A5F', 1, 0 FROM stores s
ON CONFLICT (store_id, code) DO NOTHING;
INSERT INTO budget_branches (store_id, code, label, color, position, allocated_budget)
SELECT s.id, 'MG', 'MG', '#B8862F', 2, 0 FROM stores s
ON CONFLICT (store_id, code) DO NOTHING;

-- Relax department checks to allow custom branch codes
ALTER TABLE budget_categories DROP CONSTRAINT IF EXISTS budget_categories_department_check;
ALTER TABLE budget_categories ALTER COLUMN department TYPE VARCHAR(20);
ALTER TABLE budget_category_lines DROP CONSTRAINT IF EXISTS budget_category_lines_department_check;
ALTER TABLE budget_category_lines ALTER COLUMN department TYPE VARCHAR(20);
