-- 37-fix-category-mojibake.sql
-- Idempotent fix for mojibake in category names
UPDATE categories SET name = '02 - Architecture & design' WHERE id = 36 AND (name LIKE '%?%' OR name LIKE '%?%' OR name LIKE '%?%' OR name <> '02 - Architecture & design');
UPDATE categories SET name = '03 - Construction & finitions' WHERE id = 37 AND (name LIKE '%?%' OR name LIKE '%?%' OR name LIKE '%?%' OR name <> '03 - Construction & finitions');
UPDATE categories SET name = '04 - ?clairage & ?lectricit?' WHERE id = 38 AND (name LIKE '%?%' OR name LIKE '%?%' OR name LIKE '%?%' OR name <> '04 - ?clairage & ?lectricit?');
UPDATE categories SET name = '05 - CVC & protection incendie' WHERE id = 39 AND (name LIKE '%?%' OR name LIKE '%?%' OR name LIKE '%?%' OR name <> '05 - CVC & protection incendie');
UPDATE categories SET name = '07 - Image de marque & identit? visuelle' WHERE id = 41 AND (name LIKE '%?%' OR name LIKE '%?%' OR name LIKE '%?%' OR name <> '07 - Image de marque & identit? visuelle');
