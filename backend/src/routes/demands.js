import { Router } from 'express';
import { query, tx } from '../db.js';
import {
  requireAuth, asyncRoute, can, DD_ROLES, ddRolesForOwner, departmentOf,
  assertAssignment, readScope,
} from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { decisionFingerprint } from '../utils/decision.js';
import { resolveLotId } from '../utils/lots.js';
import { publishEvent } from '../services/notification-service.js';

const router = Router();

const STAGE = {
  CDG: { from: 'pending_cdg', next: 'pending_dd', stamp: 'validated_cdg_at' },
  DD: { from: 'pending_dd', next: 'pending_dg', stamp: 'validated_dd_at' },
  DG: { from: 'pending_dg', next: 'approved', stamp: 'validated_dg_at' },
};

const EXECUTION_ROLES = ['admin', 'IT', 'MG', 'CG', 'CDG', ...DD_ROLES, 'DG'];
const EXECUTION_STATES = {
  accepte_dg: { task_state: 'a_faire', progress: 0 },
  en_cours: { task_state: 'en_cours', progress: 50 },
  livre: { task_state: 'terminee', progress: 100 },
  installe: { task_state: 'terminee', progress: 100 },
};

function stageOf(role) {
  if (['CDG', 'CG'].includes(role)) return 'CDG';
  if (DD_ROLES.includes(role)) return 'DD';
  if (role === 'DG') return 'DG';
  return null;
}

function canValidate(role, status, ownerRole, createdBy, actorId, createdByRole) {
  const stage = stageOf(role);
  if (!stage || STAGE[stage].from !== status) return false;
  if (stage === 'DD') {
    return DD_ROLES.includes(role) && Number(createdBy) !== Number(actorId);
  }
  return true;
}

function nextValidator(status, ownerRole, createdByRole) {
  if (status === 'pending_cdg') return 'CDG';
  if (status === 'pending_dd') return ddRolesForOwner(ownerRole, createdByRole)[0];
  if (status === 'pending_dg') return 'DG';
  return null;
}

async function demandContext(demand, req, overrides = {}) {
  const [store, requester] = await Promise.all([
    query('SELECT name FROM stores WHERE id=$1', [demand.store_id]),
    query('SELECT name,email FROM users WHERE id=$1', [demand.created_by]),
  ]);
  return {
    project_id: demand.store_id,
    aggregate_type: 'demand',
    aggregate_id: demand.id,
    object_type: 'demand',
    object_id: demand.id,
    reference: `D-${demand.id}`,
    title: demand.title,
    store: store.rows[0]?.name || '',
    amount: Number(demand.amount || 0).toLocaleString('fr-FR'),
    demandeur: requester.rows[0]?.name || 'Demandeur',
    requester_id: demand.created_by,
    submitted_by: demand.created_by,
    actor_id: req.user.id,
    actor: req.user.name || req.user.email || 'Utilisateur',
    ...overrides,
  };
}

async function recordTransition(entity, entityId, from, to, req, reason) {
  await query(
    `INSERT INTO state_transitions (entity,entity_id,from_state,to_state,actor_id,actor_role,reason,version,document_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8)`,
    [entity, entityId, from, to, req.user.id, req.user.role, reason || null,
      decisionFingerprint({ entity, entityId, from, to, actor: req.user.id, reason, at: new Date().toISOString() })]
  );
}

router.get('/summary', requireAuth, asyncRoute(async (req, res) => {
  const scope = await readScope(req, 'store_id', 1);
  const r = await query(`SELECT status, count(*)::int AS count FROM demands WHERE 1=1 ${scope.clause} GROUP BY status ORDER BY status`, scope.params);
  const counts = {};
  r.rows.forEach(row => { counts[row.status] = row.count; });
  res.json({ counts, total: Object.values(counts).reduce((a, b) => a + b, 0) });
}));

router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const role = req.user.role;
  const params = [];
  let where = '1=1';
  if (role === 'IT') {
    params.push(req.user.id);
    where += ` AND d.owner_role = 'IT' AND d.created_by = $${params.length}`;
  } else if (role === 'MG') {
    params.push(req.user.id);
    where += ` AND d.owner_role IN ('MG','RMG') AND d.created_by = $${params.length}`;
  }
  if (['CDG', 'CG'].includes(role)) {
    where += " AND d.status <> 'draft'";
  } else if (DD_ROLES.includes(role)) {
    where += " AND (d.status IN ('pending_dd','pending_dg','approved') OR (d.status='rejected' AND EXISTS (SELECT 1 FROM demand_validations dv WHERE dv.demand_id=d.id AND dv.validator_role='CDG' AND dv.decision='approved')))";
  } else if (role === 'DG') {
    where += " AND (d.status IN ('pending_dg','approved') OR (d.status='rejected' AND EXISTS (SELECT 1 FROM demand_validations dv WHERE dv.demand_id=d.id AND dv.validator_role IN ('DD','RMG') AND dv.decision='approved')))";
  }
  if (req.query.active === '1') {
    where += " AND d.status IN ('pending_cdg','pending_dd','pending_dg')";
  }
  if (req.query.decided === '1') {
    where += " AND d.status IN ('approved','rejected')";
  }
  if (req.query.store_id) {
    params.push(req.query.store_id);
    where += ` AND d.store_id = $${params.length}`;
  }
  if (req.query.status) {
    params.push(req.query.status);
    where += ` AND d.status = $${params.length}`;
  }
  if (req.query.supplier_id) {
    params.push(req.query.supplier_id);
    where += ` AND EXISTS (SELECT 1 FROM quotes q WHERE q.demand_id=d.id AND q.supplier_id=$${params.length} AND q.deleted_at IS NULL)`;
  }
  const access = await readScope(req, 'd.store_id', params.length + 1);
  params.push(...access.params);
  where += ` ${access.clause}`;
  const sql =
    `SELECT d.*, st.name AS store_name, l.name AS lot_name, i.name AS item_name,
       ic.name AS category_name, i.category_id AS category_id,
       u.name AS created_by_name, u.role AS created_by_role, u.department AS created_by_user_department,
       (SELECT count(*) FROM demand_validations dv WHERE dv.demand_id=d.id) AS validations_count,
       (SELECT COALESCE(json_agg(json_build_object('role',dv.validator_role,'decision',dv.decision,'comment',dv.comment,'date',dv.decided_at,'actor',vu.name) ORDER BY dv.id),'[]'::json)
          FROM demand_validations dv LEFT JOIN users vu ON vu.id=dv.validator_id WHERE dv.demand_id=d.id) AS decisions,
       (SELECT COALESCE(json_agg(json_build_object('id',q.id,'supplier_id',q.supplier_id,'supplier_name',sp.name,
          'amount_ht',q.amount_ht,'amount_tva',q.amount_tva,'amount_ttc',q.amount_ttc,'currency',q.currency,
          'version',q.version,'validity_date',q.validity_date,'file_url',q.file_url,'lot_id',q.lot_id,'uploaded_by',q.uploaded_by,'created_by',q.created_by) ORDER BY q.id),'[]'::json)
          FROM quotes q LEFT JOIN suppliers sp ON sp.id=q.supplier_id WHERE q.demand_id=d.id) AS quotes
      FROM demands d
      JOIN stores st ON st.id=d.store_id
      LEFT JOIN lots l ON l.id=d.lot_id
      LEFT JOIN items i ON i.id=d.item_id
      LEFT JOIN categories ic ON ic.id=i.category_id
      LEFT JOIN users u ON u.id=d.created_by
      WHERE ${where} ORDER BY d.created_at DESC, d.id DESC`;
  const r = await query(sql, params);
  res.json(r.rows.map(row => {
    const draftOwnerOrAdmin = row.status === 'draft' && (Number(row.created_by) === Number(req.user.id) || req.user.role === 'admin');
    return ({
    ...row,
    created_by_department: row.created_by_department || row.created_by_user_department || (['IT'].includes(row.created_by_role) ? 'IT' : ['MG','RMG'].includes(row.created_by_role) ? 'MG' : (['IT'].includes(row.owner_role) ? 'IT' : ['MG','RMG'].includes(row.owner_role) ? 'MG' : null)),
    decisions: row.decisions || [],
    quotes: row.quotes || [],
    can_validate: canValidate(role, row.status, row.owner_role, row.created_by, req.user.id, row.created_by_role),
    next_validator_role: nextValidator(row.status, row.owner_role, row.created_by_role),
    can_submit: draftOwnerOrAdmin,
    can_edit: draftOwnerOrAdmin,
    can_delete: draftOwnerOrAdmin,
  });
  }));
}));

router.get('/:id/history', requireAuth, asyncRoute(async (req, res) => {
  const access = await readScope(req, 'd.store_id', 2);
  const demand = await query(`SELECT d.id FROM demands d WHERE d.id=$1 ${access.clause}`, [req.params.id, ...access.params]);
  if (!demand.rows[0]) return res.status(404).json({ error: 'Demande introuvable' });
  const decisions = await query(
    `SELECT dv.*, u.name AS actor_name FROM demand_validations dv
     LEFT JOIN users u ON u.id=dv.validator_id WHERE dv.demand_id=$1 ORDER BY dv.id`,
    [req.params.id]
  );
  const transitions = await query(
    `SELECT st.*, u.name AS actor_name FROM state_transitions st
     LEFT JOIN users u ON u.id=st.actor_id
     WHERE st.entity='demand' AND st.entity_id=$1 ORDER BY st.id`,
    [req.params.id]
  );
  res.json({ decisions: decisions.rows, transitions: transitions.rows });
}));

router.get('/:id', requireAuth, asyncRoute(async (req, res) => {
  const access = await readScope(req, 'd.store_id', 2);
  const r = await query(
    `SELECT d.*, st.name AS store_name, l.name AS lot_name, i.name AS item_name,
       ic.name AS category_name, i.category_id AS category_id,
       u.name AS created_by_name, u.role AS created_by_role, u.department AS created_by_department,
       (SELECT COALESCE(json_agg(json_build_object('id',q.id,'supplier_id',q.supplier_id,'supplier_name',sp.name,
          'amount_ht',q.amount_ht,'amount_tva',q.amount_tva,'amount_ttc',q.amount_ttc,'currency',q.currency,
          'version',q.version,'validity_date',q.validity_date,'file_url',q.file_url,'lot_id',q.lot_id,'uploaded_by',q.uploaded_by,'created_by',q.created_by) ORDER BY q.id),'[]'::json)
          FROM quotes q LEFT JOIN suppliers sp ON sp.id=q.supplier_id WHERE q.demand_id=d.id) AS quotes
      FROM demands d JOIN stores st ON st.id=d.store_id
      LEFT JOIN lots l ON l.id=d.lot_id
      LEFT JOIN items i ON i.id=d.item_id
      LEFT JOIN categories ic ON ic.id=i.category_id
      LEFT JOIN users u ON u.id=d.created_by WHERE d.id=$1 ${access.clause}`,

    [req.params.id, ...access.params]
  );
  if (!r.rows[0]) return res.status(404).json({ error: 'Demande introuvable' });
  const role = req.user.role;
  const d = r.rows[0];
  const visibleByTurn = (
    role === 'admin' ||
    (role === 'IT' && d.owner_role === 'IT' && Number(d.created_by) === Number(req.user.id)) ||
    (['MG','RMG'].includes(role) && ['MG','RMG'].includes(d.owner_role) && Number(d.created_by) === Number(req.user.id)) ||
    (['CDG','CG'].includes(role) && d.status !== 'draft') ||
    (DD_ROLES.includes(role) && (['pending_dd','pending_dg','approved'].includes(d.status))) ||
    (role === 'DG' && (['pending_dg','approved'].includes(d.status)))
  );
  // allow rejected history visibility for validators who could have seen post-approval stages? keep permissive for decided items in their chain via list logic - but easier: if rejected and in list-style conditions
  const rejectedVisible = d.status === 'rejected' && (['CDG','CG','admin'].includes(role) || (DD_ROLES.includes(role)) || role === 'DG');
  if (!visibleByTurn && !rejectedVisible) return res.status(404).json({ error: 'Demande introuvable' });
  const validations = await query(
    `SELECT dv.*, u.name AS validator_name FROM demand_validations dv
     LEFT JOIN users u ON u.id=dv.validator_id WHERE dv.demand_id=$1 ORDER BY dv.id`,
    [req.params.id]
  );
  const drow = r.rows[0];
  const draftOwnerOrAdmin = drow.status === 'draft' && (Number(drow.created_by) === Number(req.user.id) || req.user.role === 'admin');
  res.json({
    ...drow,
    created_by_department: drow.created_by_department || (['IT'].includes(drow.created_by_role) ? 'IT' : ['MG','RMG'].includes(drow.created_by_role) ? 'MG' : (['IT'].includes(drow.owner_role) ? 'IT' : ['MG','RMG'].includes(drow.owner_role) ? 'MG' : null)),
    quotes: r.rows[0].quotes || [],
    validations: validations.rows,
    workflow: ['CDG', 'DD', 'DG'],
    current_stage: r.rows[0].status === 'pending_cdg' ? 'CDG'
      : r.rows[0].status === 'pending_dd' ? 'DD'
        : r.rows[0].status === 'pending_dg' ? 'DG' : null,
    can_validate: canValidate(req.user.role, r.rows[0].status, r.rows[0].owner_role, r.rows[0].created_by, req.user.id, r.rows[0].created_by_role),
    next_validator_role: nextValidator(r.rows[0].status, r.rows[0].owner_role, r.rows[0].created_by_role),
    can_submit: draftOwnerOrAdmin,
    can_edit: draftOwnerOrAdmin,
    can_delete: draftOwnerOrAdmin,
  });
}));

router.post('/', requireAuth, can('manage_demands'), asyncRoute(async (req, res) => {
  const { store_id, item_id, title, description, amount, kind, deadline, owner_role } = req.body || {};
  if (!store_id || !title) return res.status(400).json({ error: 'Magasin et intitulé requis' });
  const ownerRole = departmentOf(owner_role) || departmentOf(req.user.role) || req.user.role;
  if (!['IT', 'MG'].includes(ownerRole)) return res.status(403).json({ error: 'Création réservée aux départements IT / MG' });
  const lotId = req.body?.lot_id || (req.body?.lot_label ? await resolveLotId(store_id, req.body.lot_label) : null);
  try { await assertAssignment(req, store_id, lotId || null); }
  catch (e) { return res.status(e.status || 403).json({ error: e.message }); }
  const demandKind = ['article', 'mission'].includes(kind) ? kind : 'article';
  const r = await query(
    `INSERT INTO demands (store_id,lot_id,item_id,owner_role,title,description,amount,kind,deadline,status,submitted_at,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',NULL,$10) RETURNING *`,
    [store_id, lotId || null, item_id || null, ownerRole, title, description || null, Number(amount) || 0, demandKind, deadline || null, req.user.id]
  );
  await audit(req, 'CREATE_DEMAND', 'demand', r.rows[0].id, { title, store_id, ownerRole, draft: true });
  res.status(201).json(r.rows[0]);
}));

router.put('/:id', requireAuth, asyncRoute(async (req, res) => {
  const old = await query('SELECT * FROM demands WHERE id=$1', [req.params.id]);
  const demand = old.rows[0];
  if (!demand) return res.status(404).json({ error: 'Demande introuvable' });
  if (demand.status !== 'draft') return res.status(400).json({ error: 'Seule une demande en brouillon peut être modifiée' });
  if (Number(demand.created_by) !== Number(req.user.id) && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Seul le créateur ou l’administrateur peut modifier cette demande' });
  }
  const { title, description, amount_ht, amount, vat_rate, deadline, store_id, lot_id, lot_label, item_id, kind, owner_role } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Intitulé obligatoire' });
  const storeId = Number(store_id || demand.store_id);
  if (!storeId) return res.status(400).json({ error: 'Magasin requis' });
  const lotId = lot_id || (lot_label ? await resolveLotId(storeId, lot_label) : demand.lot_id || null);
  try { await assertAssignment(req, storeId, lotId || null); }
  catch (e) { return res.status(e.status || 403).json({ error: e.message }); }

  const nextOwner = departmentOf(owner_role) || demand.owner_role || departmentOf(req.user.role) || 'MG';
  if (!['IT', 'MG'].includes(nextOwner)) return res.status(400).json({ error: 'Département invalide' });
  const demandKind = ['article', 'mission'].includes(kind) ? kind : (demand.kind || 'article');
  const ht = Number(amount_ht ?? amount ?? demand.amount) || 0;
  const rate = Number(vat_rate || 20);
  const tva = Math.round(ht * rate) / 100;
  const ttc = Math.round(ht * (100 + rate)) / 100;

  const updated = await query(
    `UPDATE demands SET store_id=$1, lot_id=$2, item_id=$3, owner_role=$4, title=$5, description=$6, amount=$7, kind=$8, deadline=$9, updated_at=NOW()
     WHERE id=$10 RETURNING *`,
    [storeId, lotId || null, item_id || demand.item_id || null, nextOwner, String(title).trim(), description || null, ht, demandKind, deadline || null, demand.id]
  );
  await query(
    `UPDATE quotes SET amount_ht=$2, amount_tva=$3, amount_ttc=$4, vat_rate=$5, store_id=COALESCE(store_id,$6), lot_id=COALESCE(lot_id,$7)
     WHERE demand_id=$1 AND deleted_at IS NULL`,
    [demand.id, ht, tva, ttc, rate, storeId, lotId || null]
  );
  await audit(req, 'UPDATE_DEMAND', 'demand', demand.id, { title: updated.rows[0].title, amount: ht, owner_role: nextOwner, store_id: storeId });
  res.json(updated.rows[0]);
}));

router.post('/:id/submit', requireAuth, can('manage_demands'), asyncRoute(async (req, res) => {
  const r = await query('SELECT * FROM demands WHERE id=$1', [req.params.id]);
  const demand = r.rows[0];
  if (!demand) return res.status(404).json({ error: 'Demande introuvable' });
  if (Number(demand.created_by) !== Number(req.user.id) && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Seul le créateur ou l\'administrateur peut envoyer cette demande' });
  }
  if (demand.status !== 'draft') {
    return res.status(400).json({ error: 'Seule une demande en brouillon peut être envoyée' });
  }
  const ownerRole = departmentOf(demand.owner_role) || demand.owner_role;
  await query("UPDATE demands SET status='pending_cdg', submitted_at=NOW(), updated_at=NOW() WHERE id=$1", [demand.id]);
  await recordTransition('demand', demand.id, 'draft', 'pending_cdg', req, null);
  await audit(req, 'SUBMIT_DEMAND', 'demand', demand.id, { title: demand.title, store_id: demand.store_id, ownerRole });
  await publishEvent('demande_soumise', await demandContext(demand, req, { current_step: 'CDG', owner_role: ownerRole }));
  res.json({ ok: true, status: 'pending_cdg' });
}));

router.delete('/:id', requireAuth, asyncRoute(async (req, res) => {
  const old = await query('SELECT id, title, amount, status, store_id, item_id, lot_id, created_by FROM demands WHERE id=$1', [req.params.id]);
  if (!old.rows[0]) return res.status(404).json({ error: 'Demande introuvable' });
  const demand = old.rows[0];
  await assertAssignment(req, demand.store_id, demand.lot_id || null);
  const draftOwnerOrAdmin = demand.status === 'draft' && (Number(demand.created_by) === Number(req.user.id) || req.user.role === 'admin');
  if (!draftOwnerOrAdmin) {
    return res.status(403).json({ error: 'Après soumission, une demande ne peut plus être supprimée' });
  }
  const result = await tx(async client => {
    const tasks = await client.query('DELETE FROM planning_tasks WHERE demand_id=$1 RETURNING id', [demand.id]);
    await client.query('UPDATE quotes SET deleted_at=NOW(), demand_id=NULL WHERE demand_id=$1 AND deleted_at IS NULL', [demand.id]);
    if (demand.item_id) {
      await client.query("UPDATE items SET status='to_quote', updated_at=NOW() WHERE id=$1 AND status='approved'", [demand.item_id]);
    }
    await client.query('DELETE FROM demands WHERE id=$1', [demand.id]);
    return { planning_tasks_removed: tasks.rowCount };
  });
  await audit(req, 'DELETE_DEMAND', 'demand', demand.id, {
    title: demand.title,
    amount: demand.amount,
    status: demand.status,
    store_id: demand.store_id,
    budget_released: false,
    planning_tasks_removed: result.planning_tasks_removed,
  });
  res.json({ ok: true, id: demand.id, amount_released: 0, budget_released: false, planning_tasks_removed: result.planning_tasks_removed });
}));

router.patch('/:id/action', requireAuth, asyncRoute(async (req, res) => {
  const access = await readScope(req, 'store_id', 2);
  const old = await query(`SELECT id,created_by,status FROM demands WHERE id=$1 ${access.clause}`, [req.params.id, ...access.params]);
  if (!old.rows[0]) return res.status(404).json({ error: 'Demande introuvable' });
  if (Number(old.rows[0].created_by) !== Number(req.user.id)) {
    return res.status(403).json({ error: 'Seul le créateur peut mettre à jour l’action' });
  }
  const { action, action_note } = req.body || {};
  if (!action || !String(action).trim()) return res.status(400).json({ error: 'Action obligatoire' });
  const r = await query(
    `UPDATE demands SET action=$1, action_note=$2, action_updated_by=$3, action_updated_at=NOW()
     WHERE id=$4 RETURNING *`,
    [String(action).trim(), action_note || null, req.user.id, req.params.id]
  );
  await audit(req, 'UPDATE_DEMAND_ACTION', 'demand', req.params.id, { action, action_note });
  res.json(r.rows[0]);
}));

router.patch('/:id/execution-status', requireAuth, asyncRoute(async (req, res) => {
  // Le demandeur ou l'admin peut modifier le suivi d'exécution
  const { execution_status: status } = req.body || {};
  const config = EXECUTION_STATES[status];
  if (!config) return res.status(400).json({ error: 'Statut d’exécution invalide' });
  const current = await query('SELECT * FROM demands WHERE id=$1', [req.params.id]);
  const demand = current.rows[0];
  if (!demand) return res.status(404).json({ error: 'Demande introuvable' });
  try { await assertAssignment(req, demand.store_id, demand.lot_id); }
  catch (e) { return res.status(e.status || 403).json({ error: e.message }); }
  if (demand.status !== 'approved') return res.status(400).json({ error: 'Le suivi d\'exécution concerne uniquement les demandes approuvées' });
  if (Number(demand.created_by) !== Number(req.user.id)) return res.status(403).json({ error: 'Seul le demandeur peut modifier le suivi d\'exécution' });

  const result = await tx(async client => {
    const updated = await client.query(
      `UPDATE demands SET execution_status=$1, execution_updated_by=$2, execution_updated_at=NOW(), updated_at=NOW()
       WHERE id=$3 RETURNING *`,
      [status, req.user.id, demand.id]
    );
    await client.query(
      `UPDATE planning_tasks SET state=$1, progress=$2, execution_status=$3, gant_visible=true
       WHERE demand_id=$4`,
      [config.task_state, config.progress, status, demand.id]
    );
    return updated.rows[0];
  });
  await audit(req, 'UPDATE_DEMAND_EXECUTION', 'demand', demand.id, {
    from: demand.execution_status || 'en_cours',
    to: status,
    title: demand.title,
    store_id: demand.store_id,
  });
  res.json(result);
}));

router.post('/:id/validate', requireAuth, asyncRoute(async (req, res) => {
  const stage = stageOf(req.user.role);
  if (!stage) return res.status(403).json({ error: 'Validation réservée à CDG / DD / DG' });
  const { decision, comment } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Décision invalide' });

  const access = await readScope(req, 'd.store_id', 2);
  const result = await tx(async client => {
    const r = await client.query(
      `SELECT d.*, u.role AS created_by_role FROM demands d
        LEFT JOIN users u ON u.id=d.created_by WHERE d.id=$1 ${access.clause} FOR UPDATE OF d`,
      [req.params.id, ...access.params]
    );
    const demand = r.rows[0];
    if (!demand) throw Object.assign(new Error('Demande introuvable'), { status: 404 });
    await assertAssignment(req, demand.store_id, demand.lot_id || null);
    if (!canValidate(req.user.role, demand.status, demand.owner_role, demand.created_by, req.user.id, demand.created_by_role)) {
      throw Object.assign(new Error("Cette demande n'attend pas votre validation"), { status: 403 });
    }
    const priorActor = await client.query(
      'SELECT id FROM demand_validations WHERE demand_id=$1 AND validator_id=$2 LIMIT 1',
      [demand.id, req.user.id]
    );
    if (priorActor.rows[0]) {
      throw Object.assign(new Error('Un acteur ne peut pas décider deux étapes pour la même version'), { status: 403 });
    }
    const expected = STAGE[stage].from;
    if (demand.status !== expected) {
      throw Object.assign(new Error(`Cette demande n'attend pas la validation ${stage} (statut: ${demand.status})`), { status: 400 });
    }
    const prior = await client.query(
      'SELECT id FROM demand_validations WHERE demand_id=$1 AND validator_role=$2',
      [demand.id, stage]
    );
    if (prior.rows[0]) throw Object.assign(new Error(`${stage} a déjà validé cette demande`), { status: 400 });

    await client.query(
      `INSERT INTO demand_validations (demand_id,validator_id,validator_role,decision,comment)
       VALUES ($1,$2,$3,$4,$5)`,
      [demand.id, req.user.id, stage, decision, comment || null]
    );

    const status = decision === 'rejected' ? 'rejected' : STAGE[stage].next;
    const stamp = decision === 'rejected' ? null : STAGE[stage].stamp;
    await client.query(
      `UPDATE demands SET status=$1::varchar,
        rejection_reason=CASE WHEN $2::varchar='rejected' THEN COALESCE(NULLIF($3::text,''),'Rejeté') ELSE rejection_reason END,
        execution_status=CASE WHEN $1::varchar='approved' THEN 'accepte_dg'::varchar ELSE execution_status END,
        ${stamp ? `${stamp}=NOW(),` : ''} updated_at=NOW() WHERE id=$4`,
      [status, decision, comment || null, demand.id]
    );
    await client.query(
      `INSERT INTO state_transitions (entity,entity_id,from_state,to_state,actor_id,actor_role,reason,version,document_hash)
       VALUES ('demand',$1,$2,$3,$4,$5,$6,1,$7)`,
      [demand.id, demand.status, status, req.user.id, req.user.role, comment || null,
        decisionFingerprint({ demand: demand.id, decision, comment, actor: req.user.id, stage })]
    );
    if (stage === 'DG' && decision === 'approved') {
      await client.query(
        `INSERT INTO planning_tasks (store_id,lot_id,title,start_date,end_date,baseline_start_date,baseline_end_date,state,owner_role,progress,created_by,demand_id,amount,department,execution_status)
         VALUES ($1,$2,$3,CURRENT_DATE,COALESCE($4::date,(CURRENT_DATE + INTERVAL '30 days')::date),CURRENT_DATE,COALESCE($4::date,(CURRENT_DATE + INTERVAL '30 days')::date),'a_faire',$5,0,$6,$7,$8,$9,'accepte_dg')
         ON CONFLICT (demand_id) WHERE demand_id IS NOT NULL DO NOTHING`,
         [demand.store_id, demand.lot_id, `Demande approuvée : ${demand.title}`, demand.deadline, demand.owner_role, req.user.id, demand.id, demand.amount, departmentOf(demand.owner_role)]
       );
       if (demand.item_id) {
         await client.query("UPDATE items SET status='approved', updated_at=NOW() WHERE id=$1", [demand.item_id]);
       }
     }
    return { demand, status };
  });

  await audit(req, `DEMAND_${stage}_${decision.toUpperCase()}`, 'demand', req.params.id, {
    decision, comment, resulting_status: result.status,
  });

  const nextRoles = result.status === 'pending_dd' ? ddRolesForOwner(result.demand.owner_role, result.demand.created_by_role)
    : result.status === 'pending_dg' ? ['DG'] : [];
  const eventKey = decision === 'rejected' ? 'rejet_correction'
    : stage === 'CDG' ? 'validation_cdg'
      : stage === 'DD' ? 'validation_dd' : 'validation_finale_dg';
  await publishEvent(eventKey, await demandContext(result.demand, req, {
    decision,
    comment: comment || '',
    reason: comment || `Rejet au stade ${stage}`,
    status: result.status,
    next_role: nextRoles[0] || 'DG',
    current_step: decision === 'approved' ? (stage === 'CDG' ? 'DD' : stage === 'DD' ? 'DG' : null) : null,
    actor_id: req.user.id,
  }));

  res.json({ ok: true, status: result.status, next_stage: nextRoles[0] || null });
}));

export default router;
