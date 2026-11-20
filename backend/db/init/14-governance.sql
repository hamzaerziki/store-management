ALTER TABLE stores ADD COLUMN IF NOT EXISTS project_year INT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS revised_open_date DATE;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS date_change_reason TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS progress_justification TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS locked_read_only BOOLEAN DEFAULT false;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS reopen_reason TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS dd_validated_at TIMESTAMPTZ;

UPDATE stores SET project_year = EXTRACT(YEAR FROM opening_date)::int WHERE project_year IS NULL;
UPDATE stores SET initial_open_date = opening_date WHERE initial_open_date IS NULL;
UPDATE stores SET revised_open_date = opening_date WHERE revised_open_date IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_code_year ON stores (code, project_year) WHERE code IS NOT NULL;

CREATE OR REPLACE FUNCTION trg_store_governance() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.initial_open_date IS DISTINCT FROM OLD.initial_open_date THEN
      RAISE EXCEPTION 'La date cible initiale est immuable';
    END IF;
    IF NEW.opening_date IS DISTINCT FROM OLD.opening_date THEN
      IF NEW.date_change_reason IS NULL OR length(btrim(NEW.date_change_reason)) = 0 THEN
        RAISE EXCEPTION 'Motif obligatoire pour changer la date d’ouverture';
      END IF;
      NEW.revised_open_date := NEW.opening_date;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_store_governance ON stores;
CREATE TRIGGER trg_store_governance BEFORE UPDATE ON stores FOR EACH ROW EXECUTE FUNCTION trg_store_governance();

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS ice VARCHAR(50);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS rc VARCHAR(50);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS if_number VARCHAR(50);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS phone VARCHAR(80);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS email VARCHAR(150);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS specialties TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS rating NUMERIC(2,1) DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contract_reference VARCHAR(100);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS evaluation TEXT;

ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS ice VARCHAR(50);
ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS rc VARCHAR(50);
ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS if_number VARCHAR(50);
ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS phone VARCHAR(80);
ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS email VARCHAR(150);
ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS specialties TEXT;

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS lot_id INT REFERENCES lots(id) ON DELETE SET NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS version INT DEFAULT 1;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS amount_tva NUMERIC(14,2) DEFAULT 0;

UPDATE quotes q SET lot_id = i.lot_id FROM items i WHERE i.id = q.item_id AND q.lot_id IS NULL;
UPDATE quotes SET lot_id = (SELECT l.id FROM lots l JOIN items i ON i.store_id=l.store_id WHERE i.id=quotes.item_id ORDER BY l.id LIMIT 1) WHERE lot_id IS NULL;
UPDATE quotes SET amount_tva = ROUND(amount_ttc - amount_ht, 2) WHERE amount_tva = 0 AND amount_ttc <> amount_ht;

CREATE OR REPLACE FUNCTION trg_quote_integrity() RETURNS trigger AS $$
BEGIN
  IF NEW.lot_id IS NULL THEN
    RAISE EXCEPTION 'Un devis doit être relié à au moins un lot';
  END IF;
  IF NEW.amount_tva IS NULL THEN NEW.amount_tva := 0; END IF;
  IF ROUND(NEW.amount_ht + NEW.amount_tva, 2) <> ROUND(NEW.amount_ttc, 2) THEN
    RAISE EXCEPTION 'TTC incohérent : HT + TVA doit égaler TTC';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_quote_integrity ON quotes;
CREATE TRIGGER trg_quote_integrity BEFORE INSERT OR UPDATE ON quotes FOR EACH ROW EXECUTE FUNCTION trg_quote_integrity();

ALTER TABLE documents ADD COLUMN IF NOT EXISTS lot_id INT REFERENCES lots(id) ON DELETE SET NULL;

ALTER TABLE planning_tasks ADD COLUMN IF NOT EXISTS weight INT DEFAULT 1;
ALTER TABLE planning_tasks ADD COLUMN IF NOT EXISTS baseline_start_date DATE;
ALTER TABLE planning_tasks ADD COLUMN IF NOT EXISTS baseline_end_date DATE;
ALTER TABLE planning_tasks ADD COLUMN IF NOT EXISTS revision INT DEFAULT 1;
ALTER TABLE planning_tasks ADD COLUMN IF NOT EXISTS depends_on INT REFERENCES planning_tasks(id) ON DELETE SET NULL;
ALTER TABLE planning_tasks ADD COLUMN IF NOT EXISTS delay_days INT DEFAULT 0;
ALTER TABLE planning_tasks ADD COLUMN IF NOT EXISTS milestone BOOLEAN DEFAULT false;
ALTER TABLE planning_tasks ADD COLUMN IF NOT EXISTS change_reason TEXT;

UPDATE planning_tasks SET baseline_start_date = start_date WHERE baseline_start_date IS NULL;
UPDATE planning_tasks SET baseline_end_date = end_date WHERE baseline_end_date IS NULL;

CREATE TABLE IF NOT EXISTS planning_task_versions (
  id SERIAL PRIMARY KEY,
  task_id INT NOT NULL REFERENCES planning_tasks(id) ON DELETE CASCADE,
  revision INT NOT NULL,
  start_date DATE,
  end_date DATE,
  progress INT,
  changed_by INT REFERENCES users(id),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION trg_planning_version() RETURNS trigger AS $$
BEGIN
  IF NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date OR NEW.progress IS DISTINCT FROM OLD.progress THEN
    NEW.revision := COALESCE(OLD.revision, 1) + 1;
    NEW.delay_days := CASE
      WHEN NEW.end_date IS NOT NULL AND OLD.baseline_end_date IS NOT NULL
      THEN GREATEST(0, NEW.end_date - OLD.baseline_end_date)
      ELSE 0 END;
    INSERT INTO planning_task_versions (task_id, revision, start_date, end_date, progress, changed_by, reason)
    VALUES (OLD.id, OLD.revision, OLD.start_date, OLD.end_date, OLD.progress, NEW.created_by, NEW.change_reason);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_planning_version ON planning_tasks;
CREATE TRIGGER trg_planning_version BEFORE UPDATE ON planning_tasks FOR EACH ROW EXECUTE FUNCTION trg_planning_version();

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS quote_id INT REFERENCES quotes(id) ON DELETE SET NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS revision INT DEFAULT 1;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS planned_date DATE;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS authorized_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS currency VARCHAR(5) DEFAULT 'MAD';

CREATE TABLE IF NOT EXISTS purchase_order_amendments (
  id SERIAL PRIMARY KEY,
  purchase_order_id INT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  reference VARCHAR(100) NOT NULL,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  justification TEXT,
  change_request_id INT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency VARCHAR(5) DEFAULT 'MAD';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS controlled_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS controller_id INT REFERENCES users(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS control_comment TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS credit_note BOOLEAN DEFAULT false;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS credit_reason TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS finance_reference VARCHAR(120);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS support_name VARCHAR(255);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS support_url VARCHAR(500);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(14,2) DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_supplier_reference ON invoices (supplier_id, lower(reference)) WHERE supplier_id IS NOT NULL;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS finance_reference VARCHAR(120);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS support_name VARCHAR(255);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS support_url VARCHAR(500);

ALTER TABLE risks ADD COLUMN IF NOT EXISTS impact VARCHAR(30);
ALTER TABLE risks ADD COLUMN IF NOT EXISTS criticality VARCHAR(30);
ALTER TABLE risks ADD COLUMN IF NOT EXISTS action TEXT;
ALTER TABLE risks ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255);
ALTER TABLE risks ADD COLUMN IF NOT EXISTS attachment_url VARCHAR(500);

ALTER TABLE receptions ADD COLUMN IF NOT EXISTS report TEXT;
ALTER TABLE receptions ADD COLUMN IF NOT EXISTS photo_urls JSONB DEFAULT '[]'::jsonb;
ALTER TABLE receptions ADD COLUMN IF NOT EXISTS pv_url VARCHAR(500);
ALTER TABLE receptions ADD COLUMN IF NOT EXISTS dd_validated_at TIMESTAMPTZ;
ALTER TABLE receptions ADD COLUMN IF NOT EXISTS dg_decision VARCHAR(20);
ALTER TABLE receptions ADD COLUMN IF NOT EXISTS dg_decision_at TIMESTAMPTZ;
ALTER TABLE receptions ADD COLUMN IF NOT EXISTS dg_decision_comment TEXT;

CREATE TABLE IF NOT EXISTS opening_checklist_items (
  id SERIAL PRIMARY KEY,
  store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  label VARCHAR(200) NOT NULL,
  blocking BOOLEAN DEFAULT true,
  done BOOLEAN DEFAULT false,
  validated_by INT REFERENCES users(id),
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS change_requests (
  id SERIAL PRIMARY KEY,
  store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  lot_id INT REFERENCES lots(id) ON DELETE SET NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  impact TEXT,
  quote_id INT REFERENCES quotes(id) ON DELETE SET NULL,
  amount NUMERIC(14,2) DEFAULT 0,
  state VARCHAR(30) NOT NULL DEFAULT 'draft',
  created_by INT REFERENCES users(id),
  decided_by INT REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  decision_comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS store_assignments (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  lot_id INT REFERENCES lots(id) ON DELETE CASCADE,
  role VARCHAR(20),
  active BOOLEAN DEFAULT true,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, store_id, lot_id)
);

ALTER TABLE demands ADD COLUMN IF NOT EXISTS action TEXT;
ALTER TABLE demands ADD COLUMN IF NOT EXISTS action_note TEXT;
ALTER TABLE demands ADD COLUMN IF NOT EXISTS action_updated_by INT REFERENCES users(id);
ALTER TABLE demands ADD COLUMN IF NOT EXISTS action_updated_at TIMESTAMPTZ;

ALTER TABLE state_transitions ADD COLUMN IF NOT EXISTS version INT DEFAULT 1;
ALTER TABLE state_transitions ADD COLUMN IF NOT EXISTS document_hash VARCHAR(64);

ALTER TABLE budgets ADD COLUMN IF NOT EXISTS currency VARCHAR(5) DEFAULT 'MAD';
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS revised_amount NUMERIC(14,2);
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS revision INT DEFAULT 1;

CREATE TABLE IF NOT EXISTS budget_versions (
  id SERIAL PRIMARY KEY,
  budget_id INT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  revision INT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  state VARCHAR(30),
  changed_by INT REFERENCES users(id),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opening_checklist_store ON opening_checklist_items(store_id);
CREATE INDEX IF NOT EXISTS idx_change_requests_store ON change_requests(store_id);
CREATE INDEX IF NOT EXISTS idx_store_assignments_user ON store_assignments(user_id, store_id);
CREATE INDEX IF NOT EXISTS idx_planning_versions_task ON planning_task_versions(task_id);
CREATE INDEX IF NOT EXISTS idx_budget_versions_budget ON budget_versions(budget_id);
