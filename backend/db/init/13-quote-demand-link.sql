INSERT INTO categories (name) SELECT 'Autre' WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name='Autre');
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS demand_id INT REFERENCES demands(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_demand ON quotes(demand_id);
