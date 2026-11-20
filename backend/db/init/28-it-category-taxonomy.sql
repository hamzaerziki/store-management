ALTER TABLE categories ADD COLUMN IF NOT EXISTS items_included TEXT;

UPDATE categories SET owner_role='MG'
WHERE name IN (
  '01 — RETAIL FIT-OUT & FIXTURES',
  '02 — ARCHITECTURE & DESIGN',
  '03 — CONSTRUCTION & FINISHING',
  '04 — LIGHTING & ELECTRICAL',
  '05 — HVAC & FIRE PROTECTION',
  '07 — BRANDING & VISUAL IDENTITY',
  '08 — DECORATION & FINISHES',
  '09 — LOGISTICS & INDIRECT COSTS',
  '10 — MISCELLANEOUS & CONTINGENCY'
);

INSERT INTO categories (name, owner_role, items_included) VALUES
  ('11 — VIDÉOSURVEILLANCE','IT','NVR, IP cameras, storage HDD, tubage & câblage'),
  ('12 — COMPTEUR DE PASSAGE','IT','3D passage-counting camera, tubage & câblage'),
  ('13 — DÉTECTION INCENDIE','IT','Fire detection central, tubage & câblage'),
  ('14 — INFORMATIQUE & RÉSEAU','IT','IT rack, PoE switch, non-PoE switch, patch panels, rack extension, access points, tubage & câblage'),
  ('15 — POINTAGE DU PERSONNEL','IT','Biometric time attendance terminal, tubage & câblage'),
  ('16 — CONTRÔLE D’ACCÈS','IT','Access control terminal, exit button, door closer, electromagnetic lock, tubage & câblage'),
  ('17 — SONORISATION','IT','Amplifier, ceiling speakers, tubage & câblage'),
  ('18 — ANTIVOL MAGASIN','IT','AM anti-theft antennas, manual tag detacher, electric tag detacher, tubage & câblage')
ON CONFLICT (name) DO UPDATE SET owner_role=EXCLUDED.owner_role, items_included=EXCLUDED.items_included;

DROP TABLE IF EXISTS _it_category_map;
CREATE TEMP TABLE _it_category_map (article TEXT, category_name TEXT);
INSERT INTO _it_category_map (article, category_name) VALUES
  ('ECRAN LED','14 — INFORMATIQUE & RÉSEAU'),
  ('TV ET SUPPORT','14 — INFORMATIQUE & RÉSEAU'),
  ('MATERIEL INFORMATIQUE','14 — INFORMATIQUE & RÉSEAU'),
  ('SONORISATION - SECURITE - DETECTION INCENDIE - COMPTEUR DE PASSAGE - SYSTEME ANTI-INTRUSION ET SURVEILLANCE','11 — VIDÉOSURVEILLANCE');

DELETE FROM budget_category_lines bcl
USING _it_category_map m
WHERE bcl.category_id=(SELECT id FROM categories WHERE name='06 — IT, SECURITY & AUDIOVISUAL')
  AND bcl.article=m.article;

UPDATE items i
SET category_id=c.id, owner_role='IT'
FROM _it_category_map m
JOIN categories c ON c.name=m.category_name
WHERE i.category_id=(SELECT id FROM categories WHERE name='06 — IT, SECURITY & AUDIOVISUAL')
  AND i.name=m.article;

DROP TABLE IF EXISTS _duplicate_workbook_items;
CREATE TEMP TABLE _duplicate_workbook_items AS
SELECT id
FROM (
  SELECT i.id, ROW_NUMBER() OVER (
    PARTITION BY i.store_id, i.name, i.estimated_budget ORDER BY i.id
  ) AS row_number
  FROM items i
  JOIN _it_category_map m ON i.name=m.article
) ranked
WHERE row_number > 1;

DELETE FROM quotes q USING _duplicate_workbook_items d WHERE q.item_id=d.id;
DELETE FROM demands d USING _duplicate_workbook_items dup WHERE d.item_id=dup.id;
DELETE FROM items i USING _duplicate_workbook_items d WHERE i.id=d.id;
DROP TABLE _duplicate_workbook_items;

UPDATE item_templates t SET category_id=c.id, owner_role='IT'
FROM categories c
WHERE c.name='14 — INFORMATIQUE & RÉSEAU'
  AND t.name IN ('Scanner code-barres','Switch réseau','Serveur NAS','Imprimante thermique','Ordinateur bureau','Terminal POS','Câblage');
UPDATE item_templates t SET category_id=c.id, owner_role='IT'
FROM categories c WHERE c.name='11 — VIDÉOSURVEILLANCE' AND t.name='Caméras IP';
UPDATE item_templates t SET category_id=c.id, owner_role='IT'
FROM categories c WHERE c.name='16 — CONTRÔLE D’ACCÈS' AND t.name='Contrôle accès';
UPDATE item_templates t SET category_id=c.id, owner_role='IT'
FROM categories c WHERE c.name='18 — ANTIVOL MAGASIN' AND t.name IN ('Système alarme','Éclairage sécurité');

DELETE FROM supplier_categories
WHERE category_id=(SELECT id FROM categories WHERE name='06 — IT, SECURITY & AUDIOVISUAL');
INSERT INTO supplier_categories (supplier_id, category_id)
SELECT DISTINCT bcl.supplier_id, bcl.category_id
FROM budget_category_lines bcl
WHERE bcl.supplier_id IS NOT NULL
ON CONFLICT DO NOTHING;

DELETE FROM budget_categories
WHERE category_id=(SELECT id FROM categories WHERE name='06 — IT, SECURITY & AUDIOVISUAL');

DELETE FROM categories WHERE name='06 — IT, SECURITY & AUDIOVISUAL';

INSERT INTO budget_categories (store_id, category_id, department, planned_amount)
SELECT s.id, c.id, 'IT', 0
FROM stores s
CROSS JOIN categories c
WHERE c.name IN (
  '11 — VIDÉOSURVEILLANCE','12 — COMPTEUR DE PASSAGE','13 — DÉTECTION INCENDIE',
  '14 — INFORMATIQUE & RÉSEAU','15 — POINTAGE DU PERSONNEL','16 — CONTRÔLE D’ACCÈS',
  '17 — SONORISATION','18 — ANTIVOL MAGASIN'
)
ON CONFLICT (store_id, category_id, department) DO NOTHING;

UPDATE budget_categories bc
SET planned_amount=COALESCE(s.total, 0)
FROM (
  SELECT store_id, category_id, ROUND(SUM(amount_ht), 2) AS total
  FROM budget_category_lines
  GROUP BY store_id, category_id
) s
WHERE bc.store_id=s.store_id AND bc.category_id=s.category_id;

DROP TABLE _it_category_map;
