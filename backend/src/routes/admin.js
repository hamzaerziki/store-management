import { Router } from 'express';
import bcrypt from 'bcryptjs';
import XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { query } from '../db.js';
import { config } from '../config.js';
import { requireAuth, asyncRoute, can, USER_ROLES } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { STATUS_LABELS } from '../utils/progress.js';

const router = Router();

async function assertDeactivationAllowed(id) {
  const target = await query('SELECT id,name,email,role,active FROM users WHERE id=$1', [id]);
  if (!target.rows[0]) {
    const error = new Error('Utilisateur introuvable');
    error.status = 404;
    throw error;
  }
  if (target.rows[0].active && target.rows[0].role === 'admin') {
    const admins = await query("SELECT count(*)::int AS count FROM users WHERE role='admin' AND active=true AND id<>$1", [id]);
    if (!admins.rows[0].count) {
      const error = new Error('Impossible de dÃ©sactiver le dernier administrateur actif');
      error.status = 409;
      throw error;
    }
  }
  return target.rows[0];
}

router.get('/users', requireAuth, can('manage_users'), asyncRoute(async (req, res) => {
  const where = req.query.active === 'true' ? 'WHERE active=true' : '';
  const r = await query(`SELECT id,name,email,role,department,active,created_at FROM users ${where} ORDER BY id`);
  res.json(r.rows);
}));

router.put('/users/:id', requireAuth, can('manage_users'), asyncRoute(async (req, res) => {
  const { name, role, active, department } = req.body || {};
  if (role && !USER_ROLES.includes(role)) return res.status(400).json({ error: 'Rôle invalide' });
  if (active === false) await assertDeactivationAllowed(req.params.id);
  const current = await query('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!current.rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const nextRole = role || current.rows[0].role;
  const needsDept = ['IT', 'MG', 'RMG'].includes(nextRole);
  let nextDept = current.rows[0].department;
  if (role || department !== undefined) {
    nextDept = needsDept ? String(department || current.rows[0].department || (nextRole === 'RMG' ? 'MG' : nextRole)).toUpperCase() : null;
  }
  if (needsDept && !['IT', 'MG'].includes(nextDept)) {
    return res.status(400).json({ error: 'Département requis (IT ou MG) pour ce rôle' });
  }
  const r = await query(
    `UPDATE users SET name=COALESCE($1,name), role=COALESCE($2,role), department=$3, active=COALESCE($4,active),
      token_version=CASE WHEN $4::boolean IS FALSE THEN COALESCE(token_version,0)+1 ELSE token_version END
     WHERE id=$5 RETURNING id,name,email,role,department,active`,
    [name, role, needsDept ? nextDept : null, active, req.params.id]
  );
  await audit(req, 'UPDATE_USER', 'user', req.params.id, { name, role: nextRole, department: r.rows[0].department, active });
  res.json(r.rows[0]);
}));
router.post('/users/:id/reset-password', requireAuth, can('manage_users'), asyncRoute(async (req, res) => {
  const password = req.body?.password;
  if (!password || String(password).length < config.security.passwordMinLength) {
    return res.status(400).json({ error: `Le mot de passe doit contenir au moins ${config.security.passwordMinLength} caractÃ¨res` });
  }
  const target = await query('SELECT id,name,email FROM users WHERE id=$1', [req.params.id]);
  if (!target.rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });
  await query(
    'UPDATE users SET password_hash=$1, token_version=COALESCE(token_version, 0) + 1 WHERE id=$2',
    [await bcrypt.hash(password, config.security.bcryptRounds), req.params.id]
  );
  await audit(req, 'RESET_PASSWORD', 'user', req.params.id, { email: target.rows[0].email });
  res.json({ ok: true });
}));

router.delete('/users/:id', requireAuth, can('manage_users'), asyncRoute(async (req, res) => {
  await assertDeactivationAllowed(req.params.id);
  const r = await query('UPDATE users SET active=false, token_version=COALESCE(token_version,0)+1 WHERE id=$1 RETURNING id', [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Utilisateur introuvable' });
  await audit(req, 'DEACTIVATE_USER', 'user', req.params.id, {});
  res.json({ ok: true });
}));

router.get('/audit', requireAuth, can('view_audit'), asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size || req.query.limit || 25)));
  const search = String(req.query.q || '').trim();
  const action = String(req.query.action || '').trim();
  const entity = String(req.query.entity || '').trim();
  const userId = String(req.query.user_id || '').trim();
  const dateFrom = String(req.query.date_from || '').trim();
  const dateTo = String(req.query.date_to || '').trim();

  const where = [];
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(a.user_name ILIKE $${params.length} OR a.action ILIKE $${params.length} OR a.entity ILIKE $${params.length} OR COALESCE(a.ip,'') ILIKE $${params.length} OR COALESCE(a.details::text,'') ILIKE $${params.length})`);
  }
  if (action) { params.push(action); where.push(`a.action = $${params.length}`); }
  if (entity) { params.push(entity); where.push(`a.entity = $${params.length}`); }
  if (userId) { params.push(userId); where.push(`a.user_id = $${params.length}::int`); }
  if (dateFrom) { params.push(dateFrom); where.push(`a.created_at::date >= $${params.length}::date`); }
  if (dateTo) { params.push(dateTo); where.push(`a.created_at::date <= $${params.length}::date`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countR = await query(`SELECT COUNT(*)::int AS total FROM audit_logs a ${whereSql}`, params);
  const total = countR.rows[0]?.total || 0;
  const offset = (page - 1) * pageSize;
  params.push(pageSize, offset);
  const rowsR = await query(
    `SELECT a.*, u.role AS user_role, u.email AS user_email
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
      ${whereSql}
      ORDER BY a.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const [statsR, actionsR, entitiesR, usersR] = await Promise.all([
    query(`SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS today,
      COUNT(*) FILTER (WHERE action ILIKE '%LOGIN_SUCCESS%' OR action ILIKE '%CONNEX%')::int AS logins,
      COUNT(*) FILTER (WHERE action ILIKE '%LOGIN_FAILED%' OR action ILIKE '%ECHEC%')::int AS login_failures,
      COUNT(*) FILTER (WHERE action ILIKE '%APPROV%' OR action ILIKE '%VALID%' OR action ILIKE '%APPROB%')::int AS validations,
      COUNT(DISTINCT NULLIF(ip,''))::int AS unique_ips
      FROM audit_logs`),
    query(`SELECT DISTINCT action FROM audit_logs WHERE action IS NOT NULL ORDER BY action`),
    query(`SELECT DISTINCT entity FROM audit_logs WHERE entity IS NOT NULL AND entity <> '' ORDER BY entity`),
    query(`SELECT DISTINCT a.user_id, COALESCE(u.name,a.user_name) AS name, u.role
             FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
            WHERE COALESCE(u.name,a.user_name) IS NOT NULL
            ORDER BY name`),
  ]);

  res.json({
    items: rowsR.rows,
    total,
    page,
    page_size: pageSize,
    stats: statsR.rows[0] || {},
    filters: {
      actions: actionsR.rows.map(r => r.action),
      entities: entitiesR.rows.map(r => r.entity),
      users: usersR.rows.filter(r => r.user_id).map(r => ({ id: r.user_id, name: r.name, role: r.role })),
    },
  });
}));

router.get('/notifications', requireAuth, asyncRoute(async (req, res) => {
  const r = await query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
  res.json(r.rows);
}));

router.patch('/notifications/:id/read', requireAuth, asyncRoute(async (req, res) => {
  await query('UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
}));

router.patch('/notifications/read-all', requireAuth, asyncRoute(async (req, res) => {
  await query('UPDATE notifications SET read=true WHERE user_id=$1', [req.user.id]);
  res.json({ ok: true });
}));

async function progressReport() {
  const r = await query(
    `SELECT st.name AS magasin, st.city AS ville, st.opening_date AS ouverture,
      count(i.id) AS articles,
      COALESCE(round(avg(CASE i.status
        WHEN 'installed' THEN 100 WHEN 'delivered' THEN 90 WHEN 'ordered' THEN 70
        WHEN 'validated' THEN 50 WHEN 'approved' THEN 50 WHEN 'compared' THEN 30
        WHEN 'quotes_received' THEN 15 ELSE 0 END)),0) AS progression,
      st.budget AS budget,
      COALESCE(sum(CASE WHEN i.status IN ('validated','approved','ordered','delivered','installed')
        THEN i.estimated_budget ELSE 0 END),0) AS engage
     FROM stores st LEFT JOIN items i ON i.store_id=st.id
     GROUP BY st.id ORDER BY st.opening_date`
  );
  return r.rows;
}

router.get('/reports/progress.xlsx', requireAuth, can('export_reports'), asyncRoute(async (req, res) => {
  const rows = await progressReport();
  const data = rows.map(r => ({
    Magasin: r.magasin, Ville: r.ville, Ouverture: String(r.ouverture).slice(0, 10),
    Articles: r.articles, 'Progression %': r.progression,
    'Budget MAD': Number(r.budget), 'EngagÃ© MAD': Number(r.engage),
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Progression');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="safari-progression.xlsx"');
  res.send(buf);
}));

router.get('/reports/progress.pdf', requireAuth, can('export_reports'), asyncRoute(async (req, res) => {
  const rows = await progressReport();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="safari-progression.pdf"');
  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(res);
  doc.fontSize(18).fillColor('#0d2c26').text('Safari Import Export', { continued: false });
  doc.fontSize(11).fillColor('#666').text('Rapport de progression des ouvertures â€” ' + new Date().toLocaleDateString('fr-FR'));
  doc.moveDown();
  doc.fontSize(10).fillColor('#000');
  rows.forEach(r => {
    doc.text(`${r.magasin} (${r.ville}) â€” ${r.progression}% â€” ${r.articles} articles â€” Budget ${Number(r.budget).toLocaleString('fr-FR')} MAD`);
  });
  doc.end();
}));

router.get('/reports/progress.csv', requireAuth, can('export_reports'), asyncRoute(async (req, res) => {
  const rows = await progressReport();
  const lines = ['Magasin,Ville,Ouverture,Articles,Progression %,Budget MAD,Engage MAD'];
  rows.forEach(r => lines.push(
    `"${r.magasin}","${r.ville}",${String(r.ouverture).slice(0,10)},${r.articles},${r.progression},${r.budget},${r.engage}`
  ));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="safari-progression.csv"');
  res.send('\uFEFF' + lines.join('\n'));
}));

router.get('/config', requireAuth, asyncRoute(async (req, res) => {
  res.json({ statuses: STATUS_LABELS });
}));

export default router;


