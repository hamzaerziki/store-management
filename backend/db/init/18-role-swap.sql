ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_owner_role_check;
ALTER TABLE item_templates DROP CONSTRAINT IF EXISTS item_templates_owner_role_check;
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_owner_role_check;
ALTER TABLE demands DROP CONSTRAINT IF EXISTS demands_owner_role_check;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE role = 'DD-MG')
    OR EXISTS (SELECT 1 FROM risks WHERE owner_role = 'DD-MG')
    OR EXISTS (SELECT 1 FROM delegations WHERE role = 'DD-MG')
    OR EXISTS (SELECT 1 FROM store_assignments WHERE role = 'DD-MG')
    OR EXISTS (SELECT 1 FROM state_transitions WHERE actor_role = 'DD-MG')
    OR EXISTS (SELECT 1 FROM project_members WHERE role = 'DD-MG')
    OR EXISTS (SELECT 1 FROM notification_rules WHERE recipient_roles @> ARRAY['DD-MG']) THEN

    UPDATE users SET role = 'MG' WHERE role = 'RMG';
    UPDATE users SET role = 'RMG' WHERE role = 'DD-MG';

    UPDATE categories SET owner_role = 'MG' WHERE owner_role = 'RMG';
    UPDATE item_templates SET owner_role = 'MG' WHERE owner_role = 'RMG';
    UPDATE items SET owner_role = 'MG' WHERE owner_role = 'RMG';
    UPDATE demands SET owner_role = 'MG' WHERE owner_role = 'RMG';
    UPDATE lots SET owner_role = 'MG' WHERE owner_role = 'RMG';

    UPDATE risks SET owner_role = 'MG' WHERE owner_role = 'RMG';
    UPDATE risks SET owner_role = 'RMG' WHERE owner_role = 'DD-MG';

    UPDATE delegations SET role = 'MG' WHERE role = 'RMG';
    UPDATE delegations SET role = 'RMG' WHERE role = 'DD-MG';
    UPDATE store_assignments SET role = 'MG' WHERE role = 'RMG';
    UPDATE store_assignments SET role = 'RMG' WHERE role = 'DD-MG';
    UPDATE state_transitions SET actor_role = 'MG' WHERE actor_role = 'RMG';
    UPDATE state_transitions SET actor_role = 'RMG' WHERE actor_role = 'DD-MG';
    UPDATE project_members SET role = 'MG' WHERE role = 'RMG';
    UPDATE project_members SET role = 'RMG' WHERE role = 'DD-MG';

    UPDATE notification_rules
    SET recipient_roles = ARRAY(
      SELECT CASE WHEN value = 'DD-MG' THEN 'RMG' WHEN value = 'RMG' THEN 'MG' ELSE value END
      FROM unnest(recipient_roles) AS value
    )
    WHERE recipient_roles && ARRAY['DD-MG', 'RMG'];
  END IF;
END $$;

ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','IT','MG','RMG','CDG','CG','DD','DD-IT','DD-MG','DG'))
;
ALTER TABLE categories ADD CONSTRAINT categories_owner_role_check CHECK (owner_role IN ('IT','MG','RMG','BOTH'));
ALTER TABLE item_templates ADD CONSTRAINT item_templates_owner_role_check CHECK (owner_role IN ('IT','MG','RMG'));
ALTER TABLE items ADD CONSTRAINT items_owner_role_check CHECK (owner_role IN ('IT','MG','RMG'));
ALTER TABLE demands ADD CONSTRAINT demands_owner_role_check CHECK (owner_role IN ('IT','MG','RMG'));
