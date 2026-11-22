import { Router } from 'express';
import { query, tx } from '../../db.js';
import {
  asyncV1, setETag, badRequest, conflict, forbidden, notFound,
  parsePagination, sendPaginated, parseFilters,
} from '../../middleware/standard.js';
import {
  auditV1, auditInTx, transitionInTx, getProject, parseId, requireFields,
  documentHash, DD, DG_ROLES, FINANCIAL_READ_ROLES, PROJECT_EDIT_ROLES,
} from './shared.js';
import { publishEvent } from '../../services/notification-service.js';
import { taxSummaryForProject } from '../../services/tax-service.js';

const router = Router();

router.param('id', (req, res, next, value) => {
  if (value !== undefined && !/^[1-9][0-9]*$/.test(String(value))) return res.status(400).json({ error: 'Identifiant invalide' });
  req.params.id = String(Number(value));
  next();
});
router.param('resource', (req, res, next, value) => {
  const allowed = new Set(['purchase_orders','invoices','payments','incidents','claims','risks']);
  if (!allowed.has(String(value || ''))) return res.status(400).json({ error: 'Ressource invalide' });
  next();
});

const SORT_FIELDS = {
  id: 's.id',
  code: 's.code',
  name: 's.name',
  city: 's.city',
  year: 's.project_year',
  status: 's.project_state',
  created_at: 's.created_at',
};

function canReadTransversal(role) {
  return FINANCIAL_READ_ROLES.includes(role);
}

router.post('/projects', asyncV1(async (req, res) => {
  if (!PROJECT_EDIT_ROLES.includes(req.user.role)) {
    throw forbidden('Création de projet réservée à la direction du développement (DD)');
  }
  requireFields(req.body, ['code', 'brand_id', 'title', 'city', 'year', 'owner_user_id', 'initial_open_date']);
  const brandId = parseId(req.body.brand_id, 'enseigne');
  const brand = (await query('SELECT * FROM brands WHERE id=$1 AND active=true', [brandId])).rows[0];
  if (!brand) throw badRequest('Enseigne introuvable ou inactive');
  const code = String(req.body.code).trim();
  const year = Number(req.body.year);
  if (!Number.isInteger(year) || year < 2000) throw badRequest('Année invalide');
  const duplicate = await query('SELECT id FROM stores WHERE code=$1 AND project_year=$2', [code, year]);
  if (duplicate.rowCount) throw conflict('Code projet déjà utilisé pour cette année', { code, year });
  const ownerId = parseId(req.body.owner_user_id, 'responsable');
  const owner = (await query('SELECT id, role FROM users WHERE id=$1 AND active=true', [ownerId])).rows[0];
  if (!owner) throw badRequest('Responsable introuvable ou inactif');
  const initialDate = String(req.body.initial_open_date).slice(0, 10);

  const inserted = await tx(async client => {
    const r = await client.query(
      `INSERT INTO stores
         (name, city, opening_date, project_state, budget, brand, code, address, area_m2,
          owner_user_id, initial_open_date, forecast_open_date, revised_open_date,
          project_year, brand_id, phase, created_by, updated_by, created_at)
       VALUES ($1,$2,$3,'brouillon',COALESCE($4,0),$5,$6,$7,$8,$9,$3,$10,$3,$11,$12,'planning',$13,$13,NOW())
       RETURNING *`,
      [
        String(req.body.title).trim(), String(req.body.city).trim(), initialDate,
        req.body.budget ?? 0, brand.name, code, req.body.address || null,
        req.body.area_m2 || null, ownerId, req.body.forecast_open_date || initialDate,
        year, brandId, req.user.id,
      ]
    );
    const project = r.rows[0];
    await client.query(
      `INSERT INTO project_members (project_id, user_id, role, edit_scope, created_by, updated_by)
       VALUES ($1,$2,$3,'project',$4,$4)
       ON CONFLICT (project_id, user_id, role) DO NOTHING`,
      [project.id, ownerId, owner.role, req.user.id]
    );
    await transitionInTx(client, req, 'project', project.id, null, 'brouillon', 'Création projet', 1, documentHash({ code, year, brand_id: brandId }));
    await auditInTx(client, req, 'PROJECT_CREATE', 'project', project.id, { code, year, brand_id: brandId, owner_user_id: ownerId });
    return project;
  });
  setETag(res, inserted);
  res.status(201).json({ project: inserted });
}));

router.get('/projects', asyncV1(async (req, res) => {
  const pagination = parsePagination(req, { pageSize: 20 });
  const filters = parseFilters(req, ['brand_id', 'year', 'city', 'owner_user_id', 'status', 'code', 'q']);
  const params = [];
  let where = 's.deleted_at IS NULL';
  if (filters.brand_id) { params.push(filters.brand_id); where += ` AND s.brand_id = $${params.length}`; }
  if (filters.year) { params.push(filters.year); where += ` AND s.project_year = $${params.length}`; }
  if (filters.city) { params.push(filters.city); where += ` AND s.city ILIKE $${params.length}`; }
  if (filters.owner_user_id) { params.push(filters.owner_user_id); where += ` AND s.owner_user_id = $${params.length}`; }
  if (filters.status) { params.push(filters.status); where += ` AND s.project_state = $${params.length}`; }
  if (filters.code) { params.push(filters.code); where += ` AND s.code = $${params.length}`; }
  if (filters.q) { params.push(`%${filters.q}%`); where += ` AND (s.name ILIKE $${params.length} OR s.code ILIKE $${params.length})`; }
  if (!canReadTransversal(req.user.role)) {
    params.push(req.user.id);
    const p = `$${params.length}`;
    where += ` AND (
      EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=s.id AND pm.user_id=${p} AND pm.active=true AND pm.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM store_assignments sa WHERE sa.store_id=s.id AND sa.user_id=${p} AND sa.active=true)
    )`;
  }
  const sortField = SORT_FIELDS[req.query.sort] || 's.id';
  const direction = String(req.query.order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const total = (await query(`SELECT count(*)::int AS count FROM stores s WHERE ${where}`, params)).rows[0]?.count || 0;
  const r = await query(
    `SELECT s.*, b.name AS brand_name,
       ROW_NUMBER() OVER (ORDER BY ${sortField} ${direction}, s.id ${direction}) AS rn
       FROM stores s LEFT JOIN brands b ON b.id=s.brand_id
      WHERE ${where}
      ORDER BY ${sortField} ${direction}, s.id ${direction}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  const data = r.rows.map(row => ({
    id: row.id,
    code: row.code,
    brand_id: row.brand_id,
    brand: row.brand_name || row.brand,
    title: row.name,
    city: row.city,
    address: row.address,
    area_m2: row.area_m2,
    year: row.project_year,
    initial_open_date: row.initial_open_date,
    forecast_open_date: row.forecast_open_date,
    revised_open_date: row.revised_open_date,
    actual_open_date: row.actual_open_date,
    owner_user_id: row.owner_user_id,
    status: row.project_state,
    version: row.version,
    row_version: row.row_version,
    budget: Number(row.budget || 0),
    etag: `"${row.row_version || row.version || 1}"`,
  }));
  sendPaginated(res, data, pagination, total, { filters: filters });
}));

async function assertChecklistComplete(projectId) {
  const blockers = await query(
    `SELECT id, item_code, status FROM opening_checklist
      WHERE project_id=$1 AND mandatory=true AND COALESCE(status,'a_faire') <> 'valide'`,
    [projectId]
  );
  if (blockers.rowCount) {
    throw conflict('Checklist bloquante incomplète : ouverture impossible', {
      items: blockers.rows.map(row => ({ id: row.id, code: row.item_code, status: row.status })),
    });
  }
}

router.post('/projects/:id/opening/submit', asyncV1(async (req, res) => {
  if (!DD.includes(req.user.role)) throw forbidden('Soumission du dossier de préouverture réservée au DD');
  const projectId = parseId(req.params.id, 'projet');
  const project = await getProject(projectId);
  await assertAssignment(req, projectId);
  await assertChecklistComplete(projectId);
  const result = await tx(async client => {
    const existing = await client.query('SELECT * FROM opening_decisions WHERE project_id=$1 FOR UPDATE', [projectId]);
    let decision;
    if (existing.rows[0]) {
      const updated = await client.query(
        `UPDATE opening_decisions SET dd_approved_by=$1, dd_approved_at=NOW(), comment=$2,
           updated_by=$1, updated_at=NOW() WHERE id=$3 RETURNING *`,
        [req.user.id, req.body?.comment || null, existing.rows[0].id]
      );
      decision = updated.rows[0];
    } else {
      const inserted = await client.query(
        `INSERT INTO opening_decisions
           (project_id, dd_approved_by, dd_approved_at, comment, created_by, updated_by)
         VALUES ($1,$2,NOW(),$3,$2,$2) RETURNING *`,
        [projectId, req.user.id, req.body?.comment || null]
      );
      decision = inserted.rows[0];
    }
    await client.query(
      `UPDATE stores SET dd_validated_at=NOW(), project_state='preouverture', updated_by=$2, updated_at=NOW()
        WHERE id=$1`,
      [projectId, req.user.id]
    );
    const updatedProject = await client.query('SELECT * FROM stores WHERE id=$1', [projectId]);
    await transitionInTx(client, req, 'opening', projectId, project.project_state, 'validation_dd', req.body?.comment || null, 1, documentHash({ projectId, dd: req.user.id }));
    await auditInTx(client, req, 'OPENING_SUBMIT_DD', 'opening_decision', decision.id, { project_id: projectId, comment: req.body?.comment || null });
    return { decision, project: updatedProject.rows[0] };
  });
  await publishEvent('validation_dd', {
    project_id: projectId,
    store_id: projectId,
    aggregate_type: 'opening',
    aggregate_id: projectId,
    object_type: 'opening',
    object_id: projectId,
    opening: true,
    requester_id: req.user.id,
    actor_id: req.user.id,
    decision: 'approuve',
    reference: `OUVERTURE-${projectId}`,
    comment: req.body?.comment || null,
  }, { actorId: req.user.id, correlationId: req.correlationId });
  setETag(res, result.project);
  res.json({ opening_decision: result.decision, project: result.project });
}));

router.post('/projects/:id/opening/decision', asyncV1(async (req, res) => {
  if (!DG_ROLES.includes(req.user.role)) throw forbidden('Décision finale d’ouverture réservée au DG');
  const projectId = parseId(req.params.id, 'projet');
  const project = await getProject(projectId);
  await assertAssignment(req, projectId);
  const decision = String(req.body?.decision || '').trim();
  const authorized = ['autorisee', 'approved', 'autorise'].includes(decision);
  const refused = ['refusee', 'rejected', 'refuse'].includes(decision);
  if (!authorized && !refused) throw badRequest('Décision invalide : autorisee ou refusee attendu');
  if (refused && !String(req.body?.comment || '').trim()) throw badRequest('Motif obligatoire pour un refus d’ouverture');
  const dd = (await query('SELECT * FROM opening_decisions WHERE project_id=$1', [projectId])).rows[0];
  if (!dd?.dd_approved_at && !project.dd_validated_at) throw conflict('Validation DD requise avant décision DG d’ouverture');
  await assertChecklistComplete(projectId);

  const result = await tx(async client => {
    const locked = await client.query('SELECT * FROM opening_decisions WHERE project_id=$1 FOR UPDATE', [projectId]);
    let decisionRow;
    const payload = [projectId, authorized ? 'autorisee' : 'refusee', req.user.id, req.body?.comment || null, req.user.id];
    if (locked.rows[0]) {
      const r = await client.query(
        `UPDATE opening_decisions SET dg_decision=$2, dg_actor_id=$3, dg_decided_at=NOW(),
           comment=$4, updated_by=$5, updated_at=NOW() WHERE id=$1 RETURNING *`,
        [locked.rows[0].id, ...payload.slice(1)]
      );
      decisionRow = r.rows[0];
    } else {
      const r = await client.query(
        `INSERT INTO opening_decisions
           (project_id, dd_approved_by, dd_approved_at, dg_decision, dg_actor_id, dg_decided_at, comment, created_by, updated_by)
         VALUES ($1,$2,NOW(),$3,$4,NOW(),$5,$6,$6) RETURNING *`,
        [projectId, dd?.dd_approved_by || null, ...payload.slice(1)]
      );
      decisionRow = r.rows[0];
    }
    const nextState = authorized ? 'ouvert' : 'preouverture';
    const updated = await client.query(
      `UPDATE stores SET project_state=$1,
         actual_open_date=CASE WHEN $2 THEN COALESCE(actual_open_date, CURRENT_DATE) ELSE actual_open_date END,
         state_reason=CASE WHEN $3 THEN $4 ELSE state_reason END,
         updated_by=$5, updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [nextState, authorized, refused, req.body?.comment || null, req.user.id, projectId]
    );
    await transitionInTx(client, req, 'opening', projectId, 'validation_dd', authorized ? 'autorisee' : 'refusee', req.body?.comment || null, 1, documentHash({ projectId, dg: req.user.id, decision }));
    await auditInTx(client, req, authorized ? 'OPENING_AUTHORIZED_DG' : 'OPENING_REFUSED_DG', 'opening_decision', decisionRow.id, {
      project_id: projectId, decision: authorized ? 'autorisee' : 'refusee', comment: req.body?.comment || null,
    });
    return { decision: decisionRow, project: updated.rows[0] };
  });
  const eventKey = authorized ? 'validation_finale_dg' : 'rejet_correction';
  await publishEvent(eventKey, {
    project_id: projectId,
    store_id: projectId,
    aggregate_type: 'opening',
    aggregate_id: projectId,
    object_type: 'opening',
    object_id: projectId,
    opening: true,
    actor_id: req.user.id,
    requester_id: dd?.dd_approved_by || project.owner_user_id,
    responsible_user_ids: project.owner_user_id ? [project.owner_user_id] : [],
    decision: authorized ? 'autorisee' : 'refusee',
    status: authorized ? 'autorisee' : 'refusee',
    reason: req.body?.comment || null,
    reference: `OUVERTURE-${projectId}`,
  }, { actorId: req.user.id, correlationId: req.correlationId });
  setETag(res, result.project);
  res.json({ opening_decision: result.decision, project: result.project });
}));

router.get('/projects/:id/tax-summary', asyncV1(async (req, res) => {
  if (!FINANCIAL_READ_ROLES.includes(req.user.role)) throw forbidden('Lecture du récapitulatif TVA non autorisée');
  const projectId = parseId(req.params.id, 'projet');
  await getProject(projectId);
  await assertAssignment(req, projectId);
  res.json(await taxSummaryForProject(projectId));
}));

export default router;
