import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { query } from '../db.js';
import { requireAuth, asyncRoute, can, assertAssignment } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { createUpload, persistUpload, uploadPath } from '../utils/upload-security.js';

const upload = createUpload({ kinds: ['pdf', 'image', 'video', 'document'], maxBytes: 100 * 1024 * 1024 });

const cleanFolder = value => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);

const isDevisDocument = row => String(row?.folder || '').toLowerCase().startsWith('devis') || String(row?.object_type || '') === 'quote';
const VALIDATOR_ROLES = ['CDG', 'CG', 'DD', 'RMG', 'DG'];
const canSeeDevis = (req, row) => req.user?.role === 'admin' || VALIDATOR_ROLES.includes(req.user?.role) || Number(row?.uploaded_by) === Number(req.user?.id) || Number(row?.created_by) === Number(req.user?.id);
const canAccessDocument = (req, row) => !isDevisDocument(row) || canSeeDevis(req, row);

const router = Router();

router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.store_id) {
    params.push(req.query.store_id);
    where = 'WHERE d.store_id = $1';
  }
  if (req.query.lot_id) {
    params.push(req.query.lot_id);
    where += `${where ? ' AND' : 'WHERE'} d.lot_id = $${params.length}`;
  }
  if (req.query.folder) {
    params.push(cleanFolder(req.query.folder));
    where += `${where ? ' AND' : 'WHERE'} d.folder = $${params.length}`;
  }
  const r = await query(
    `SELECT d.*, st.name AS store_name, u.name AS uploader_name
     FROM documents d
     JOIN stores st ON st.id = d.store_id
     LEFT JOIN users u ON u.id = d.uploaded_by
     ${where}
     ORDER BY d.created_at DESC`,
    params
  );
  res.json(r.rows.filter(row => canAccessDocument(req, row)));
}));

router.get('/folders', requireAuth, asyncRoute(async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.store_id) {
    params.push(req.query.store_id);
    where = 'WHERE store_id = $1';
  }
  const roleIdx = params.length + 1;
  const uidIdx = params.length + 2;
  params.push(req.user.role, req.user.id);
  const visible = `(${roleIdx}::text IN ('admin','CDG','CG','DD','RMG','DG') OR (lower(d.folder) NOT LIKE 'devis%' AND COALESCE(d.object_type,'') <> 'quote') OR d.uploaded_by = ${uidIdx}::int OR d.created_by = ${uidIdx}::int)`;
  const r = await query(
    `SELECT id, store_id, name, count, persistent FROM (
       SELECT f.id, f.store_id, f.name,
              (SELECT count(*)::int FROM documents d WHERE d.store_id = f.store_id AND d.folder = f.name AND ${visible}) AS count,
              TRUE AS persistent
       FROM document_folders f
       UNION ALL
       SELECT NULL::int AS id, d.store_id, d.folder AS name, count(*)::int AS count, FALSE AS persistent
       FROM documents d
       WHERE NOT EXISTS (SELECT 1 FROM document_folders f WHERE f.store_id = d.store_id AND f.name = d.folder)
         AND ${visible}
       GROUP BY d.store_id, d.folder
     ) folders ${where} ORDER BY name`,
    params
  );
  res.json(r.rows);
}));

router.post('/folders', requireAuth, can('upload_quotes'), asyncRoute(async (req, res) => {
  const { store_id, name } = req.body || {};
  const folder = cleanFolder(name);
  if (!store_id || !folder) return res.status(400).json({ error: 'Magasin et nom du dossier requis' });
  const store = await query('SELECT id FROM stores WHERE id=$1', [store_id]);
  if (!store.rows[0]) return res.status(404).json({ error: 'Magasin introuvable' });
  const r = await query(
    `INSERT INTO document_folders (store_id, name, created_by) VALUES ($1,$2,$3)
     ON CONFLICT (store_id, name) DO UPDATE SET name=EXCLUDED.name RETURNING *`,
    [store_id, folder, req.user.id]
  );
  await audit(req, 'CREATE_DOCUMENT_FOLDER', 'document_folder', r.rows[0].id, { store_id, folder });
  res.status(201).json({ ...r.rows[0], count: 0, persistent: true });
}));

router.delete('/folders/:id', requireAuth, can('upload_quotes'), asyncRoute(async (req, res) => {
  const old = await query('SELECT df.*, (SELECT count(*) FROM documents d WHERE d.store_id=df.store_id AND d.folder=df.name)::int AS count FROM document_folders df WHERE df.id=$1', [req.params.id]);
  if (!old.rows[0]) return res.status(404).json({ error: 'Dossier introuvable' });
  if (old.rows[0].count > 0) return res.status(400).json({ error: 'Dossier non vide : supprimez d’abord ses fichiers' });
  await query('DELETE FROM document_folders WHERE id=$1', [req.params.id]);
  await audit(req, 'DELETE_DOCUMENT_FOLDER', 'document_folder', req.params.id, { name: old.rows[0].name });
  res.json({ ok: true });
}));

router.post('/', requireAuth, can('upload_quotes'), upload.single('file'), asyncRoute(async (req, res) => {
  const { store_id, lot_id, folder, name } = req.body || {};
  if (!store_id || !req.file) return res.status(400).json({ error: 'Magasin et fichier requis' });
  const store = await query('SELECT id,name FROM stores WHERE id=$1', [store_id]);
  if (!store.rows[0]) return res.status(404).json({ error: 'Magasin introuvable' });
  await assertAssignment(req, store_id, lot_id || null);
  const safeFolder = cleanFolder(folder) || 'Autres';
  const original = path.basename(req.file.originalname);
  const storedName = await persistUpload(req.file, 'doc');
  const r = await query(
    `INSERT INTO documents (store_id,lot_id,folder,name,original_name,stored_name,mime_type,size_bytes,uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [store_id, lot_id || null, safeFolder, name || original.replace(/\.[^.]+$/, ''), original, storedName, req.file.mimetype, req.file.size, req.user.id]
  );
  await audit(req, 'UPLOAD_DOCUMENT', 'document', r.rows[0].id, { store_id, folder: safeFolder, name: original });
  res.status(201).json(r.rows[0]);
}));

router.get('/:id/view', requireAuth, asyncRoute(async (req, res) => {
  const r = await query('SELECT * FROM documents WHERE id=$1', [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Fichier introuvable' });
  await assertAssignment(req, r.rows[0].store_id, r.rows[0].lot_id || null);
  if (!canAccessDocument(req, r.rows[0])) return res.status(403).json({ error: 'Accès réservé au propriétaire du devis' });
  const filePath = uploadPath(r.rows[0].stored_name);
  if (!filePath) return res.status(400).json({ error: 'Nom de fichier invalide' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier indisponible' });
  const filename = path.basename(r.rows[0].original_name || r.rows[0].name || 'document').replace(/"/g, '');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.sendFile(filePath);
}));

router.get('/:id/download', requireAuth, asyncRoute(async (req, res) => {
  const r = await query('SELECT * FROM documents WHERE id=$1', [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Fichier introuvable' });
  await assertAssignment(req, r.rows[0].store_id, r.rows[0].lot_id || null);
  if (!canAccessDocument(req, r.rows[0])) return res.status(403).json({ error: 'Accès réservé au propriétaire du devis' });
  const filePath = uploadPath(r.rows[0].stored_name);
  if (!filePath) return res.status(400).json({ error: 'Nom de fichier invalide' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier indisponible' });
  res.download(filePath, r.rows[0].original_name);
}));

router.delete('/:id', requireAuth, can('upload_quotes'), asyncRoute(async (req, res) => {
  const old = await query('SELECT * FROM documents WHERE id=$1', [req.params.id]);
  if (!old.rows[0]) return res.status(404).json({ error: 'Fichier introuvable' });
  await assertAssignment(req, old.rows[0].store_id, old.rows[0].lot_id || null);
  const isOwnerDoc = Number(old.rows[0].uploaded_by) === Number(req.user.id) || Number(old.rows[0].created_by) === Number(req.user.id);
  if (req.user.role !== 'admin' && !isOwnerDoc) return res.status(403).json({ error: 'Suppression réservée au propriétaire du fichier' });
  const r = await query('DELETE FROM documents WHERE id=$1 RETURNING *', [req.params.id]);
  const filePath = uploadPath(r.rows[0].stored_name);
  if (!filePath) return res.status(400).json({ error: 'Nom de fichier invalide' });
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  await audit(req, 'DELETE_DOCUMENT', 'document', req.params.id, { name: r.rows[0].original_name });
  res.json({ ok: true });
}));

export default router;
