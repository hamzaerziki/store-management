import { Router } from 'express';
import { query, tx } from '../db.js';
import { requireAuth, asyncRoute, can, DD_ROLES, assertFinancialActor, readScope, assertAssignment as requireAssignment } from '../middleware/auth.js';;
import { audit } from '../utils/audit.js';
import { decisionFingerprint } from '../utils/decision.js';
import { resolveLotId } from '../utils/lots.js';

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

const DIRECTORS = ['DG', ...DD_ROLES];

async function assertWritable(req, storeId, options = {}) {
  if (options.financial) assertFinancialActor(req);
  const r = await query('SELECT locked_read_only FROM stores WHERE id=$1', [storeId]);
  if (r.rows[0]?.locked_read_only && !['DG'].includes(req.user.role)) {
    const error = new Error('Projet clôturé en lecture seule');
    error.status = 403;
    throw error;
  }
}

router.get('/summary', requireAuth, asyncRoute(async (req, res) => {
  const scope = await readScope(req, 'store_id', 1);
  const filter = scope.clause ? `WHERE 1=1 ${scope.clause}` : '';
  const counts = {};
  for (const table of ['change_requests', 'opening_checklist_items', 'store_assignments']) {
    const r = await query(`SELECT count(*)::int AS count FROM ${table} ${filter}`, scope.params);
    counts[table] = r.rows[0].count;
  }
  const amendmentScope = scope.clause ? `WHERE 1=1 ${scope.clause.replace('store_id', 'po.store_id')}` : '';
  const amendments = await query(
    `SELECT count(*)::int AS count FROM purchase_order_amendments a
     JOIN purchase_orders po ON po.id=a.purchase_order_id ${amendmentScope}`,
    scope.params
  );
  counts.purchase_order_amendments = amendments.rows[0].count;
  const planningScope = scope.clause ? `WHERE 1=1 ${scope.clause.replace('store_id', 'pt.store_id')}` : '';
  const planning = await query(
    `SELECT count(*)::int AS count FROM planning_task_versions v
     JOIN planning_tasks pt ON pt.id=v.task_id ${planningScope}`,
    scope.params
  );
  counts.planning_task_versions = planning.rows[0].count;
  const budgetScope = scope.clause ? `WHERE 1=1 ${scope.clause.replace('store_id', 'b.store_id')}` : '';
  const budgets = await query(
    `SELECT count(*)::int AS count FROM budget_versions v
     JOIN budgets b ON b.id=v.budget_id ${budgetScope}`,
    scope.params
  );
  counts.budget_versions = budgets.rows[0].count;
  const blockers = await query(`SELECT count(*)::int AS count FROM opening_checklist_items WHERE blocking=true AND done=false ${scope.clause}`, scope.params);
  const risks = await query(`SELECT count(*)::int AS count FROM risks WHERE state NOT IN ('clos','resolu') ${scope.clause}`, scope.params);
  res.json({ counts, blocking_checklist: blockers.rows[0].count, open_risks: risks.rows[0].count });
}));

router.get('/references', requireAuth, asyncRoute(async (req, res) => {
  const scope = await readScope(req, 'id', 1);
  const storesFilter = scope.clause ? `WHERE 1=1 ${scope.clause}` : '';
  const lotsFilter = scope.clause ? `WHERE 1=1 ${scope.clause.replace('id', 'st.id')}` : '';
  const [stores, users, suppliers, lots, brands] = await Promise.all([
    query(`SELECT id,name,code,city,brand,project_year,opening_date,initial_open_date,revised_open_date,project_state,locked_read_only FROM stores ${storesFilter} ORDER BY name`, scope.params),
    query('SELECT id,name,email,role,active FROM users ORDER BY name'),
    query('SELECT id,name,ice,rc,if_number,phone,email,specialties,rating FROM suppliers ORDER BY name'),
    query(`SELECT l.id,l.code,l.name,l.store_id,l.owner_role,l.budget,st.name AS store_name FROM lots l JOIN stores st ON st.id=l.store_id ${lotsFilter} ORDER BY st.name,l.code`, scope.params),
    query('SELECT * FROM brands ORDER BY name'),
  ]);
  res.json({ stores: stores.rows, users: users.rows, suppliers: suppliers.rows, lots: lots.rows, brands: brands.rows });
}));

router.get('/decisions', requireAuth, asyncRoute(async (req, res) => {
  const params = [];
  let where = 'WHERE 1=1';
  if (req.query.store_id) {
    params.push(req.query.store_id);
    const p = `$${params.length}`;
    where += ` AND st.entity_id IN (
      SELECT id FROM stores WHERE id=${p}
      UNION SELECT id FROM budgets WHERE store_id=${p}
      UNION SELECT id FROM purchase_orders WHERE store_id=${p}
      UNION SELECT id FROM invoices WHERE store_id=${p}
      UNION SELECT id FROM demands WHERE store_id=${p}
      UNION SELECT c.id FROM comparisons c JOIN items i ON i.id=c.item_id WHERE i.store_id=${p}
    )`;
  }
  if (req.query.entity) {
    params.push(req.query.entity);
    where += ` AND st.entity = $${params.length}`;
  }
  const scope = await readScope(req, 'id', params.length + 1);
  params.push(...scope.params);
  if (!scope.all) {
    if (!scope.params.length) {
      where += ' AND 1=0';
    } else {
      const p = `$${params.length}`;
      where += ` AND st.entity_id IN (
        SELECT id FROM stores WHERE id=${p}
        UNION SELECT id FROM budgets WHERE store_id=${p}
        UNION SELECT id FROM purchase_orders WHERE store_id=${p}
        UNION SELECT id FROM invoices WHERE store_id=${p}
        UNION SELECT id FROM demands WHERE store_id=${p}
        UNION SELECT c.id FROM comparisons c JOIN items i ON i.id=c.item_id WHERE i.store_id=${p}
      )`;
    }
  }
  const r = await query(
    `SELECT st.*, u.name AS actor_name FROM state_transitions st
     LEFT JOIN users u ON u.id = st.actor_id ${where}
     ORDER BY st.created_at DESC LIMIT 300`,
    params
  );
  res.json(r.rows);
}));

router.get('/assignments', requireAuth, asyncRoute(async (req, res) => {
  const scope = await readScope(req, 'a.store_id', 1);
  const r = await query(
    `SELECT a.*, u.name AS user_name, u.email, st.name AS store_name, l.name AS lot_name
     FROM store_assignments a JOIN users u ON u.id=a.user_id JOIN stores st ON st.id=a.store_id
     LEFT JOIN lots l ON l.id=a.lot_id
     WHERE 1=1 ${scope.clause} ORDER BY st.name, u.name`,
    scope.params
  );
  res.json(r.rows);
}));

router.post('/assignments', requireAuth, asyncRoute(async (req, res) => {
  if (!['admin', 'DG'].includes(req.user.role)) return res.status(403).json({ error: 'Affectation réservée à admin / DG' });
  const { user_id, store_id, role, active = true } = req.body || {};
  if (!user_id || !store_id) return res.status(400).json({ error: 'Utilisateur et magasin requis' });
  const lotId = req.body?.lot_id || (req.body?.lot_label ? await resolveLotId(store_id, req.body.lot_label) : null);
  const r = await query(
    `INSERT INTO store_assignments (user_id,store_id,lot_id,role,active,created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id,store_id,lot_id) DO UPDATE SET role=EXCLUDED.role, active=EXCLUDED.active
     RETURNING *`,
    [user_id, store_id, lotId || null, role || null, !!active, req.user.id]
  );
  await audit(req, 'UPSERT_ASSIGNMENT', 'store_assignment', r.rows[0].id, req.body);
  res.status(201).json(r.rows[0]);
}));

router.get('/change-requests', requireAuth, asyncRoute(async (req, res) => {
  const params = [];
  let where = '1=1';
  if (req.query.store_id) { params.push(req.query.store_id); where += ` AND cr.store_id = $${params.length}`; }
  const scope = await readScope(req, 'cr.store_id', params.length + 1);
  params.push(...scope.params);
  where += ` ${scope.clause}`;
  const r = await query(
    `SELECT cr.*, st.name AS store_name, l.name AS lot_name, q.amount_ttc AS quote_amount
     FROM change_requests cr JOIN stores st ON st.id=cr.store_id
     LEFT JOIN lots l ON l.id=cr.lot_id LEFT JOIN quotes q ON q.id=cr.quote_id
     WHERE ${where} ORDER BY cr.created_at DESC`,
    params
  );
  res.json(r.rows);
}));

router.post('/change-requests', requireAuth, can('manage_operations'), asyncRoute(async (req, res) => {
  const { store_id, title, description, impact, quote_id, amount } = req.body || {};
  if (!store_id || !title) return res.status(400).json({ error: 'Magasin et intitulé requis' });
  const lotId = req.body?.lot_id || (req.body?.lot_label ? await resolveLotId(store_id, req.body.lot_label) : null);
  await assertWritable(req, store_id);
  await assertAssignment(req, store_id, lotId || null);
  const r = await query(
    `INSERT INTO change_requests (store_id,lot_id,title,description,impact,quote_id,amount,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [store_id, lotId || null, title, description || null, impact || null, quote_id || null, Number(amount) || 0, req.user.id]
  );
  await audit(req, 'CREATE_CHANGE_REQUEST', 'change_request', r.rows[0].id, req.body);
  res.status(201).json(r.rows[0]);
}));

router.post('/change-requests/:id/decision', requireAuth, asyncRoute(async (req, res) => {
  if (![...DIRECTORS, 'CDG', 'CG'].includes(req.user.role)) return res.status(403).json({ error: 'Décision réservée à la direction' });
  const { decision, comment } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Décision invalide' });
  if (decision === 'rejected' && !comment) return res.status(400).json({ error: 'Motif de rejet requis' });
  const access = await readScope(req, 'store_id', 2);
  const old = await query(`SELECT * FROM change_requests WHERE id=$1 ${access.clause} FOR UPDATE`, [req.params.id, ...access.params]);
  if (!old.rows[0]) return res.status(404).json({ error: 'Demande de changement introuvable' });
  await assertAssignment(req, old.rows[0].store_id, old.rows[0].lot_id || null);
  if (Number(old.rows[0].created_by) === Number(req.user.id)) {
    return res.status(403).json({ error: 'Le créateur ne peut pas décider de sa propre demande' });
  }
  const prior = await query(
    `SELECT id FROM state_transitions WHERE entity='change_request' AND entity_id=$1
      AND actor_id=$2 AND to_state IN ('approved','rejected') LIMIT 1`,
    [req.params.id, req.user.id]
  );
  if (prior.rowCount) return res.status(403).json({ error: 'Un acteur ne peut pas décider deux étapes pour la même version' });
  const r = await query(
    `UPDATE change_requests SET state=$1, decided_by=$2, decided_at=NOW(), decision_comment=$3
     WHERE id=$4 RETURNING *`,
    [decision === 'approved' ? 'approved' : 'rejected', req.user.id, comment || null, req.params.id]
  );
  await query(
    `INSERT INTO state_transitions (entity,entity_id,from_state,to_state,actor_id,actor_role,reason,version,document_hash)
     VALUES ('change_request',$1,$2,$3,$4,$5,$6,1,$7)`,
    [req.params.id, old.rows[0].state, r.rows[0].state, req.user.id, req.user.role, comment || null,
      decisionFingerprint({ id: req.params.id, decision, comment, actor: req.user.id })]
  );
  await audit(req, `CHANGE_REQUEST_${decision.toUpperCase()}`, 'change_request', req.params.id, { comment });
  res.json(r.rows[0]);
}));

router.get('/opening-checklist', requireAuth, asyncRoute(async (req, res) => {
  const params = [];
  let where = '1=1';
  if (req.query.store_id) { params.push(req.query.store_id); where += ` AND oc.store_id = $${params.length}`; }
  const scope = await readScope(req, 'oc.store_id', params.length + 1);
  params.push(...scope.params);
  where += ` ${scope.clause}`;
  const r = await query(`SELECT oc.*, u.name AS validator_name FROM opening_checklist_items oc LEFT JOIN users u ON u.id=oc.validated_by WHERE ${where} ORDER BY oc.id`, params);
  res.json(r.rows);
}));

router.post('/opening-checklist', requireAuth, can('manage_operations'), asyncRoute(async (req, res) => {
  const { store_id, label, blocking = true } = req.body || {};
  if (!store_id || !label) return res.status(400).json({ error: 'Magasin et libellé requis' });
  await assertWritable(req, store_id);
  await assertAssignment(req, store_id);
  const r = await query(
    'INSERT INTO opening_checklist_items (store_id,label,blocking) VALUES ($1,$2,$3) RETURNING *',
    [store_id, label, !!blocking]
  );
  await audit(req, 'CREATE_OPENING_CHECK', 'opening_checklist', r.rows[0].id, req.body);
  res.status(201).json(r.rows[0]);
}));

router.patch('/opening-checklist/:id', requireAuth, asyncRoute(async (req, res) => {
  const old = await query('SELECT * FROM opening_checklist_items WHERE id=$1 FOR UPDATE', [req.params.id]);
  if (!old.rows[0]) return res.status(404).json({ error: 'Élément introuvable' });
  await assertWritable(req, old.rows[0].store_id);
  await assertAssignment(req, old.rows[0].store_id);
  const r = await query(
    `UPDATE opening_checklist_items SET done=COALESCE($1,done), validated_by=CASE WHEN $1 THEN $2 ELSE NULL END,
      validated_at=CASE WHEN $1 THEN NOW() ELSE NULL END WHERE id=$3 RETURNING *`,
    [req.body?.done === undefined ? null : !!req.body.done, req.user.id, req.params.id]
  );
  await audit(req, 'UPDATE_OPENING_CHECK', 'opening_checklist', req.params.id, req.body);
  res.json(r.rows[0]);
}));

router.get('/site-reports', requireAuth, asyncRoute(async (req, res) => {
  const params = [];
  let where = '1=1';
  if (req.query.store_id) { params.push(req.query.store_id); where += ` AND r.store_id = $${params.length}`; }
  const scope = await readScope(req, 'r.store_id', params.length + 1);
  params.push(...scope.params);
  where += ` ${scope.clause}`;
  const r = await query(
    `SELECT r.*, st.name AS store_name, l.name AS lot_name, u.name AS recorder
     FROM receptions r JOIN stores st ON st.id=r.store_id LEFT JOIN lots l ON l.id=r.lot_id
     LEFT JOIN users u ON u.id=r.recorded_by WHERE ${where} ORDER BY r.created_at DESC`,
    params
  );
  res.json(r.rows);
}));

router.post('/site-reports', requireAuth, can('manage_operations'), asyncRoute(async (req, res) => {
  const { store_id, item_id, reference, received_at, conform = true, notes, report, photo_urls = [], pv_url } = req.body || {};
  if (!store_id || !reference) return res.status(400).json({ error: 'Magasin et référence requis' });
  const lotId = req.body?.lot_id || (req.body?.lot_label ? await resolveLotId(store_id, req.body.lot_label) : null);
  await assertWritable(req, store_id);
  await assertAssignment(req, store_id, lotId || null);
  const r = await query(
    `INSERT INTO receptions (store_id,lot_id,item_id,reference,received_at,conform,notes,recorded_by,report,photo_urls,pv_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [store_id, lotId || null, item_id || null, reference, received_at || null, !!conform, notes || null,
      req.user.id, report || null, JSON.stringify(Array.isArray(photo_urls) ? photo_urls : []), pv_url || null]
  );
  await audit(req, 'CREATE_SITE_REPORT', 'reception', r.rows[0].id, req.body);
  res.status(201).json(r.rows[0]);
}));

router.post('/site-reports/:id/validation', requireAuth, asyncRoute(async (req, res) => {
  const { kind, decision, comment } = req.body || {};
  if (!['dd', 'dg'].includes(kind)) return res.status(400).json({ error: 'Type de validation invalide' });
  if (kind === 'dd' && !DD_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Validation DD requise' });
  if (kind === 'dg' && req.user.role !== 'DG') return res.status(403).json({ error: 'Validation DG requise' });
  const old = await query('SELECT * FROM receptions WHERE id=$1 FOR UPDATE', [req.params.id]);
  if (!old.rows[0]) return res.status(404).json({ error: 'Compte rendu introuvable' });
  await assertWritable(req, old.rows[0].store_id);
  await assertAssignment(req, old.rows[0].store_id, old.rows[0].lot_id);
  if (Number(old.rows[0].recorded_by) === Number(req.user.id)) {
    return res.status(403).json({ error: 'Le créateur ne peut pas valider son propre compte rendu' });
  }
  const prior = await query(
    `SELECT id FROM state_transitions WHERE entity='reception' AND entity_id=$1 AND actor_id=$2
      AND to_state IN ('dd_validee','dg_decidee','approved','rejected') LIMIT 1`,
    [req.params.id, req.user.id]
  );
  if (prior.rowCount) return res.status(403).json({ error: 'Un acteur ne peut pas décider deux étapes pour la même version' });
  if (kind === 'dg' && !old.rows[0].dd_validated_at) {
    return res.status(409).json({ error: 'Validation DD requise avant décision DG' });
  }
  const column = kind === 'dd' ? 'dd_validated_at' : 'dg_decision_at';
  const r = await query(
    `UPDATE receptions SET ${column}=NOW(), dg_decision=CASE WHEN $2='dg' THEN $3 ELSE dg_decision END,
      dg_decision_comment=CASE WHEN $2='dg' THEN $4 ELSE dg_decision_comment END
     WHERE id=$1 RETURNING *`,
    [req.params.id, kind, decision || null, comment || null]
  );
  const opening = await query('SELECT id FROM opening_decisions WHERE project_id=$1 ORDER BY id DESC LIMIT 1', [old.rows[0].store_id]);
  if (kind === 'dd') {
    if (opening.rowCount) {
      await query('UPDATE opening_decisions SET dd_approved_by=$1, dd_approved_at=NOW(), comment=$2, updated_at=NOW() WHERE id=$3',
        [req.user.id, comment || null, opening.rows[0].id]);
    } else {
      await query('INSERT INTO opening_decisions (project_id,dd_approved_by,dd_approved_at,comment,created_by) VALUES ($1,$2,NOW(),$3,$4)',
        [old.rows[0].store_id, req.user.id, comment || null, req.user.id]);
    }
  } else if (opening.rowCount) {
    await query('UPDATE opening_decisions SET dg_decision=$1, dg_actor_id=$2, dg_decided_at=NOW(), comment=$3, updated_at=NOW() WHERE id=$4',
      [decision || null, req.user.id, comment || null, opening.rows[0].id]);
  } else {
    await query('INSERT INTO opening_decisions (project_id,dg_decision,dg_actor_id,dg_decided_at,comment,created_by) VALUES ($1,$2,$3,NOW(),$4,$5)',
      [old.rows[0].store_id, decision || null, req.user.id, comment || null, req.user.id]);
  }
  await query(
    `INSERT INTO state_transitions (entity,entity_id,from_state,to_state,actor_id,actor_role,reason,version,document_hash)
     VALUES ('reception',$1,$2,$3,$4,$5,$6,1,$7)`,
    [req.params.id, kind === 'dd' ? 'effectuee' : 'dd_validee', kind === 'dd' ? 'dd_validee' : (decision || 'dg_decidee'),
      req.user.id, req.user.role, comment || null, decisionFingerprint({ id: req.params.id, kind, decision, comment })]
  );
  await audit(req, `SITE_${kind.toUpperCase()}_VALIDATION`, 'reception', req.params.id, { decision, comment });
  res.json(r.rows[0]);
}));

router.get('/planning-versions', requireAuth, asyncRoute(async (req, res) => {
  const params = [];
  let where = '1=1';
  if (req.query.task_id) { params.push(req.query.task_id); where += ` AND v.task_id = $${params.length}`; }
  const scope = await readScope(req, 'pt.store_id', params.length + 1);
  params.push(...scope.params);
  where += ` ${scope.clause}`;
  const r = await query(
    `SELECT v.*, u.name AS changed_by_name FROM planning_task_versions v
     JOIN planning_tasks pt ON pt.id=v.task_id LEFT JOIN users u ON u.id=v.changed_by
     WHERE ${where} ORDER BY v.revision DESC`,
    params
  );
  res.json(r.rows);
}));

router.get('/budget-versions', requireAuth, asyncRoute(async (req, res) => {
  const params = [];
  let where = '1=1';
  if (req.query.budget_id) { params.push(req.query.budget_id); where += ` AND v.budget_id = $${params.length}`; }
  const scope = await readScope(req, 'b.store_id', params.length + 1);
  params.push(...scope.params);
  where += ` ${scope.clause}`;
  const r = await query(
    `SELECT v.*, u.name AS changed_by_name FROM budget_versions v
     JOIN budgets b ON b.id=v.budget_id LEFT JOIN users u ON u.id=v.changed_by
     WHERE ${where} ORDER BY v.revision DESC`,
    params
  );
  res.json(r.rows);
}));

router.post('/purchase-orders/:id/amendments', requireAuth, can('manage_operations'), asyncRoute(async (req, res) => {
  const { reference, amount, justification, change_request_id } = req.body || {};
  if (!reference || !Number(amount)) return res.status(400).json({ error: 'Référence et montant requis' });
  const po = await query('SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE', [req.params.id]);
  if (!po.rows[0]) return res.status(404).json({ error: 'Engagement introuvable' });
  assertFinancialActor(req);
  await assertWritable(req, po.rows[0].store_id, { financial: true });
  await assertAssignment(req, po.rows[0].store_id, po.rows[0].lot_id, { financial: true });
  const r = await tx(async client => {
    const inserted = await client.query(
      `INSERT INTO purchase_order_amendments (purchase_order_id,reference,amount,justification,change_request_id,created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, reference, Number(amount), justification || null, change_request_id || null, req.user.id]
    );
    await client.query('UPDATE purchase_orders SET revision=revision+1 WHERE id=$1', [req.params.id]);
    return inserted.rows[0];
  });
  await audit(req, 'CREATE_AMENDMENT', 'purchase_order', req.params.id, req.body);
  res.status(201).json(r);
}));

router.put('/stores/:id/governance', requireAuth, can('manage_stores'), asyncRoute(async (req, res) => {
  const { project_year, revised_open_date, date_change_reason, progress_justification } = req.body || {};
  const old = await query('SELECT * FROM stores WHERE id=$1 FOR UPDATE', [req.params.id]);
  if (!old.rows[0]) return res.status(404).json({ error: 'Magasin introuvable' });
  if (old.rows[0].locked_read_only && !['DG'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Projet clôturé en lecture seule' });
  }
  await assertAssignment(req, req.params.id);
  if (revised_open_date && old.rows[0].initial_open_date && new Date(revised_open_date) < new Date(old.rows[0].initial_open_date)) {
    return res.status(400).json({ error: 'La date révisée ne peut pas précéder la date initiale' });
  }
  const r = await query(
    `UPDATE stores SET project_year=COALESCE($1,project_year), revised_open_date=COALESCE($2,revised_open_date),
      date_change_reason=COALESCE($3,date_change_reason), progress_justification=COALESCE($4,progress_justification),
      dd_validated_at=COALESCE(
        (SELECT MAX(dd_approved_at) FROM opening_decisions WHERE project_id=$5),
        (SELECT MAX(dd_validated_at) FROM receptions WHERE store_id=$5),
        dd_validated_at)
     WHERE id=$5 RETURNING *`,
    [project_year || null, revised_open_date || null, date_change_reason || null, progress_justification || null,
      req.params.id]
  );
  await audit(req, 'UPDATE_STORE_GOVERNANCE', 'store', req.params.id, req.body);
  res.json(r.rows[0]);
}));

router.post('/stores/:id/reopen', requireAuth, asyncRoute(async (req, res) => {
  if (req.user.role !== 'DG') return res.status(403).json({ error: 'Réouverture réservée à DG' });
  const { reason } = req.body || {};
  if (!reason) return res.status(400).json({ error: 'Motif de réouverture obligatoire' });
  await assertAssignment(req, req.params.id);
  const r = await query(
    'UPDATE stores SET locked_read_only=false, reopen_reason=$1 WHERE id=$2 RETURNING *',
    [reason, req.params.id]
  );
  if (!r.rows[0]) return res.status(404).json({ error: 'Magasin introuvable' });
  await query(
    `INSERT INTO state_transitions (entity,entity_id,from_state,to_state,actor_id,actor_role,reason,version,document_hash)
     VALUES ('project',$1,'cloture','reouvert',$2,$3,$4,1,$5)`,
    [req.params.id, req.user.id, req.user.role, reason, decisionFingerprint({ id: req.params.id, reason, actor: req.user.id })]
  );
  await audit(req, 'REOPEN_STORE', 'store', req.params.id, { reason });
  res.json(r.rows[0]);
}));

export default router;
