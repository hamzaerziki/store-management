UPDATE quotes
   SET state = 'brouillon'
 WHERE state IS NULL OR btrim(state) = '';

UPDATE quotes
   SET version = 1
 WHERE version IS NULL OR version < 1;

UPDATE quotes
   SET row_version = 1
 WHERE row_version IS NULL OR row_version < 1;

UPDATE quotes
   SET quote_ref = 'Q-' || id
 WHERE quote_ref IS NULL OR btrim(quote_ref) = '';

UPDATE quotes
   SET issue_date = COALESCE(created_at::date, CURRENT_DATE)
 WHERE issue_date IS NULL;

UPDATE quotes
   SET expiry_date = (issue_date + INTERVAL '30 days')::date
 WHERE expiry_date IS NULL AND issue_date IS NOT NULL;
