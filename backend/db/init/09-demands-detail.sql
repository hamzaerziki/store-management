ALTER TABLE demands ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'article';
ALTER TABLE demands DROP CONSTRAINT IF EXISTS demands_kind_check;
ALTER TABLE demands ADD CONSTRAINT demands_kind_check CHECK (kind IN ('article','mission'));
ALTER TABLE demands ADD COLUMN IF NOT EXISTS deadline DATE;
