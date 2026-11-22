ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','IT','MG','RMG','CDG','CG','DD','DD-IT','DD-MG','DG'))
;

ALTER TABLE validations ALTER COLUMN validator_role TYPE VARCHAR(20);
ALTER TABLE demand_validations ALTER COLUMN validator_role TYPE VARCHAR(20);


-- demo DD users removed; admin only
ALTER TABLE planning_tasks ADD COLUMN IF NOT EXISTS demand_id INT REFERENCES demands(id) ON DELETE SET NULL;
ALTER TABLE planning_tasks ADD COLUMN IF NOT EXISTS amount NUMERIC(14,2) DEFAULT 0;
ALTER TABLE planning_tasks ADD COLUMN IF NOT EXISTS department VARCHAR(10);
CREATE UNIQUE INDEX IF NOT EXISTS idx_planning_tasks_demand ON planning_tasks(demand_id) WHERE demand_id IS NOT NULL;
