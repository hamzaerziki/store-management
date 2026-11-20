ALTER TABLE stores ADD COLUMN IF NOT EXISTS image_url TEXT;

INSERT INTO document_folders (store_id, name)
SELECT s.id, 'Devis'
FROM stores s
ON CONFLICT (store_id, name) DO NOTHING;
