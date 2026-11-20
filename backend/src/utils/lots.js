import { query } from '../db.js';

const clean = value => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);

export function cleanFreeLabel(value) {
  return clean(value);
}

export async function resolveLotId(storeId, label) {
  const name = clean(label);
  if (!storeId || !name) return null;
  const base = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'zone';
  let hash = 7;
  for (const char of name) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  const code = `LIBRE-${base}-${hash.toString(36).slice(0, 6)}`.slice(0, 50);
  const r = await query(
    `INSERT INTO lots (store_id, code, name, owner_role)
     VALUES ($1, $2, $3, NULL)
     ON CONFLICT (store_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [storeId, code, name]
  );
  return r.rows[0].id;
}
