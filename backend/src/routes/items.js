import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, asyncRoute, can, scope, ownsItem, readScope, DD_ROLES } from '../middleware/auth.js';
import { audit, notify, usersWithRoles } from '../utils/audit.js';
import { STATUS_LABELS, progressOf } from '../utils/progress.js';

const router = Router();

router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const s = scope(req);
  const params = [...s.params];
  const conditions = ['1=1', ...(s.clause ? [s.clause.replace(/^AND\s*/, '')] : [])];
  if (req.query.store_id) { params.push(req.query.store_id); conditions.push(`i.store_id = $${params.length}`); }
  if (req.query.category_id) { params.push(req.query.category_id); conditions.push(`i.category_id = $${params.length}`); }
  if (req.query.status) { params.push(req.query.status); conditions.push(`i.status = $${params.length}`); }
  const access = await readScope(req, 'i.store_id', params.length + 1);
  params.push(...access.params);
  if (access.clause) conditions.push(access.clause.replace(/^AND\s*/, ''));
  const r = await query(
    `SELECT i.*, c.name AS category_name, st.name AS store_name, u.name AS created_by_name,
      (SELECT count(*) FROM quotes q WHERE q.item_id = i.id) AS quotes_count
     FROM items i
     JOIN categories c ON c.id = i.category_id
     JOIN stores st ON st.id = i.store_id
     LEFT JOIN users u ON u.id = i.created_by
     WHERE ${conditions.join(' AND ')} ORDER BY i.store_id, i.id`,
    params
  );
  res.json(r.rows.map(row => ({ ...row, progress: progressOf(row.status) })));
}));

router.get('/:id', requireAuth, asyncRoute(async (req, res) => {
  const s = scope(req);
  const access = await readScope(req, 'i.store_id', 2 + s.params.length);
  const r = await query(
    `SELECT i.*, c.name AS category_name, st.name AS store_name, u.name AS created_by_name FROM items i
     JOIN categories c ON c.id=i.category_id JOIN stores st ON st.id=i.store_id
     LEFT JOIN users u ON u.id=i.created_by
     WHERE i.id=$1 ${s.clause} ${access.clause}`,
    [req.params.id, ...s.params, ...access.params]
  );
  if (!r.rows[0]) return res.status(404).json({ error: 'Article introuvable ou hors périmètre' });
  res.json({ ...r.rows[0], progress: progressOf(r.rows[0].status) });
}));

router.post('/', requireAuth, can('update_items'), asyncRoute(async (req, res) => {
  const { store_id, category_id, name, quantity, estimated_budget, owner_role } = req.body || {};
  if (!store_id || !category_id || !name) return res.status(400).json({ error: 'Champs requis' });
  const own = owner_role || (req.user.role === 'IT' ? 'IT' : 'MG');
  if (req.user.role === 'IT' && own !== 'IT') return res.status(403).json({ error: 'Hors périmètre IT' });
  if (['MG', 'RMG'].includes(req.user.role) && !['MG', 'RMG'].includes(own)) return res.status(403).json({ error: 'Hors périmètre MG' });
  const r = await query(
    `INSERT INTO items (store_id,category_id,name,quantity,estimated_budget,owner_role,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [store_id, category_id, name, quantity || 1, estimated_budget || 0, own, req.user.id]
  );
  await audit(req, 'CREATE_ITEM', 'item', r.rows[0].id, { name, store_id, owner_role: own });
  res.status(201).json(r.rows[0]);
}));

router.post('/quick', requireAuth, can('update_items'), asyncRoute(async (req, res) => {
  const { store_id, template_ids, name, category_id, quantity, estimated_budget, is_service, status, owner_role } = req.body || {};
  if (!store_id) return res.status(400).json({ error: 'Magasin requis' });
  const st = await query('SELECT id FROM stores WHERE id=$1', [store_id]);
  if (!st.rows[0]) return res.status(404).json({ error: 'Magasin introuvable' });
  const allowedStatuses = ['to_quote', 'quotes_received', 'compared', 'ordered', 'delivered', 'installed'];
  const initialStatus = allowedStatuses.includes(status) ? status : 'to_quote';
  const service = is_service === true || is_service === 'true' || is_service === '1';
  const existing = await query('SELECT name FROM items WHERE store_id=$1', [store_id]);
  const seen = new Set(existing.rows.map(r => String(r.name).trim().toLowerCase()));
  const created = [];
  let skipped = 0;
  const allowedOwner = role => req.user.role === 'admin' || role === req.user.role;
  const ids = Array.isArray(template_ids) ? template_ids.map(Number).filter(Boolean) : [];
  if (ids.length) {
    const templates = await query('SELECT * FROM item_templates WHERE id = ANY($1::int[]) ORDER BY id', [ids]);
    for (const t of templates.rows) {
      const key = String(t.name).trim().toLowerCase();
      if (seen.has(key) || !allowedOwner(t.owner_role)) { skipped += 1; continue; }
      const r = await query(
        `INSERT INTO items (store_id,category_id,name,quantity,estimated_budget,status,owner_role,created_by)
         VALUES ($1,$2,$3,$4,$5,'to_quote',$6,$7) RETURNING *`,
        [store_id, t.category_id, t.name, t.default_quantity, t.default_budget, t.owner_role, req.user.id]
      );
      created.push(r.rows[0]);
      seen.add(key);
    }
  } else if (name && category_id) {
    const key = String(name).trim().toLowerCase();
    const own = req.user.role === 'IT' ? 'IT'
      : req.user.role === 'admin' && ['IT', 'MG', 'RMG'].includes(owner_role) ? owner_role
        : 'MG';
    if (seen.has(key)) skipped += 1;
    else {
      const r = await query(
        `INSERT INTO items (store_id,category_id,name,quantity,estimated_budget,status,is_service,owner_role,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [store_id, category_id, name, Number(quantity) || 1, Number(estimated_budget) || 0, initialStatus, service, own, req.user.id]
      );
      created.push(r.rows[0]);
    }
  }
  if (!created.length && !skipped) return res.status(400).json({ error: 'Aucun article sélectionné' });
  await audit(req, 'QUICK_ADD_ITEMS', 'store', store_id, { created: created.length, skipped });
  res.status(201).json({ created: created.length, skipped, items: created });
}));

router.put('/:id', requireAuth, can('update_items'), asyncRoute(async (req, res) => {
  if (!(await ownsItem(req, req.params.id))) return res.status(403).json({ error: 'Hors périmètre' });
  const { name, quantity, estimated_budget, category_id } = req.body || {};
  const r = await query(
    `UPDATE items SET name=COALESCE($1,name), quantity=COALESCE($2,quantity),
     estimated_budget=COALESCE($3,estimated_budget), category_id=COALESCE($4,category_id),
     updated_at=NOW() WHERE id=$5 RETURNING *`,
    [name, quantity, estimated_budget, category_id, req.params.id]
  );
  if (!r.rows[0]) return res.status(404).json({ error: 'Article introuvable' });
  await audit(req, 'UPDATE_ITEM', 'item', req.params.id, req.body);
  res.json(r.rows[0]);
}));

router.patch('/:id/status', requireAuth, can('update_items'), asyncRoute(async (req, res) => {
  const { status, comment } = req.body || {};
  const allowed = ['to_quote', 'quotes_received', 'compared', 'ordered', 'delivered', 'installed'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Statut non autorisé (passer par la validation)' });
  if (!(await ownsItem(req, req.params.id))) return res.status(403).json({ error: 'Hors périmètre' });
  const old = await query('SELECT status, name, store_id FROM items WHERE id=$1', [req.params.id]);
  if (!old.rows[0]) return res.status(404).json({ error: 'Article introuvable' });
  await query('UPDATE items SET status=$1, updated_at=NOW() WHERE id=$2', [status, req.params.id]);
  await audit(req, 'UPDATE_ITEM_STATUS', 'item', req.params.id, {
    from: old.rows[0].status, to: status, label: STATUS_LABELS[status], comment,
  });
  const cg = await usersWithRoles(['CDG', 'CG', ...DD_ROLES, 'DG']);
  await notify(cg.rows.map(u => u.id), `Statut « ${STATUS_LABELS[status]} » pour ${old.rows[0].name}`, 'status');
  res.json({ ok: true, status, progress: progressOf(status) });
}));

router.delete('/:id', requireAuth, can('update_items'), asyncRoute(async (req, res) => {
  if (!(await ownsItem(req, req.params.id))) return res.status(403).json({ error: 'Hors périmètre' });
  const r = await query('DELETE FROM items WHERE id=$1 RETURNING id', [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Article introuvable' });
  await audit(req, 'DELETE_ITEM', 'item', req.params.id, {});
  res.json({ ok: true });
}));

export default router;
