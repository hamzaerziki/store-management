INSERT INTO stores (name, city, opening_date, status, budget)
SELECT 'Lacoste Capital Mall Rabat', 'Rabat', '2027-01-10', 'at_risk', 3899250
WHERE NOT EXISTS (SELECT 1 FROM stores WHERE name LIKE 'Lacoste%');

DROP TABLE IF EXISTS _keep_store;
CREATE TEMP TABLE _keep_store AS
SELECT id FROM stores WHERE name LIKE 'Lacoste%' ORDER BY id LIMIT 1;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','IT','MG','RMG','CDG','CG','DD','DD-IT','DD-MG','DG'));

UPDATE users SET role='DD' WHERE role='DOSI';

DELETE FROM stores WHERE id NOT IN (SELECT id FROM _keep_store);
UPDATE stores
SET name='Lacoste Capital Mall Rabat', city='Rabat', budget=3899250
WHERE id IN (SELECT id FROM _keep_store);

DELETE FROM budget_category_lines
WHERE store_id IN (SELECT id FROM _keep_store)
  AND category_id IN (SELECT id FROM categories WHERE name IN (
    'Mobilier & Agencement','Travaux & Finitions','Éclairage & Signalétique',
    'Informatique & Multimédia','Sécurité & Incendie','Études & Ingénierie',
    'Climatisation & Technique','Logistique & Services','Divers & Compléments'
  ));
DELETE FROM budget_categories
WHERE store_id IN (SELECT id FROM _keep_store)
  AND category_id IN (SELECT id FROM categories WHERE name IN (
    'Mobilier & Agencement','Travaux & Finitions','Éclairage & Signalétique',
    'Informatique & Multimédia','Sécurité & Incendie','Études & Ingénierie',
    'Climatisation & Technique','Logistique & Services','Divers & Compléments'
  ));
DELETE FROM supplier_categories WHERE category_id IN (
  SELECT id FROM categories WHERE name IN (
    'Mobilier & Agencement','Travaux & Finitions','Éclairage & Signalétique',
    'Informatique & Multimédia','Sécurité & Incendie','Études & Ingénierie',
    'Climatisation & Technique','Logistique & Services','Divers & Compléments'
  )
);
DELETE FROM categories WHERE name IN (
  'Mobilier & Agencement','Travaux & Finitions','Éclairage & Signalétique',
  'Informatique & Multimédia','Sécurité & Incendie','Études & Ingénierie',
  'Climatisation & Technique','Logistique & Services','Divers & Compléments'
) AND NOT EXISTS (SELECT 1 FROM items WHERE category_id=categories.id);

ALTER TABLE demands ALTER COLUMN submitted_at DROP NOT NULL;
UPDATE demands SET submitted_at=NULL WHERE status='draft';

UPDATE lots
SET budget=3899250, name='Budget Lacoste Capital Mall', status='brouillon'
WHERE id=(SELECT l.id FROM lots l JOIN _keep_store k ON k.id=l.store_id ORDER BY l.id LIMIT 1);

WITH imported_items AS (
  INSERT INTO items (store_id, lot_id, category_id, name, estimated_budget, owner_role, created_by, is_service)
  SELECT
    (SELECT id FROM _keep_store),
    (SELECT l.id FROM lots l JOIN _keep_store k ON k.id=l.store_id ORDER BY l.id LIMIT 1),
    bcl.category_id,
    LEFT(bcl.article, 200),
    bcl.amount_ht,
    bcl.department,
    CASE WHEN bcl.department='IT'
      THEN (SELECT id FROM users WHERE role='IT' AND active=true ORDER BY id LIMIT 1)
      ELSE (SELECT id FROM users WHERE role='MG' AND active=true ORDER BY id LIMIT 1)
    END,
    false
  FROM budget_category_lines bcl
  JOIN _keep_store k ON k.id=bcl.store_id
  WHERE NOT EXISTS (
      SELECT 1 FROM items i
      JOIN _keep_store ik ON ik.id=i.store_id
      WHERE i.name=LEFT(bcl.article, 200)
        AND i.estimated_budget=bcl.amount_ht
  )
  RETURNING id, name, category_id, estimated_budget, owner_role, created_by
), imported_demands AS (
  INSERT INTO demands (store_id, lot_id, item_id, title, description, amount, kind, owner_role, status, submitted_at, created_by)
  SELECT
    (SELECT id FROM _keep_store),
    (SELECT l.id FROM lots l JOIN _keep_store k ON k.id=l.store_id ORDER BY l.id LIMIT 1),
    ii.id,
    ii.name,
    'Importé du workbook BUDGET LACOSTE CAPITAL MALL V1 (1).xlsx',
    ii.estimated_budget,
    'article',
    ii.owner_role,
    'draft',
    NULL,
    ii.created_by
  FROM imported_items ii
  WHERE NOT EXISTS (SELECT 1 FROM demands d WHERE d.item_id=ii.id)
  RETURNING id, item_id
)
INSERT INTO quotes (item_id, supplier_id, demand_id, lot_id, amount_ht, amount_tva, amount_ttc,
                    currency, quote_ref, notes, uploaded_by, state, created_by)
SELECT
  idm.item_id,
  bcl.supplier_id,
  idm.id,
  (SELECT l.id FROM lots l JOIN _keep_store k ON k.id=l.store_id ORDER BY l.id LIMIT 1),
  bcl.amount_ht,
  ROUND(bcl.amount_ht * 0.20, 2),
  ROUND(bcl.amount_ht * 1.20, 2),
  'MAD',
  LEFT('WB-LACOSTE-' || COALESCE(bcl.source_row::text, bcl.id::text), 100),
  'Ligne importée du workbook — catégorie : ' || c.name || ' — prestataire : ' || COALESCE(s.name, 'non renseigné'),
  i.created_by,
  'brouillon',
  i.created_by
FROM imported_demands idm
JOIN items i ON i.id=idm.item_id
JOIN budget_category_lines bcl
  ON bcl.category_id=i.category_id
 AND LEFT(bcl.article, 200)=i.name
 AND bcl.amount_ht=i.estimated_budget
JOIN _keep_store k ON k.id=bcl.store_id
JOIN categories c ON c.id=bcl.category_id
LEFT JOIN suppliers s ON s.id=bcl.supplier_id
WHERE bcl.supplier_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM quotes q WHERE q.demand_id=idm.id);

DROP TABLE _keep_store;
