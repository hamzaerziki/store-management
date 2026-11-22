import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { query } from '../db.js';
import { requireAuth, asyncRoute, can, assertAssignment, readScope } from '../middleware/auth.js';
import { signFileToken, verifyFileToken, checkFileTokenRateLimit } from '../utils/file-token.js';
import { audit } from '../utils/audit.js';
import { createUpload, persistUpload, uploadPath } from '../utils/upload-security.js';

const upload = createUpload({ kinds: ['pdf', 'image', 'video', 'document'], maxBytes: 100 * 1024 * 1024 });

const cleanFolder = value => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);

const isOwner = (req, row) => Number(row?.uploaded_by) === Number(req.user?.id) || Number(row?.created_by) === Number(req.user?.id);
const canDeleteDocument = (req, row) => req.user?.role === 'admin' || isOwner(req, row);
const canAccessDocument = () => true;

async function assertFileToken(req, ft) {
  if (!ft?.uid) throw Object.assign(new Error('Lien de fichier invalide ou expiré'), { status: 401 });
  const u = await query('SELECT id, role, name, token_version, active FROM users WHERE id=$1', [ft.uid]);
  const user = u.rows[0];
  if (!user?.active) throw Object.assign(new Error('Lien de fichier invalide ou expiré'), { status: 401 });
  if (Number(user.token_version || 0) !== Number(ft.ver || 0)) throw Object.assign(new Error('Lien de fichier invalide ou expiré'), { status: 401 });
  req.user = { id: user.id, role: user.role, name: user.name, ver: Number(user.token_version || 0) };
  return req.user;
}

const router = Router();

router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const params = [];
  let where = '1=1';
  if (req.query.store_id) {
    params.push(req.query.store_id);
    where += ` AND d.store_id = $${params.length}`;
  }
  if (req.query.lot_id) {
    params.push(req.query.lot_id);
    where += ` AND d.lot_id = $${params.length}`;
  }
  if (req.query.folder) {
    params.push(cleanFolder(req.query.folder));
    where += ` AND d.folder = $${params.length}`;
  }
  const scope = await readScope(req, 'd.store_id', params.length + 1);
  params.push(...scope.params);
  where += ` ${scope.clause}`;
  const r = await query(
    `SELECT d.*, st.name AS store_name, u.name AS uploader_name
     FROM documents d
     JOIN stores st ON st.id = d.store_id
     LEFT JOIN users u ON u.id = d.uploaded_by
     WHERE ${where}
     ORDER BY d.created_at DESC`,
    params
  );
  res.json(r.rows.filter(row => canAccessDocument(req, row)));
}));

router.get('/folders', requireAuth, asyncRoute(async (req, res) => {
  const params = [];
  let where = '1=1';
  if (req.query.store_id) {
    params.push(req.query.store_id);
    where += ` AND store_id = $${params.length}`;
  }
  const scope = await readScope(req, 'store_id', params.length + 1);
  params.push(...scope.params);
  where += ` ${scope.clause}`;
  const r = await query(
    `SELECT id, store_id, name, count, persistent, created_by FROM (
       SELECT f.id, f.store_id, f.name, f.created_by,
              (SELECT count(*)::int FROM documents d WHERE d.store_id = f.store_id AND d.folder = f.name) AS count,
              TRUE AS persistent
       FROM document_folders f
       UNION ALL
       SELECT NULL::int AS id, d.store_id, d.folder AS name, NULL::int AS created_by, count(*)::int AS count, FALSE AS persistent
       FROM documents d
       WHERE NOT EXISTS (SELECT 1 FROM document_folders f WHERE f.store_id = d.store_id AND f.name = d.folder)
       GROUP BY d.store_id, d.folder
     ) folders WHERE ${where} ORDER BY name`,
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
  if (!canDeleteDocument(req, old.rows[0])) return res.status(403).json({ error: 'Suppression réservée au propriétaire du dossier ou à un administrateur' });
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

router.get('/:id/file-token', requireAuth, asyncRoute(async (req, res) => {
  if (!checkFileTokenRateLimit(req.user.id)) return res.status(429).json({ error: 'Trop de demandes de token fichier' });
  const action = req.query.action === 'download' ? 'download' : 'view';
  const r = await query('SELECT id, store_id, lot_id FROM documents WHERE id=$1', [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Fichier introuvable' });
  await assertAssignment(req, r.rows[0].store_id, r.rows[0].lot_id || null);
  const token = signFileToken({ uid: req.user.id, kind: 'document', id: r.rows[0].id, action, ver: req.user.ver || 0 });
  res.json({ token, expires_in: 300 });
}));

router.get('/:id/view', asyncRoute(async (req, res) => {
  const ft = verifyFileToken(req.query.ft, { kind: 'document', id: req.params.id, action: 'view' });
  if (!ft) return res.status(401).json({ error: 'Lien de fichier invalide ou expiré' });
  await assertFileToken(req, ft);
  const r = await query('SELECT * FROM documents WHERE id=$1', [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Fichier introuvable' });
  await assertAssignment(req, r.rows[0].store_id, r.rows[0].lot_id || null);
  if (!canAccessDocument(req, r.rows[0])) return res.status(403).json({ error: 'Accès réservé au propriétaire du devis' });
  const filePath = uploadPath(r.rows[0].stored_name);
  if (!filePath) return res.status(400).json({ error: 'Nom de fichier invalide' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier indisponible' });
  const filename = path.basename(r.rows[0].original_name || r.rows[0].name || 'document').replace(/[\r\n"]/g, '') || 'document';
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.sendFile(filePath);
}));

router.get('/:id/download', asyncRoute(async (req, res) => {
  const ft = verifyFileToken(req.query.ft, { kind: 'document', id: req.params.id, action: 'download' });
  if (!ft) return res.status(401).json({ error: 'Lien de fichier invalide ou expiré' });
  await assertFileToken(req, ft);
  const r = await query('SELECT * FROM documents WHERE id=$1', [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Fichier introuvable' });
  await assertAssignment(req, r.rows[0].store_id, r.rows[0].lot_id || null);
  if (!canAccessDocument(req, r.rows[0])) return res.status(403).json({ error: 'Accès refusé' });
  const filePath = uploadPath(r.rows[0].stored_name);
  if (!filePath) return res.status(400).json({ error: 'Nom de fichier invalide' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier indisponible' });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const safeName = path.basename(r.rows[0].original_name || r.rows[0].name || 'document').replace(/[\r\n"]/g, '') || 'document';
  res.download(filePath, safeName);
}));

router.delete('/:id', requireAuth, can('upload_quotes'), asyncRoute(async (req, res) => {
  const old = await query('SELECT * FROM documents WHERE id=$1', [req.params.id]);
  if (!old.rows[0]) return res.status(404).json({ error: 'Fichier introuvable' });
  await assertAssignment(req, old.rows[0].store_id, old.rows[0].lot_id || null);
  if (!canDeleteDocument(req, old.rows[0])) return res.status(403).json({ error: 'Suppression réservée au propriétaire du fichier ou à un administrateur' });
  const r = await query('DELETE FROM documents WHERE id=$1 RETURNING *', [req.params.id]);
  const filePath = uploadPath(r.rows[0].stored_name);
  if (!filePath) return res.status(400).json({ error: 'Nom de fichier invalide' });
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  await audit(req, 'DELETE_DOCUMENT', 'document', req.params.id, { name: r.rows[0].original_name });
  res.json({ ok: true });
}));

export default router;
