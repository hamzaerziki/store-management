import { query } from '../db.js';

const cache = new Map();
const TTL_MS = 30_000;

function getCached(key) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  cache.delete(key);
  return undefined;
}

export async function getSetting(key, fallback = null) {
  const cached = getCached(key);
  if (cached !== undefined) return cached;
  try {
    const r = await query('SELECT value FROM app_settings WHERE key=$1', [key]);
    const value = r.rows[0]?.value ?? fallback;
    cache.set(key, { value, expires: Date.now() + TTL_MS });
    return value;
  } catch {
    return fallback;
  }
}

export async function setSetting(key, value, userId = null) {
  await query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=NOW()`,
    [key, JSON.stringify(value ?? {}), userId]
  );
  cache.delete(key);
}

export function clearSettingCache(key) {
  if (key) cache.delete(key); else cache.clear();
}
