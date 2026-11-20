import { Router } from 'express';
import { query } from '../../db.js';
import {
  asyncV1, setETag, badRequest, conflict, forbidden,
  parsePagination, sendPaginated, parseFilters, assertIfMatch,
} from '../../middleware/standard.js';
import {
  auditV1, parseId, requireFields, FINANCIAL_READ_ROLES,
} from './shared.js';
import {
  validateTaxRateInput, calculateDocumentTotals, ROUNDING_RULES,
} from '../../services/tax-service.js';
import {
  listRules, listTemplates, upsertRules, upsertTemplates,
  listNotifications, markNotificationRead, EVENT_KEYS,
} from '../../services/notification-service.js';

const router = Router();

const ADMIN_ROLES = ['admin', 'DG'];

function dayBefore(value) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

router.get('/tax-rates', asyncV1(async (req, res) => {
  const pagination = parsePagination(req, { pageSize: 25 });
  const filters = parseFilters(req, ['code', 'regime', 'active', 'valid_on']);
  const params = [];
  let where = 'deleted_at IS NULL';
  if (filters.code) { params.push(filters.code); where += ` AND code ILIKE $${params.length}`; }
  if (filters.regime) { params.push(filters.regime); where += ` AND regime = $${params.length}`; }
  if (filters.active !== undefined) { params.push(filters.active === 'true'); where += ` AND active = $${params.length}`; }
  if (filters.valid_on) { params.push(filters.valid_on); where += ` AND valid_from <= $${params.length} AND (valid_to IS NULL OR valid_to >= $${params.length})`; }
  const total = (await query(`SELECT count(*)::int AS count FROM tax_rates WHERE ${where}`, params)).rows[0]?.count || 0;
  const r = await query(
    `SELECT * FROM tax_rates WHERE ${where} ORDER BY valid_from DESC, code LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  sendPaginated(res, r.rows, pagination, total, { filters });
}));

router.post('/tax-rates', asyncV1(async (req, res) => {
  if (!ADMIN_ROLES.includes(req.user.role)) throw forbidden('Administration des taux de TVA réservée à admin / DG');
  const input = validateTaxRateInput(req.body || {});
  const exists = await query('SELECT id FROM tax_rates WHERE code=$1', [input.code]);
  if (exists.rowCount) throw conflict('Code de taux de TVA déjà existant', { code: input.code });
  const inserted = await query(
    `INSERT INTO tax_rates
       (code, label, rate, regime, valid_from, valid_to, active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
     RETURNING *`,
    [
      input.code, input.label, input.rate, input.regime,
      input.valid_from || new Date().toISOString().slice(0, 10),
      input.valid_to || null,
      input.active === undefined ? true : input.active,
      req.user.id,
    ]
  );
  await auditV1(req, 'TAX_RATE_CREATE', 'tax_rate', inserted.rows[0].id, input);
  setETag(res, inserted.rows[0]);
  res.status(201).json({ tax_rate: inserted.rows[0] });
}));

router.patch('/tax-rates/:id', asyncV1(async (req, res) => {
  if (!ADMIN_ROLES.includes(req.user.role)) throw forbidden('Administration des taux de TVA réservée à admin / DG');
  const id = parseId(req.params.id, 'taux de TVA');
  const current = (await query('SELECT * FROM tax_rates WHERE id=$1 AND deleted_at IS NULL', [id])).rows[0];
  if (!current) throw badRequest('Taux de TVA introuvable');
  assertIfMatch(req, current, 'row_version', 'taux de TVA');
  const input = validateTaxRateInput(req.body || {}, true);
  const effectiveChange = ['code', 'rate', 'regime'].some(key => input[key] !== undefined && String(input[key]) !== String(current[key]));
  const used = await query('SELECT count(*)::int AS count FROM document_lines WHERE tax_rate_id=$1', [id]);
  const effectiveFrom = req.body.effective_from || input.valid_from;

  if (effectiveChange && effectiveFrom && effectiveFrom !== String(current.valid_from)) {
    const closed = await query(
      'UPDATE tax_rates SET valid_to=$1, updated_by=$2, updated_at=NOW() WHERE id=$3 RETURNING *',
      [dayBefore(effectiveFrom), req.user.id, id]
    );
    const versions = await query("SELECT count(*)::int AS count FROM tax_rates WHERE code LIKE $1", [`${current.code}-V%`]);
    const newCode = req.body.new_code || `${current.code}-V${(versions.rows[0]?.count || 0) + 1}`;
    const duplicate = await query('SELECT id FROM tax_rates WHERE code=$1', [newCode]);
    if (duplicate.rowCount) throw conflict('Code de la nouvelle version déjà utilisé', { code: newCode });
    const inserted = await query(
      `INSERT INTO tax_rates
         (code, label, rate, regime, valid_from, valid_to, active, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       RETURNING *`,
      [
        newCode,
        input.label || current.label,
        input.rate ?? current.rate,
        input.regime || current.regime,
        effectiveFrom,
        input.valid_to || null,
        input.active === undefined ? current.active : input.active,
        req.user.id,
      ]
    );
    await auditV1(req, 'TAX_RATE_EFFECTIVE_VERSION', 'tax_rate', inserted.rows[0].id, {
      supersedes: id, old: current, new: inserted.rows[0],
    });
    setETag(res, inserted.rows[0]);
    return res.json({ tax_rate: inserted.rows[0], supersedes: id, previous_valid_to: closed.rows[0]?.valid_to });
  }
  if (effectiveChange && used.rows[0]?.count > 0) {
    throw conflict('Taux utilisé par des documents : fournissez effective_from pour créer une nouvelle version sans altérer les documents approuvés', {
      references: used.rows[0].count,
    });
  }
  const columns = [];
  const values = [];
  for (const [key, column] of Object.entries({ code: 'code', label: 'label', rate: 'rate', regime: 'regime', valid_from: 'valid_from', valid_to: 'valid_to', active: 'active' })) {
    if (input[key] !== undefined) {
      values.push(input[key]);
      columns.push(`${column}=$${values.length}`);
    }
  }
  if (!columns.length) return res.json({ tax_rate: current });
  values.push(req.user.id);
  columns.push(`updated_by=$${values.length}`);
  values.push(id);
  const updated = await query(`UPDATE tax_rates SET ${columns.join(',')}, updated_at=NOW() WHERE id=$${values.length} RETURNING *`, values);
  await auditV1(req, 'TAX_RATE_UPDATE', 'tax_rate', id, { before: current, after: updated.rows[0] });
  setETag(res, updated.rows[0]);
  res.json({ tax_rate: updated.rows[0] });
}));

router.get('/notification-rules', asyncV1(async (req, res) => {
  const pagination = parsePagination(req, { pageSize: 50 });
  const filters = parseFilters(req, ['event_key', 'channel', 'enabled']);
  let rules = await listRules();
  rules = rules.filter(row => {
    if (filters.event_key && row.event_key !== filters.event_key) return false;
    if (filters.channel && row.channel !== filters.channel) return false;
    if (filters.enabled !== undefined && Boolean(row.enabled) !== (filters.enabled === 'true')) return false;
    return true;
  });
  const data = rules.slice(pagination.offset, pagination.offset + pagination.limit);
  sendPaginated(res, data, pagination, rules.length, { filters, known_events: EVENT_KEYS });
}));

router.put('/notification-rules', asyncV1(async (req, res) => {
  if (!ADMIN_ROLES.includes(req.user.role)) throw forbidden('Administration des règles de notification réservée à admin / DG');
  const entries = Array.isArray(req.body) ? req.body : (req.body?.rules || req.body);
  const saved = await upsertRules(entries, req.user.id);
  await auditV1(req, 'NOTIFICATION_RULES_UPDATE', 'notification_rule', null, { count: saved.length, rules: saved });
  res.json({ rules: saved });
}));

router.get('/notification-templates', asyncV1(async (req, res) => {
  const pagination = parsePagination(req, { pageSize: 50 });
  const filters = parseFilters(req, ['event_key', 'channel', 'locale']);
  let templates = await listTemplates();
  templates = templates.filter(row => {
    if (filters.event_key && row.event_key !== filters.event_key) return false;
    if (filters.channel && row.channel !== filters.channel) return false;
    if (filters.locale && row.locale !== filters.locale) return false;
    return true;
  });
  const data = templates.slice(pagination.offset, pagination.offset + pagination.limit);
  sendPaginated(res, data, pagination, templates.length, { filters });
}));

router.put('/notification-templates', asyncV1(async (req, res) => {
  if (!ADMIN_ROLES.includes(req.user.role)) throw forbidden('Administration des modèles de notification réservée à admin / DG');
  const entries = Array.isArray(req.body) ? req.body : (req.body?.templates || req.body);
  const saved = await upsertTemplates(entries, req.user.id);
  await auditV1(req, 'NOTIFICATION_TEMPLATES_UPDATE', 'notification_template', null, { count: saved.length, templates: saved });
  res.json({ templates: saved });
}));

router.post('/documents/:id/calculate-totals', asyncV1(async (req, res) => {
  const documentId = parseId(req.params.id, 'document');
  const doc = (await query('SELECT * FROM documents WHERE id=$1', [documentId])).rows[0];
  if (!doc) throw badRequest('Document introuvable');
  if (!FINANCIAL_READ_ROLES.includes(req.user.role) && Number(doc.uploaded_by) !== Number(req.user.id)) {
    const assigned = await query(
      `SELECT id FROM project_members WHERE project_id=$1 AND user_id=$2 AND active=true`,
      [doc.store_id, req.user.id]
    );
    if (!assigned.rowCount) throw forbidden('Accès refusé : document hors périmètre');
  }
  const roundingRule = req.body?.rounding_rule || 'line';
  if (!ROUNDING_RULES.includes(roundingRule)) throw badRequest(`Règle d’arrondi inconnue : ${roundingRule}`);
  const result = await calculateDocumentTotals(documentId, {
    lines: Array.isArray(req.body?.lines) ? req.body.lines : null,
    rounding_rule: roundingRule,
    deductible_percentage: req.body?.deductible_percentage,
    persist: Boolean(req.body?.persist),
    actorId: req.user.id,
  });
  await auditV1(req, 'DOCUMENT_TOTALS_CALCULATE', 'document', documentId, {
    rounding_rule: roundingRule, totals: result.totals, read_only: result.read_only,
  });
  res.json(result);
}));

router.get('/notifications', asyncV1(async (req, res) => {
  const pagination = parsePagination(req, { pageSize: 20 });
  const filters = parseFilters(req, ['event_type', 'channel', 'user_id']);
  if (filters.unread_only === undefined && req.query.unread_only !== undefined) {
    filters.unread_only = String(req.query.unread_only);
  }
  const includeAll = req.user.role === 'admin' && Boolean(filters.user_id);
  const targetUserId = includeAll ? parseId(filters.user_id, 'utilisateur') : req.user.id;
  const result = await listNotifications(targetUserId, filters, pagination, { includeAll });
  sendPaginated(res, result.rows, pagination, result.total, { unread_count: result.unread_count, filters });
}));

router.patch('/notifications/:id/read', asyncV1(async (req, res) => {
  const id = parseId(req.params.id, 'notification');
  const notification = await markNotificationRead(id, req.user.id, { includeAll: req.user.role === 'admin' });
  res.json({ notification });
}));

export default router;
