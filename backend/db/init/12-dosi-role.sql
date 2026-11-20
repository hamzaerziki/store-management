ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

UPDATE users SET role = 'DD' WHERE role IN ('DOSI', 'DD-IT');

ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','IT','MG','RMG','CDG','CG','DD','DD-IT','DD-MG','DG'))
;

UPDATE validations SET validator_role = 'DD' WHERE validator_role IN ('DOSI', 'DD-IT');
UPDATE demand_validations SET validator_role = 'DD' WHERE validator_role IN ('DOSI', 'DD-IT');
UPDATE state_transitions SET actor_role = 'DD' WHERE actor_role IN ('DOSI', 'DD-IT');
