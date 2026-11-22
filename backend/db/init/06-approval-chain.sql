ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','IT','MG','RMG','CDG','CG','DD','DD-IT','DD-MG','DG'))
;

UPDATE users SET role = 'CDG' WHERE role = 'CG';
UPDATE validations SET validator_role = 'CDG' WHERE validator_role = 'CG';
ALTER TABLE comparisons DROP CONSTRAINT IF EXISTS comparisons_status_check;

UPDATE comparisons SET status = 'pending_cdg' WHERE status = 'pending_cg';

ALTER TABLE comparisons ADD CONSTRAINT comparisons_status_check CHECK (status IN ('draft','pending_cdg','pending_dd','pending_dg','validated','rejected'));

-- demo DD users removed; admin only
