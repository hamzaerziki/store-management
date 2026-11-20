INSERT INTO brands (name, code) VALUES
('Sandro', 'SD'), ('Maje', 'MJ'), ('Lacoste', 'LC'), ('Boss', 'BS'), ('Gant', 'GN')
ON CONFLICT (name) DO NOTHING;

UPDATE stores SET name = 'Lacoste Capital Mall Rabat', city = 'Rabat', brand = 'Lacoste', code = 'LC', brand_id = (SELECT id FROM brands WHERE name = 'Lacoste') WHERE name LIKE 'Lacoste%';

DELETE FROM stores WHERE name NOT LIKE 'Lacoste%';
