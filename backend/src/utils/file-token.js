import crypto from 'crypto';
import { config } from '../config.js';

const TTL_MS = 5 * 60 * 1000;
const hits = new Map();
export function checkFileTokenRateLimit(uid) {
  const key = String(uid || 'anon');
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < 60_000);
  arr.push(now); hits.set(key, arr);
  return arr.length <= 60;
}

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function fromB64url(str) { return Buffer.from(str, 'base64url').toString('utf8'); }

export function signFileToken({ uid, kind, id, action, ver = 0 }) {
  const payload = { uid: Number(uid), kind: String(kind), id: Number(id), action: String(action), ver: Number(ver || 0), exp: Date.now() + TTL_MS };
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', config.jwt.secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyFileToken(token, { kind, id, action } = {}) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', config.jwt.secret).update(body).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(fromB64url(body)); } catch { return null; }
  if (!payload || Number(payload.exp) < Date.now()) return null;
  if (kind && payload.kind !== kind) return null;
  if (id !== undefined && Number(payload.id) !== Number(id)) return null;
  if (action && payload.action !== action) return null;
  return payload;
}
