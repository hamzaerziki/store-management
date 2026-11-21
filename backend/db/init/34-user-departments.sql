ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(10);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_department_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_department_check CHECK (department IS NULL OR department IN ('IT','MG'));
  END IF;
END $$;

UPDATE users
SET department = CASE
  WHEN role = 'IT' THEN 'IT'
  WHEN role IN ('MG','RMG') THEN 'MG'
  ELSE NULL
END
WHERE department IS NULL;
