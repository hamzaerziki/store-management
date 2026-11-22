import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, asyncRoute, can } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';

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

router.get('/categories', requireAuth, asyncRoute(async (req, res) => {
  const r = await query('SELECT * FROM categories ORDER BY id');
  res.json(r.rows);
}));

router.post('/categories', requireAuth, can('manage_catalog'), asyncRoute(async (req, res) => {
  const { name, owner_role } = req.body || {};
  if (!name || !['IT', 'MG', 'BOTH'].includes(owner_role)) return res.status(400).json({ error: 'Données invalides' });
  const r = await query('INSERT INTO categories (name,owner_role) VALUES ($1,$2) RETURNING *', [name, owner_role]);
  await audit(req, 'CREATE_CATEGORY', 'category', r.rows[0].id, { name, owner_role });
  res.status(201).json(r.rows[0]);
}));

router.delete('/categories/:id', requireAuth, can('manage_catalog'), asyncRoute(async (req, res) => {
  const r = await query('DELETE FROM categories WHERE id = $1 RETURNING id', [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Catégorie introuvable' });
  await audit(req, 'DELETE_CATEGORY', 'category', req.params.id, {});
  res.json({ ok: true });
}));

router.get('/templates', requireAuth, asyncRoute(async (req, res) => {
  const r = await query(
    `SELECT t.*, c.name AS category_name FROM item_templates t
     JOIN categories c ON c.id=t.category_id ORDER BY c.id, t.id`
  );
  res.json(r.rows);
}));

router.post('/templates', requireAuth, can('manage_catalog'), asyncRoute(async (req, res) => {
  const { category_id, name, default_quantity, default_budget, owner_role } = req.body || {};
  if (!category_id || !name || !['IT', 'MG'].includes(owner_role)) return res.status(400).json({ error: 'Données invalides' });
  const r = await query(
    `INSERT INTO item_templates (category_id,name,default_quantity,default_budget,owner_role)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [category_id, name, Number(default_quantity) || 1, Number(default_budget) || 0, owner_role]
  );
  await audit(req, 'CREATE_TEMPLATE', 'template', r.rows[0].id, { name, owner_role });
  res.status(201).json(r.rows[0]);
}));

router.get('/suppliers', requireAuth, asyncRoute(async (req, res) => {
  const r = await query('SELECT * FROM suppliers ORDER BY name');
  res.json(r.rows);
}));

router.post('/suppliers', requireAuth, can('manage_catalog'), asyncRoute(async (req, res) => {
  const { name, contact, notes, kind, ice, rc, if_number, phone, email, address, specialties, rating, contract_reference, evaluation } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  const r = await query(
    `INSERT INTO suppliers
      (name,contact,notes,kind,ice,rc,if_number,phone,email,address,specialties,rating,contract_reference,evaluation)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [name, contact || null, notes || null, kind || 'Entreprise', ice || null, rc || null, if_number || null,
      phone || null, email || null, address || null, specialties || null, Number(rating) || 0,
      contract_reference || null, evaluation || null]
  );
  await audit(req, 'CREATE_SUPPLIER', 'supplier', r.rows[0].id, { name, kind: kind || 'Entreprise', ice, rc, if_number });
  res.status(201).json(r.rows[0]);
}));

router.put('/suppliers/:id', requireAuth, can('manage_catalog'), asyncRoute(async (req, res) => {
  const fields = ['name', 'contact', 'notes', 'kind', 'ice', 'rc', 'if_number', 'phone', 'email', 'address', 'specialties', 'rating', 'contract_reference', 'evaluation'];
  const entries = fields.filter(field => Object.prototype.hasOwnProperty.call(req.body || {}, field));
  if (!entries.length) return res.status(400).json({ error: 'Aucune donnée à mettre à jour' });
  const params = entries.map(field => req.body[field]);
  params.push(req.params.id);
  const sets = entries.map((field, index) => `${field}=$${index + 1}`).join(',');
  const r = await query(`UPDATE suppliers SET ${sets} WHERE id=$${params.length} RETURNING *`, params);
  if (!r.rows[0]) return res.status(404).json({ error: 'Prestataire introuvable' });
  await audit(req, 'UPDATE_SUPPLIER', 'supplier', req.params.id, req.body);
  res.json(r.rows[0]);
}));

export default router;
