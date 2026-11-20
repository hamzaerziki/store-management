import { query } from '../../db.js';
import { DD_ROLES } from '../../middleware/auth.js';
import { badRequest, conflict, forbidden, notFound, precondition } from '../../middleware/standard.js';
import { audit } from '../../utils/audit.js';
import { decisionFingerprint } from '../../utils/decision.js';

export const CDG_ROLES = ['CDG', 'CG'];
export const DG_ROLES = ['DG'];
export const DD = DD_ROLES;
export const DIRECTOR_ROLES = ['DG', ...DD_ROLES];
export const FINANCIAL_READ_ROLES = ['CDG', 'CG', ...DD_ROLES, 'DG'];
export const AUDIT_READ_ROLES = ['admin', ...FINANCIAL_READ_ROLES];
export const PROJECT_EDIT_ROLES = [...DD_ROLES];
export const STEP_ROLES = { CDG: CDG_ROLES, DD: DD_ROLES, DG: DG_ROLES };

export function run(client, text, params = []) {
  return client ? client.query(text, params) : query(text, params);
}

export function parseId(value, label = 'identifiant') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw badRequest(`${label} invalide`);
  return id;
}

export function requireFields(body, fields) {
  for (const field of fields) {
    if (body?.[field] === undefined || body?.[field] === null || String(body[field]).trim() === '') {
      throw badRequest(`${field} requis`);
    }
  }
}

export function documentHash(payload) {
  return decisionFingerprint(payload);
}

export async function getProject(projectId, client) {
  const r = await run(client, 'SELECT * FROM stores WHERE id=$1 AND deleted_at IS NULL', [projectId]);
  if (!r.rows[0]) throw notFound('Projet introuvable');
  return r.rows[0];
}

export async function assertWritable(req, projectId, client) {
  if (!projectId) return;
  const r = await run(client, 'SELECT locked_read_only, project_state FROM stores WHERE id=$1', [projectId]);
  if (r.rows[0]?.locked_read_only && !DIRECTOR_ROLES.includes(req.user.role)) {
    throw forbidden('Projet clôturé en lecture seule');
  }
}

export async function assertAssignment(req, projectId, lotId = null, client) {
  if (!projectId) throw forbidden('Affectation requise : projet ou lot non précisé');
  if (DIRECTOR_ROLES.includes(req.user.role) || CDG_ROLES.includes(req.user.role)) return;
  const scoped = await run(client,
    `SELECT id FROM project_members
      WHERE project_id=$1 AND user_id=$2 AND active=true AND deleted_at IS NULL LIMIT 1`,
    [projectId, req.user.id]
  );
  if (scoped.rowCount) return;
  const legacy = await run(client,
    `SELECT id FROM store_assignments
      WHERE user_id=$1 AND store_id=$2 AND (lot_id IS NULL OR lot_id=$3) AND active=true LIMIT 1`,
    [req.user.id, projectId, lotId || null]
  );
  if (legacy.rowCount) return;
  throw forbidden('Affectation refusée : projet ou lot non attribué');
}

export async function effectiveRole(req, projectId = null, lotId = null, client) {
  if (!projectId) return req.user.role;
  const r = await run(client,
    `SELECT role FROM delegations
      WHERE to_user_id=$1 AND active=true
        AND starts_at <= CURRENT_DATE AND ends_at >= CURRENT_DATE
        AND (store_id IS NULL OR store_id=$2)
        AND (lot_id IS NULL OR lot_id=$3)
      ORDER BY (store_id IS NULL), (lot_id IS NULL) LIMIT 1`,
    [req.user.id, projectId, lotId || null]
  );
  return r.rows[0]?.role || req.user.role;
}

export function assertStepRole(step, role) {
  const allowed = STEP_ROLES[step];
  if (!allowed) throw badRequest(`Étape d’approbation inconnue : ${step}`);
  if (!allowed.includes(role)) {
    throw forbidden(`Rôle ${role} non autorisé pour l’étape ${step}`, { step, required_roles: allowed });
  }
}

export function assertActor(req, body = {}) {
  if (body.actor_id !== undefined && body.actor_id !== null && Number(body.actor_id) !== Number(req.user.id)) {
    throw forbidden('Acteur incohérent : la décision doit être portée par l’utilisateur authentifié');
  }
}

export async function auditV1(req, action, entity, entityId, details = {}) {
  return audit(req, action, entity, entityId, { ...details, correlation_id: req.correlationId });
}

export async function auditInTx(client, req, action, entity, entityId, details = {}) {
  await client.query(
    `INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, created_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb, NOW())`,
    [
      req.user?.id || null,
      req.user?.name || 'systeme',
      action,
      entity,
      entityId || null,
      JSON.stringify({ ...details, correlation_id: req.correlationId }),
    ]
  );
}

export async function transitionInTx(client, req, entity, entityId, from, to, reason = null, version = 1, hash = null) {
  await client.query(
    `INSERT INTO state_transitions
       (entity, entity_id, from_state, to_state, actor_id, actor_role, reason, version, document_hash, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
    [entity, entityId, from || null, to, req.user.id, req.user.role, reason || null, version || 1, hash || documentHash({ entity, entityId, from, to, actor: req.user.id, at: new Date().toISOString() })]
  );
}

export async function approvalObject(client, objectType, objectId) {
  if (objectType === 'budget') {
    const r = await client.query('SELECT * FROM budgets WHERE id=$1 FOR UPDATE', [objectId]);
    if (!r.rows[0]) throw notFound('Budget introuvable');
    const row = r.rows[0];
    return {
      table: 'budgets',
      type: 'budget',
      row,
      version: Number(row.revision || 1),
      state: row.state,
      amount: Number(row.revised_amount ?? row.amount ?? 0),
      projectId: row.store_id,
      lotId: row.lot_id,
      vendorId: null,
    };
  }
  if (objectType === 'quote') {
    const r = await client.query(
      `SELECT q.*, COALESCE(i.store_id, l.store_id) AS resolved_store_id
         FROM quotes q
         LEFT JOIN items i ON i.id=q.item_id
         LEFT JOIN lots l ON l.id=q.lot_id
        WHERE q.id=$1 FOR UPDATE OF q`,
      [objectId]
    );
    if (!r.rows[0]) throw notFound('Devis introuvable');
    const row = r.rows[0];
    return {
      table: 'quotes',
      type: 'quote',
      row,
      version: Number(row.version || 1),
      state: row.state,
      amount: Number(row.amount_ttc ?? 0),
      projectId: row.resolved_store_id,
      lotId: row.lot_id,
      vendorId: row.supplier_id,
    };
  }
  throw badRequest(`Type d’objet d’approbation inconnu : ${objectType}`);
}

const BUDGET_STAMP = { CDG: 'validated_cdg_at', DD: 'validated_dd_at', DG: 'validated_dg_at' };

export function nextApprovalState(step, decision) {
  if (decision === 'rejected' || decision === 'rejete') return 'corrige';
  if (decision === 'correction' || decision === 'demande_correction') return 'corrige';
  if (step === 'CDG') return 'soumis_dd';
  if (step === 'DD') return 'soumis_dg';
  return 'approuve';
}

export async function applyApprovalToObject(client, approval, step, decision, req, hash) {
  const nextState = nextApprovalState(step, decision);
  const approved = ['approved', 'approuve'].includes(decision) && step === 'DG';
  if (approval.type === 'budget') {
    const stamp = BUDGET_STAMP[step];
    const r = await client.query(
      `UPDATE budgets
          SET state=$1,
              ${stamp} = CASE WHEN $2 IN ('approved','approuve') THEN NOW() ELSE ${stamp} END,
              rejection_reason=CASE WHEN $2 IN ('rejected','rejete','correction','demande_correction') THEN $3 ELSE rejection_reason END,
              updated_at=NOW()
        WHERE id=$4 RETURNING *`,
      [nextState, decision, req.body?.comment || null, approval.row.id]
    );
    return r.rows[0];
  }
  const r = await client.query(
    `UPDATE quotes
        SET state=$1,
            approved_version=CASE WHEN $2 THEN $3 ELSE approved_version END,
            approved_at=CASE WHEN $2 THEN NOW() ELSE approved_at END,
            updated_at=NOW()
      WHERE id=$4 RETURNING *`,
    [nextState, approved, approval.version, approval.row.id]
  );
  return r.rows[0];
}

export function approvalNotificationEvent(step, decision) {
  if (['rejected', 'rejete', 'correction', 'demande_correction'].includes(decision)) return 'rejet_correction';
  if (step === 'CDG') return 'validation_cdg';
  if (step === 'DD') return 'validation_dd';
  return 'validation_finale_dg';
}

export async function approvalNotificationContext(approval, requestRow, req, objectRow, extra = {}) {
  const projectId = approval.projectId;
  const owners = await query(
    `SELECT user_id, role FROM project_members WHERE project_id=$1 AND active=true AND deleted_at IS NULL`,
    [projectId]
  ).catch(() => ({ rows: [] }));
  const responsibleIds = owners.rows.filter(row => ['IT', 'MG'].includes(row.role)).map(row => row.user_id);
  return {
    aggregate_type: approval.type,
    aggregate_id: approval.row.id,
    object_type: approval.type,
    object_id: approval.row.id,
    project_id: projectId,
    store_id: projectId,
    approval_request_id: requestRow.id,
    budget_id: approval.type === 'budget' ? approval.row.id : null,
    quote_id: approval.type === 'quote' ? approval.row.id : null,
    requester_id: requestRow.submitted_by,
    demandeur_id: requestRow.submitted_by,
    actor_id: req.user.id,
    current_step: requestRow.current_step,
    validator_role: requestRow.current_step,
    reference: `${String(approval.type).toUpperCase()}-${approval.row.id}`,
    amount: approval.amount,
    store: projectId,
    decision: req.body?.decision,
    comment: req.body?.comment || null,
    reason: req.body?.comment || null,
    version: approval.version,
    responsible_user_ids: responsibleIds,
    object_state: objectRow?.state || approval.state,
    ...extra,
  };
}

export function assertIfMatchRow(req, row, label) {
  const header = req.get('If-Match');
  if (!header || header === '*') return;
  const expected = header.replace(/^W\//, '').replace(/^"|"$/g, '').trim();
  const current = String(row?.row_version ?? row?.version ?? row?.revision ?? '');
  if (expected !== current) {
    throw precondition(`Conflit de concurrence sur ${label} : version attendue ${expected}, version actuelle ${current}`, { expected, current });
  }
}

export function assertNotDuplicate(condition, message, details = {}) {
  if (condition) throw conflict(message, details);
}
