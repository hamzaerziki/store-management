ALTER TABLE planning_tasks ADD COLUMN IF NOT EXISTS updated_by INT REFERENCES users(id);

CREATE OR REPLACE FUNCTION trg_planning_version() RETURNS trigger AS $$
BEGIN
  IF NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date OR NEW.progress IS DISTINCT FROM OLD.progress THEN
    NEW.revision := COALESCE(OLD.revision, 1) + 1;
    NEW.delay_days := CASE
      WHEN NEW.end_date IS NOT NULL AND OLD.baseline_end_date IS NOT NULL
      THEN GREATEST(0, NEW.end_date - OLD.baseline_end_date)
      ELSE 0 END;
    INSERT INTO planning_task_versions (task_id, revision, start_date, end_date, progress, changed_by, reason)
    VALUES (OLD.id, OLD.revision, OLD.start_date, OLD.end_date, OLD.progress, COALESCE(NEW.updated_by, NEW.created_by), NEW.change_reason);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

UPDATE planning_tasks
SET baseline_start_date = COALESCE(baseline_start_date, start_date),
    baseline_end_date = COALESCE(baseline_end_date, end_date),
    gant_visible = true
WHERE baseline_start_date IS NULL OR baseline_end_date IS NULL OR gant_visible IS DISTINCT FROM true;
