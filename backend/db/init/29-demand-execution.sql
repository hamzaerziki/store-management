ALTER TABLE demands ADD COLUMN IF NOT EXISTS execution_status text DEFAULT 'en_cours';
ALTER TABLE demands ADD COLUMN IF NOT EXISTS execution_updated_at timestamptz;
ALTER TABLE demands ADD COLUMN IF NOT EXISTS execution_updated_by integer REFERENCES users(id);
UPDATE demands SET execution_status='en_cours' WHERE execution_status IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='demands_execution_status_check' AND conrelid='demands'::regclass
  ) THEN
    ALTER TABLE demands ADD CONSTRAINT demands_execution_status_check
      CHECK (execution_status IN ('en_cours','livre','installe'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS demands_execution_status_idx ON demands(execution_status);

ALTER TABLE planning_tasks ADD COLUMN IF NOT EXISTS execution_status text DEFAULT 'en_cours';
ALTER TABLE planning_tasks ADD COLUMN IF NOT EXISTS gant_visible boolean DEFAULT true;
UPDATE planning_tasks pt SET execution_status=d.execution_status
FROM demands d WHERE pt.demand_id=d.id AND pt.execution_status='en_cours';
UPDATE planning_tasks pt SET gant_visible=true WHERE pt.gant_visible IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='planning_tasks_execution_status_check' AND conrelid='planning_tasks'::regclass
  ) THEN
    ALTER TABLE planning_tasks ADD CONSTRAINT planning_tasks_execution_status_check
      CHECK (execution_status IN ('en_cours','livre','installe'));
  END IF;
END $$;
