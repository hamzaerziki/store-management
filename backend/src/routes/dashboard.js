import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, asyncRoute, readScope } from '../middleware/auth.js';;
import { computeStoreProgress, storeSignal, progressOf, STATUS_LABELS } from '../utils/progress.js';

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

const QUOTE_ESTIMATE = `COALESCE(
  (SELECT q.amount_ht FROM comparisons c JOIN quotes q ON q.id=c.selected_quote_id
   WHERE c.item_id=i.id AND c.status IN ('validated','pending_dg') AND q.deleted_at IS NULL ORDER BY c.created_at DESC LIMIT 1),
  (SELECT MIN(q2.amount_ht) FROM quotes q2 WHERE q2.item_id=i.id AND q2.deleted_at IS NULL),
  i.estimated_budget
)`;

const FILTER_KEYS = ['year', 'brand', 'city', 'owner', 'enterprise', 'status', 'store_status'];

function activeFilterValues(query) {
  return FILTER_KEYS.reduce((acc, key) => {
    const value = query[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') acc[key] = String(value).trim();
    return acc;
  }, {});
}

async function filterOptions() {
  const [stores, items] = await Promise.all([
    query('SELECT name, city, opening_date, brand FROM stores ORDER BY opening_date'),
    query(
      `SELECT i.owner_role, i.status,
        (SELECT sup.name FROM quotes q JOIN suppliers sup ON sup.id=q.supplier_id
         WHERE q.item_id=i.id ORDER BY q.id DESC LIMIT 1) AS enterprise_name
       FROM items i`
    ),
  ]);
  return {
    years: [...new Set(stores.rows.map(s => new Date(s.opening_date).getFullYear()))].filter(Boolean).sort((a, b) => b - a),
    brands: [...new Set(stores.rows.map(s => s.brand || 'Safari Import'))].sort(),
    cities: [...new Set(stores.rows.map(s => s.city))].filter(Boolean).sort(),
    owners: [...new Set(items.rows.map(i => i.owner_role))].filter(Boolean).sort(),
    enterprises: [...new Set(items.rows.map(i => i.enterprise_name))].filter(Boolean).sort(),
    statuses: Object.keys(STATUS_LABELS),
  };
}

async function resolveScope(filters) {
  const storesRes = await query('SELECT * FROM stores ORDER BY opening_date');
  const storeFilters = filters.year || filters.brand || filters.city;
  let storeRows = storesRes.rows;
  if (storeFilters) {
    storeRows = storeRows.filter(store => {
      if (filters.year && String(new Date(store.opening_date).getFullYear()) !== filters.year) return false;
      if (filters.brand && (store.brand || 'Safari Import') !== filters.brand) return false;
      if (filters.city && store.city !== filters.city) return false;
      return true;
    });
  }
  const storeIds = storeRows.map(store => store.id);
  const itemsRes = await query(
    `SELECT i.id, i.store_id, i.owner_role, i.status, ${QUOTE_ESTIMATE} AS estimate,
      (SELECT sup.name FROM quotes q JOIN suppliers sup ON sup.id=q.supplier_id
       WHERE q.item_id=i.id ORDER BY q.id DESC LIMIT 1) AS enterprise_name
     FROM items i`
  );
  let itemRows = itemsRes.rows;
  if (storeFilters) itemRows = itemRows.filter(item => storeIds.includes(item.store_id));
  if (filters.owner) itemRows = itemRows.filter(item => item.owner_role === filters.owner);
  if (filters.status) itemRows = itemRows.filter(item => item.status === filters.status);
  if (filters.enterprise) itemRows = itemRows.filter(item => item.enterprise_name === filters.enterprise);
  if (filters.store_status) {
    const statusByStore = new Map();
    storeRows.forEach(store => {
      const rows = itemRows
        .filter(item => item.store_id === store.id)
        .map(item => ({ status: item.status, estimated_budget: item.estimate }));
      const progress = computeStoreProgress(rows);
      const signal = storeSignal(progress, store.opening_date, store.status_override, {
        total: rows.length,
        installed: rows.filter(row => row.status === 'installed').length,
      });
      statusByStore.set(store.id, signal.status);
    });
    storeRows = storeRows.filter(store => statusByStore.get(store.id) === filters.store_status);
  }
  if (filters.owner || filters.status || filters.enterprise) {
    const activeStores = new Set(itemRows.map(item => item.store_id));
    storeRows = storeRows.filter(store => activeStores.has(store.id));
  }
  const allowedStores = new Set(storeRows.map(store => store.id));
  itemRows = itemRows.filter(item => allowedStores.has(item.store_id));
  const itemIds = itemRows.map(item => item.id);
  return { stores: storeRows, itemIds, itemRows };
}

router.get('/filters', requireAuth, asyncRoute(async (req, res) => {
  res.json(await filterOptions());
}));

async function storeSummary(store, itemIds = null) {
  const scoped = itemIds ? 'AND i.id = ANY($2::int[])' : '';
  const params = itemIds ? [store.id, itemIds] : [store.id];
  const items = await query(
    `SELECT i.status, ${QUOTE_ESTIMATE} AS estimate FROM items i WHERE i.store_id=$1 ${scoped}`,
    params
  );
  const rows = items.rows.map(row => ({ status: row.status, estimated_budget: row.estimate }));
  const progress = computeStoreProgress(rows);
  const byStatus = {};
  Object.keys(STATUS_LABELS).forEach(key => { byStatus[key] = 0; });
  rows.forEach(row => { byStatus[row.status] = (byStatus[row.status] || 0) + 1; });
  const estimated = rows.reduce((sum, row) => sum + Number(row.estimated_budget || 0), 0);
  const engaged = rows
    .filter(row => progressOf(row.status) >= 50)
    .reduce((sum, row) => sum + Number(row.estimated_budget || 0), 0);
  const signal = storeSignal(progress, store.opening_date, store.status_override, {
    total: rows.length,
    installed: rows.filter(row => row.status === 'installed').length,
  });
  return {
    id: store.id, name: store.name, city: store.city, opening_date: store.opening_date,
    brand: store.brand || 'Safari Import', code: store.code || null, phase: store.phase || 'planning',
    project_state: store.project_state || 'preparation', state_reason: store.state_reason || null,
    budget: Number(store.budget), progress,
    computed_status: signal.status,
    status_reason: signal.reason,
    status_override: store.status_override,
    items_count: rows.length, items_by_status: byStatus,
    engaged, estimated, days_to_opening: signal.days_to_opening,
  };
}

router.get('/global', requireAuth, asyncRoute(async (req, res) => {
  const filters = activeFilterValues(req.query);
  const scope = await resolveScope(filters);
  const stores = await Promise.all(scope.stores.map(store => storeSummary(store, scope.itemIds)));
  const globalProgress = stores.length ? Math.round(stores.reduce((sum, store) => sum + store.progress, 0) / stores.length) : 0;
  const budgetTotal = stores.reduce((sum, store) => sum + store.budget, 0);
  const engaged = stores.reduce((sum, store) => sum + store.engaged, 0);
  const statusCounts = {};
  stores.forEach(store => { statusCounts[store.computed_status] = (statusCounts[store.computed_status] || 0) + 1; });
  const alerts = (statusCounts.at_risk || 0) + (statusCounts.late || 0) + (statusCounts.en_retard || 0);
  const scopeStoreIds = stores.map(store => store.id);

  const [demandStatusRows, pendingDemandRows, demandAgingRows, riskRows, riskCountRows, lateTaskRows, lateTaskCountRows, countRows, autoRiskRows, budgetByStoreRows] = await Promise.all([
    query(
      `SELECT status, count(*)::int AS count FROM demands WHERE store_id = ANY($1::int[]) GROUP BY status`,
      [scopeStoreIds]
    ),
    query(
      `SELECT d.id, d.title AS item_name, st.name AS store_name, d.amount, d.status,
          'demande' AS kind, '/stores/' || st.id || '?tab=devis' AS url
       FROM demands d JOIN stores st ON st.id=d.store_id
       WHERE d.status IN ('pending_cdg','pending_dd','pending_dg') AND d.store_id = ANY($1::int[])
       ORDER BY d.submitted_at DESC NULLS LAST, d.created_at DESC LIMIT 8`,
       [scopeStoreIds]
     ),
     query(
       `SELECT status, bucket, count(*)::int AS count FROM (
          SELECT d.status,
            CASE
              WHEN EXTRACT(DAY FROM NOW() - d.submitted_at) <= 3 THEN '0-3 j'
              WHEN EXTRACT(DAY FROM NOW() - d.submitted_at) <= 7 THEN '4-7 j'
              WHEN EXTRACT(DAY FROM NOW() - d.submitted_at) <= 14 THEN '8-14 j'
              ELSE '+14 j'
            END AS bucket
          FROM demands d
          WHERE d.status IN ('pending_cdg','pending_dd','pending_dg') AND d.store_id = ANY($1::int[])
        ) aged GROUP BY status, bucket ORDER BY bucket, status`,
       [scopeStoreIds]
     ),
     query(
       `SELECT r.id, r.title, r.severity, r.criticality_score, r.due_date, st.name AS store_name,
          '/stores/' || st.id || '?tab=risques' AS url
       FROM risks r JOIN stores st ON st.id=r.store_id
       WHERE r.state <> 'clos' AND r.deleted_at IS NULL AND r.store_id = ANY($1::int[])
       ORDER BY r.criticality_score DESC NULLS LAST, r.due_date ASC NULLS LAST LIMIT 8`,
      [scopeStoreIds]
    ),
    query(
      `SELECT count(*)::int AS count FROM risks
       WHERE state <> 'clos' AND deleted_at IS NULL AND store_id = ANY($1::int[])`,
      [scopeStoreIds]
    ),
    query(
      `SELECT pt.id, pt.title, pt.end_date, pt.progress, st.name AS store_name,
          '/stores/' || st.id || '?tab=planning' AS url
       FROM planning_tasks pt JOIN stores st ON st.id=pt.store_id
       WHERE pt.end_date < CURRENT_DATE AND COALESCE(pt.progress,0) < 100 AND pt.store_id = ANY($1::int[])
       ORDER BY pt.end_date LIMIT 8`,
      [scopeStoreIds]
    ),
    query(
      `SELECT count(*)::int AS count FROM planning_tasks
       WHERE end_date < CURRENT_DATE AND COALESCE(progress,0) < 100 AND store_id = ANY($1::int[])`,
      [scopeStoreIds]
    ),
    query(
      `SELECT
         (SELECT count(*)::int FROM users) AS users,
         (SELECT count(*)::int FROM stores WHERE id = ANY($1::int[])) AS stores,
         (SELECT count(*)::int FROM demands WHERE store_id = ANY($1::int[])) AS demands,
         (SELECT count(*)::int FROM items WHERE id = ANY($2::int[])) AS items,
         (SELECT count(*)::int FROM categories) AS categories,
         (SELECT count(*)::int FROM suppliers) AS suppliers`,
      [scopeStoreIds, scope.itemIds]
    ),
    query(
      `SELECT * FROM (
         SELECT 'task-' || pt.id AS key, pt.store_id, st.name AS store_name,
           'Tâche de planning en retard' AS title,
           'La tâche « ' || pt.title || ' » dépasse son échéance avec ' || COALESCE(pt.progress,0) || ' % d’avancement.' AS description,
           4 AS severity, 4 AS probability, 16 AS criticality, 'Retard planning' AS impact,
           'Mettre à jour le planning' AS action, '/stores/' || st.id || '?tab=planning' AS url,
           pt.end_date::text AS due_date
         FROM planning_tasks pt JOIN stores st ON st.id=pt.store_id
         WHERE pt.end_date < CURRENT_DATE AND COALESCE(pt.progress,0) < 100 AND pt.store_id = ANY($1::int[])
         UNION ALL
         SELECT 'budget-' || b.id, b.store_id, st.name,
           'Dépassement budgétaire',
           'Le budget « ' || b.label || ' » dépasse son enveloppe.',
           5, 5, 25, 'Budget', 'Réviser le budget', '/stores/' || st.id || '?tab=budget',
           CURRENT_DATE::text
         FROM budgets b JOIN stores st ON st.id=b.store_id
         WHERE b.amount < COALESCE((
           SELECT SUM(po.amount) FROM purchase_orders po
           WHERE po.store_id=b.store_id AND po.state IN ('commande','recu','clos')
         ),0) AND b.store_id = ANY($1::int[])
         UNION ALL
         SELECT 'demand-' || d.id, d.store_id, st.name,
           'Validation bloquée depuis plus de 7 jours',
           'La demande « ' || COALESCE(d.title, '#') || d.id || ' » attend encore une validation.',
           4, 3, 12, 'Délai de validation', 'Relancer CDG / DD / DG', '/stores/' || st.id || '?tab=devis',
           (CURRENT_DATE + INTERVAL '3 days')::text
         FROM demands d JOIN stores st ON st.id=d.store_id
         WHERE d.status IN ('pending_cdg','pending_dd','pending_dg')
           AND COALESCE(d.submitted_at, d.created_at) < NOW() - INTERVAL '7 days'
           AND d.store_id = ANY($1::int[])
         UNION ALL
         SELECT 'po-' || po.id, po.store_id, st.name,
           'Bon de commande en retard',
           'La commande « ' || po.reference || ' » dépasse sa date de livraison prévue.',
           4, 4, 16, 'Logistique', 'Relancer le fournisseur', '/stores/' || st.id || '?tab=engagements',
           po.planned_date::text
         FROM purchase_orders po JOIN stores st ON st.id=po.store_id
         WHERE po.state = 'commande' AND po.planned_date < CURRENT_DATE
           AND po.store_id = ANY($1::int[])

       ) detected ORDER BY criticality DESC, due_date ASC NULLS LAST`,
      [scopeStoreIds]
    ),
    query(
      `SELECT st.id AS store_id, st.name AS store_name, st.budget,
         COALESCE((
           SELECT SUM(po.amount) FROM purchase_orders po
           WHERE po.store_id=st.id AND po.state IN ('commande','recu','clos')
         ),0) AS engaged,
         c.id AS category_id, c.name AS category_name,
         COUNT(i.id)::int AS items_count,
         COALESCE(SUM(${QUOTE_ESTIMATE}),0) AS item_estimate
       FROM stores st
       LEFT JOIN items i ON i.store_id=st.id
       LEFT JOIN categories c ON c.id=i.category_id
       WHERE st.id = ANY($1::int[])
       GROUP BY st.id, st.budget, c.id, c.name
       ORDER BY st.name, c.name`,
      [scopeStoreIds]
    ),
  ]);
  const demandStatusCounts = {};
  demandStatusRows.rows.forEach(row => { demandStatusCounts[row.status] = row.count; });
  const demandPending = ['pending_cdg', 'pending_dd', 'pending_dg']
    .reduce((sum, status) => sum + (demandStatusCounts[status] || 0), 0);

  const detectedRisks = autoRiskRows.rows.map(row => ({
    ...row,
    id: row.key,
    auto: true,
    criticality_score: Number(row.criticality || 0),
  }));
  const allRiskRows = [
    ...riskRows.rows.map(row => ({ ...row, auto: false })),
    ...detectedRisks,
  ].sort((a, b) => Number(b.criticality_score || 0) - Number(a.criticality_score || 0));
  const manualRiskCount = Number(riskCountRows.rows[0]?.count || 0);

  const budgetByStoreMap = new Map();
  budgetByStoreRows.rows.forEach(row => {
    if (!budgetByStoreMap.has(row.store_id)) {
      budgetByStoreMap.set(row.store_id, {
        id: row.store_id,
        name: row.store_name,
        budget: Number(row.budget || 0),
        engaged: Number(row.engaged || 0),
        categories: [],
      });
    }
    const store = budgetByStoreMap.get(row.store_id);
    if (row.category_id && !store.categories.some(category => category.id === row.category_id)) {
      store.categories.push({
        id: row.category_id,
        name: row.category_name,
        items: Number(row.items_count || 0),
        amount: Number(row.item_estimate || 0),
      });
    }
  });
  const budgetByStore = Array.from(budgetByStoreMap.values()).map(store => ({
    ...store,
    available: store.budget - store.engaged,
    pct: store.budget ? Math.round((store.engaged / store.budget) * 100) : 0,
  }));

  const pending = await query(
    `SELECT c.id, i.name AS item_name, st.name AS store_name, q.amount_ttc AS amount, c.status,
        'comparatif' AS kind, '/comparisons/' || c.id AS url
     FROM comparisons c JOIN items i ON i.id=c.item_id JOIN stores st ON st.id=i.store_id
     LEFT JOIN quotes q ON q.id=c.selected_quote_id
     WHERE c.status IN ('pending_cdg','pending_dd','pending_dg') AND i.id = ANY($1::int[])
     ORDER BY c.created_at LIMIT 8`,
    [scope.itemIds]
  );
  const decisions = [
    ...pending.rows.map(row => ({ ...row, amount: Number(row.amount || 0) })),
    ...pendingDemandRows.rows.map(row => ({ ...row, amount: Number(row.amount || 0) })),
  ].sort((a, b) => b.amount - a.amount).slice(0, 8);
  const activity = await query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 8');
  const trendItems = await query(
    `SELECT i.store_id, i.status, i.updated_at, ${QUOTE_ESTIMATE} AS estimate FROM items i WHERE i.id = ANY($1::int[])`,
    [scope.itemIds]
  );
  const itemRows = trendItems.rows.map(row => ({ status: row.status, estimated_budget: row.estimate }));
  const itemsTotal = itemRows.length;
  const itemsInstalled = itemRows.filter(row => row.status === 'installed').length;
  const itemsProgress = computeStoreProgress(itemRows);
  const estimatedTotal = itemRows.reduce((sum, row) => sum + Number(row.estimated_budget || 0), 0);

  const statusTotals = {};
  Object.keys(STATUS_LABELS).forEach(key => { statusTotals[key] = 0; });
  itemRows.forEach(row => { statusTotals[row.status] = (statusTotals[row.status] || 0) + 1; });
  const pipeline = Object.entries(STATUS_LABELS)
    .map(([key, label]) => ({ key, label, count: statusTotals[key] || 0 }))
    .filter(entry => entry.count > 0);

  const formatter = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
  const trend = Array.from({ length: 7 }, (_, index) => {
    const month = new Date();
    month.setDate(1);
    month.setHours(23, 59, 59, 999);
    month.setMonth(month.getMonth() - 6 + index);
    const rows = trendItems.rows.filter(row => new Date(row.updated_at) <= month);
    const progress = computeStoreProgress(rows.map(row => ({ status: row.status, estimated_budget: row.estimate })));
    const byStore = new Map();
    rows.forEach(row => {
      const arr = byStore.get(row.store_id) || [];
      arr.push({ status: row.status, estimated_budget: row.estimate });
      byStore.set(row.store_id, arr);
    });
    const storeIds = [...byStore.keys()];
    const target = storeIds.length
      ? Math.round(storeIds.reduce((sum, id) => sum + computeStoreProgress(byStore.get(id) || []), 0) / storeIds.length)
      : progress;
    return {
      month: formatter.format(month).replace('.', ''),
      progress,
      target,
    };
  });

  res.json({
    filters: { applied: filters },
    kpis: {
      stores: stores.length,
      global_progress: itemsProgress,
      stores_progress: globalProgress,
      items_total: itemsTotal,
      items_installed: itemsInstalled,
      items_progress: itemsProgress,
      estimated_total: estimatedTotal,
      demand_pending: demandPending,
      demand_status_counts: demandStatusCounts,
      risks_open: manualRiskCount + detectedRisks.length,
      risks_manual: manualRiskCount,
      risks_auto: detectedRisks.length,
      planning_late: lateTaskCountRows.rows[0]?.count || 0,
      alerts, budget_total: budgetTotal, budget_engaged: engaged,
      budget_pct: budgetTotal ? Math.round((engaged / budgetTotal) * 100) : 0,
    },
    counts: countRows.rows[0] || {},
    status_counts: statusCounts,
    demand_aging: demandAgingRows.rows,
    smart: { pipeline },
    stores,
    budget_by_store: budgetByStore,
    pending_validations: decisions,
    risks: allRiskRows,
    late_tasks: lateTaskRows.rows,
    recent_activity: activity.rows,
    trend,
  });
}));

router.get('/store/:id', requireAuth, asyncRoute(async (req, res) => {
  const scope = await readScope(req, 'id', 2);
  const st = await query(`SELECT * FROM stores WHERE id=$1 ${scope.clause}`, [req.params.id, ...scope.params]);
  if (!st.rows[0]) return res.status(404).json({ error: 'Magasin introuvable' });
  const summary = await storeSummary(st.rows[0]);

  const categoryRows = await query(
    `SELECT c.id, c.name, i.id AS item_id, i.status, ${QUOTE_ESTIMATE} AS estimate
     FROM categories c LEFT JOIN items i ON i.category_id=c.id AND i.store_id=$1
     ORDER BY c.id`,
    [req.params.id]
  );
  const grouped = new Map();
  categoryRows.rows.forEach(row => {
    if (!grouped.has(row.id)) grouped.set(row.id, { id: row.id, name: row.name, rows: [] });
    if (row.item_id) grouped.get(row.id).rows.push({ status: row.status, estimated_budget: row.estimate });
  });
  const categories = Array.from(grouped.values()).map(group => ({
    id: group.id,
    name: group.name,
    items: group.rows.length,
    progress: computeStoreProgress(group.rows),
  }));

  const blockers = await query(
    `SELECT i.id, i.name, i.status, ${QUOTE_ESTIMATE} AS estimated_budget
     FROM items i WHERE i.store_id=$1 AND i.status IN ('to_quote','quotes_received')
     ORDER BY estimated_budget DESC LIMIT 6`,
    [req.params.id]
  );
  const recent = await query(
    `SELECT * FROM audit_logs WHERE entity='item' OR details->>'store_id'=$1
     ORDER BY created_at DESC LIMIT 6`,
    [req.params.id]
  );
  res.json({ ...summary, categories, next_actions: blockers.rows, recent_activity: recent.rows });
}));

export default router;
