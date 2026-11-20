ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','IT','MG','RMG','CDG','CG','DD','DD-IT','DD-MG','DG'));

UPDATE users SET role='DD', name='Direction Développement' WHERE lower(email)='dd@safari.ma';

ALTER TABLE categories ADD COLUMN IF NOT EXISTS items_included TEXT;

INSERT INTO categories (name, owner_role, items_included) VALUES
  ('01 — RETAIL FIT-OUT & FIXTURES','MG',NULL),
  ('02 — ARCHITECTURE & DESIGN','MG',NULL),
  ('03 — CONSTRUCTION & FINISHING','MG',NULL),
  ('04 — LIGHTING & ELECTRICAL','MG',NULL),
  ('05 — HVAC & FIRE PROTECTION','MG',NULL),
  ('07 — BRANDING & VISUAL IDENTITY','MG',NULL),
  ('08 — DECORATION & FINISHES','MG',NULL),
  ('09 — LOGISTICS & INDIRECT COSTS','MG',NULL),
  ('10 — MISCELLANEOUS & CONTINGENCY','MG',NULL),
  ('11 — VIDÉOSURVEILLANCE','IT','NVR, IP cameras, storage HDD, tubage & câblage'),
  ('12 — COMPTEUR DE PASSAGE','IT','3D passage-counting camera, tubage & câblage'),
  ('13 — DÉTECTION INCENDIE','IT','Fire detection central, tubage & câblage'),
  ('14 — INFORMATIQUE & RÉSEAU','IT','IT rack, PoE switch, non-PoE switch, patch panels, rack extension, access points, tubage & câblage'),
  ('15 — POINTAGE DU PERSONNEL','IT','Biometric time attendance terminal, tubage & câblage'),
  ('16 — CONTRÔLE D’ACCÈS','IT','Access control terminal, exit button, door closer, electromagnetic lock, tubage & câblage'),
  ('17 — SONORISATION','IT','Amplifier, ceiling speakers, tubage & câblage'),
  ('18 — ANTIVOL MAGASIN','IT','AM anti-theft antennas, manual tag detacher, electric tag detacher, tubage & câblage')
ON CONFLICT (name) DO UPDATE SET owner_role=EXCLUDED.owner_role, items_included=EXCLUDED.items_included;

CREATE TABLE IF NOT EXISTS budget_categories (
  id SERIAL PRIMARY KEY,
  store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  department VARCHAR(3) NOT NULL CHECK (department IN ('IT','MG')),
  planned_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, category_id, department)
);

CREATE TABLE IF NOT EXISTS budget_category_lines (
  id SERIAL PRIMARY KEY,
  store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  department VARCHAR(3) NOT NULL CHECK (department IN ('IT','MG')),
  article TEXT NOT NULL,
  supplier_id INT REFERENCES suppliers(id) ON DELETE SET NULL,
  amount_ht NUMERIC(14,2) NOT NULL DEFAULT 0,
  source_file TEXT NOT NULL DEFAULT 'BUDGET LACOSTE CAPITAL MALL V1 (1).xlsx',
  source_row INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (store_id, category_id, article, supplier_id, amount_ht)
);

CREATE TABLE IF NOT EXISTS supplier_categories (
  supplier_id INT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  category_id INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (supplier_id, category_id)
);

INSERT INTO suppliers (name, created_at)
SELECT v.name, NOW()
FROM (VALUES
  ('CEVIZOGLU'),('MIRAGE'),('BALSAN'),('OWL STUDIO'),('TRATO'),('CEOS'),('LCDA'),
  ('CARLIPA'),('INDUSTRIE DU DECORS'),('SHAMS'),('BOULAHIA TOPO'),('RMS'),('FRIGIVAL'),
  ('AZ ARCHITECHT'),('LATCO'),('RISK'),('RABAT INCENDIE'),('INDUS RAYONNAGE'),('CANAL 7')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM suppliers s WHERE lower(s.name)=lower(v.name));

DROP TABLE IF EXISTS _budget_store;
CREATE TEMP TABLE _budget_store AS
SELECT id FROM stores WHERE name LIKE 'Lacoste%' ORDER BY id LIMIT 1;

WITH lines(article, supplier_name, department, category_name, amount_ht, source_row) AS (
  VALUES
    ('MOBILIER','CEVIZOGLU','MG','01 — RETAIL FIT-OUT & FIXTURES',1377932.25,4),
    ('CARRELAGE','MIRAGE','MG','03 — CONSTRUCTION & FINISHING',23535.00,5),
    ('TAPIS SURFACE','BALSAN','MG','08 — DECORATION & FINISHES',13987.50,6),
    ('PLV - MANNEQUINS - CINTRES','', 'MG','01 — RETAIL FIT-OUT & FIXTURES',131250.00,7),
    ('ETUDE LUMINAIRE','OWL STUDIO','MG','04 — LIGHTING & ELECTRICAL',25000.00,8),
    ('LUMINAIRE','TRATO','MG','04 — LIGHTING & ELECTRICAL',187895.00,9),
    ('ENSEIGNE','CEOS','MG','07 — BRANDING & VISUAL IDENTITY',187500.00,10),
    ('BETON FACADE','LCDA','MG','03 — CONSTRUCTION & FINISHING',100781.145,11),
    ('ECRAN LED','CARLIPA','IT','14 — INFORMATIQUE & RÉSEAU',125000.00,12),
    ('RIDEAU CABINE','INDUSTRIE DU DECORS','MG','08 — DECORATION & FINISHES',10937.50,13),
    ('DISTRIBUTEUR PARFUM','SHAMS','MG','10 — MISCELLANEOUS & CONTINGENCY',25740.00,14),
    ('INSTALLATIONS MOBILIER','CEVIZOGLU','MG','01 — RETAIL FIT-OUT & FIXTURES',115500.00,16),
    ('LOGISTICS','', 'MG','09 — LOGISTICS & INDIRECT COSTS',0,17),
    ('SERVICE CHARGE','', 'MG','09 — LOGISTICS & INDIRECT COSTS',0,18),
    ('PACKAGING ET AUTRES SERVICES','', 'MG','09 — LOGISTICS & INDIRECT COSTS',0,19),
    ('LEVE TOPOGRAPHIQUE MAGASIN LACOSTE','BOULAHIA TOPO','MG','02 — ARCHITECTURE & DESIGN',4600.00,22),
    ('TRAVAUX DAMENAGEMENT - GROS OEUVRE - FAUX PLAFOND - REVETEMENT - PEINTURE - MENUISERIE - ELECTRICITE - VITRERIE - FACADE','RMS','MG','03 — CONSTRUCTION & FINISHING',832715.80,23),
    ('CLIMATISATION - VENTILLATION - SPRINKLAGE','FRIGIVAL','MG','05 — HVAC & FIRE PROTECTION',166515.00,24),
    ('ARCHITECTE LOCAL','AZ ARCHITECHT','MG','02 — ARCHITECTURE & DESIGN',30000.00,25),
    ('TV ET SUPPORT','LATCO','IT','14 — INFORMATIQUE & RÉSEAU',31560.00,26),
    ('MATERIEL INFORMATIQUE','', 'IT','14 — INFORMATIQUE & RÉSEAU',20000.00,27),
    ('SONORISATION - SECURITE - DETECTION INCENDIE - COMPTEUR DE PASSAGE - SYSTEME ANTI-INTRUSION ET SURVEILLANCE','RISK','IT','11 — VIDÉOSURVEILLANCE',157190.00,28),
    ('EXTINCTEURS','RABAT INCENDIE','MG','05 — HVAC & FIRE PROTECTION',3500.00,29),
    ('RAYONNAGE','INDUS RAYONNAGE','MG','01 — RETAIL FIT-OUT & FIXTURES',20000.00,30),
    ('PALLISADE - HABILLAGE ET DESHABILLAGE VITRE','CANAL 7','MG','07 — BRANDING & VISUAL IDENTITY',20000.00,31),
    ('AUTRE / SUPPLEMENT','', 'MG','10 — MISCELLANEOUS & CONTINGENCY',200000.00,32)
)
INSERT INTO budget_category_lines (store_id, category_id, department, article, supplier_id, amount_ht, source_row)
SELECT
  (SELECT id FROM _budget_store),
  c.id,
  l.department,
  l.article,
  (SELECT s.id FROM suppliers s WHERE lower(s.name)=lower(l.supplier_name) LIMIT 1),
  l.amount_ht,
  l.source_row
FROM lines l
JOIN categories c ON c.name=l.category_name
ON CONFLICT (store_id, category_id, article, supplier_id, amount_ht) DO NOTHING;

INSERT INTO budget_categories (store_id, category_id, department, planned_amount)
SELECT store_id, category_id, department, ROUND(SUM(amount_ht), 2)
FROM budget_category_lines
WHERE store_id IN (SELECT id FROM _budget_store)
GROUP BY store_id, category_id, department
ON CONFLICT (store_id, category_id, department) DO UPDATE SET planned_amount=EXCLUDED.planned_amount;

INSERT INTO supplier_categories (supplier_id, category_id)
SELECT DISTINCT supplier_id, category_id
FROM budget_category_lines
WHERE store_id IN (SELECT id FROM _budget_store) AND supplier_id IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE stores SET budget=3899250 WHERE id IN (SELECT id FROM _budget_store);

DROP TABLE _budget_store;
