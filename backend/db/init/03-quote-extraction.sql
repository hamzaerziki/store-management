ALTER TABLE quotes ADD COLUMN IF NOT EXISTS extracted_data JSONB DEFAULT '{}'::jsonb;
