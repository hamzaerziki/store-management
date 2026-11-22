-- Safari Store Opening Tracker — seed data

INSERT INTO users (name,email,password_hash,role,active) VALUES
('Administrateur','admin@safari.ma','$2a$12$GBKNRM0vzY8qXM4YjRQTOe.K37j82WdfcNUw64qTyEkM54pg1HKgW','admin',true); -- default demo users removed; keep admin only

INSERT INTO stores (name,city,opening_date,status,budget) VALUES
('Lacoste Capital Mall Rabat','Rabat','2027-01-10','at_risk',3899250);

INSERT INTO categories (name,owner_role) VALUES
('Mobilier','MG'),('Équipement','MG'),('Informatique','IT'),('Signalétique','MG'),('Sécurité','MG'),('Fournitures','MG'),('Autre','BOTH');

INSERT INTO item_templates (category_id,name,default_quantity,default_budget,owner_role)
SELECT c.id, v.name, v.qty, v.budget, v.owner
FROM (VALUES
  ('Mobilier','Comptoir caisse',1,45000,'MG'),
  ('Mobilier','Étagères métalliques',6,28000,'MG'),
  ('Mobilier','Rayonnages',4,32000,'MG'),
  ('Mobilier','Meuble accueil',1,18000,'MG'),
  ('Mobilier','Chaises',8,6500,'MG'),
  ('Mobilier','Banquette',2,12000,'MG'),
  ('Équipement','Chariot élévateur',1,145000,'MG'),
  ('Équipement','Étagères entrepôt',5,38000,'MG'),
  ('Équipement','Balance',2,8500,'MG'),
  ('Équipement','Éclairage LED',12,12000,'MG'),
  ('Équipement','Climatisation',2,95000,'MG'),
  ('Équipement','Ventilateurs',4,4500,'MG'),
  ('Informatique','Terminal POS',3,55000,'IT'),
  ('Informatique','Ordinateur bureau',2,16000,'IT'),
  ('Informatique','Imprimante thermique',3,8500,'IT'),
  ('Informatique','Serveur NAS',1,42000,'IT'),
  ('Informatique','Switch réseau',2,12000,'IT'),
  ('Informatique','Scanner code-barres',3,9500,'IT'),
  ('Signalétique','Enseigne principale',1,125000,'MG'),
  ('Signalétique','Panneaux directionnels',6,15000,'MG'),
  ('Signalétique','Affiches vitrine',8,4500,'MG'),
  ('Signalétique','Totem accueil',1,38000,'MG'),
  ('Signalétique','Autocollants sol',10,2500,'MG'),
  ('Signalétique','Panneau prix',15,3500,'MG'),
  ('Sécurité','Caméras IP',8,28000,'MG'),
  ('Sécurité','Système alarme',1,55000,'MG'),
  ('Sécurité','Extincteurs',4,3500,'MG'),
  ('Sécurité','Contrôle accès',1,65000,'MG'),
  ('Sécurité','Coffre-fort',1,22000,'MG'),
  ('Sécurité','Éclairage sécurité',6,9500,'MG'),
  ('Fournitures','Sacs emballage',1000,6500,'MG'),
  ('Fournitures','Étiquettes',500,3500,'MG'),
  ('Fournitures','Papier caisse',200,2500,'MG'),
  ('Fournitures','Fournitures bureau',1,8500,'MG'),
  ('Fournitures','Nettoyants',1,2800,'MG'),
  ('Fournitures','Gants',100,1500,'MG'),
  ('Autre','Divers',1,5000,'MG'),
  ('Autre','Outillage',1,18000,'MG'),
  ('Autre','Petit matériel',1,7500,'MG'),
  ('Autre','Signalétique temporaire',1,6500,'MG'),
  ('Autre','Câblage',1,22000,'IT'),
  ('Autre','Réservation',1,4000,'MG')
) AS v(cat,name,qty,budget,owner)
JOIN categories c ON c.name = v.cat;

INSERT INTO suppliers (name,contact,notes) VALUES
('Atlas Mobiliers','contact@atlasmobiliers.ma','Mobilier de qualité, délai 3 semaines'),
('Sofira Équipement','commercial@sofira.ma','Équipement commercial'),
('TechnoPro Maroc','ventes@technopro.ma','Matériel informatique et POS'),
('Réseau Info','contact@reseauinfo.ma','Intégration réseau et câblage'),
('Signa Plus','info@signaplus.ma','Signalétique et enseignes'),
('SecuriSafari','commercial@securisafari.ma','Sécurité et surveillance'),
('Bureau Vallée Maroc','pro@bureaux.ma','Fournitures de bureau'),
('Delta Import','export@deltaimport.ma','Import général');

DO $$
DECLARE
  s RECORD; t RECORD; roll INT; st VARCHAR(25); target INT;
BEGIN
  FOR s IN SELECT * FROM stores ORDER BY id LOOP
    target := (ARRAY[120,92,78,58,40,24,10])[s.id];
    FOR t IN SELECT * FROM item_templates ORDER BY id LOOP
      roll := (t.id * 37 + s.id * 61) % 100;
      IF roll < target * 0.75 THEN st := 'installed';
      ELSIF roll < target * 0.85 THEN st := 'delivered';
      ELSIF roll < target * 0.92 THEN st := 'ordered';
      ELSIF roll < target THEN st := 'validated';
      ELSIF roll < target + 15 THEN st := 'compared';
      ELSIF roll < target + 30 THEN st := 'quotes_received';
      ELSE st := 'to_quote';
      END IF;
      INSERT INTO items (store_id,category_id,name,quantity,estimated_budget,status,owner_role,created_by)
      VALUES (s.id, t.category_id, t.name, t.default_quantity, t.default_budget,
              st, t.owner_role, CASE WHEN t.owner_role='IT' THEN 2 ELSE 3 END);
    END LOOP;
  END LOOP;
END $$;

DO $$
DECLARE
  it RECORD; j INT; sid INT; base NUMERIC; sc INT; sup_total INT;
BEGIN
  SELECT count(*) INTO sup_total FROM suppliers;
  FOR it IN SELECT * FROM items WHERE status <> 'to_quote' LOOP
    FOR j IN 1..(2 + it.id % 3) LOOP
      SELECT id INTO sid FROM suppliers ORDER BY id OFFSET ((it.id * 3 + j) % sup_total) LIMIT 1;
      base := it.estimated_budget * (0.82 + ((it.id * 7 + j * 13) % 38) / 100.0);
      INSERT INTO quotes (item_id,supplier_id,amount_ht,amount_ttc,currency,delivery_days,validity_date,
                          payment_terms,warranty_months,reliability_score,notes,uploaded_by)
      VALUES (it.id, sid, round(base,2), round(base * 1.2,2), 'MAD',
              7 + (it.id * 3 + j) % 30, CURRENT_DATE + 30 + ((it.id + j) % 60),
              '30 jours', 12, 3 + ((it.id + j) % 3),
              'Devis ' || j || ' — ' || it.name,
              CASE WHEN it.owner_role='IT' THEN 2 ELSE 3 END);
    END LOOP;
  END LOOP;
END $$;

DO $$
DECLARE
  it RECORD; cid INT; cheapest INT; cstatus VARCHAR(20);
BEGIN
  FOR it IN SELECT * FROM items WHERE status IN ('compared','validated','approved','ordered','delivered','installed') LOOP
    SELECT id INTO cheapest FROM quotes WHERE item_id = it.id ORDER BY amount_ttc ASC LIMIT 1;
    cstatus := CASE WHEN it.status = 'compared' THEN 'pending_cg' ELSE 'validated' END;
    INSERT INTO comparisons (item_id,selected_quote_id,justification,status,created_by)
    VALUES (it.id, cheapest, 'Meilleur rapport qualité/prix après analyse des devis reçus.',
            cstatus, CASE WHEN it.owner_role='IT' THEN 2 ELSE 3 END)
    RETURNING id INTO cid;
    INSERT INTO comparison_quotes (comparison_id,quote_id)
      SELECT cid, id FROM quotes WHERE item_id = it.id;
    IF cstatus = 'validated' THEN
      INSERT INTO validations (comparison_id,validator_id,validator_role,decision,comment)
      VALUES (cid, 4, 'CG', 'approved', 'Conforme au budget prévisionnel.');
      IF it.estimated_budget >= 100000 THEN
        INSERT INTO validations (comparison_id,validator_id,validator_role,decision,comment)
        VALUES (cid, 5, 'DG', 'approved', 'Validation finale accordée.');
      END IF;
    END IF;
  END LOOP;
END $$;

INSERT INTO notifications (user_id,message,type,read) VALUES
(4,'3 comparatifs en attente de validation financière','validation',false),
(4,'Nouveau devis téléversé pour Safari Tanger Centre','quote',false),
(5,'5 comparatifs nécessitent votre approbation finale','approval',false),
(1,'Bienvenue sur Safari Store Opening Tracker','info',true),
(3,'Pensez à mettre à jour le statut des articles de Fès Ville','reminder',false);

INSERT INTO audit_logs (user_id,user_name,action,entity,entity_id,details) VALUES
(4,'Nabil Farouk','VALIDATE_COMPARISON','comparison',1,'{"decision":"approved","role":"CG"}'),
(3,'Salma Idrissi','UPLOAD_QUOTE','quote',1,'{"supplier":"Atlas Mobiliers"}'),
(2,'Karim Benali','UPDATE_ITEM_STATUS','item',12,'{"from":"compared","to":"ordered"}'),
(5,'M. Diallo','FINAL_APPROVAL','comparison',4,'{"decision":"approved"}'),
(1,'Administrateur','CREATE_STORE','store',3,'{"name":"Lacoste Capital Mall Rabat"}');
