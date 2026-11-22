-- Remove default/demo users, keep only admin@safari.ma
DO $$
DECLARE r record; ids int[];
BEGIN
  SELECT array_agg(id) INTO ids FROM users
  WHERE lower(email) IN ('it@safari.ma','mg@safari.ma','cg@safari.ma','dg@safari.ma','dd@safari.ma','dd_mg@safari.ma','test_reset@safari.ma')
     OR (active=false AND lower(email) LIKE 'disabled_%@removed.local');
  IF ids IS NULL THEN
    -- still ensure only admin active
    UPDATE users SET active=false, token_version=COALESCE(token_version,0)+1 WHERE lower(email) <> 'admin@safari.ma';
  ELSE
    DELETE FROM notifications WHERE user_id = ANY(ids);
    FOR r IN
      SELECT c.conrelid::regclass AS tbl, a.attname AS col, a.attnotnull AS notnull
      FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
      WHERE c.confrelid='users'::regclass AND c.contype='f'
    LOOP
      IF r.notnull THEN
        EXECUTE format('DELETE FROM %s WHERE %I = ANY($1)', r.tbl, r.col) USING ids;
      ELSE
        BEGIN
          EXECUTE format('UPDATE %s SET %I=NULL WHERE %I = ANY($1)', r.tbl, r.col, r.col) USING ids;
        EXCEPTION WHEN others THEN
          EXECUTE format('DELETE FROM %s WHERE %I = ANY($1)', r.tbl, r.col) USING ids;
        END;
      END IF;
    END LOOP;
    DELETE FROM users WHERE id = ANY(ids);
    UPDATE users SET active=false, token_version=COALESCE(token_version,0)+1 WHERE lower(email) <> 'admin@safari.ma';
  END IF;
  UPDATE users SET active=true, role='admin', name='Administrateur' WHERE lower(email)='admin@safari.ma';
END $$;
