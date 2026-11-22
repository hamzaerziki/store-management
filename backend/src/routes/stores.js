import { Router } from 'express';
import { query, tx } from '../db.js';
import { requireAuth, requireRole, asyncRoute, can, assertFinancialActor, assertAssignment, readScope } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { computeStoreProgress, storeSignal } from '../utils/progress.js';
import { createUpload, persistUpload } from '../utils/upload-security.js';
import { publishEvent } from '../services/notification-service.js';

const uploadStoreImage = createUpload({ kinds: ['image'], maxBytes: 8 * 1024 * 1024, field: 'image' });

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

async function withProgress(store) {
  const r = await query('SELECT status,estimated_budget FROM items WHERE store_id = $1', [store.id]);
  const progress = computeStoreProgress(r.rows);
  const installed = r.rows.filter(row => row.status === 'installed').length;
  const signal = storeSignal(progress, store.opening_date, store.status_override, { total: r.rows.length, installed });
  return {
    ...store,
    progress,
    computed_status: signal.status,
    status_reason: signal.reason,
    days_to_opening: signal.days_to_opening,
    items_count: r.rows.length,
  };
}

router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const r = await query('SELECT * FROM stores ORDER BY opening_date');
  const stores = await Promise.all(r.rows.map(withProgress));
  if (req.query.status) {
    return res.json(stores.filter(s => s.computed_status === req.query.status));
  }
  res.json(stores);
}));

router.get('/:id', requireAuth, asyncRoute(async (req, res) => {
  const scope = await readScope(req, 'id', 2);
  const r = await query(`SELECT * FROM stores WHERE id = $1 ${scope.clause}`, [req.params.id, ...scope.params]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Magasin introuvable' });
  res.json(await withProgress(r.rows[0]));
}));

router.put('/:id/image', requireAuth, can('manage_stores'), uploadStoreImage.single('image'), asyncRoute(async (req, res) => {
  const current = await query('SELECT id,name,image_url,image_zoom,image_pos_x,image_pos_y FROM stores WHERE id=$1', [req.params.id]);
  if (!current.rows[0]) return res.status(404).json({ error: 'Magasin introuvable' });
  let storedImage = current.rows[0].image_url || null;
  const hasFile = !!req.file;
  const clear = req.body?.image_url === '' || req.body?.clear_image === 'true';
  const hasTransform = req.body?.image_zoom !== undefined || req.body?.image_pos_x !== undefined || req.body?.image_pos_y !== undefined;
  if (hasFile) storedImage = `/uploads/${await persistUpload(req.file, 'store')}`;
  else if (clear) storedImage = null;
  else if (!hasTransform) return res.status(400).json({ error: 'Image ou transformation requise' });
  const zoom = req.body?.image_zoom !== undefined ? Math.min(2.5, Math.max(1, Number(req.body.image_zoom) || 1)) : (hasFile || clear ? 1 : current.rows[0].image_zoom ?? 1);
  const posX = req.body?.image_pos_x !== undefined ? Number(req.body.image_pos_x) || 0 : (hasFile || clear ? 0 : current.rows[0].image_pos_x ?? 0);
  const posY = req.body?.image_pos_y !== undefined ? Number(req.body.image_pos_y) || 0 : (hasFile || clear ? 0 : current.rows[0].image_pos_y ?? 0);
  const r = await query(
    'UPDATE stores SET image_url=$1, image_zoom=$2, image_pos_x=$3, image_pos_y=$4, updated_at=NOW() WHERE id=$5 RETURNING *',
    [storedImage, zoom, posX, posY, req.params.id]
  );
  await audit(req, 'UPDATE_STORE_IMAGE', 'store', req.params.id, { from: current.rows[0].image_url || null, to: storedImage, zoom, posX, posY, name: current.rows[0].name });
  res.json(r.rows[0]);
}));

router.post('/', requireAuth, can('manage_stores'), uploadStoreImage.single('image'), asyncRoute(async (req, res) => {
  const { name, city, opening_date, budget, status, brand, brand_id, code, project_year, address, area_m2, owner_user_id, initial_open_date, forecast_open_date, revised_open_date, actual_open_date, phase, project_state, state_reason, date_change_reason, image_url } = req.body || {};
  if (!name || !city || !opening_date) return res.status(400).json({ error: 'Nom, ville et date requis' });
  if (budget !== undefined && req.user.role !== 'admin') assertFinancialActor(req);
  const storedImage = req.file ? `/uploads/${await persistUpload(req.file, 'store')}` : image_url || null;
  const r = await query(
    `INSERT INTO stores
      (name,city,opening_date,budget,status,brand,brand_id,code,project_year,address,area_m2,owner_user_id,initial_open_date,forecast_open_date,revised_open_date,actual_open_date,phase,project_state,state_reason,date_change_reason,image_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
    [name, city, opening_date, budget || 0, status || 'planning', brand || 'Safari Import', brand_id || null, code || null,
      project_year || new Date(opening_date).getFullYear(), address || null, area_m2 || null, owner_user_id || null,
      initial_open_date || opening_date, forecast_open_date || null, revised_open_date || opening_date,
      actual_open_date || null, phase || 'planning', project_state || 'preparation', state_reason || null, date_change_reason || null, storedImage]
  );
  await query(
    `INSERT INTO document_folders (store_id, name)
     SELECT $1, f.name
     FROM (VALUES ('Photos'), ('Vidéos'), ('Plans 3D'), ('Réception'), ('Autres'), ('Devis')) AS f(name)
     ON CONFLICT (store_id, name) DO NOTHING`,
    [r.rows[0].id]
  );
  await audit(req, 'CREATE_STORE', 'store', r.rows[0].id, { name, city, brand: brand || 'Safari Import', image_url: storedImage });
  res.status(201).json(r.rows[0]);
}));

router.put('/:id/budget', requireAuth, can('edit_budget'), asyncRoute(async (req, res) => {
  const amount = Number(req.body?.budget);
  const reason = req.body?.reason || 'Révision budgétaire depuis la fiche projet';
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Budget invalide' });
  assertFinancialActor(req);
  await assertAssignment(req, req.params.id, null, { financial: true });
  const result = await tx(async client => {
    const old = await client.query('SELECT id,name,budget,row_version FROM stores WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!old.rows[0]) throw Object.assign(new Error('Magasin introuvable'), { status: 404 });
    const budgets = await client.query('SELECT * FROM budgets WHERE store_id=$1 FOR UPDATE', [req.params.id]);
    for (const budget of budgets.rows) {
      const nextRevision = Number(budget.revision || 1) + 1;
      await client.query(
        `INSERT INTO budget_versions (budget_id,revision,amount,state,changed_by,reason)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [budget.id, nextRevision, amount, budget.state, req.user.id, reason]
      );
      await client.query(
        `UPDATE budgets SET revised_amount=$1, revision=$2, state='brouillon',
          submitted_at=NULL, validated_cdg_at=NULL, validated_dd_at=NULL, validated_dg_at=NULL,
          rejection_reason=NULL, updated_at=NOW() WHERE id=$3`,
        [amount, nextRevision, budget.id]
      );
    }
    await client.query('UPDATE stores SET budget=$1, row_version=row_version+1, updated_at=NOW() WHERE id=$2', [amount, req.params.id]);
    await client.query('UPDATE lots SET budget=$1 WHERE store_id=$2', [amount, req.params.id]);
    return old.rows[0];
  });
  await audit(req, 'UPDATE_STORE_BUDGET', 'store', req.params.id, { from: result.budget, to: amount, reason, revision: true });
  res.json({ ok: true, budget: amount });
}));

router.put('/:id', requireAuth, can('manage_stores'), asyncRoute(async (req, res) => {
  const { name, city, opening_date, budget, status, brand, brand_id, code, project_year, address, area_m2, owner_user_id, initial_open_date, forecast_open_date, revised_open_date, actual_open_date, phase, project_state, state_reason, date_change_reason, progress_justification } = req.body || {};
  const current = await query('SELECT locked_read_only, initial_open_date, opening_date, forecast_open_date, revised_open_date FROM stores WHERE id=$1', [req.params.id]);
  if (!current.rows[0]) return res.status(404).json({ error: 'Magasin introuvable' });
  if (current.rows[0].locked_read_only && !['DG'].includes(req.user.role)) return res.status(403).json({ error: 'Projet clôturé en lecture seule' });
  if (budget !== undefined) return res.status(400).json({ error: 'Utilisez PUT /stores/:id/budget pour réviser le budget' });
  await assertAssignment(req, req.params.id);
  if (initial_open_date && current.rows[0].initial_open_date
    && String(initial_open_date).slice(0, 10) !== String(current.rows[0].initial_open_date).slice(0, 10)) {
    return res.status(409).json({ error: 'La date d\'ouverture initiale est immuable' });
  }
  const initial = current.rows[0].initial_open_date ? new Date(current.rows[0].initial_open_date) : null;
  if (initial && revised_open_date && new Date(revised_open_date) < initial) {
    return res.status(400).json({ error: 'La date révisée ne peut pas précéder la date initiale' });
  }
  if (initial && actual_open_date && new Date(actual_open_date) < initial) {
    return res.status(400).json({ error: 'La date réelle ne peut pas précéder la date initiale' });
  }
  const hasOverride = req.body && Object.prototype.hasOwnProperty.call(req.body, 'status_override');
  const override = hasOverride ? (req.body.status_override || null) : null;
  const r = await query(
    `UPDATE stores SET name=COALESCE($1,name), city=COALESCE($2,city),
     opening_date=COALESCE($3,opening_date), budget=COALESCE($4,budget), status=COALESCE($5,status),
     brand=COALESCE($6,brand), brand_id=COALESCE($7,brand_id), code=COALESCE($8,code), address=COALESCE($9,address),
     area_m2=COALESCE($10,area_m2), owner_user_id=COALESCE($11,owner_user_id),
     forecast_open_date=COALESCE($12,forecast_open_date),
     revised_open_date=COALESCE($13,revised_open_date), actual_open_date=COALESCE($14,actual_open_date),
     phase=COALESCE($15,phase), project_state=COALESCE($16,project_state), state_reason=COALESCE($17,state_reason),
     project_year=COALESCE($18,project_year), date_change_reason=COALESCE($19,date_change_reason),
     progress_justification=COALESCE($20,progress_justification),
     status_override=CASE WHEN $21::boolean THEN NULL WHEN $22::varchar(20) IS NOT NULL THEN $22::varchar(20) ELSE status_override END
     WHERE id=$23 RETURNING *`,
    [name, city, opening_date, budget, status, brand, brand_id, code, address, area_m2, owner_user_id,
      forecast_open_date, revised_open_date, actual_open_date, phase, project_state, state_reason, project_year || null,
      date_change_reason || null, progress_justification || null, hasOverride && !override, override, req.params.id]
  );
  if (!r.rows[0]) return res.status(404).json({ error: 'Magasin introuvable' });
  await audit(req, 'UPDATE_STORE', 'store', req.params.id, req.body);
  const dateFields = ['opening_date', 'forecast_open_date', 'revised_open_date'];
  const dateChanged = dateFields.some(field =>
    req.body?.[field] !== undefined && String(req.body[field] || '') !== String(current.rows[0][field] || ''));
  if (dateChanged) {
    await publishEvent('modification_date_ouverture', {
      project_id: r.rows[0].id,
      aggregate_type: 'store',
      aggregate_id: r.rows[0].id,
      object_type: 'store',
      object_id: r.rows[0].id,
      reference: r.rows[0].code || `ST-${r.rows[0].id}`,
      title: r.rows[0].name,
      store: r.rows[0].name,
      previous_date: current.rows[0].opening_date || current.rows[0].revised_open_date || current.rows[0].initial_open_date || null,
      new_date: r.rows[0].opening_date || r.rows[0].revised_open_date || r.rows[0].forecast_open_date || null,
      reason: date_change_reason || 'Modification de la date d’ouverture souhaitée',
      requester_id: r.rows[0].owner_user_id || null,
      owner_user_id: r.rows[0].owner_user_id || null,
      actor_id: req.user.id,
      actor: req.user.name || req.user.email || 'Utilisateur',
    });
  }
  res.json(r.rows[0]);
}));

router.delete('/:id', requireAuth, requireRole('admin'), asyncRoute(async (req, res) => {
  const current = await query('SELECT id,name FROM stores WHERE id=$1', [req.params.id]);
  if (!current.rowCount) return res.status(404).json({ error: 'Magasin introuvable' });
  await query('DELETE FROM stores WHERE id=$1', [req.params.id]);
  await audit(req, 'DELETE_STORE', 'store', req.params.id, { name: current.rows[0].name });
  res.json({ ok: true });
}));

router.post('/:id/generate-items', requireAuth, can('update_items'), asyncRoute(async (req, res) => {
  const scope = await readScope(req, 'id', 2);
  const st = await query(`SELECT id,name FROM stores WHERE id=$1 ${scope.clause}`, [req.params.id, ...scope.params]);
  if (!st.rows[0]) return res.status(404).json({ error: 'Magasin introuvable' });
  try { await assertAssignment(req, req.params.id); } catch (e) { return res.status(e.status || 403).json({ error: e.message }); }
  const categoryIds = Array.isArray(req.body?.category_ids) ? req.body.category_ids.map(Number).filter(Boolean) : [];
  const templates = categoryIds.length
    ? await query('SELECT * FROM item_templates WHERE category_id = ANY($1::int[]) ORDER BY id', [categoryIds])
    : await query('SELECT * FROM item_templates ORDER BY id');
  const existing = await query('SELECT name FROM items WHERE store_id=$1', [req.params.id]);
  const seen = new Set(existing.rows.map(r => String(r.name).trim().toLowerCase()));
  let created = 0;
  let skipped = 0;
  for (const t of templates.rows) {
    const key = String(t.name).trim().toLowerCase();
    if (seen.has(key)) { skipped += 1; continue; }
    await query(
      `INSERT INTO items (store_id,category_id,name,quantity,estimated_budget,status,owner_role,created_by)
       VALUES ($1,$2,$3,$4,$5,'to_quote',$6,$7)`,
      [req.params.id, t.category_id, t.name, t.default_quantity, t.default_budget, t.owner_role, req.user.id]
    );
    seen.add(key);
    created += 1;
  }
  await audit(req, 'GENERATE_CHECKLIST', 'store', req.params.id, { created, skipped, store: st.rows[0].name });
  res.status(201).json({ created, skipped, total: templates.rows.length, items_count: existing.rows.length + created });
}));

router.get('/:id/items', requireAuth, asyncRoute(async (req, res) => {
  const scope = await readScope(req, 'i.store_id', 2);
  const r = await query(
    `SELECT i.*, c.name AS category_name FROM items i
     JOIN categories c ON c.id = i.category_id
     WHERE i.store_id = $1 ${scope.clause} ORDER BY i.id`,
    [req.params.id, ...scope.params]
  );
  res.json(r.rows);
}));

export default router;
