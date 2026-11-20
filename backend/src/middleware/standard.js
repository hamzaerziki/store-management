import crypto from 'crypto';
import { query } from '../db.js';
import { requireAuth } from './auth.js';

export class HttpError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details = {}) => new HttpError(400, 'VALIDATION_ERROR', message, details);
export const unauthorized = (message = 'Authentification requise') => new HttpError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Accès refusé pour votre rôle', details = {}) => new HttpError(403, 'FORBIDDEN', message, details);
export const notFound = (message = 'Ressource introuvable') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (message, details = {}) => new HttpError(409, 'CONFLICT', message, details);
export const precondition = (message, details = {}) => new HttpError(412, 'PRECONDITION_FAILED', message, details);

export function standardContext(req, res, next) {
  req.correlationId = req.get('x-correlation-id') || req.get('x-request-id') || crypto.randomUUID();
  res.setHeader('X-Correlation-Id', req.correlationId);
  next();
}

export function v1Auth(req, res, next) {
  if (!req.correlationId) req.correlationId = crypto.randomUUID();
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 1 && typeof body.error === 'string') {
      const status = res.statusCode;
      const code = status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : 'REQUEST_REJECTED';
      return originalJson({ code, message: body.error, correlation_id: req.correlationId, details: {} });
    }
    return originalJson(body);
  };
  return requireAuth(req, res, next);
}

export function v1Role(...roles) {
  const allowed = roles.flat().filter(Boolean);
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!allowed.includes(req.user.role)) {
      return next(forbidden(`Accès refusé : rôle ${req.user.role} non autorisé`, { required_roles: allowed }));
    }
    return next();
  };
}

export function errorEnvelope(res, status, code, message, correlationId, details = {}) {
  return res.status(status).json({ code, message, correlation_id: correlationId, details });
}

export function asyncV1(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function errorHandlerV1(err, req, res, next) {
  if (res.headersSent) return next(err);
  const correlationId = req.correlationId || crypto.randomUUID();
  if (err instanceof HttpError) {
    return errorEnvelope(res, err.status, err.code, err.message, correlationId, err.details || {});
  }
  const code = err && err.code;
  if (code === '23505') {
    return errorEnvelope(res, 409, 'CONFLICT', 'Doublon détecté : la valeur existe déjà', correlationId, { constraint: err.constraint || null });
  }
  if (code === '23503') {
    return errorEnvelope(res, 409, 'CONFLICT', 'Référence invalide : enregistrement lié introuvable', correlationId, { constraint: err.constraint || null });
  }
  if (code === '23514' || code === '22007' || code === '22003') {
    return errorEnvelope(res, 400, 'VALIDATION_ERROR', 'Valeur invalide au regard des contraintes métier', correlationId, { constraint: err.constraint || null });
  }
  if (code === '22P02') {
    return errorEnvelope(res, 400, 'VALIDATION_ERROR', 'Format de paramètre invalide', correlationId);
  }
  const message = err?.message || '';
  if (/immuable|Motif obligatoire|TTC incohérent|au moins un lot|dépassement/i.test(message)) {
    return errorEnvelope(res, err.status || 409, 'BUSINESS_RULE_ERROR', message, correlationId);
  }
  if (err?.status && err.status >= 400 && err.status < 500) {
    return errorEnvelope(res, err.status, 'REQUEST_REJECTED', message, correlationId);
  }
  console.error('[v1]', correlationId, err);
  return errorEnvelope(res, 500, 'INTERNAL_ERROR', 'Erreur interne du serveur', correlationId);
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const replayMemory = new Map();
const inFlight = new Set();
let tableChecked = false;
let tableUsable = false;

async function ensureIdempotencyTable() {
  if (tableChecked) return tableUsable;
  tableChecked = true;
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS v1_idempotency (
         scope TEXT NOT NULL,
         idem_key TEXT NOT NULL,
         status INT NOT NULL,
         response JSONB NOT NULL,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         expires_at TIMESTAMPTZ NOT NULL,
         PRIMARY KEY (scope, idem_key)
       )`
    );
    tableUsable = true;
  } catch (e) {
    tableUsable = false;
  }
  return tableUsable;
}

async function loadReplay(scope, key) {
  if (!(await ensureIdempotencyTable())) return null;
  try {
    const r = await query(
      'SELECT status, response FROM v1_idempotency WHERE scope=$1 AND idem_key=$2 AND expires_at > NOW()',
      [scope, key]
    );
    if (!r.rows[0]) return null;
    return { status: Number(r.rows[0].status), body: r.rows[0].response };
  } catch (e) {
    return null;
  }
}

function saveReplay(scope, key, status, body) {
  if (!tableUsable) return;
  query(
    `INSERT INTO v1_idempotency (scope, idem_key, status, response, expires_at)
     VALUES ($1,$2,$3,$4::jsonb, NOW() + ($5 || ' milliseconds')::interval)
     ON CONFLICT (scope, idem_key) DO NOTHING`,
    [scope, key, status, JSON.stringify(body), String(IDEMPOTENCY_TTL_MS)]
  ).catch(() => {});
}

export function requireIdempotencyKey(req, res, next) {
  const key = req.get('Idempotency-Key') || req.get('x-idempotency-key');
  if (!key || !String(key).trim()) {
    return next(new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'En-tête Idempotency-Key obligatoire pour cette opération financière'));
  }
  req.idempotencyKey = String(key).trim();
  return next();
}

export function idempotent() {
  return asyncV1(async (req, res, next) => {
    const key = req.idempotencyKey || req.get('Idempotency-Key') || req.get('x-idempotency-key');
    if (!key || !String(key).trim()) {
      throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'En-tête Idempotency-Key obligatoire pour cette opération financière');
    }
    const idemKey = String(key).trim();
    req.idempotencyKey = idemKey;
    const scope = `${req.user?.id || 'anon'}|${req.method}|${req.baseUrl}${req.path}`;
    const mapKey = `${scope}|${idemKey}`;
    const cached = replayMemory.get(mapKey);
    if (cached && cached.expires > Date.now()) {
      res.setHeader('X-Idempotent-Replay', 'true');
      return res.status(cached.status).json(cached.body);
    }
    if (cached) replayMemory.delete(mapKey);
    if (inFlight.has(mapKey)) {
      throw new HttpError(409, 'IDEMPOTENCY_IN_PROGRESS', 'Une requête avec cette clé d’idempotence est déjà en cours');
    }
    inFlight.add(mapKey);
    let originalJson = null;
    try {
      const stored = await loadReplay(scope, idemKey);
      if (stored) {
        inFlight.delete(mapKey);
        res.setHeader('X-Idempotent-Replay', 'true');
        return res.status(stored.status).json(stored.body);
      }
      originalJson = res.json.bind(res);
      res.json = (body) => {
        if (res.statusCode >= 200 && res.statusCode < 400 && body !== undefined) {
          replayMemory.set(mapKey, { status: res.statusCode, body, expires: Date.now() + IDEMPOTENCY_TTL_MS });
          saveReplay(scope, idemKey, res.statusCode, body);
        }
        return originalJson(body);
      };
      const release = () => inFlight.delete(mapKey);
      res.once('finish', release);
      res.once('close', release);
    } catch (e) {
      inFlight.delete(mapKey);
      if (originalJson) res.json = originalJson;
      throw e;
    }
    return next();
  });
}

export function clearIdempotencyMemory() {
  replayMemory.clear();
  inFlight.clear();
}

export function etagFor(row, versionKey = 'row_version') {
  if (!row) return '"0"';
  const value = row[versionKey] ?? row.version ?? row.updated_at ?? row.revision ?? 0;
  return `"${String(value)}"`;
}

export function setETag(res, row, versionKey = 'row_version') {
  const etag = etagFor(row, versionKey);
  res.setHeader('ETag', etag);
  return etag;
}

export function assertIfMatch(req, row, versionKey = 'row_version', label = 'ressource') {
  const header = req.get('If-Match');
  if (!header || header === '*') return;
  const expected = header.replace(/^W\//, '').replace(/^"|"$/g, '').trim();
  const current = String(row?.[versionKey] ?? row?.version ?? row?.revision ?? '');
  if (expected !== current) {
    throw new HttpError(412, 'PRECONDITION_FAILED', `Conflit de concurrence sur ${label} : version attendue ${expected}, version actuelle ${current}`, { expected, current });
  }
}

export function assertVersion(req, bodyVersion, currentVersion, label = 'document') {
  if (bodyVersion === undefined || bodyVersion === null || bodyVersion === '') return;
  const expected = Number(bodyVersion);
  const current = Number(currentVersion);
  if (!Number.isFinite(expected) || expected !== current) {
    throw new HttpError(409, 'VERSION_CONFLICT', `Version obsolète pour ${label} : attendue ${current}, reçue ${bodyVersion}`, { expected, current });
  }
}

export function parsePagination(req, defaults = {}) {
  const pageSizeDefault = Number(defaults.pageSize) > 0 ? Number(defaults.pageSize) : 20;
  const maxPageSize = Number(defaults.maxPageSize) > 0 ? Number(defaults.maxPageSize) : 100;
  const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
  const requested = parseInt(req.query?.pageSize ?? req.query?.page_size, 10);
  const pageSize = Math.min(maxPageSize, Math.max(1, Number.isFinite(requested) && requested > 0 ? requested : pageSizeDefault));
  return { page, pageSize, offset: (page - 1) * pageSize, limit: pageSize };
}

export function paginationMeta(total, page, pageSize) {
  const totalItems = Number(total) || 0;
  return {
    page,
    pageSize,
    total: totalItems,
    totalPages: pageSize > 0 ? Math.ceil(totalItems / pageSize) : 0,
    hasNext: page * pageSize < totalItems,
    hasPrevious: page > 1,
  };
}

export function sendPaginated(res, rows, pagination, total, extra = {}) {
  return res.json({ data: rows, pagination: paginationMeta(total, pagination.page, pagination.pageSize), ...extra });
}

export function paginateArray(items, pagination) {
  const list = Array.isArray(items) ? items : [];
  return list.slice(pagination.offset, pagination.offset + pagination.limit);
}

export function parseFilters(req, allowedKeys = []) {
  const filters = {};
  for (const key of allowedKeys) {
    const value = req.query?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') filters[key] = String(value).trim();
  }
  return filters;
}
