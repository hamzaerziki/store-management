import { Router } from 'express';
import { query } from '../../db.js';
import {
  asyncV1, forbidden, parsePagination, sendPaginated, parseFilters,
} from '../../middleware/standard.js';
import {
  round2, fetchSection8, alerteBudget, ecartPlanning, retardOuverture,
} from '../../utils/finance.js';
import { AUDIT_READ_ROLES, FINANCIAL_READ_ROLES, parseId } from './shared.js';

const router = Router();

async function scopedProjects(req) {
  const filters = parseFilters(req, ['year', 'brand_id', 'city', 'owner_user_id', 'status']);
  const params = [];
  let where = 's.deleted_at IS NULL';
  if (filters.year) { params.push(filters.year); where += ` AND s.project_year = $${params.length}`; }
  if (filters.brand_id) { params.push(filters.brand_id); where += ` AND s.brand_id = $${params.length}`; }
  if (filters.city) { params.push(filters.city); where += ` AND s.city ILIKE $${params.length}`; }
  if (filters.owner_user_id) { params.push(filters.owner_user_id); where += ` AND s.owner_user_id = $${params.length}`; }
  if (filters.status) { params.push(filters.status); where += ` AND s.project_state = $${params.length}`; }
  if (!FINANCIAL_READ_ROLES.includes(req.user.role)) {
    params.push(req.user.id);
    const p = `$${params.length}`;
    where += ` AND EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=s.id AND pm.user_id=${p} AND pm.active=true)`;
  }
  const r = await query(`SELECT s.id FROM stores s WHERE ${where} ORDER BY s.id`, params);
  return { ids: r.rows.map(row => row.id), filters };
}

router.get('/dashboard', asyncV1(async (req, res) => {
  const { ids, filters } = await scopedProjects(req);
  const projects = [];
  for (const id of ids) {
    const section = await fetchSection8(id);
    if (section) projects.push(section);
  }
  const sum = key => round2(projects.reduce((total, project) => total + Number(project[key] || 0), 0));
  const budgetTotal = sum('budget_en_vigueur');
  const engaged = sum('engagement_net');
  const available = sum('disponible_a_engager');
  const invoiced = sum('facture_net');
  const paid = sum('paiements_nets');
  const avgProgress = projects.length
    ? round2(projects.reduce((total, project) => total + Number(project.avancement_projet || 0), 0) / projects.length)
    : 0;
  const lateProjects = projects.filter(project => Number(project.retard_ouverture_jours || 0) > 0).length;
  const risks = projects.reduce((acc, project) => ({
    total: acc.total + (project.risques?.total || 0),
    ouverts: acc.ouverts + (project.risques?.ouverts || 0),
    critiques: acc.critiques + (project.risques?.critiques || 0),
  }), { total: 0, ouverts: 0, critiques: 0 });
  const alerts = projects
    .filter(project => project.alerte_budget !== 'normal' || project.risques?.critiques > 0 || Number(project.retard_ouverture_jours || 0) > 0)
    .map(project => ({
      project_id: project.project_id,
      name: project.name,
      severity: project.alerte_budget === 'depassement' || project.risques?.critiques > 0 ? 'critique' : 'attention',
      message: project.alerte_budget === 'depassement'
        ? 'Budget disponible négatif : révision à approuver'
        : project.risques?.critiques > 0 ? 'Risque critique identifié' : 'Ouverture révisée en retard',
      disponible_a_engager: project.disponible_a_engager,
      retard_ouverture_jours: project.retard_ouverture_jours,
    }));
  res.json({
    generated_at: new Date().toISOString(),
    filters,
    kpis: {
      projets: projects.length,
      budget_en_vigueur: budgetTotal,
      engagement_net: engaged,
      disponible_a_engager: available,
      alerte_budget: alerteBudget(available),
      facture_net: invoiced,
      paiements_nets: paid,
      reste_a_payer: round2(invoiced - paid),
      cout_final_estime: sum('cout_final_estime'),
      avancement_projet: avgProgress,
      ecart_planning: ecartPlanning(avgProgress, projects.length ? round2(projects.reduce((total, project) => total + Number(project.avancement_theorique || 0), 0) / projects.length) : 0),
      retards_ouverture: lateProjects,
      risques: risks,
    },
    projects,
    alerts,
  });
}));

router.get('/audit-events', asyncV1(async (req, res) => {
  if (!AUDIT_READ_ROLES.includes(req.user.role)) throw forbidden('Lecture du journal d’audit non autorisée');
  const pagination = parsePagination(req, { pageSize: 25 });
  const filters = parseFilters(req, ['actor_id', 'action', 'object_type', 'object_id', 'correlation_id', 'from', 'to', 'project_id']);
  const params = [];
  let where = '1=1';
  if (filters.actor_id) { params.push(filters.actor_id); where += ` AND a.actor_id = $${params.length}`; }
  if (filters.action) { params.push(filters.action); where += ` AND a.action ILIKE $${params.length}`; }
  if (filters.object_type) { params.push(filters.object_type); where += ` AND a.object_type = $${params.length}`; }
  if (filters.object_id) { params.push(filters.object_id); where += ` AND a.object_id = $${params.length}`; }
  if (filters.correlation_id) { params.push(filters.correlation_id); where += ` AND a.correlation_id = $${params.length}`; }
  if (filters.from) { params.push(filters.from); where += ` AND a.occurred_at >= $${params.length}`; }
  if (filters.to) { params.push(filters.to); where += ` AND a.occurred_at <= $${params.length}`; }
  if (filters.project_id) {
    const projectId = parseId(filters.project_id, 'projet');
    params.push(projectId);
    const p = `$${params.length}`;
    where += ` AND (
        a.object_id = ${p}
        OR a.object_id IN (SELECT id FROM budgets WHERE store_id=${p})
        OR a.object_id IN (SELECT id FROM purchase_orders WHERE store_id=${p})
        OR a.object_id IN (SELECT id FROM invoices WHERE store_id=${p})
        OR a.object_id IN (SELECT id FROM quotes WHERE item_id IN (SELECT id FROM items WHERE store_id=${p}))
        OR a.object_id IN (SELECT id FROM tasks WHERE package_id IN (SELECT id FROM work_packages WHERE project_id=${p}))
      )`;
  }
  const total = (await query(`SELECT count(*)::int AS count FROM audit_events a WHERE ${where}`, params)).rows[0]?.count || 0;
  const r = await query(
    `SELECT a.* FROM audit_events a WHERE ${where}
      ORDER BY a.occurred_at DESC, a.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.limit, pagination.offset]
  );
  sendPaginated(res, r.rows, pagination, total, { filters });
}));

export default router;
