import { Router } from 'express';
import { query, tx } from '../db.js';
import {
  requireAuth, asyncRoute, can, DD_ROLES, VALIDATOR_ROLES, assertAssignment as requireAssignment,
  assertFinancialActor, readScope, departmentOf,
} from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { decisionFingerprint } from '../utils/decision.js';
import { resolveLotId, cleanFreeLabel } from '../utils/lots.js';
import { publishEvent } from '../services/notification-service.js';

const router = Router();

const RESOURCES = {
  lots: { table: 'lots', fields: ['store_id', 'code', 'name', 'owner_role', 'budget', 'status'] },
  purchase_orders: { table: 'purchase_orders', fields: ['store_id', 'lot_id', 'supplier_id', 'item_id', 'quote_id', 'reference', 'amount', 'state', 'ordered_at', 'planned_date', 'revision', 'currency'] },
  invoices: { table: 'invoices', fields: ['store_id', 'lot_id', 'supplier_id', 'purchase_order_id', 'reference', 'amount_ht', 'amount_ttc', 'vat_amount', 'currency', 'state', 'invoice_date', 'due_date', 'finance_reference', 'support_name', 'credit_note', 'credit_reason', 'credit_note_invoice_id'] },
  payments: { table: 'payments', fields: ['store_id', 'invoice_id', 'amount', 'method', 'reference', 'paid_at', 'finance_reference', 'support_name', 'support_url'] },
  risks: { table: 'risks', fields: ['store_id', 'lot_id', 'title', 'description', 'severity', 'probability', 'impact', 'criticality', 'criticality_score', 'state', 'owner_role', 'due_date', 'action', 'attachment_name', 'attachment_url'] },
  receptions: { table: 'receptions', fields: ['store_id', 'lot_id', 'item_id', 'reference', 'received_at', 'conform', 'notes', 'report', 'photo_urls', 'pv_url', 'dd_validated_at', 'dg_decision', 'dg_decision_at', 'dg_decision_comment'] },
  planning_tasks: { table: 'planning_tasks', fields: ['store_id', 'lot_id', 'title', 'start_date', 'end_date', 'baseline_start_date', 'baseline_end_date', 'state', 'owner_role', 'progress', 'weight', 'depends_on', 'delay_days', 'milestone', 'change_reason', 'amount', 'department', 'demand_id', 'execution_status'] },
  delegations: { table: 'delegations', fields: ['from_user_id', 'to_user_id', 'role', 'store_id', 'lot_id', 'starts_at', 'ends_at', 'active'] },
};

const TRANSITIONS = {
  purchase_orders: {
    brouillon: { autorise: ['CDG', 'CG', 'DG'], commande: ['CDG', 'CG', 'DG'], suspendu: [...DD_ROLES] },
    autorise: { commande: ['IT', 'MG'], annule: ['CDG', 'CG', 'DG'] },
    commande: { recu: ['IT', 'MG'], annule: ['CDG', 'CG', 'DG'] },
    recu: { clos: ['CDG', 'CG'] },
  },
  invoices: {
    recue: { verifiee: ['CDG', 'CG', ...DD_ROLES, 'DG'], a_controle: ['CDG', 'CG', ...DD_ROLES, 'DG'], litige: ['CDG', 'CG', 'DG'], avoir: ['CDG', 'CG', 'DG'] },
    a_controle: { verifiee: ['CDG', 'CG', ...DD_ROLES, 'DG'], validee: ['CDG', 'CG', ...DD_ROLES, 'DG'], litige: ['CDG', 'CG', 'DG'] },
    verifiee: { validee: ['CDG', 'CG', 'DG'], payee: ['CDG', 'CG'] },
    validee: { partiellement_payee: ['CDG', 'CG'], payee: ['CDG', 'CG'], avoir: ['CDG', 'CG', 'DG'] },
    partiellement_payee: { payee: ['CDG', 'CG'], avoir: ['CDG', 'CG', 'DG'] },
  },
  risks: {
    ouvert: { en_cours: ['IT', 'MG', ...DD_ROLES], clos: [...DD_ROLES, 'DG'] },
    en_cours: { resolu: [...DD_ROLES, 'DG'] },
  },
  receptions: {
    planifiee: { effectuee: ['IT', 'MG'] },
    effectuee: { conforme: [...DD_ROLES, 'DG'], non_conforme: [...DD_ROLES, 'DG'] },
  },
  planning_tasks: {
    a_faire: { en_cours: ['IT', 'MG', ...DD_ROLES] },
    en_cours: { terminee: ['IT', 'MG', ...DD_ROLES] },
  },
};

const BUDGET_SUBMIT_ROLES = ['IT', 'MG', 'RMG'];
const BUDGET_TRANSITIONS = {
  brouillon: { soumis_cdg: BUDGET_SUBMIT_ROLES },
  soumis_cdg: { soumis_dd: ['CDG', 'CG'], corrige: ['CDG', 'CG'] },
  soumis_dd: { soumis_dg: [...DD_ROLES], corrige: [...DD_ROLES] },
  soumis_dg: { approuve: ['DG'], corrige: ['DG'] },
  corrige: { soumis_cdg: BUDGET_SUBMIT_ROLES },
};

async function riskContext(risk, req, overrides = {}) {
  const store = await query('SELECT name FROM stores WHERE id=$1', [risk.store_id]);
  return {
    project_id: risk.store_id,
    aggregate_type: 'risk',
    aggregate_id: risk.id,
    object_type: 'risk',
    object_id: risk.id,
    reference: `R-${risk.id}`,
    title: risk.title,
    store: store.rows[0]?.name || '',
    severity: risk.severity || risk.criticality || '',
    criticality: risk.criticality || '',
    state: risk.state || '',
    action: risk.action || '',
    actor_id: req.user.id,
    actor: req.user.name || req.user.email || 'Utilisateur',
    ...overrides,
  };
}

const PROJECT_TRANSITIONS = {
  brouillon: { preparation: [...DD_ROLES] },
  preparation: { validation_budget: [...DD_ROLES] },
  validation_budget: { approuve: ['CDG', 'CG', ...DD_ROLES, 'DG'], corrige: ['CDG', 'CG', ...DD_ROLES, 'DG'] },
  approuve: { execution: [...DD_ROLES, 'DG'] },
  execution: { ouvert: ['DG', 'admin'] },
  ouvert: { cloture: ['DG', 'admin'] },
  cloture: {},
  corrige: { validation_budget: ['CDG', 'CG', ...DD_ROLES, 'DG'], preparation: [...DD_ROLES] },
  suspendu: { preparation: [...DD_ROLES, 'DG'] },
  annule: { preparation: [...DD_ROLES] },
};

function canTransition(map, from, to, role) {
  return !!map[from]?.[to]?.includes(role);
}

async function effectiveRole(req, storeId = null, lotId = null) {
  const r = await query(
    `SELECT role FROM delegations
     WHERE to_user_id=$1 AND active=true
       AND starts_at <= CURRENT_DATE AND ends_at >= CURRENT_DATE
       AND (store_id IS NULL OR store_id=$2)
       AND (lot_id IS NULL OR lot_id=$3)
     ORDER BY (store_id IS NULL), (lot_id IS NULL) LIMIT 1`,
    [req.user.id, storeId, lotId]
  );
  return r.rows[0]?.role || req.user.role;
}

async function recordTransition(entity, entityId, from, to, req, role, reason) {
  await query(
    `INSERT INTO state_transitions (entity,entity_id,from_state,to_state,actor_id,actor_role,reason,version,document_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8)`,
    [entity, entityId, from, to, req.user.id, role, reason || null,
      decisionFingerprint({ entity, entityId, from, to, actor: req.user.id, reason, at: new Date().toISOString() })]
  );
  await audit(req, `${entity.toUpperCase()}_TRANSITION`, entity, entityId, { from, to, reason, role });
}

const round2 = value => Math.round(Number(value || 0) * 100) / 100;

async function assertStoreWritable(req, storeId, options = {}) {
  if (options.financial) assertFinancialActor(req);
  if (!storeId) return;
  const r = await query('SELECT locked_read_only FROM stores WHERE id=$1', [storeId]);
  if (r.rows[0]?.locked_read_only && !['DG'].includes(req.user.role)) {
    const error = new Error('Projet clôturé en lecture seule');
    error.status = 403;
    throw error;
  }
}

async function assertAssignment(req, storeId, lotId = null, options = {}) {
  return requireAssignment(req, storeId, lotId, options);
}

const RISK_BANDS = [
  { max: 4, label: 'faible' },
  { max: 9, label: 'moyen' },
  { max: 15, label: 'eleve' },
  { max: 25, label: 'critique' },
];

function riskCriticality(probability, impact) {
  const p = Number(probability);
  const i = Number(impact);
  if (!Number.isFinite(p) || !Number.isFinite(i)
    || !Number.isInteger(p) || !Number.isInteger(i) || p < 1 || p > 5 || i < 1 || i > 5) {
    const error = new Error('Probabilité et impact doivent être des entiers compris entre 1 et 5');
    error.status = 400;
    throw error;
  }
  const score = p * i;
  const band = RISK_BANDS.find(item => score <= item.max) || RISK_BANDS[RISK_BANDS.length - 1];
  return { score, label: band.label };
}

let routeColumnsReady = null;
function ensureRouteColumns() {
  if (!routeColumnsReady) {
    routeColumnsReady = query('ALTER TABLE invoices ADD COLUMN IF NOT EXISTS credit_note_invoice_id INT')
      .catch(e => { console.error('ensureRouteColumns error:', e.message); });
  }
  return routeColumnsReady;
}

async function assertNotSelfValidator(req, entity, entityId, creatorId, version, decisionStates) {
  if (creatorId && Number(creatorId) === Number(req.user.id)) {
    const error = new Error('Le créateur ou demandeur ne peut pas valider son propre dossier');
    error.status = 403;
    throw error;
  }
  const states = decisionStates || ['soumis_dd', 'soumis_dg', 'approuve', 'corrige'];
  const prior = await query(
    `SELECT id FROM state_transitions
      WHERE entity=$1 AND entity_id=$2 AND actor_id=$3
        AND to_state = ANY($4::text[]) AND COALESCE(version, 1) = $5 LIMIT 1`,
    [entity, entityId, req.user.id, states, version || 1]
  );
  if (prior.rowCount) {
    const error = new Error('Un acteur ne peut pas décider deux étapes pour la même version');
    error.status = 403;
    throw error;
  }
}

async function assertApprovedQuote(quoteId) {
  if (quoteId === undefined || quoteId === null || quoteId === '') {
    const error = new Error('quote_id obligatoire : aucun engagement ne peut être créé sans devis source');
    error.status = 400;
    throw error;
  }
  const q = await query(
    `SELECT q.*,
       (SELECT MAX(q2.version) FROM quotes q2
         WHERE q2.supplier_id = q.supplier_id
           AND (q2.item_id IS NOT DISTINCT FROM q.item_id)) AS max_version,
       (SELECT count(*)::int FROM comparisons c
         WHERE c.selected_quote_id = q.id AND c.status IN ('validated','approved')) AS approved_comparisons
      FROM quotes q WHERE q.id=$1`,
    [quoteId]
  );
  if (!q.rows[0]) {
    const error = new Error('Devis source introuvable');
    error.status = 404;
    throw error;
  }
  const quote = q.rows[0];
  if (quote.max_version !== null && Number(quote.version || 1) < Number(quote.max_version)) {
    const error = new Error('Le devis source n’est pas la version courante');
    error.status = 409;
    throw error;
  }
  const state = String(quote.state || '').toLowerCase();
  const approved = ['approuve', 'approved'].includes(state)
    || (quote.approved_version !== null && quote.approved_version !== undefined
      && Number(quote.approved_version) === Number(quote.version || 1))
    || Number(quote.approved_comparisons || 0) > 0;
  if (!approved) {
    const error = new Error('Aucun engagement ne peut provenir d’un devis non approuvé');
    error.status = 409;
    throw error;
  }
  const expiry = quote.expiry_date || quote.validity_date || null;
  if (expiry && new Date(expiry) < new Date(new Date().toDateString())) {
    const error = new Error('Le devis source est expiré');
    error.status = 409;
    throw error;
  }
  if (quote.issue_date && new Date(quote.issue_date) > new Date()) {
    const error = new Error('La date d’émission du devis est incohérente');
    error.status = 409;
    throw error;
  }
  return quote;
}

async function approvedEnvelope(storeId, lotId) {
  const budget = await query(
    `SELECT COALESCE(MAX(amount),0) AS amount FROM budgets
     WHERE store_id=$1 AND lot_id IS NOT DISTINCT FROM $2 AND state='approuve'`,
    [storeId, lotId || null]
  );
  if (Number(budget.rows[0]?.amount || 0) > 0) return Number(budget.rows[0].amount);
  const store = await query('SELECT budget FROM stores WHERE id=$1', [storeId]);
  return Number(store.rows[0]?.budget || 0);
}

async function assertEnvelope(storeId, lotId, extraAmount, excludeId = null) {
  const used = await query(
    `SELECT COALESCE(SUM(amount),0) AS amount FROM purchase_orders
     WHERE store_id=$1 AND lot_id IS NOT DISTINCT FROM $2
       AND state NOT IN ('annule','suspendu') AND id IS DISTINCT FROM $3`,
    [storeId, lotId || null, excludeId]
  );
  const limit = await approvedEnvelope(storeId, lotId);
  if (Number(used.rows[0].amount) + Number(extraAmount || 0) > limit) {
    const error = new Error('Dépassement de l’enveloppe approuvée : révision budgétaire à approuver');
    error.status = 409;
    throw error;
  }
}

async function assertDgApproval(storeId) {
  const budget = await query('SELECT id FROM budgets WHERE store_id=$1 AND validated_dg_at IS NOT NULL LIMIT 1', [storeId]);
  if (budget.rowCount) return;
  const demand = await query(
    `SELECT dv.id FROM demand_validations dv JOIN demands d ON d.id=dv.demand_id
     WHERE d.store_id=$1 AND dv.validator_role='DG' AND dv.decision='approved' LIMIT 1`,
    [storeId]
  );
  if (!demand.rowCount) {
    const error = new Error('Approbation DG requise avant création d’un engagement autorisé');
    error.status = 403;
    throw error;
  }
}

async function invoiceBalance(invoiceId, client = null) {
  const run = client ? client.query.bind(client) : query;
  let r;
  try {
    r = await run(
      `SELECT i.id, i.amount_ttc, i.credit_note,
         COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id=i.id),0) AS paid,
         COALESCE((SELECT SUM(cn.amount_ttc) FROM credit_notes cn
                    WHERE cn.invoice_id=i.id AND cn.deleted_at IS NULL),0)
         + COALESCE((SELECT SUM(c.amount_ttc) FROM invoices c
                      WHERE c.credit_note=true AND c.credit_note_invoice_id=i.id
                        AND c.deleted_at IS NULL),0) AS credits
        FROM invoices i WHERE i.id=$1`,
      [invoiceId]
    );
  } catch (e) {
    r = await run(
      `SELECT i.id, i.amount_ttc, i.credit_note,
         COALESCE(SUM(p.amount),0) AS paid, 0 AS credits
        FROM invoices i LEFT JOIN payments p ON p.invoice_id=i.id
        WHERE i.id=$1 GROUP BY i.id, i.amount_ttc, i.credit_note`,
      [invoiceId]
    );
  }
  if (!r.rows[0]) return 0;
  if (r.rows[0].credit_note) return 0;
  const balance = Number(r.rows[0].amount_ttc) - Number(r.rows[0].paid) - Number(r.rows[0].credits);
  return Math.max(0, round2(balance));
}

router.get('/summary', requireAuth, asyncRoute(async (req, res) => {
  const tables = Object.values(RESOURCES).map(r => r.table).concat(['budgets']);
  const scope = await readScope(req, 'store_id', 1);
  const filter = scope.clause ? `WHERE 1=1 ${scope.clause}` : '';
  const counts = {};
  for (const table of tables) {
    const r = await query(`SELECT count(*)::int AS count FROM ${table} ${filter}`, scope.params);
    counts[table] = r.rows[0].count;
  }
  const budgets = await query(`SELECT state, count(*)::int AS count FROM budgets ${filter} GROUP BY state ORDER BY state`, scope.params);
  const projects = await query(`SELECT project_state, count(*)::int AS count FROM stores ${filter} GROUP BY project_state ORDER BY project_state`, scope.params);
  res.json({ counts, budgets: budgets.rows, projects: projects.rows });
}));

router.get('/progress', requireAuth, asyncRoute(async (req, res) => {
  const params = [];
  let where = '1=1';
  if (req.query.store_id) { params.push(req.query.store_id); where += ` AND store_id=$${params.length}`; }
  const scope = await readScope(req, 'store_id', params.length + 1);
  params.push(...scope.params);
  where += ` ${scope.clause}`;
  const r = await query(
    `SELECT store_id, lot_id,
       CASE WHEN SUM(weight)>0 THEN ROUND(SUM(progress*weight)::numeric / SUM(weight))::int ELSE 0 END AS weighted_progress,
       count(*)::int AS tasks FROM planning_tasks WHERE ${where}
      GROUP BY store_id, lot_id ORDER BY store_id, lot_id NULLS FIRST`,
    params
  );
  res.json(r.rows);
}));

router.get('/brands', requireAuth, asyncRoute(async (req, res) => {
  const r = await query('SELECT * FROM brands ORDER BY name');
  res.json(r.rows);
}));

router.post('/brands', requireAuth, can('manage_stores'), asyncRoute(async (req, res) => {
  const { name, code } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  const r = await query('INSERT INTO brands (name,code) VALUES ($1,$2) RETURNING *', [name, code || null]);
  await audit(req, 'CREATE_BRAND', 'brand', r.rows[0].id, { name, code });
  res.status(201).json(r.rows[0]);
}));

router.get('/enterprises', requireAuth, asyncRoute(async (req, res) => {
  const r = await query('SELECT * FROM enterprises ORDER BY name');
  res.json(r.rows);
}));

router.post('/enterprises', requireAuth, can('manage_catalog'), asyncRoute(async (req, res) => {
  const { name, kind, contact, notes } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  const r = await query(
    'INSERT INTO enterprises (name,kind,contact,notes) VALUES ($1,$2,$3,$4) RETURNING *',
    [name, kind || 'Entreprise', contact || null, notes || null]
  );
  await audit(req, 'CREATE_ENTERPRISE', 'enterprise', r.rows[0].id, { name, kind });
  res.status(201).json(r.rows[0]);
}));

router.get('/budgets', requireAuth, asyncRoute(async (req, res) => {
  const params = [];
  let where = '1=1';
  if (req.query.store_id) { params.push(req.query.store_id); where += ` AND b.store_id = $${params.length}`; }
  if (req.query.lot_id) { params.push(req.query.lot_id); where += ` AND b.lot_id = $${params.length}`; }
  if (req.query.lot_label) {
    params.push(`%${cleanFreeLabel(req.query.lot_label)}%`);
    where += ` AND b.lot_id IN (SELECT id FROM lots WHERE name ILIKE $${params.length})`;
  }
  const scope = await readScope(req, 'b.store_id', params.length + 1);
  params.push(...scope.params);
  where += ` ${scope.clause}`;
  const r = await query(
    `SELECT b.*, st.name AS store_name, l.name AS lot_name FROM budgets b
     JOIN stores st ON st.id=b.store_id LEFT JOIN lots l ON l.id=b.lot_id
     WHERE ${where} ORDER BY b.created_at DESC`,
    params
  );
  res.json(r.rows);
}));

router.post('/budgets', requireAuth, can('edit_budget'), asyncRoute(async (req, res) => {
  const { store_id, label, amount } = req.body || {};
  if (!store_id || !label) return res.status(400).json({ error: 'Magasin et libellé requis' });
  if (amount !== undefined && Number(amount) < 0) return res.status(400).json({ error: 'Le montant du budget ne peut pas être négatif' });
  const lotId = req.body?.lot_id || (req.body?.lot_label ? await resolveLotId(store_id, req.body.lot_label) : null);
  assertFinancialActor(req);
  await assertStoreWritable(req, store_id, { financial: true });
  await assertAssignment(req, store_id, lotId || null, { financial: true });
  const r = await query(
    `INSERT INTO budgets (store_id,lot_id,label,amount,state,created_by)
     VALUES ($1,$2,$3,$4,'brouillon',$5) RETURNING *`,
    [store_id, lotId || null, label, Number(amount) || 0, req.user.id]
  );
  await recordTransition('budget', r.rows[0].id, null, 'brouillon', req, req.user.role, 'Création');
  res.status(201).json(r.rows[0]);
}));

router.put('/budgets/:id', requireAuth, can('edit_budget'), asyncRoute(async (req, res) => {
  const { amount, revised_amount, reason } = req.body || {};
  const old = await query('SELECT * FROM budgets WHERE id=$1 FOR UPDATE', [req.params.id]);
  if (!old.rows[0]) return res.status(404).json({ error: 'Budget introuvable' });
  if (!reason) return res.status(400).json({ error: 'Motif de révision budgétaire obligatoire' });
  assertFinancialActor(req);
  await assertStoreWritable(req, old.rows[0].store_id, { financial: true });
  await assertAssignment(req, old.rows[0].store_id, old.rows[0].lot_id, { financial: true });
  const nextAmount = round2(revised_amount !== undefined ? revised_amount : amount);
  if (!Number.isFinite(nextAmount) || nextAmount < 0) return res.status(400).json({ error: 'Montant de révision invalide' });
  const result = await tx(async client => {
    const updated = await client.query(
      `UPDATE budgets SET revised_amount=$1, revision=revision+1, state='brouillon',
        submitted_at=NULL, validated_cdg_at=NULL, validated_dd_at=NULL, validated_dg_at=NULL,
        rejection_reason=NULL, updated_at=NOW()
       WHERE id=$2 RETURNING *`,
      [nextAmount, req.params.id]
    );
    await client.query(
      `INSERT INTO budget_versions (budget_id,revision,amount,state,changed_by,reason)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.params.id, old.rows[0].revision + 1, nextAmount, old.rows[0].state, req.user.id, reason]
    );
    return updated.rows[0];
  });
  await recordTransition('budget', old.rows[0].id, old.rows[0].state, 'brouillon', req, req.user.role, reason);
  res.json(result);
}));

router.post('/budgets/:id/transition', requireAuth, asyncRoute(async (req, res) => {
  const { to, reason } = req.body || {};
  const old = await query('SELECT * FROM budgets WHERE id=$1 FOR UPDATE', [req.params.id]);
  if (!old.rows[0]) return res.status(404).json({ error: 'Budget introuvable' });
  const budget = old.rows[0];
  const role = await effectiveRole(req, budget.store_id, budget.lot_id);
  if (!canTransition(BUDGET_TRANSITIONS, budget.state, to, role)) {
    return res.status(403).json({ error: `Transition ${budget.state} → ${to} refusée pour ${role}` });
  }
  assertFinancialActor(req);
  await assertStoreWritable(req, budget.store_id, { financial: true });
  await assertAssignment(req, budget.store_id, budget.lot_id, { financial: true });
  if (['soumis_dd', 'soumis_dg', 'approuve', 'corrige'].includes(to)) {
    try {
      await assertNotSelfValidator(req, 'budget', budget.id, budget.created_by || budget.submitted_by, budget.revision || 1);
    } catch (e) {
      return res.status(e.status || 403).json({ error: e.message });
    }
  }
  if (['soumis_cdg', 'soumis_dd', 'soumis_dg'].includes(to) && !reason && budget.state === 'corrige') {
    return res.status(400).json({ error: 'Motif de correction requis' });
  }
  const stamp = {
    soumis_cdg: 'submitted_at', soumis_dd: 'validated_cdg_at',
    soumis_dg: 'validated_dd_at', approuve: 'validated_dg_at',
  }[to];
  const r = await query(
    `UPDATE budgets SET state=$1, rejection_reason=CASE WHEN $2='corrige' THEN $3 ELSE rejection_reason END,
      ${stamp ? `${stamp}=NOW(),` : ''} updated_at=NOW() WHERE id=$4 RETURNING *`,
    [to, to === 'corrige' ? 'corrige' : '', reason || null, req.params.id]
  );
  await recordTransition('budget', budget.id, budget.state, to, req, role, reason);
  res.json(r.rows[0]);
}));

router.post('/stores/:id/project-state', requireAuth, asyncRoute(async (req, res) => {
  const { to, reason } = req.body || {};
  const old = await query('SELECT id,name,project_state,dd_validated_at,locked_read_only FROM stores WHERE id=$1 FOR UPDATE', [req.params.id]);
  if (!old.rows[0]) return res.status(404).json({ error: 'Magasin introuvable' });
  if (old.rows[0].locked_read_only && !['DG'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Projet clôturé en lecture seule' });
  }
  const role = await effectiveRole(req, old.rows[0].id, null);
  const from = old.rows[0].project_state;
  const forced = ['suspendu', 'annule'].includes(to) && !['cloture'].includes(from) && [...DD_ROLES, 'DG'].includes(role);
  if (!forced && !canTransition(PROJECT_TRANSITIONS, from, to, role)) {
    return res.status(403).json({ error: `Transition projet ${from} → ${to} refusée pour ${role}` });
  }
  if (['corrige', 'suspendu', 'annule'].includes(to) && !reason) return res.status(400).json({ error: 'Motif obligatoire' });
  if (to === 'ouvert') {
    const blockers = await query('SELECT count(*)::int AS count FROM opening_checklist_items WHERE store_id=$1 AND blocking=true AND done=false', [req.params.id]);
    if (blockers.rows[0].count > 0) return res.status(409).json({ error: 'Checklist bloquante incomplète : ouverture impossible' });
    const dd = old.rows[0].dd_validated_at
      ? true
      : (await query('SELECT id FROM receptions WHERE store_id=$1 AND dd_validated_at IS NOT NULL LIMIT 1', [req.params.id])).rowCount > 0
      || (await query('SELECT id FROM opening_decisions WHERE project_id=$1 AND dd_approved_at IS NOT NULL LIMIT 1', [req.params.id])).rowCount > 0;
    if (!dd) return res.status(409).json({ error: 'Validation DD requise avant décision DG d’ouverture' });
    const ddActor = await query(
      'SELECT dd_approved_by FROM opening_decisions WHERE project_id=$1 AND dd_approved_at IS NOT NULL ORDER BY dd_approved_at DESC LIMIT 1',
      [req.params.id]
    );
    if (ddActor.rows[0]?.dd_approved_by && Number(ddActor.rows[0].dd_approved_by) === Number(req.user.id)) {
      return res.status(403).json({ error: 'Le validateur DD ne peut pas porter la décision finale DG' });
    }
  }
  await query(
    'UPDATE stores SET project_state=$1, state_reason=$2, locked_read_only=$3 WHERE id=$4',
    [to, reason || null, to === 'cloture', req.params.id]
  );
  await recordTransition('project', old.rows[0].id, from, to, req, role, reason);
  res.json({ ok: true, from, to });
}));

router.get('/:resource', requireAuth, asyncRoute(async (req, res) => {
  const cfg = RESOURCES[req.params.resource];
  if (!cfg) return res.status(404).json({ error: 'Ressource inconnue' });
  const params = [];
  let where = '1=1';
  if (req.query.store_id) { params.push(req.query.store_id); where += ` AND store_id = $${params.length}`; }
  if (req.query.lot_id) { params.push(req.query.lot_id); where += ` AND lot_id = $${params.length}`; }
  if (req.query.lot_label) {
    params.push(`%${cleanFreeLabel(req.query.lot_label)}%`);
    where += ` AND lot_id IN (SELECT id FROM lots WHERE name ILIKE $${params.length})`;
  }
  const scope = await readScope(req, 'store_id', params.length + 1);
  params.push(...scope.params);
  where += ` ${scope.clause}`;
  if (req.params.resource === 'planning_tasks') {
    const role = req.user.role;
    const allPlanning = ['admin', 'CDG', 'CG', 'RMG', ...DD_ROLES, 'DG'].includes(role);
    if (!allPlanning) {
      const dept = departmentOf(role);
      if (dept) {
        params.push(dept);
        where += ` AND (department = $${params.length} OR (department IS NULL AND owner_role = ANY($${params.length + 1}::text[])))`;
        params.push(dept === 'IT' ? ['IT'] : ['MG', 'RMG']);
      } else {
        where += ' AND 1=0';
      }
    }
  }
  const extra = req.params.resource === 'planning_tasks'
    ? ', (SELECT name FROM lots WHERE lots.id=planning_tasks.lot_id) AS lot_name'
    : '';
  const order = req.params.resource === 'planning_tasks' ? 'start_date NULLS LAST, id' : 'id DESC';
  const r = await query(`SELECT ${cfg.table}.*${extra} FROM ${cfg.table} WHERE ${where} ORDER BY ${order}`, params);
  res.json(r.rows);
}));

router.post('/:resource', requireAuth, can('manage_operations'), asyncRoute(async (req, res) => {
  const resource = req.params.resource;
  const cfg = RESOURCES[resource];
  if (!cfg) return res.status(404).json({ error: 'Ressource inconnue' });
  const financial = ['purchase_orders', 'invoices', 'payments'].includes(resource);
  const storeId = req.body?.store_id || null;
  const lotId = req.body?.lot_id || (req.body?.lot_label ? await resolveLotId(storeId, req.body.lot_label) : null);
  if (lotId && !req.body?.lot_id) req.body.lot_id = lotId;
  const role = await effectiveRole(req, storeId, lotId);
  if (financial) assertFinancialActor(req);
  if (resource === 'payments' && !['CDG', 'CG'].includes(role)) {
    return res.status(403).json({ error: 'Paiement réservé au contrôle de gestion' });
  }
  if (resource === 'delegations') {
    if (!['admin', ...DD_ROLES, 'DG'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Délégation réservée à la direction' });
    }
    const delegationRole = req.body?.role;
    if (!VALIDATOR_ROLES.includes(delegationRole)) {
      return res.status(400).json({ error: 'Rôle de délégation invalide' });
    }
    if (!req.body?.from_user_id || !req.body?.to_user_id) {
      return res.status(400).json({ error: 'Utilisateurs source et cible requis' });
    }
    if (String(req.body.from_user_id) === String(req.body.to_user_id)) {
      return res.status(400).json({ error: 'La délégation à soi-même n’est pas autorisée' });
    }
    if (!['admin', 'DG'].includes(req.user.role) && String(req.body.from_user_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Vous ne pouvez déléguer que votre propre rôle' });
    }
    const source = await query('SELECT role FROM users WHERE id=$1 AND active=true', [req.body.from_user_id]);
    if (!source.rows[0] || source.rows[0].role !== delegationRole) {
      return res.status(400).json({ error: 'Le rôle délégué doit correspondre au rôle de l’utilisateur source' });
    }
    if (req.body?.starts_at && req.body?.ends_at && new Date(req.body.starts_at) > new Date(req.body.ends_at)) {
      return res.status(400).json({ error: 'La date de fin doit suivre la date de début' });
    }
  }
  if (resource !== 'delegations') {
    await assertStoreWritable(req, storeId, { financial });
    await assertAssignment(req, storeId, lotId, { financial });
  }

  const amountFields = new Set(['budget', 'amount', 'amount_ht', 'amount_ttc', 'vat_amount', 'credit_note_invoice_id']);
  for (const field of amountFields) {
    if (req.body?.[field] !== undefined && req.body[field] !== null && req.body[field] !== ''
      && (!Number.isFinite(Number(req.body[field])) || Number(req.body[field]) < 0)) {
      return res.status(400).json({ error: `Montant invalide pour ${field} : une valeur positive est requise` });
    }
  }
  if (req.body?.progress !== undefined && (Number(req.body.progress) < 0 || Number(req.body.progress) > 100)) {
    return res.status(400).json({ error: 'La progression doit être comprise entre 0 et 100' });
  }
  if (req.body?.weight !== undefined && Number(req.body.weight) < 0) {
    return res.status(400).json({ error: 'Le poids doit être positif ou nul' });
  }
  if (resource === 'planning_tasks') {
    if (req.body?.start_date && req.body?.end_date && new Date(req.body.start_date) > new Date(req.body.end_date)) {
      return res.status(400).json({ error: 'La date de fin doit suivre la date de début' });
    }
    if (req.body?.baseline_start_date && req.body?.baseline_end_date
      && new Date(req.body.baseline_start_date) > new Date(req.body.baseline_end_date)) {
      return res.status(400).json({ error: 'Les dates de référence du planning sont incohérentes' });
    }
  }

  const computed = {};
  if (resource === 'risks') {
    try {
      const impactValue = req.body?.impact !== undefined && String(req.body.impact).trim() !== ''
        && Number.isFinite(Number(req.body.impact)) ? req.body.impact : req.body?.severity;
      const risk = riskCriticality(req.body?.probability, impactValue);
      computed.criticality_score = risk.score;
      computed.criticality = String(risk.score);
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }
  }

  if (resource === 'purchase_orders') {
    if (req.body?.quote_id === undefined || req.body?.quote_id === null || req.body?.quote_id === '') {
      return res.status(400).json({ error: 'quote_id obligatoire : aucun engagement ne peut être créé sans devis source' });
    }
    const amount = round2(req.body?.amount);
    await assertEnvelope(storeId, lotId, amount);
    if (['autorise', 'commande'].includes(req.body?.state)) {
      await assertDgApproval(storeId);
      try { await assertApprovedQuote(req.body.quote_id); }
      catch (e) { return res.status(e.status || 409).json({ error: e.message }); }
    }
  }

  if (resource === 'invoices') {
    await ensureRouteColumns();
    if (!req.body?.purchase_order_id) return res.status(400).json({ error: 'Facture reliée à un engagement obligatoire' });
    const ht = round2(req.body?.amount_ht);
    const ttc = round2(req.body?.amount_ttc);
    const tva = req.body?.vat_amount !== undefined ? round2(req.body.vat_amount) : round2(ttc - ht);
    if (round2(ht + tva) !== ttc) return res.status(400).json({ error: 'TTC incohérent : HT + TVA doit égaler TTC' });
    if (req.body?.invoice_date && req.body?.due_date && new Date(req.body.invoice_date) > new Date(req.body.due_date)) {
      return res.status(400).json({ error: 'La date d’échéance doit suivre la date de facture' });
    }
    const duplicate = await query(
      'SELECT id FROM invoices WHERE supplier_id IS NOT DISTINCT FROM $1 AND reference=$2 LIMIT 1',
      [req.body?.supplier_id || null, req.body?.reference || null]
    );
    if (req.body?.reference && duplicate.rowCount) {
      return res.status(409).json({ error: 'Référence de facture déjà utilisée pour ce prestataire' });
    }
    const po = await query('SELECT amount FROM purchase_orders WHERE id=$1', [req.body.purchase_order_id]);
    if (!po.rows[0]) return res.status(404).json({ error: 'Engagement introuvable' });
    const amendments = await query('SELECT COALESCE(SUM(amount),0) AS amount FROM purchase_order_amendments WHERE purchase_order_id=$1', [req.body.purchase_order_id]);
    if (ttc > Number(po.rows[0].amount) + Number(amendments.rows[0].amount)) {
      return res.status(409).json({ error: 'Dépassement de l’engagement : régularisation requise' });
    }
    req.body.vat_amount = tva;
  }

  if (resource === 'payments') {
    await ensureRouteColumns();
    if (!req.body?.finance_reference || !req.body?.support_name) {
      return res.status(400).json({ error: 'Justificatif Finance et référence obligatoires' });
    }
    if (!req.body?.invoice_id) return res.status(400).json({ error: 'Facture obligatoire' });
    const amount = round2(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Le montant du paiement doit être positif' });
    const invoice = await query('SELECT id,credit_note FROM invoices WHERE id=$1 FOR UPDATE', [req.body.invoice_id]);
    if (!invoice.rows[0]) return res.status(404).json({ error: 'Facture introuvable' });
    if (invoice.rows[0].credit_note) return res.status(409).json({ error: 'Aucun paiement ne peut être imputé sur un avoir' });
    const balance = await invoiceBalance(req.body.invoice_id);
    if (amount > balance) return res.status(409).json({ error: 'Montant supérieur au solde de la facture' });
  }

  const numericFields = new Set(['budget', 'amount', 'amount_ht', 'amount_ttc', 'vat_amount', 'revision', 'progress', 'weight', 'delay_days', 'criticality_score']);
  const entries = cfg.fields
    .filter(field => (computed[field] !== undefined) || (req.body && Object.prototype.hasOwnProperty.call(req.body, field)))
    .map(field => {
      let value = computed[field] !== undefined ? computed[field] : req.body[field];
      if (numericFields.has(field)) value = round2(value);
      if (field === 'photo_urls' && typeof value === 'string') value = value.split(',').map(item => item.trim()).filter(Boolean);
      if (field === 'photo_urls') value = JSON.stringify(Array.isArray(value) ? value : []);
      return [field, value];
    });
  if (resource === 'delegations' && !entries.some(([field]) => field === 'active')) entries.push(['active', true]);
  if (resource === 'planning_tasks') {
    if (!entries.some(([field]) => field === 'baseline_start_date')) entries.push(['baseline_start_date', req.body?.start_date || null]);
    if (!entries.some(([field]) => field === 'baseline_end_date')) entries.push(['baseline_end_date', req.body?.end_date || null]);
    if (!entries.some(([field]) => field === 'weight')) entries.push(['weight', 1]);
  }
  const columns = entries.map(([field]) => field).concat(resource === 'payments' ? ['recorded_by'] : ['created_by']);
  const values = entries.map(([, value]) => value).concat(req.user.id);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(',');
  const r = await query(
    `INSERT INTO ${cfg.table} (${columns.join(',')}) VALUES (${placeholders}) RETURNING *`,
    values
  );
  await audit(req, `CREATE_${resource.toUpperCase()}`, resource, r.rows[0].id, req.body);
  if (resource === 'risks') {
    await publishEvent('depassement_retard', await riskContext(r.rows[0], req, { decision: 'created' }));
  }
  res.status(201).json(r.rows[0]);
}));

router.put('/planning_tasks/:id', requireAuth, can('manage_operations'), asyncRoute(async (req, res) => {
  const { title, start_date, end_date, state, owner_role, progress, weight, depends_on, milestone, change_reason, lot_label, updated_by, execution_status } = req.body || {};
  const old = await query('SELECT * FROM planning_tasks WHERE id=$1 FOR UPDATE', [req.params.id]);
  if (!old.rows[0]) return res.status(404).json({ error: 'Tâche de planning introuvable' });
  await assertStoreWritable(req, old.rows[0].store_id);
  await assertAssignment(req, old.rows[0].store_id, old.rows[0].lot_id);
  const lotId = lot_label ? await resolveLotId(old.rows[0].store_id, lot_label) : null;
  if (start_date && end_date && new Date(start_date) > new Date(end_date)) {
    return res.status(400).json({ error: 'La date de fin doit suivre la date de début' });
  }
  const execMap = {
    accepte_dg: { progress: 0, state: 'a_faire' },
    en_cours: { progress: 50, state: 'en_cours' },
    livre: { progress: 100, state: 'terminee' },
    installe: { progress: 100, state: 'terminee' },
  };
  const mapped = execution_status ? execMap[execution_status] : null;
  if (execution_status && !mapped) return res.status(400).json({ error: 'Statut d’exécution invalide' });
  const nextProgress = mapped ? mapped.progress : progress;
  const nextState = mapped ? mapped.state : state;
  const nextExecution = execution_status || old.rows[0].execution_status || null;
  if (nextProgress !== undefined && (Number(nextProgress) < 0 || Number(nextProgress) > 100)) {
    return res.status(400).json({ error: 'La progression doit être comprise entre 0 et 100' });
  }
  if (weight !== undefined && Number(weight) < 0) {
    return res.status(400).json({ error: 'Le poids doit être positif ou nul' });
  }
  if ((req.body?.baseline_start_date && String(req.body.baseline_start_date) !== String(old.rows[0].baseline_start_date))
    || (req.body?.baseline_end_date && String(req.body.baseline_end_date) !== String(old.rows[0].baseline_end_date))) {
    return res.status(409).json({ error: 'Planning initial gelé : utilisez une version révisée' });
  }
  const changed = (start_date && String(start_date) !== String(old.rows[0].start_date))
    || (end_date && String(end_date) !== String(old.rows[0].end_date))
    || (nextProgress !== undefined && Number(nextProgress) !== Number(old.rows[0].progress))
    || (execution_status && String(execution_status) !== String(old.rows[0].execution_status || ''));
  if (changed && !change_reason) return res.status(400).json({ error: 'Motif obligatoire pour modifier planning ou progression' });
  const actorId = updated_by || req.user.id;
  const r = await query(
    `UPDATE planning_tasks SET title=COALESCE($1,title), start_date=COALESCE($2,start_date),
      end_date=COALESCE($3,end_date), state=COALESCE($4,state), owner_role=COALESCE($5,owner_role),
      progress=COALESCE($6,progress), weight=COALESCE($7,weight), depends_on=COALESCE($8,depends_on),
      milestone=COALESCE($9,milestone), change_reason=$10, lot_id=COALESCE($11,lot_id), updated_by=$12,
      execution_status=COALESCE($14,execution_status)
      WHERE id=$13 RETURNING *`,
    [title, start_date, end_date, nextState, owner_role, nextProgress === undefined ? null : nextProgress,
      weight === undefined ? null : round2(weight), depends_on === undefined ? null : depends_on,
      milestone === undefined ? null : !!milestone, change_reason || null, lotId, actorId, req.params.id, nextExecution]
  );
  await audit(req, 'UPDATE_PLANNING_TASK', 'planning_task', req.params.id, req.body);
  res.json(r.rows[0]);
}));

router.put('/risks/:id', requireAuth, can('manage_operations'), asyncRoute(async (req, res) => {
  const old = await query('SELECT * FROM risks WHERE id=$1 FOR UPDATE', [req.params.id]);
  if (!old.rows[0]) return res.status(404).json({ error: 'Risque introuvable' });
  await assertStoreWritable(req, old.rows[0].store_id);
  await assertAssignment(req, old.rows[0].store_id, old.rows[0].lot_id);
  const probability = req.body?.probability !== undefined ? req.body.probability : old.rows[0].probability;
  const rawImpact = req.body?.impact !== undefined ? req.body.impact : old.rows[0].impact;
  const impactValue = rawImpact !== undefined && String(rawImpact).trim() !== '' && Number.isFinite(Number(rawImpact))
    ? rawImpact
    : (req.body?.severity !== undefined ? req.body.severity : old.rows[0].severity);
  let risk;
  try {
    risk = riskCriticality(probability, impactValue);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }
  const computed = { criticality: String(risk.score) };
  const entries = RESOURCES.risks.fields
    .filter(field => field !== 'criticality_score'
      && (computed[field] !== undefined || (req.body && Object.prototype.hasOwnProperty.call(req.body, field))))
    .map(field => [field, computed[field] !== undefined ? computed[field] : req.body[field]]);
  const sets = entries.map(([field], i) => `${field}=$${i + 1}`);
  const values = entries.map(([, value]) => value);
  sets.push(`criticality_score=$${values.length + 1}`);
  values.push(risk.score);
  sets.push(`updated_by=$${values.length + 1}`);
  values.push(req.user.id);
  sets.push('updated_at=NOW()', 'row_version=row_version+1');
  values.push(req.params.id);
  const r = await query(
    `UPDATE risks SET ${sets.join(',')} WHERE id=$${values.length} RETURNING *`,
    values
  );
  await audit(req, 'UPDATE_RISK', 'risk', req.params.id, req.body);
  await publishEvent('depassement_retard', await riskContext(r.rows[0], req, { decision: 'updated' }));
  res.json(r.rows[0]);
}));

router.post('/:resource/:id/transition', requireAuth, asyncRoute(async (req, res) => {
  const resource = req.params.resource;
  const cfg = RESOURCES[resource];
  const map = TRANSITIONS[resource];
  if (!cfg || !map) return res.status(404).json({ error: 'Transition indisponible' });
  const { to, reason } = req.body || {};
  const old = await query(`SELECT * FROM ${cfg.table} WHERE id=$1 FOR UPDATE`, [req.params.id]);
  if (!old.rows[0]) return res.status(404).json({ error: 'Enregistrement introuvable' });
  const row = old.rows[0];
  const financial = ['purchase_orders', 'invoices', 'payments'].includes(resource);
  if (financial) assertFinancialActor(req);
  await assertStoreWritable(req, row.store_id || null, { financial });
  await assertAssignment(req, row.store_id || null, row.lot_id || null, { financial });
  const role = await effectiveRole(req, row.store_id || null, row.lot_id || null);
  if (!canTransition(map, row.state, to, role)) {
    return res.status(403).json({ error: `Transition ${row.state} → ${to} refusée pour ${role}` });
  }
  try {
    if (resource === 'invoices' && ['verifiee', 'validee', 'a_controle'].includes(to)) {
      await assertNotSelfValidator(req, 'invoice', row.id, row.created_by, row.revision || 1,
        ['verifiee', 'validee', 'a_controle', 'payee', 'partiellement_payee']);
    }
    if (resource === 'purchase_orders' && ['autorise', 'commande'].includes(to)) {
      await assertNotSelfValidator(req, 'purchase_order', row.id, row.created_by, row.revision || 1,
        ['autorise', 'commande']);
    }
  } catch (e) {
    return res.status(e.status || 403).json({ error: e.message });
  }
  if (['annule', 'suspendu', 'corrige', 'litige', 'avoir'].includes(to) && !reason) {
    return res.status(400).json({ error: 'Motif obligatoire pour cette transition' });
  }
  if (resource === 'purchase_orders' && ['autorise', 'commande'].includes(to)) {
    await assertDgApproval(row.store_id);
    await assertEnvelope(row.store_id, row.lot_id, row.amount, row.id);
    if (!row.quote_id) {
      return res.status(400).json({ error: 'quote_id obligatoire : aucun engagement ne peut être créé sans devis source' });
    }
    try { await assertApprovedQuote(row.quote_id); }
    catch (e) { return res.status(e.status || 409).json({ error: e.message }); }
  }
  if (resource === 'invoices' && ['verifiee', 'validee', 'a_controle'].includes(to)) {
    if (!row.purchase_order_id) return res.status(400).json({ error: 'Facture non reliée à un engagement' });
    const po = await query('SELECT amount FROM purchase_orders WHERE id=$1', [row.purchase_order_id]);
    const amendments = await query('SELECT COALESCE(SUM(amount),0) AS amount FROM purchase_order_amendments WHERE purchase_order_id=$1', [row.purchase_order_id]);
    if (Number(row.amount_ttc) > Number(po.rows[0]?.amount || 0) + Number(amendments.rows[0].amount)) {
      return res.status(409).json({ error: 'Dépassement de l’engagement : régularisation requise' });
    }
    const r = await query(`UPDATE ${cfg.table} SET state=$1, controlled_at=NOW(), controller_id=$3 WHERE id=$2 RETURNING *`, [to, row.id, req.user.id]);
    await recordTransition(resource, row.id, row.state, to, req, role, reason);
    return res.json(r.rows[0]);
  }
  const r = await query(`UPDATE ${cfg.table} SET state=$1 WHERE id=$2 RETURNING *`, [to, row.id]);
  await recordTransition(resource, row.id, row.state, to, req, role, reason);
  res.json(r.rows[0]);
}));

router.delete('/:resource/:id', requireAuth, can('manage_operations'), asyncRoute(async (req, res) => {
  const resource = req.params.resource;
  const cfg = RESOURCES[resource];
  if (!cfg) return res.status(404).json({ error: 'Ressource inconnue' });
  const old = await query(`SELECT * FROM ${cfg.table} WHERE id=$1`, [req.params.id]);
  if (!old.rows[0]) return res.status(404).json({ error: 'Enregistrement introuvable' });
  const financial = ['purchase_orders', 'invoices', 'payments'].includes(resource);
  if (financial) assertFinancialActor(req);
  await assertStoreWritable(req, old.rows[0].store_id || null, { financial });
  await assertAssignment(req, old.rows[0].store_id || null, old.rows[0].lot_id || null, { financial });
  const validated = ['approuve', 'validee', 'verifiee', 'payee', 'partiellement_payee', 'commande', 'recu', 'clos'];
  if (validated.includes(old.rows[0].state)) {
    return res.status(409).json({ error: 'Suppression interdite : utilisez annulation ou avoir pour conserver l’historique' });
  }
  const r = await query(`DELETE FROM ${cfg.table} WHERE id=$1 RETURNING id`, [req.params.id]);
  await audit(req, `DELETE_${resource.toUpperCase()}`, resource, req.params.id, {});
  res.json({ ok: true });
}));

export default router;
