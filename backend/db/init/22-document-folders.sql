CREATE TABLE IF NOT EXISTS document_folders (
  id SERIAL PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, name)
);

INSERT INTO document_folders (store_id, name)
SELECT s.id, f.name
FROM stores s
CROSS JOIN (VALUES ('Photos'), ('Vidéos'), ('Plans 3D'), ('Réception'), ('Autres')) AS f(name)
ON CONFLICT (store_id, name) DO NOTHING;
