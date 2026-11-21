-- Rename MG categories to French display names
UPDATE categories SET name = '01 ? Am?nagement retail & mobilier fixe' WHERE id = 35 AND owner_role = 'MG';
UPDATE categories SET name = '02 ? Architecture & design' WHERE id = 36 AND owner_role = 'MG';
UPDATE categories SET name = '03 ? Construction & finitions' WHERE id = 37 AND owner_role = 'MG';
UPDATE categories SET name = '04 ? ?clairage & ?lectricit?' WHERE id = 38 AND owner_role = 'MG';
UPDATE categories SET name = '05 ? CVC & protection incendie' WHERE id = 39 AND owner_role = 'MG';
UPDATE categories SET name = '07 ? Image de marque & identit? visuelle' WHERE id = 41 AND owner_role = 'MG';
UPDATE categories SET name = '08 ? D?coration & finitions' WHERE id = 42 AND owner_role = 'MG';
UPDATE categories SET name = '09 ? Logistique & co?ts indirects' WHERE id = 43 AND owner_role = 'MG';
UPDATE categories SET name = '10 ? Divers & impr?vus' WHERE id = 44 AND owner_role = 'MG';

-- App settings for SMTP/admin-configurable values
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by INT REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
