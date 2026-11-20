ALTER TABLE demands ALTER COLUMN execution_status SET DEFAULT 'accepte_dg';
ALTER TABLE planning_tasks ALTER COLUMN execution_status SET DEFAULT 'accepte_dg';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='demands_execution_status_check' AND conrelid='demands'::regclass
  ) THEN
    ALTER TABLE demands DROP CONSTRAINT demands_execution_status_check;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='demands_execution_status_check' AND conrelid='demands'::regclass
  ) THEN
    ALTER TABLE demands ADD CONSTRAINT demands_execution_status_check
      CHECK (execution_status IN ('accepte_dg','en_cours','livre','installe'));
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='planning_tasks_execution_status_check' AND conrelid='planning_tasks'::regclass
  ) THEN
    ALTER TABLE planning_tasks DROP CONSTRAINT planning_tasks_execution_status_check;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='planning_tasks_execution_status_check' AND conrelid='planning_tasks'::regclass
  ) THEN
    ALTER TABLE planning_tasks ADD CONSTRAINT planning_tasks_execution_status_check
      CHECK (execution_status IN ('accepte_dg','en_cours','livre','installe'));
  END IF;
END $$;

UPDATE planning_tasks
SET execution_status = CASE
      WHEN execution_status IN ('livre','installe') THEN execution_status
      WHEN COALESCE(progress,0) >= 100 THEN 'installe'
      WHEN COALESCE(progress,0) > 0 THEN 'en_cours'
      ELSE 'accepte_dg'
    END,
    progress = CASE
      WHEN execution_status IN ('livre','installe') OR COALESCE(progress,0) >= 100 THEN 100
      WHEN COALESCE(progress,0) > 0 THEN 50
      ELSE 0
    END,
    state = CASE
      WHEN execution_status IN ('livre','installe') OR COALESCE(progress,0) >= 100 THEN 'terminee'
      WHEN COALESCE(progress,0) > 0 THEN 'en_cours'
      ELSE 'a_faire'
    END;

UPDATE demands d
SET execution_status='accepte_dg'
WHERE d.status='approved'
  AND COALESCE(d.execution_status,'accepte_dg') IN ('accepte_dg','en_cours')
  AND NOT EXISTS (
    SELECT 1 FROM planning_tasks pt
    WHERE pt.demand_id=d.id AND COALESCE(pt.progress,0) > 0
  );
