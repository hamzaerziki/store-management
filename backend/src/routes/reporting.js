import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, asyncRoute, can, readScope } from '../middleware/auth.js';
import { computeStoreProgress, storeSignal } from '../utils/progress.js';

const router = Router();

const ITEM_ESTIMATE = `COALESCE(
  (SELECT q.amount_ht FROM comparisons c JOIN quotes q ON q.id=c.selected_quote_id
   WHERE c.item_id=i.id AND c.status IN ('validated','pending_dg') AND q.deleted_at IS NULL ORDER BY c.created_at DESC LIMIT 1),
  (SELECT MIN(q2.amount_ht) FROM quotes q2 WHERE q2.item_id=i.id AND q2.deleted_at IS NULL),
  i.estimated_budget
)`;
const STORE_STATUS_LABELS = {
  planning: 'Planifié', on_track: 'En bonne voie', at_risk: 'À risque',
  late: 'En retard', en_retard: 'En retard', ready: 'Prêt', ouvert: 'Ouvert', cloture: 'Clôturé',
};

function filtersOf(req) {
  return ['year', 'brand', 'city', 'owner', 'store_status'].reduce((acc, key) => {
    const value = req.query[key];
    if (value !== undefined && String(value).trim() !== '') acc[key] = String(value).trim();
    return acc;
  }, {});
}

function applyFilters(rows, filters) {
  return rows.filter(row => {
    if (filters.year && String(row.opening_year) !== filters.year) return false;
    if (filters.brand && row.brand !== filters.brand) return false;
    if (filters.city && row.city !== filters.city) return false;
    if (filters.owner && row.owner_role !== filters.owner) return false;
    if (filters.store_status && row.computed_status !== filters.store_status) return false;
    return true;
  });
}

async function buildSummary(req, filters) {
  const scope = await readScope(req, 's.id', 1);
  const itemScope = await readScope(req, 'i.store_id', 1);
  const [storeRows, itemRows] = await Promise.all([
    query(
      `SELECT s.id, s.name, s.city, s.brand, s.code, EXTRACT(YEAR FROM s.opening_date)::int AS opening_year,
        s.opening_date, s.project_state, s.budget, s.status_override, u.role AS owner_role,
        COALESCE((SELECT SUM(po.amount) FROM purchase_orders po WHERE po.store_id=s.id AND po.state IN ('commande','recu','clos')),0) AS engaged,
        COALESCE((SELECT SUM(i.amount_ttc) FROM invoices i WHERE i.store_id=s.id AND i.credit_note=false),0) AS invoiced,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.store_id=s.id),0) AS paid,
        (SELECT COUNT(*)::int FROM risks rk WHERE rk.store_id=s.id AND rk.state NOT IN ('clos','resolu')) AS risks,
        CASE WHEN s.opening_date < CURRENT_DATE AND s.project_state NOT IN ('ouvert','cloture') THEN 1 ELSE 0 END AS delayed,
        COALESCE((SELECT ROUND(AVG(pt.progress))::int FROM planning_tasks pt WHERE pt.store_id=s.id),0) AS progress
       FROM stores s LEFT JOIN users u ON u.id=s.owner_user_id WHERE 1=1 ${scope.clause} ORDER BY s.name`,
      scope.params
    ),
    query(`SELECT i.store_id, i.status, ${ITEM_ESTIMATE} AS estimate FROM items i WHERE 1=1 ${itemScope.clause}`, itemScope.params),
  ]);
  const statusByStore = new Map();
  storeRows.rows.forEach(store => {
    const rows = itemRows.rows
      .filter(item => item.store_id === store.id)
      .map(item => ({ status: item.status, estimated_budget: item.estimate }));
    const progress = computeStoreProgress(rows);
    const signal = storeSignal(progress, store.opening_date, store.status_override, {
      total: rows.length,
      installed: rows.filter(row => row.status === 'installed').length,
    });
    statusByStore.set(store.id, signal.status);
  });
  const stores = applyFilters(
    storeRows.rows.map(store => ({ ...store, computed_status: statusByStore.get(store.id) })),
    filters
  );
  const totals = stores.reduce((acc, store) => {
    acc.budget += Number(store.budget || 0);
    acc.engaged += Number(store.engaged || 0);
    acc.invoiced += Number(store.invoiced || 0);
    acc.paid += Number(store.paid || 0);
    acc.risks += Number(store.risks || 0);
    acc.delays += Number(store.delayed || 0);
    return acc;
  }, { budget: 0, engaged: 0, invoiced: 0, paid: 0, risks: 0, delays: 0 });

  const byStore = stores.map(store => ({
    ...store,
    available: Number(store.budget || 0) - Number(store.engaged || 0),
  }));
  const byBrand = Object.values(byStore.reduce((acc, store) => {
    const key = store.brand || 'Safari Import';
    acc[key] = acc[key] || { label: key, budget: 0, engaged: 0, invoiced: 0, paid: 0, risks: 0, delays: 0, stores: 0 };
    acc[key].budget += Number(store.budget || 0);
    acc[key].engaged += Number(store.engaged || 0);
    acc[key].invoiced += Number(store.invoiced || 0);
    acc[key].paid += Number(store.paid || 0);
    acc[key].risks += Number(store.risks || 0);
    acc[key].delays += Number(store.delayed || 0);
    acc[key].stores += 1;
    return acc;
  }, {}));

  const lotScope = await readScope(req, 'l.store_id', 1);
  const lotRows = await query(
    `SELECT l.id, l.code, l.name, l.budget, s.name AS store_name, s.brand,
      COALESCE((SELECT SUM(po.amount) FROM purchase_orders po WHERE po.lot_id=l.id AND po.state IN ('commande','recu','clos')),0) AS engaged,
      COALESCE((SELECT SUM(i.amount_ttc) FROM invoices i WHERE i.lot_id=l.id AND i.credit_note=false),0) AS invoiced,
      COALESCE((SELECT SUM(p.amount) FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.lot_id=l.id),0) AS paid
     FROM lots l JOIN stores s ON s.id=l.store_id WHERE 1=1 ${lotScope.clause} ORDER BY s.name, l.code`,
    lotScope.params
  );
  const byLot = lotRows.rows.filter(row => !filters.brand || row.brand === filters.brand);

  const trendScope = await readScope(req, 'store_id', 1);
  const trendRows = await query(
    `SELECT to_char(date_trunc('month', updated_at), 'YYYY-MM') AS month, status, count(*)::int AS count
     FROM items WHERE 1=1 ${trendScope.clause} GROUP BY 1,2 ORDER BY 1`,
    trendScope.params
  );
  const months = [...new Set(trendRows.rows.map(row => row.month))].sort().slice(-12);
  const statuses = [...new Set(trendRows.rows.map(row => row.status))];
  const trend = months.map(month => {
    const point = { month };
    statuses.forEach(status => { point[status] = 0; });
    trendRows.rows.filter(row => row.month === month).forEach(row => { point[row.status] = row.count; });
    return point;
  });

  return {
    generated_at: new Date().toISOString(),
    filters,
    totals,
    by_store: byStore,
    by_brand: byBrand,
    by_lot: byLot,
    trend,
    statuses,
  };
}

router.get('/filters', requireAuth, can('export_reports'), asyncRoute(async (req, res) => {
  const [stores, owners] = await Promise.all([
    query('SELECT name, city, brand, opening_date FROM stores ORDER BY opening_date'),
    query('SELECT DISTINCT u.role FROM users u JOIN stores s ON s.owner_user_id=u.id WHERE u.role IS NOT NULL ORDER BY u.role'),
  ]);
  res.json({
    years: [...new Set(stores.rows.map(s => new Date(s.opening_date).getFullYear()))].filter(Boolean).sort((a, b) => b - a),
    brands: [...new Set(stores.rows.map(s => s.brand || 'Safari Import'))].filter(Boolean).sort(),
    cities: [...new Set(stores.rows.map(s => s.city))].filter(Boolean).sort(),
    owners: owners.rows.map(row => row.role).filter(Boolean),
    statuses: Object.keys(STORE_STATUS_LABELS),
    status_labels: STORE_STATUS_LABELS,
  });
}));

router.get('/summary', requireAuth, can('export_reports'), asyncRoute(async (req, res) => {
  res.json(await buildSummary(req, filtersOf(req)));
}));

router.get('/export', requireAuth, can('export_reports'), asyncRoute(async (req, res) => {
  const data = await buildSummary(req, filtersOf(req));
  const header = ['Magasin', 'Enseigne', 'Ville', 'Budget', 'Engagé', 'Facturé', 'Payé', 'Risques', 'Retards', 'Avancement'];
  const lines = data.by_store.map(store => [
    store.name, store.brand || 'Safari Import', store.city, store.budget, store.engaged,
    store.invoiced, store.paid, store.risks, store.delayed, store.progress,
  ]);
  if (String(req.query.format || 'csv').toLowerCase() === 'pdf') {
    const rows = lines.map(cells => `<tr>${cells.map(cell => `<td>${String(cell ?? '')}</td>`).join('')}</tr>`).join('');
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Rapport Safari</title><style>body{font-family:Arial,sans-serif;font-size:11px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:5px;text-align:left}th{background:#1b4332;color:white}</style></head><body><h1>Rapport d'ouverture — Safari</h1><p>Généré le ${new Date(data.generated_at).toLocaleString('fr-FR')}</p><table><thead><tr>${header.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></body></html>`);
    return;
  }
  const csv = [header, ...lines].map(cells => cells.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(';')).join('\n');
  res.type('text/csv').attachment(`safari-reporting-${new Date().toISOString().slice(0, 10)}.csv`).send(`\uFEFF${csv}`);
}));

export default router;
