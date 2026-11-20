ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='items' AND column_name='store_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='items' AND column_name='status') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_items_store_status ON items(store_id, status)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='items' AND column_name='category_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='items' AND column_name='lot_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_items_lot ON items(lot_id)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='demands' AND column_name='store_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='demands' AND column_name='status') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_demands_store_status ON demands(store_id, status)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='demands' AND column_name='created_at') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_demands_created_at ON demands(created_at DESC)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quotes' AND column_name='item_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_quotes_item ON quotes(item_id)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quotes' AND column_name='demand_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_quotes_demand ON quotes(demand_id)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quotes' AND column_name='created_at') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_quotes_created_at ON quotes(created_at DESC)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='documents' AND column_name='store_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='documents' AND column_name='folder') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_documents_store_folder ON documents(store_id, folder)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='documents' AND column_name='store_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='documents' AND column_name='created_at') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_documents_store_created ON documents(store_id, created_at DESC)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchase_orders' AND column_name='store_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchase_orders' AND column_name='state') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_purchase_orders_store_state ON purchase_orders(store_id, state)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='store_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='state') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_invoices_store_state ON invoices(store_id, state)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payments' AND column_name='invoice_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='risks' AND column_name='store_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='risks' AND column_name='state') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_risks_store_state ON risks(store_id, state)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='planning_tasks' AND column_name='store_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='planning_tasks' AND column_name='state') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_planning_tasks_store_state ON planning_tasks(store_id, state)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='planning_tasks' AND column_name='store_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='planning_tasks' AND column_name='end_date') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_planning_tasks_store_end ON planning_tasks(store_id, end_date)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='delegations' AND column_name='to_user_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='delegations' AND column_name='active') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_delegations_user_active ON delegations(to_user_id, active)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='receptions' AND column_name='store_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='receptions' AND column_name='item_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_receptions_store_item ON receptions(store_id, item_id)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_logs' AND column_name='created_at') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='user_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='read') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read, created_at DESC)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='state_transitions' AND column_name='entity')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='state_transitions' AND column_name='entity_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_state_transitions_entity ON state_transitions(entity, entity_id)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='email') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(lower(email))';
  END IF;
END $$;
