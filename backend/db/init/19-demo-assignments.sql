WITH demo_assignments(email, store_id) AS (
  VALUES
    ('it@safari.ma', 3),
    ('mg@safari.ma', 3),
    ('dd@safari.ma', 3)
)
INSERT INTO store_assignments (user_id, store_id, role, active)
SELECT u.id, d.store_id, u.role, true
FROM demo_assignments d
JOIN users u ON lower(u.email) = d.email
ON CONFLICT (user_id, store_id, lot_id) DO UPDATE
SET active = true, role = EXCLUDED.role;
