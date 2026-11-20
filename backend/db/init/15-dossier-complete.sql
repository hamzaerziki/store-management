-- 15-dossier-complete.sql
-- Section 6 + V2.1 Addendum C completion. Additive and idempotent.
-- Existing tables, columns, rows and migrations are never dropped or deleted.

-- Helper: keep updated_at / row_version in sync on every managed table.
CREATE OR REPLACE FUNCTION public.trg_dossier_meta() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, NOW());
    NEW.updated_at := COALESCE(NEW.updated_at, NEW.created_at);
    NEW.row_version := COALESCE(NEW.row_version, 1);
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_at := NOW();
    NEW.row_version := COALESCE(OLD.row_version, 1) + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Helper: add a CHECK constraint only when it does not already exist.
CREATE OR REPLACE FUNCTION public.dossier_add_check(
  p_table text, p_name text, p_expr text, p_not_valid boolean DEFAULT false
) RETURNS void AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = p_table::regclass AND c.conname = p_name
  ) THEN
    IF p_not_valid THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s) NOT VALID', p_table, p_name, p_expr);
    ELSE
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', p_table, p_name, p_expr);
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 1. Real Section 6 tables that did not exist yet
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS project_members (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(40),
  edit_scope VARCHAR(80),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  row_version INT NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  UNIQUE (project_id, user_id, role)
);

CREATE TABLE IF NOT EXISTS work_packages (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  category_id INT REFERENCES categories(id) ON DELETE SET NULL,
  title VARCHAR(200) NOT NULL,
  code VARCHAR(50),
  owner_user_id INT REFERENCES users(id) ON DELETE SET NULL,
  initial_budget NUMERIC(14,2) NOT NULL DEFAULT 0,
  status VARCHAR(40) NOT NULL DEFAULT 'brouillon',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  row_version INT NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  UNIQUE (project_id, code)
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  package_id INT NOT NULL REFERENCES work_packages(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  baseline_start DATE,
  baseline_end DATE,
  forecast_start DATE,
  forecast_end DATE,
  actual_start DATE,
  actual_end DATE,
  weight NUMERIC(10,2) NOT NULL DEFAULT 1,
  progress_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  status VARCHAR(40) NOT NULL DEFAULT 'a_faire',
  owner_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  row_version INT NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  id SERIAL PRIMARY KEY,
  predecessor_task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  successor_task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dependency_type VARCHAR(20) NOT NULL DEFAULT 'FS',
  lag_days INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  row_version INT NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  UNIQUE (predecessor_task_id, successor_task_id)
);

CREATE TABLE IF NOT EXISTS consultations (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  package_id INT REFERENCES work_packages(id) ON DELETE SET NULL,
  title VARCHAR(200) NOT NULL,
  deadline DATE,
  status VARCHAR(40) NOT NULL DEFAULT 'brouillon',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  row_version INT NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS quote_lines (
  id SERIAL PRIMARY KEY,
  quote_id INT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  package_id INT REFERENCES work_packages(id) ON DELETE SET NULL,
  description TEXT,
  qty NUMERIC(14,4) NOT NULL DEFAULT 1,
  unit_price NUMERIC(14,4) NOT NULL DEFAULT 0,
  vat_rate NUMERIC(6,3) NOT NULL DEFAULT 0,
  amount_ht NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  row_version INT NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS budget_lines (
  id SERIAL PRIMARY KEY,
  budget_id INT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  package_id INT REFERENCES work_packages(id) ON DELETE SET NULL,
  amount_ht NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_ttc NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  row_version INT NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id SERIAL PRIMARY KEY,
  object_type VARCHAR(60) NOT NULL,
  object_id INT NOT NULL,
  object_version INT NOT NULL DEFAULT 1,
  current_step VARCHAR(10) NOT NULL DEFAULT 'CDG',
  status VARCHAR(30) NOT NULL DEFAULT 'soumis',
  submitted_by INT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  row_version INT NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS approval_decisions (
  id SERIAL PRIMARY KEY,
  request_id INT NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  step VARCHAR(10) NOT NULL,
  actor_id INT REFERENCES users(id) ON DELETE SET NULL,
  decision VARCHAR(20) NOT NULL,
  comment TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  document_hash VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  row_version INT NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS commitment_lines (
  id SERIAL PRIMARY KEY,
  commitment_id INT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  package_id INT REFERENCES work_packages(id) ON DELETE SET NULL,
  amount_ht NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_ttc NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  row_version INT NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS opening_decisions (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  dd_approved_by INT REFERENCES users(id) ON DELETE SET NULL,
  dd_approved_at TIMESTAMPTZ,
  dg_decision VARCHAR(20),
  dg_actor_id INT REFERENCES users(id) ON DELETE SET NULL,
  dg_decided_at TIMESTAMPTZ,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  row_version INT NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS user_roles (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_code VARCHAR(30) NOT NULL,
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  row_version INT NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS reservations (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  package_id INT REFERENCES work_packages(id) ON DELETE SET NULL,
  severity VARCHAR(30),
  description TEXT,
  due_date DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'ouverte',
  evidence_id INT REFERENCES documents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  row_version INT NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- 2. V2.1 Addendum C tables (exact named fields + universal metadata)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tax_rates (
  id SERIAL PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  label VARCHAR(120) NOT NULL,
  rate NUMERIC(6,3) NOT NULL DEFAULT 0,
  regime VARCHAR(20) NOT NULL DEFAULT 'taxable',
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to DATE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  row_version INT NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT tax_rates_code_key UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS document_lines (
  id SERIAL PRIMARY KEY,
  document_type VARCHAR(60) NOT NULL,
  document_id INT NOT NULL,
  quantity NUMERIC(14,4) NOT NULL DEFAULT 1,
  unit_price_ht NUMERIC(14,4) NOT NULL DEFAULT 0,
  discount_ht NUMERIC(14,2) NOT NULL DEFAULT 0,
  base_ht NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_rate_id INT REFERENCES tax_rates(id) ON DELETE SET NULL,
  tax_rate_snapshot NUMERIC(6,3) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_ttc NUMERIC(14,2) NOT NULL DEFAULT 0,
  rounding_rule VARCHAR(40) NOT NULL DEFAULT 'line',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  row_version INT NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tax_recoverability (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  document_line_id INT REFERENCES document_lines(id) ON DELETE CASCADE,
  deductible_percentage NUMERIC(6,3) NOT NULL DEFAULT 100,
  deductible_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  justification TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  row_version INT NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS notification_events (
  id SERIAL PRIMARY KEY,
  event_key VARCHAR(80) NOT NULL,
  aggregate_type VARCHAR(60),
  aggregate_id INT,
  event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  row_version INT NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS notification_recipients (
  id SERIAL PRIMARY KEY,
  event_id INT NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL DEFAULT 'internal',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  retry_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  row_version INT NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS notification_templates (
  id SERIAL PRIMARY KEY,
  event_key VARCHAR(80) NOT NULL,
  channel VARCHAR(20) NOT NULL DEFAULT 'internal',
  locale VARCHAR(10) NOT NULL DEFAULT 'fr',
  subject_template VARCHAR(300) NOT NULL DEFAULT '',
  body_template TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  row_version INT NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT notification_templates_key UNIQUE (event_key, channel, locale)
);

CREATE TABLE IF NOT EXISTS notification_rules (
  id SERIAL PRIMARY KEY,
  event_key VARCHAR(80) NOT NULL,
  recipient_roles TEXT[] NOT NULL DEFAULT '{}',
  channel VARCHAR(20) NOT NULL DEFAULT 'internal',
  reminder_delay INT NOT NULL DEFAULT 0,
  escalation_delay INT NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  disableable BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  row_version INT NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT notification_rules_key UNIQUE (event_key, channel)
);

CREATE TABLE IF NOT EXISTS credit_notes (
  id SERIAL PRIMARY KEY,
  invoice_id INT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  reference VARCHAR(100) NOT NULL,
  amount_ttc NUMERIC(14,2) NOT NULL DEFAULT 0,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  document_id INT REFERENCES documents(id) ON DELETE SET NULL,
  reason TEXT,
  state VARCHAR(30) NOT NULL DEFAULT 'brouillon',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL,
  row_version INT NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT credit_notes_reference_key UNIQUE (reference)
);

-- ---------------------------------------------------------------------------
-- 3. Additive columns on existing tables
-- ---------------------------------------------------------------------------

-- brands: code already exists, make it unique when the data allows it.
ALTER TABLE brands ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- stores (canonical "projects" source): version fields.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE stores ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS updated_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS row_version INT NOT NULL DEFAULT 1;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- users: Entra ID subject + canonical display name.
ALTER TABLE users ADD COLUMN IF NOT EXISTS entra_subject VARCHAR(200);
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(150);
UPDATE users SET display_name = name WHERE display_name IS NULL;

-- suppliers (canonical "vendors" source) needs an active flag for the view.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS updated_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS row_version INT NOT NULL DEFAULT 1;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- documents: object linking, storage, checksum, versioning, fiscal fields.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS object_type VARCHAR(60);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS object_id INT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS storage_key VARCHAR(500);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS checksum VARCHAR(64);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS fiscal_reference VARCHAR(120);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS fiscal_date DATE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS tax_rate_code VARCHAR(40);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS amount_ht NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS amount_tva NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS amount_ttc NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE documents ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS updated_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS row_version INT NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- notifications: event linkage, channel, delivery status and retry telemetry.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS event_type VARCHAR(80);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS object_type VARCHAR(60);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS object_id INT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS event_id INT REFERENCES notification_events(id) ON DELETE SET NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS channel VARCHAR(20) NOT NULL DEFAULT 'internal';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS updated_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS row_version INT NOT NULL DEFAULT 1;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- quotes: workflow state, versioning and optimistic concurrency.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS state VARCHAR(30);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS quote_ref VARCHAR(100);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS issue_date DATE;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS expiry_date DATE;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS approved_version INT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS updated_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS row_version INT NOT NULL DEFAULT 1;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- purchase_orders: quote_id already exists; add idempotency and concurrency.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(120);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS updated_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS row_version INT NOT NULL DEFAULT 1;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- invoices and payments: idempotency, concurrency and event references.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(120);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS event_id INT REFERENCES notification_events(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS event_key VARCHAR(80);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS row_version INT NOT NULL DEFAULT 1;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(120);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS event_id INT REFERENCES notification_events(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS event_key VARCHAR(80);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE payments ADD COLUMN IF NOT EXISTS updated_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS row_version INT NOT NULL DEFAULT 1;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- receptions (canonical "site_reports" source): document link + metadata.
ALTER TABLE receptions ADD COLUMN IF NOT EXISTS document_id INT REFERENCES documents(id) ON DELETE SET NULL;
ALTER TABLE receptions ADD COLUMN IF NOT EXISTS visit_date DATE;
ALTER TABLE receptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE receptions ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE receptions ADD COLUMN IF NOT EXISTS updated_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE receptions ADD COLUMN IF NOT EXISTS row_version INT NOT NULL DEFAULT 1;
ALTER TABLE receptions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
UPDATE receptions SET visit_date = received_at WHERE visit_date IS NULL;

-- opening_checklist_items (canonical "opening_checklist" source).
ALTER TABLE opening_checklist_items ADD COLUMN IF NOT EXISTS item_code VARCHAR(50);
ALTER TABLE opening_checklist_items ADD COLUMN IF NOT EXISTS mandatory BOOLEAN;
ALTER TABLE opening_checklist_items ADD COLUMN IF NOT EXISTS responsible_role VARCHAR(20);
ALTER TABLE opening_checklist_items ADD COLUMN IF NOT EXISTS status VARCHAR(30);
ALTER TABLE opening_checklist_items ADD COLUMN IF NOT EXISTS evidence_id INT REFERENCES documents(id) ON DELETE SET NULL;
ALTER TABLE opening_checklist_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE opening_checklist_items ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE opening_checklist_items ADD COLUMN IF NOT EXISTS updated_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE opening_checklist_items ADD COLUMN IF NOT EXISTS row_version INT NOT NULL DEFAULT 1;
ALTER TABLE opening_checklist_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
UPDATE opening_checklist_items SET item_code = label WHERE item_code IS NULL;
UPDATE opening_checklist_items SET mandatory = blocking WHERE mandatory IS NULL;
UPDATE opening_checklist_items SET status = CASE WHEN done THEN 'valide' ELSE 'a_faire' END WHERE status IS NULL;

-- risks: numeric criticality 1..25 alongside the historical label.
ALTER TABLE risks ADD COLUMN IF NOT EXISTS criticality_score INT;
ALTER TABLE risks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE risks ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE risks ADD COLUMN IF NOT EXISTS updated_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE risks ADD COLUMN IF NOT EXISTS row_version INT NOT NULL DEFAULT 1;
ALTER TABLE risks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 4. Canonical compatibility views (dossier names -> existing tables)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW projects AS
SELECT
  s.id,
  s.code,
  s.brand_id,
  s.name AS title,
  s.name,
  s.city,
  s.address,
  s.area_m2,
  s.project_year AS "year",
  s.initial_open_date,
  s.forecast_open_date,
  s.revised_open_date,
  s.actual_open_date,
  s.opening_date,
  s.owner_user_id,
  s.project_state AS status,
  s.version,
  s.budget,
  s.phase,
  s.created_at,
  s.updated_at
FROM stores s;

CREATE OR REPLACE VIEW vendors AS
SELECT
  p.id,
  p.name AS legal_name,
  p.name,
  p.ice AS "ICE",
  p.if_number AS "IF",
  p.rc AS "RC",
  p.contact,
  p.email,
  p.phone,
  p.specialties,
  p.active,
  p.kind,
  p.rating,
  p.enterprise_id
FROM suppliers p;

CREATE OR REPLACE VIEW commitments AS
SELECT
  o.id,
  o.store_id AS project_id,
  o.supplier_id AS vendor_id,
  o.quote_id,
  o.reference AS order_ref,
  o.amount AS approved_amount,
  COALESCE(o.ordered_at, o.planned_date) AS date,
  o.state AS status,
  o.store_id,
  o.lot_id,
  o.revision,
  o.currency,
  o.authorized_at,
  o.cancelled_at,
  o.idempotency_key,
  o.row_version
FROM purchase_orders o;

CREATE OR REPLACE VIEW site_reports AS
SELECT
  r.id,
  r.store_id AS project_id,
  COALESCE(r.visit_date, r.received_at) AS visit_date,
  r.recorded_by AS author_id,
  COALESCE(r.report, r.notes) AS notes,
  r.document_id,
  r.store_id,
  r.lot_id,
  r.reference,
  r.conform,
  r.photo_urls,
  r.pv_url,
  r.dd_validated_at,
  r.dg_decision,
  r.dg_decision_at,
  r.created_at
FROM receptions r;

CREATE OR REPLACE VIEW opening_checklist AS
SELECT
  i.id,
  i.store_id AS project_id,
  COALESCE(i.item_code, i.label) AS item_code,
  COALESCE(i.mandatory, i.blocking) AS mandatory,
  i.responsible_role,
  COALESCE(i.status, CASE WHEN i.done THEN 'valide' ELSE 'a_faire' END) AS status,
  i.evidence_id,
  i.label,
  i.blocking,
  i.done,
  i.validated_by,
  i.validated_at
FROM opening_checklist_items i;

CREATE OR REPLACE VIEW audit_events AS
SELECT
  a.id,
  a.user_id AS actor_id,
  a.action,
  a.entity AS object_type,
  a.entity_id AS object_id,
  a.details -> 'before' AS before_json,
  a.details -> 'after' AS after_json,
  a.created_at AS occurred_at,
  a.details ->> 'correlation_id' AS correlation_id,
  a.user_name AS actor_name,
  a.details
FROM audit_logs a;

-- ---------------------------------------------------------------------------
-- 5. FK indexes
-- ---------------------------------------------------------------------------

DO $$
DECLARE spec text; t text; c text;
BEGIN
  FOREACH spec IN ARRAY ARRAY[
    'project_members.project_id','project_members.user_id','project_members.created_by','project_members.updated_by',
    'work_packages.project_id','work_packages.category_id','work_packages.owner_user_id','work_packages.created_by','work_packages.updated_by',
    'tasks.package_id','tasks.owner_id','tasks.created_by','tasks.updated_by',
    'task_dependencies.predecessor_task_id','task_dependencies.successor_task_id','task_dependencies.created_by','task_dependencies.updated_by',
    'consultations.project_id','consultations.package_id','consultations.created_by','consultations.updated_by',
    'quote_lines.quote_id','quote_lines.package_id','quote_lines.created_by','quote_lines.updated_by',
    'budget_lines.budget_id','budget_lines.package_id','budget_lines.created_by','budget_lines.updated_by',
    'approval_requests.submitted_by','approval_requests.created_by','approval_requests.updated_by',
    'approval_decisions.request_id','approval_decisions.actor_id','approval_decisions.created_by','approval_decisions.updated_by',
    'commitment_lines.commitment_id','commitment_lines.package_id','commitment_lines.created_by','commitment_lines.updated_by',
    'opening_decisions.project_id','opening_decisions.dd_approved_by','opening_decisions.dg_actor_id','opening_decisions.created_by','opening_decisions.updated_by',
    'user_roles.user_id','user_roles.created_by','user_roles.updated_by',
    'reservations.project_id','reservations.package_id','reservations.evidence_id','reservations.created_by','reservations.updated_by',
    'tax_rates.created_by','tax_rates.updated_by',
    'document_lines.tax_rate_id','document_lines.created_by','document_lines.updated_by',
    'tax_recoverability.project_id','tax_recoverability.document_line_id','tax_recoverability.created_by','tax_recoverability.updated_by',
    'notification_events.actor_id','notification_events.created_by','notification_events.updated_by',
    'notification_recipients.event_id','notification_recipients.user_id','notification_recipients.created_by','notification_recipients.updated_by',
    'notification_templates.created_by','notification_templates.updated_by',
    'notification_rules.created_by','notification_rules.updated_by',
    'credit_notes.invoice_id','credit_notes.document_id','credit_notes.created_by','credit_notes.updated_by',
    'documents.object_id'
  ] LOOP
    t := split_part(spec, '.', 1);
    c := split_part(spec, '.', 2);
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = c
    ) THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (%I)', 'idx_' || t || '_' || c, t, c);
    END IF;
  END LOOP;

  FOREACH spec IN ARRAY ARRAY[
    'notifications.event_id','notifications.object_id',
    'invoices.event_id','payments.event_id',
    'purchase_orders.idempotency_key','invoices.idempotency_key','payments.idempotency_key',
    'receptions.document_id','receptions.visit_date',
    'opening_checklist_items.evidence_id','risks.criticality_score',
    'quotes.quote_ref','quotes.state','quotes.row_version','stores.version',
    'users.entra_subject'
  ] LOOP
    t := split_part(spec, '.', 1);
    c := split_part(spec, '.', 2);
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = c
    ) THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (%I)', 'idx_' || t || '_' || c, t, c);
    END IF;
  END LOOP;
END $$;

-- Uniqueness made safe: only create the unique index when existing data is unique.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT code FROM brands WHERE code IS NOT NULL GROUP BY code HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_brands_code_unique ON brands (code) WHERE code IS NOT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT entra_subject FROM users WHERE entra_subject IS NOT NULL GROUP BY entra_subject HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_entra_subject_unique ON users (entra_subject) WHERE entra_subject IS NOT NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. CHECK constraints
-- ---------------------------------------------------------------------------

SELECT public.dossier_add_check('work_packages', 'work_packages_budget_nonneg', 'initial_budget >= 0');
SELECT public.dossier_add_check('tasks', 'tasks_progress_pct_range', 'progress_pct BETWEEN 0 AND 100');
SELECT public.dossier_add_check('tasks', 'tasks_weight_nonneg', 'weight >= 0');
SELECT public.dossier_add_check('tasks', 'tasks_baseline_dates_coherent', 'baseline_end IS NULL OR baseline_start IS NULL OR baseline_end >= baseline_start');
SELECT public.dossier_add_check('tasks', 'tasks_forecast_dates_coherent', 'forecast_end IS NULL OR forecast_start IS NULL OR forecast_end >= forecast_start');
SELECT public.dossier_add_check('tasks', 'tasks_actual_dates_coherent', 'actual_end IS NULL OR actual_start IS NULL OR actual_end >= actual_start');
SELECT public.dossier_add_check('task_dependencies', 'task_dependencies_distinct', 'predecessor_task_id <> successor_task_id');
SELECT public.dossier_add_check('quote_lines', 'quote_lines_qty_nonneg', 'qty >= 0');
SELECT public.dossier_add_check('quote_lines', 'quote_lines_price_nonneg', 'unit_price >= 0');
SELECT public.dossier_add_check('quote_lines', 'quote_lines_vat_nonneg', 'vat_rate >= 0');
SELECT public.dossier_add_check('quote_lines', 'quote_lines_amount_nonneg', 'amount_ht >= 0');
SELECT public.dossier_add_check('budget_lines', 'budget_lines_ht_nonneg', 'amount_ht >= 0');
SELECT public.dossier_add_check('budget_lines', 'budget_lines_ttc_nonneg', 'amount_ttc >= 0');
SELECT public.dossier_add_check('approval_requests', 'approval_requests_version_pos', 'object_version >= 1');
SELECT public.dossier_add_check('approval_requests', 'approval_requests_step_valid', 'current_step IN (''CDG'',''DD'',''DG'')');
SELECT public.dossier_add_check('approval_decisions', 'approval_decisions_step_valid', 'step IN (''CDG'',''DD'',''DG'')');
SELECT public.dossier_add_check('approval_decisions', 'approval_decisions_value_valid', 'decision IN (''approved'',''rejected'',''correction'',''approuve'',''rejete'',''demande_correction'')');
SELECT public.dossier_add_check('commitment_lines', 'commitment_lines_ht_nonneg', 'amount_ht >= 0');
SELECT public.dossier_add_check('commitment_lines', 'commitment_lines_ttc_nonneg', 'amount_ttc >= 0');
SELECT public.dossier_add_check('opening_decisions', 'opening_decisions_dg_valid', 'dg_decision IS NULL OR dg_decision IN (''autorisee'',''refusee'',''approved'',''rejected'')');
SELECT public.dossier_add_check('user_roles', 'user_roles_dates_coherent', 'valid_to IS NULL OR valid_to >= valid_from');
SELECT public.dossier_add_check('reservations', 'reservations_status_valid', 'status IN (''ouverte'',''correction'',''verification'',''levee'')');
SELECT public.dossier_add_check('tax_rates', 'tax_rates_rate_nonneg', 'rate >= 0');
SELECT public.dossier_add_check('tax_rates', 'tax_rates_regime_valid', 'regime IN (''taxable'',''exonere'',''hors_champ'')');
SELECT public.dossier_add_check('tax_rates', 'tax_rates_dates_coherent', 'valid_to IS NULL OR valid_to >= valid_from');
SELECT public.dossier_add_check('document_lines', 'document_lines_quantity_nonneg', 'quantity >= 0');
SELECT public.dossier_add_check('document_lines', 'document_lines_price_nonneg', 'unit_price_ht >= 0');
SELECT public.dossier_add_check('document_lines', 'document_lines_discount_nonneg', 'discount_ht >= 0');
SELECT public.dossier_add_check('document_lines', 'document_lines_base_nonneg', 'base_ht >= 0');
SELECT public.dossier_add_check('document_lines', 'document_lines_snapshot_nonneg', 'tax_rate_snapshot >= 0');
SELECT public.dossier_add_check('document_lines', 'document_lines_tax_nonneg', 'tax_amount >= 0');
SELECT public.dossier_add_check('document_lines', 'document_lines_ttc_nonneg', 'total_ttc >= 0');
SELECT public.dossier_add_check('tax_recoverability', 'tax_recoverability_pct_range', 'deductible_percentage BETWEEN 0 AND 100');
SELECT public.dossier_add_check('tax_recoverability', 'tax_recoverability_amount_nonneg', 'deductible_amount >= 0');
SELECT public.dossier_add_check('notification_recipients', 'notification_recipients_retry_nonneg', 'retry_count >= 0');
SELECT public.dossier_add_check('notification_recipients', 'notification_recipients_channel_valid', 'channel IN (''internal'',''email'')');
SELECT public.dossier_add_check('notification_recipients', 'notification_recipients_status_valid', 'status IN (''pending'',''sent'',''failed'',''read'',''skipped'')');
SELECT public.dossier_add_check('notification_templates', 'notification_templates_channel_valid', 'channel IN (''internal'',''email'')');
SELECT public.dossier_add_check('notification_rules', 'notification_rules_channel_valid', 'channel IN (''internal'',''email'')');
SELECT public.dossier_add_check('notification_rules', 'notification_rules_reminder_nonneg', 'reminder_delay >= 0');
SELECT public.dossier_add_check('notification_rules', 'notification_rules_escalation_nonneg', 'escalation_delay >= 0');
SELECT public.dossier_add_check('credit_notes', 'credit_notes_amount_nonneg', 'amount_ttc >= 0');

-- Existing rows are preserved: constraints on them are added NOT VALID.
SELECT public.dossier_add_check('risks', 'risks_criticality_score_range', 'criticality_score BETWEEN 1 AND 25', true);
SELECT public.dossier_add_check('quotes', 'quotes_amounts_nonneg', 'amount_ht >= 0 AND amount_ttc >= 0 AND amount_tva >= 0', true);
SELECT public.dossier_add_check('purchase_orders', 'purchase_orders_amount_nonneg', 'amount >= 0', true);
SELECT public.dossier_add_check('invoices', 'invoices_amounts_nonneg', 'amount_ht >= 0 AND amount_ttc >= 0', true);
SELECT public.dossier_add_check('payments', 'payments_amount_nonneg', 'amount >= 0', true);
SELECT public.dossier_add_check('stores', 'stores_dates_coherent', 'forecast_open_date IS NULL OR initial_open_date IS NULL OR forecast_open_date >= initial_open_date', true);
SELECT public.dossier_add_check('documents', 'documents_version_pos', 'version >= 1', true);

-- ---------------------------------------------------------------------------
-- 7. updated_at / row_version maintenance triggers
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'project_members','work_packages','tasks','task_dependencies','consultations',
    'quote_lines','budget_lines','approval_requests','approval_decisions',
    'commitment_lines','opening_decisions','user_roles','reservations',
    'tax_rates','document_lines','tax_recoverability','notification_events',
    'notification_recipients','notification_templates','notification_rules','credit_notes',
    'stores','suppliers','quotes','documents','notifications','purchase_orders',
    'invoices','payments','receptions','opening_checklist_items','risks'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = t::regclass AND tgname = 'trg_dossier_meta_' || t
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.trg_dossier_meta()',
        'trg_dossier_meta_' || t, t
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 8. Safe seeds
-- ---------------------------------------------------------------------------

INSERT INTO tax_rates (code, label, rate, regime, valid_from, active)
VALUES
  ('TVA-20', 'TVA 20 %',      20.000, 'taxable', CURRENT_DATE, true),
  ('TVA-10', 'TVA 10 %',      10.000, 'taxable', CURRENT_DATE, true),
  ('TVA-0',  'TVA 0 %',        0.000, 'taxable', CURRENT_DATE, true),
  ('EXO-0',  'Exonération 0 %', 0.000, 'exonere', CURRENT_DATE, true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO notification_templates (event_key, channel, locale, subject_template, body_template, enabled)
SELECT e.event_key, c.channel, 'fr', e.subject_template, e.body_template, true
FROM (VALUES
  ('demande_soumise',
   'Nouvelle demande soumise — {reference}',
   'Demande {reference} — boutique {store} — montant {amount} — auteur {actor}. Lien : {link}'),
  ('validation_cdg',
   'Validation CDG — {reference}',
   'Décision {decision} par {actor}, commentaire : {comment}, le {date}. Lien : {link}'),
  ('validation_dd',
   'Validation DD — {reference}',
   'Décision {decision} par {actor}, commentaire : {comment}, le {date}. Lien : {link}'),
  ('validation_finale_dg',
   'Décision finale DG — {reference}',
   'Statut final {status}, montant {amount}, décidé par {actor} le {date}. Lien : {link}'),
  ('rejet_correction',
   'Rejet ou demande de correction — {reference}',
   'Motif obligatoire : {reason}. Version concernée : {version}. Lien : {link}'),
  ('revision_budget_soumise',
   'Révision de budget soumise — {reference}',
   'Ancien budget {old_amount}, nouveau budget {new_amount}, écart {delta}. Justification : {justification}. Lien : {link}'),
  ('revision_budget_approuvee',
   'Révision de budget approuvée — {reference}',
   'Ancien budget {old_amount}, nouveau budget {new_amount}, écart {delta}. Lien : {link}'),
  ('annulation',
   'Annulation — {reference}',
   'Auteur {actor}, motif : {reason}, effet : {effect}, date : {date}. Lien : {link}'),
  ('depassement_retard',
   'Dépassement ou retard critique — {reference}',
   'Seuil {threshold}, impact {impact}, action attendue : {action}. Lien : {link}'),
  ('modification_date_ouverture',
   'Modification de la date d’ouverture — {reference}',
   'Ancienne date {old_date}, nouvelle date {new_date}, motif : {reason}. Lien : {link}')
) AS e(event_key, subject_template, body_template)
CROSS JOIN (VALUES ('internal'), ('email')) AS c(channel)
ON CONFLICT (event_key, channel, locale) DO NOTHING;

INSERT INTO notification_rules (event_key, recipient_roles, channel, reminder_delay, escalation_delay, enabled, disableable)
VALUES
  ('demande_soumise',            ARRAY['CDG'],                       'internal', 24, 72,  true, true),
  ('demande_soumise',            ARRAY['CDG'],                       'email',    24, 72,  true, true),
  ('validation_cdg',             ARRAY['DD','CDG'],                  'internal', 0,  0,   true, false),
  ('validation_cdg',             ARRAY['DD','CDG'],                  'email',    0,  0,   true, false),
  ('validation_dd',              ARRAY['DG','DD'],                   'internal', 0,  0,   true, false),
  ('validation_dd',              ARRAY['DG','DD'],                   'email',    0,  0,   true, false),
  ('validation_finale_dg',       ARRAY['CDG','DD','RMG','IT','DG'],   'internal', 0,  0,   true, false),
  ('validation_finale_dg',       ARRAY['CDG','DD','RMG','IT','DG'],   'email',    0,  0,   true, false),
  ('rejet_correction',           ARRAY['CDG','DD','RMG','IT'],        'internal', 0,  0,   true, false),
  ('rejet_correction',           ARRAY['CDG','DD','RMG','IT'],        'email',    0,  0,   true, false),
  ('revision_budget_soumise',    ARRAY['CDG'],                       'internal', 24, 48,  true, true),
  ('revision_budget_soumise',    ARRAY['CDG'],                       'email',    24, 48,  true, true),
  ('revision_budget_approuvee',  ARRAY['CDG','DD','RMG','IT'],        'internal', 0,  0,   true, true),
  ('revision_budget_approuvee',  ARRAY['CDG','DD','RMG','IT'],        'email',    0,  0,   true, true),
  ('annulation',                 ARRAY['CDG','DD','DG','RMG','IT'],    'internal', 0,  0,   true, true),
  ('annulation',                 ARRAY['CDG','DD','DG','RMG','IT'],    'email',    0,  0,   true, true),
  ('depassement_retard',         ARRAY['CDG','DD','DG','RMG'],        'internal', 12, 48,  true, true),
  ('depassement_retard',         ARRAY['CDG','DD','DG','RMG'],        'email',    12, 48,  true, true),
  ('modification_date_ouverture',ARRAY['DD','RMG','IT','DG'],         'internal', 24, 72,  true, true),
  ('modification_date_ouverture',ARRAY['DD','RMG','IT','DG'],         'email',    24, 72,  true, true)
ON CONFLICT (event_key, channel) DO NOTHING;
