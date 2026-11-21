import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { config } from '../config.js';
import { query, tx } from '../db.js';
import {
  requireAuth, asyncRoute, can, scope, ownsItem, DD_ROLES, departmentOf, ddRolesForOwner,
  assertAssignment, readScope,
} from '../middleware/auth.js';
import { audit, notify, usersWithRoles } from '../utils/audit.js';
import { extractQuotePdf } from '../utils/pdf.js';
import { resolveLotId } from '../utils/lots.js';
import { classifyDevise } from '../utils/classification.js';
import { decisionFingerprint } from '../utils/decision.js';
import { createUpload, persistUpload } from '../utils/upload-security.js';
import { publishEvent } from '../services/notification-service.js';

const roundMoney = value => Math.round(Number(value || 0) * 100) / 100;

let quoteColumnsReady = null;
function ensureQuoteWorkflowColumns() {
  if (!quoteColumnsReady) {
    quoteColumnsReady = query(`
      ALTER TABLE quotes
        ADD COLUMN IF NOT EXISTS state VARCHAR(30),
        ADD COLUMN IF NOT EXISTS quote_ref VARCHAR(100),
        ADD COLUMN IF NOT EXISTS issue_date DATE,
        ADD COLUMN IF NOT EXISTS expiry_date DATE,
        ADD COLUMN IF NOT EXISTS approved_version INT,
        ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ
    `).catch(e => { console.error('ensureQuoteWorkflowColumns error:', e.message); });
  }
  return quoteColumnsReady;
}

function moneyFrom(body, extracted = {}) {
  const rate = body.vat_rate !== undefined && body.vat_rate !== '' ? Number(body.vat_rate) : 20;
  let ht = body.amount_ht || extracted.amount_ht;
  let ttc = body.amount_ttc || extracted.amount_ttc;
  if (ht && !ttc) ttc = roundMoney(Number(ht) * (1 + Number(rate) / 100));
  if (!ht && ttc) ht = roundMoney(Number(ttc) / (1 + Number(rate) / 100));
  const tva = body.amount_tva !== undefined && body.amount_tva !== '' ? body.amount_tva : roundMoney(Number(ttc || 0) - Number(ht || 0));
  return { ht: roundMoney(ht), tva: roundMoney(tva), ttc: roundMoney(ttc), rate };
}

const upload = createUpload({ kinds: ['pdf', 'image', 'document'], maxBytes: 15 * 1024 * 1024 });
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '');
    cb(null, ok);
  },
});

const router = Router();

function isPdf(file) {
  return !!file && (file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || ''));
}

function quoteScope(req) {
  const role = req.user?.role;
  if (role === 'IT') return { clause: "AND COALESCE(i.owner_role, d.owner_role) = 'IT'", params: [] };
  if (['MG', 'RMG'].includes(role)) return { clause: "AND COALESCE(i.owner_role, d.owner_role) IN ('MG','RMG')", params: [] };
  return { clause: '', params: [] };
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function closest(rows, needle) {
  const wanted = normalizeName(needle);
  if (!wanted) return null;
  return rows.find(row => normalizeName(row.name) === wanted)
    || rows.find(row => normalizeName(row.name).includes(wanted) && wanted.length >= 5)
    || rows.find(row => wanted.includes(normalizeName(row.name)) && normalizeName(row.name).length >= 5)
    || null;
}

async function findSupplier(name) {
  if (!name) return null;
  const r = await query('SELECT id,name FROM suppliers');
  return closest(r.rows, name)?.id || null;
}

async function findItem(name, role, service = false) {
  if (!name) return null;
  const r = await query('SELECT id,name,owner_role FROM items WHERE is_service=$1', [service]);
  const candidates = ['admin', 'CDG', 'CG', ...DD_ROLES, 'DG'].includes(role) ? r.rows : r.rows.filter(row => row.owner_role === role);
  return closest(candidates, name)?.id || null;
}

async function ensureClassifiedItem(req, storeId, classification, extracted, amountTtc) {
  const store = await query('SELECT id FROM stores WHERE id=$1', [storeId]);
  if (!store.rows[0]) throw Object.assign(new Error('Magasin introuvable'), { status: 404 });

  const isService = !!classification.is_service;
  const existing = await query('SELECT id,name FROM items WHERE store_id=$1 AND is_service=$2', [storeId, isService]);
  const name = classification.item_name || extracted.item_name || 'Article importé';
  const match = closest(existing.rows, name);
  if (match) return { id: match.id, autoCreated: false };

  let categoryId = classification.category_id;
  if (!categoryId) {
    const fallback = await query("SELECT id FROM categories WHERE lower(name)='autre' LIMIT 1");
    categoryId = fallback.rows[0]?.id;
  }
  if (!categoryId) throw Object.assign(new Error('Catégorie introuvable'), { status: 500 });

  const owner = ['admin', 'CDG', 'CG', ...DD_ROLES, 'DG'].includes(req.user.role) ? classification.owner_role : req.user.role;
  const r = await query(
    `INSERT INTO items (store_id,lot_id,category_id,name,quantity,estimated_budget,status,is_service,owner_role,created_by)
     VALUES ($1,(SELECT id FROM lots WHERE store_id=$1 ORDER BY id LIMIT 1),$2,$3,$4,$5,'quotes_received',$6,$7,$8) RETURNING id`,
    [storeId, categoryId, name, Number(extracted.quantity) || 1, amountTtc, isService, owner, req.user.id]
  );
  return { id: r.rows[0].id, autoCreated: true };
}

function resolveUpload(fileUrl) {
  if (!fileUrl) return null;
  const base = path.resolve(config.uploadDir);
  const filePath = path.resolve(base, path.basename(String(fileUrl)));
  if (filePath !== base && !filePath.startsWith(base + path.sep)) return null;
  return filePath;
}

async function quoteForAction(req, id) {
  await ensureQuoteWorkflowColumns();
  const r = await query(
    `SELECT q.*, COALESCE(i.store_id, d.store_id) AS store_id, i.lot_id AS item_lot_id,
      COALESCE(i.owner_role, d.owner_role) AS owner_role
     FROM quotes q
     LEFT JOIN items i ON i.id=q.item_id
     LEFT JOIN demands d ON d.id=q.demand_id
     WHERE q.id=$1`,
    [id]
  );
  if (!r.rows[0]) throw Object.assign(new Error('Devis introuvable'), { status: 404 });
  const row = r.rows[0];
  const role = req.user.role;
  const allowed = !['IT', 'MG', 'RMG'].includes(role)
    || row.owner_role === role
    || (['MG', 'RMG'].includes(role) && ['MG', 'RMG'].includes(row.owner_role));
  if (!allowed) throw Object.assign(new Error('Hors périmètre'), { status: 403 });
  if (row.store_id) await assertAssignment(req, row.store_id, row.lot_id || row.item_lot_id);
  return row;
}

router.post('/extract', requireAuth, can('upload_quotes'), pdfUpload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Un devis PDF est requis' });
  try {
    const { text, fields } = await extractQuotePdf(req.file.buffer);
    const classification = await classifyDevise(text, fields);
    const supplierId = await findSupplier(fields.supplier_name);
    const itemId = classification.is_service ? null : await findItem(classification.item_name, req.user.role, false);
    res.json({ fields, classification, supplier_id: supplierId, item_id: itemId, service_line: !!classification.is_service, text_preview: text.slice(0, 2000) });
  } catch (e) {
    res.status(400).json({ error: `Lecture PDF impossible : ${e.message}` });
  }
}));

router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const s = quoteScope(req);
  const params = [...s.params];
  let where = '1=1';
  if (s.clause) where += ' ' + s.clause;
  if (req.query.item_id) { params.push(req.query.item_id); where += ` AND q.item_id = $${params.length}`; }
  const access = await readScope(req, 'COALESCE(i.store_id, d.store_id)', params.length + 1);
  params.push(...access.params);
  where += ` ${access.clause}`;
  const r = await query(
    `SELECT q.*, sp.name AS supplier_name, i.name AS item_name, d.id AS demand_id, d.title AS demand_title,
       d.status AS demand_status, d.action AS demand_action,
       COALESCE(i.store_id, d.store_id) AS store_id, st.name AS store_name,
       up.name AS uploaded_by_name, uc.name AS created_by_name
     FROM quotes q JOIN suppliers sp ON sp.id=q.supplier_id
     LEFT JOIN items i ON i.id=q.item_id
     LEFT JOIN demands d ON d.id=q.demand_id
     LEFT JOIN stores st ON st.id=COALESCE(i.store_id, d.store_id)
     LEFT JOIN users up ON up.id=q.uploaded_by
     LEFT JOIN users uc ON uc.id=q.created_by
     WHERE ${where} ORDER BY q.uploaded_at DESC`,
    params
  );
  res.json(r.rows.map(row => ({ ...row, classification: row.extracted_data?.classification || null })));
}));

router.post('/with-demand', requireAuth, can('manage_demands'), can('upload_quotes'), upload.single('file'), asyncRoute(async (req, res) => {
  const b = req.body || {};
  await ensureQuoteWorkflowColumns();
  if (!b.store_id || !b.title || !b.supplier_id) {
    return res.status(400).json({ error: 'Magasin, intitulé et entreprise sont requis' });
  }
  const categoryId = Number(b.category_id);
  if (!categoryId) return res.status(400).json({ error: 'Catégorie requise' });
  const category = await query('SELECT id, owner_role FROM categories WHERE id=$1', [categoryId]);
  if (!category.rows[0]) return res.status(400).json({ error: 'Catégorie invalide' });
  const userDepartment = departmentOf(req.user.role);
  const allowedCategoryOwners = ['BOTH'];
  if (['admin', 'DD', 'DG', 'CDG', 'CG'].includes(req.user.role)) allowedCategoryOwners.push('IT', 'MG');
  if (userDepartment) allowedCategoryOwners.push(userDepartment);
  if (req.user.role === 'RMG') allowedCategoryOwners.push('MG');
  if (!allowedCategoryOwners.includes(category.rows[0].owner_role)) {
    return res.status(403).json({ error: 'Catégorie hors périmètre' });
  }
  const lotId = b.lot_id || (b.lot_label ? await resolveLotId(b.store_id, b.lot_label) : null);
  if (req.user.role !== 'admin') {
    try { await assertAssignment(req, b.store_id, lotId || null); }
    catch (e) { return res.status(e.status || 403).json({ error: e.message }); }
  }
  let extracted = {};
  let text = '';
  let extractionError = null;
  if (isPdf(req.file)) {
    try {
      const result = await extractQuotePdf(req.file.buffer);
      extracted = result.fields;
      text = result.text;
    } catch (e) { extractionError = e.message; }
  }
  const supplierId = b.supplier_id || await findSupplier(extracted.supplier_name);
  if (!supplierId) return res.status(400).json({ error: 'Entreprise requise', extraction: extracted, extraction_error: extractionError });
  const { ht: amountHt, tva: amountTva, ttc: amountTtc, rate: vatRate } = moneyFrom(b, extracted);
  if (!amountHt || !amountTtc) {
    return res.status(400).json({ error: 'Montants HT et TTC requis ou introuvables dans le PDF', extraction: extracted, extraction_error: extractionError });
  }
  const ownerRole = departmentOf(req.user.role) || (['IT', 'MG'].includes(category.rows[0].owner_role) ? category.rows[0].owner_role : 'IT');
  const demandKind = ['article', 'mission'].includes(b.kind) ? b.kind : 'article';
  let storedName = null;
  let fileUrl = null;
  if (req.file) {
    storedName = await persistUpload(req.file, 'devis');
    fileUrl = `/uploads/${storedName}`;
  }
  const extractedData = {
    ...extracted,
    source: req.file?.originalname || null,
    text_preview: text.slice(0, 2000),
    error: extractionError,
    extracted_at: new Date().toISOString(),
  };

  const result = await tx(async client => {
    const i = await client.query(
      `INSERT INTO items (store_id,lot_id,category_id,name,estimated_budget,owner_role,created_by,is_service)
       VALUES ($1,COALESCE($2::int,(SELECT id FROM lots WHERE store_id=$1 ORDER BY id LIMIT 1)),
         $3,$4,$5,$6,$7,$8) RETURNING *`,
        [b.store_id, lotId || null, categoryId, b.title, Number(amountHt) || 0, ownerRole, req.user.id, demandKind === 'mission']
     );
      const d = await client.query(
         `INSERT INTO demands (store_id,lot_id,item_id,title,description,amount,kind,deadline,owner_role,status,submitted_at,created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',NULL,$10) RETURNING *`,
         [b.store_id, lotId || i.rows[0].lot_id || null, i.rows[0].id, b.title, b.description || null,
          Number(amountHt) || 0, demandKind, b.deadline || null, ownerRole, req.user.id]
      );

    const expiryDate = b.expiry_date || b.validity_date || extracted.expiry_date || extracted.validity_date || null;
    const quoteRef = b.quote_ref || extracted.quote_ref || `DEV-${Date.now()}`;
    const q = await client.query(
      `INSERT INTO quotes (item_id,supplier_id,demand_id,lot_id,amount_ht,amount_tva,amount_ttc,version,currency,delivery_days,validity_date,
        payment_terms,warranty_months,reliability_score,file_url,notes,extracted_data,uploaded_by,
        state,quote_ref,issue_date,expiry_date,created_by)
       VALUES ($1,$2,$3,COALESCE($4::int,(SELECT lot_id FROM items WHERE id=$1),(SELECT id FROM lots WHERE store_id=(SELECT store_id FROM items WHERE id=$1) ORDER BY id LIMIT 1)),$5,$6,$7,1,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
        'brouillon',$18,$19,$20,$21) RETURNING *`,
      [i.rows[0].id, supplierId, d.rows[0].id, lotId || null, amountHt, amountTva, amountTtc, b.currency || 'MAD',
        b.delivery_days || extracted.delivery_days || null, b.validity_date || extracted.validity_date || null,
        b.payment_terms || extracted.payment_terms || null, b.warranty_months || extracted.warranty_months || 0,
        b.reliability_score || extracted.reliability_score || 3, fileUrl, b.notes || null,
        JSON.stringify(extractedData), req.user.id,
        quoteRef, b.issue_date || extracted.issue_date || new Date().toISOString().slice(0, 10), expiryDate, req.user.id]
    );
    await client.query("UPDATE items SET status='quotes_received', updated_at=NOW() WHERE id=$1", [i.rows[0].id]);
    let doc = null;
    if (req.file) {
      const docResult = await client.query(
        `INSERT INTO documents (store_id,lot_id,folder,name,original_name,stored_name,mime_type,size_bytes,uploaded_by,object_type,object_id,amount_ht,amount_ttc,created_by)
         VALUES ($1,$2,'Devis',$3,$4,$5,$6,$7,$8,'quote',$9,$10,$11,$12) RETURNING *`,
        [b.store_id, lotId || null, b.title, req.file.originalname, storedName, req.file.mimetype,
          req.file.size, req.user.id, q.rows[0].id, amountHt, amountTtc, req.user.id]
      );
      doc = docResult.rows[0];
    }
    return { item: i.rows[0], demand: d.rows[0], quote: q.rows[0], document: doc };
  });

  await audit(req, 'CREATE_DEMAND_WITH_QUOTE', 'demand', result.demand.id, {
    title: result.demand.title, store_id: result.demand.store_id, quote_id: result.quote.id, amount: result.demand.amount, auto_submitted: true,
  });
  const [storeRow, requesterRow] = await Promise.all([
    query('SELECT name FROM stores WHERE id=$1', [result.demand.store_id]),
    query('SELECT name FROM users WHERE id=$1', [result.demand.created_by]),
  ]);
  await publishEvent('demande_soumise', {
    project_id: result.demand.store_id,
    aggregate_type: 'demand',
    aggregate_id: result.demand.id,
    object_type: 'demand',
    object_id: result.demand.id,
    reference: `D-${result.demand.id}`,
    title: result.demand.title,
    store: storeRow.rows[0]?.name || '',
    amount: Number(result.demand.amount || 0).toLocaleString('fr-FR'),
    demandeur: requesterRow.rows[0]?.name || 'Demandeur',
    requester_id: result.demand.created_by,
    submitted_by: result.demand.created_by,
    actor_id: req.user.id,
    actor: req.user.name || req.user.email || 'Utilisateur',
    owner_role: ownerRole,
    current_step: 'CDG',
  });
  res.status(201).json({ ...result, extraction: extracted, extraction_error: extractionError });
}));

router.post('/', requireAuth, can('upload_quotes'), upload.single('file'), asyncRoute(async (req, res) => {
  const b = req.body || {};
  await ensureQuoteWorkflowColumns();
  if (b.store_id) {
    try { await assertAssignment(req, b.store_id, b.lot_id || null); }
    catch (e) { return res.status(e.status || 403).json({ error: e.message }); }
  }
  let extracted = {};
  let text = '';
  let extractionError = null;
  let classification = null;
  let autoCreated = false;

  if (isPdf(req.file)) {
    try {
      const result = await extractQuotePdf(req.file.buffer);
      extracted = result.fields;
      text = result.text;
      classification = await classifyDevise(text, extracted);
    } catch (e) {
      extractionError = e.message;
    }
  }

  const supplierId = b.supplier_id || await findSupplier(extracted.supplier_name);
  const { ht: amountHt, tva: amountTva, ttc: amountTtc, rate: vatRate } = moneyFrom(b, extracted);

  if (!supplierId || !amountHt || !amountTtc) {
    return res.status(400).json({
      error: 'Fournisseur et montants requis ou introuvables dans le PDF',
      extraction: extracted,
      classification,
      extraction_error: extractionError,
    });
  }

  const isService = !!classification?.is_service;
  let itemId = isService ? null : b.item_id;
  if (!itemId && !isService) itemId = await findItem(classification?.item_name || extracted.item_name, req.user.role, false);
  if (!itemId && b.store_id && classification) {
    const ensured = await ensureClassifiedItem(req, b.store_id, classification, extracted, amountTtc);
    itemId = ensured.id;
    autoCreated = ensured.autoCreated;
  }
  if (!itemId) {
    return res.status(400).json({
      error: isService
        ? 'Prestation détectée : sélectionnez le magasin pour créer la ligne de prestation classée'
        : 'Article introuvable : choisissez un article ou un magasin pour la classification automatique',
      extraction: extracted,
      classification,
      extraction_error: extractionError,
    });
  }
  if (!(await ownsItem(req, itemId))) return res.status(403).json({ error: 'Hors périmètre' });
  const itemScope = await query('SELECT store_id, lot_id FROM items WHERE id=$1', [itemId]);
  if (itemScope.rows[0]) {
    try { await assertAssignment(req, itemScope.rows[0].store_id, itemScope.rows[0].lot_id); }
    catch (e) { return res.status(e.status || 403).json({ error: e.message }); }
  }

  if (classification) {
    const categoryId = classification.confidence >= 0.7 ? classification.category_id : null;
    await query('UPDATE items SET category_id=COALESCE($2,category_id), estimated_budget=$3, updated_at=NOW() WHERE id=$1', [itemId, categoryId, amountTtc]);
  }

  const fileUrl = req.file ? `/uploads/${await persistUpload(req.file, 'devis')}` : null;
  const extractedData = {
    ...extracted,
    classification: classification ? { ...classification, auto_created_item: autoCreated } : null,
    source: req.file?.originalname || null,
    text_preview: text.slice(0, 2000),
    error: extractionError,
    extracted_at: new Date().toISOString(),
  };
  const expiryDate = b.expiry_date || b.validity_date || extracted.expiry_date || extracted.validity_date || null;
  const quoteRef = b.quote_ref || extracted.quote_ref || `DEV-${Date.now()}`;
  const r = await query(
    `INSERT INTO quotes (item_id,supplier_id,lot_id,amount_ht,amount_tva,amount_ttc,version,currency,delivery_days,validity_date,
      payment_terms,warranty_months,reliability_score,file_url,notes,extracted_data,uploaded_by,
      state,quote_ref,issue_date,expiry_date,created_by)
     VALUES ($1,$2,COALESCE($3::int,(SELECT lot_id FROM items WHERE id=$1),(SELECT id FROM lots WHERE store_id=(SELECT store_id FROM items WHERE id=$1) ORDER BY id LIMIT 1)),$4,$5,$6,1,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
      'brouillon',$17,$18,$19,$20) RETURNING *`,
    [itemId, supplierId, b.lot_id || null, amountHt, amountTva, amountTtc, b.currency || 'MAD',
      b.delivery_days || extracted.delivery_days || null, b.validity_date || extracted.validity_date || null,
      b.payment_terms || extracted.payment_terms || null, b.warranty_months || extracted.warranty_months || 0,
      b.reliability_score || extracted.reliability_score || 3, fileUrl, b.notes || null,
      JSON.stringify(extractedData), req.user.id,
      quoteRef, b.issue_date || extracted.issue_date || new Date().toISOString().slice(0, 10), expiryDate, req.user.id]
  );
  await query("UPDATE items SET status='quotes_received', updated_at=NOW() WHERE id=$1 AND status='to_quote'", [itemId]);
  await audit(req, 'UPLOAD_QUOTE', 'quote', r.rows[0].id, {
    item_id: itemId, amount: amountTtc, file: req.file?.originalname,
    category: classification?.category_name, confidence: classification?.confidence,
    service: isService,
  });
  const committee = await usersWithRoles(['CDG', 'CG', ...DD_ROLES, 'DG']);
  await notify(committee.rows.map(u => u.id), 'Nouveau devis téléversé — comparatif à préparer', 'quote');
  res.status(201).json({ ...r.rows[0], extraction: extracted, classification, service_line: isService, auto_created_item: autoCreated, extraction_error: extractionError });
}));

router.post('/:id/submit', requireAuth, asyncRoute(async (req, res) => {
  const quote = await quoteForAction(req, req.params.id);
  if (!['IT', 'MG', 'RMG'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Soumission réservée au propriétaire du devis' });
  }
  const state = String(quote.state || 'brouillon');
  if (!['brouillon', 'corrige'].includes(state)) {
    return res.status(409).json({ error: `Soumission impossible depuis l’état ${state}` });
  }
  const r = await query(
    `UPDATE quotes SET state='soumis_cdg', submitted_at=NOW(), updated_at=NOW(), updated_by=$2
     WHERE id=$1 RETURNING *`,
    [req.params.id, req.user.id]
  );
  await query(
    `INSERT INTO state_transitions (entity,entity_id,from_state,to_state,actor_id,actor_role,reason,version,document_hash)
     VALUES ('quote',$1,$2,'soumis_cdg',$3,$4,NULL,COALESCE($5,1),$6)`,
    [req.params.id, state, req.user.id, req.user.role, r.rows[0].version,
      decisionFingerprint({ quote: req.params.id, from: state, to: 'soumis_cdg', actor: req.user.id })]
  );
  await audit(req, 'SUBMIT_QUOTE', 'quote', req.params.id, { from: state, to: 'soumis_cdg' });
  const cdg = await usersWithRoles(['CDG', 'CG']);
  await notify(cdg.rows.map(u => u.id), `Devis soumis au contrôle de gestion — ${r.rows[0].quote_ref || r.rows[0].id}`, 'validation');
  res.json({ ok: true, status: 'soumis_cdg' });
}));

router.put('/:id', requireAuth, can('upload_quotes'), upload.single('file'), asyncRoute(async (req, res) => {
  const quote = await quoteForAction(req, req.params.id);
  const state = String(quote.state || 'brouillon');
  const b = req.body || {};
  const { ht, tva, ttc } = moneyFrom(b, {});
  const fileUrl = req.file ? `/uploads/${await persistUpload(req.file, 'devis')}` : quote.file_url;
  const approved = ['approuve', 'approved'].includes(state)
    || (quote.approved_version !== null && quote.approved_version !== undefined
      && Number(quote.approved_version) === Number(quote.version || 1));
  if (approved) {
    const versionRow = await query(
      `SELECT COALESCE(MAX(version),1)+1 AS next_version FROM quotes
       WHERE supplier_id=$1 AND item_id IS NOT DISTINCT FROM $2`,
      [quote.supplier_id, quote.item_id]
    );
    const nextVersion = Number(versionRow.rows[0].next_version);
    const expiryDate = b.expiry_date || quote.expiry_date || quote.validity_date || null;
    const quoteRef = `${quote.quote_ref || 'DEV'}-v${nextVersion}`;
    const r = await query(
      `INSERT INTO quotes (item_id,supplier_id,demand_id,lot_id,amount_ht,amount_tva,amount_ttc,version,currency,delivery_days,validity_date,
        payment_terms,warranty_months,reliability_score,file_url,notes,extracted_data,uploaded_by,
        state,quote_ref,issue_date,expiry_date,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
        'brouillon',$19,CURRENT_DATE,$20,$21,$21) RETURNING *`,
      [quote.item_id, quote.supplier_id, quote.demand_id, quote.lot_id, ht, tva, ttc, nextVersion,
        b.currency || quote.currency || 'MAD', b.delivery_days || quote.delivery_days,
        b.validity_date || quote.validity_date, b.payment_terms || quote.payment_terms,
        b.warranty_months || quote.warranty_months || 0, b.reliability_score || quote.reliability_score || 3,
        fileUrl, b.notes || quote.notes, quote.extracted_data, req.user.id,
        quoteRef, expiryDate, req.user.id]
    );
    await query("UPDATE quotes SET state='remplace', updated_at=NOW(), updated_by=$2 WHERE id=$1", [req.params.id, req.user.id]);
    await audit(req, 'NEW_QUOTE_VERSION', 'quote', r.rows[0].id, { from_id: quote.id, version: nextVersion });
    return res.status(201).json(r.rows[0]);
  }
  if (!['brouillon', 'corrige'].includes(state)) {
    return res.status(409).json({ error: `Modification impossible depuis l’état ${state}` });
  }
  const r = await query(
    `UPDATE quotes SET amount_ht=COALESCE($2,amount_ht), amount_tva=COALESCE($3,amount_tva), amount_ttc=COALESCE($4,amount_ttc),
      currency=COALESCE($5,currency), validity_date=COALESCE($6,validity_date), expiry_date=COALESCE($7,expiry_date),
      payment_terms=COALESCE($8,payment_terms), warranty_months=COALESCE($9,warranty_months),
      reliability_score=COALESCE($10,reliability_score), file_url=COALESCE($11,file_url), notes=COALESCE($12,notes),
      quote_ref=COALESCE($13,quote_ref), issue_date=COALESCE($14,issue_date),
      state='brouillon', submitted_at=NULL, approved_at=NULL, updated_at=NOW(), updated_by=$15
     WHERE id=$1 RETURNING *`,
    [req.params.id, b.amount_ht ? ht : null, b.amount_tva ? tva : null, b.amount_ttc ? ttc : null,
      b.currency || null, b.validity_date || null, b.expiry_date || null, b.payment_terms || null,
      b.warranty_months || null, b.reliability_score || null, fileUrl && req.file ? fileUrl : null,
      b.notes || null, b.quote_ref || null, b.issue_date || null, req.user.id]
  );
  await audit(req, 'UPDATE_QUOTE', 'quote', req.params.id, b);
  res.json(r.rows[0]);
}));

router.get('/:id/file', requireAuth, asyncRoute(async (req, res) => {
  const s = quoteScope(req);
  const access = await readScope(req, 'COALESCE(i.store_id, d.store_id)', s.params.length + 2);
  const params = [req.params.id, ...s.params, ...access.params];
  const r = await query(
    `SELECT q.file_url, q.uploaded_by, q.created_by FROM quotes q
     LEFT JOIN items i ON i.id=q.item_id
     LEFT JOIN demands d ON d.id=q.demand_id
     WHERE q.id=$1 ${s.clause} ${access.clause}`,
    params
  );
  const row = r.rows[0];
  if (!row?.file_url) return res.status(404).json({ error: 'Fichier introuvable' });
  // A1: devis visible to any authorized assigned role
  const filePath = resolveUpload(row.file_url);
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier introuvable' });
  const filename = path.basename(filePath).replace(/"/g, '');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.sendFile(filePath);
}));

router.get('/:id', requireAuth, asyncRoute(async (req, res) => {
  const s = quoteScope(req);
  const access = await readScope(req, 'COALESCE(i.store_id, d.store_id)', s.params.length + 2);
  const params = [req.params.id, ...s.params, ...access.params];
  const r = await query(
    `SELECT q.*, sp.name AS supplier_name, i.name AS item_name, d.title AS demand_title,
       COALESCE(i.store_id, d.store_id) AS store_id, st.name AS store_name,
       up.name AS uploaded_by_name, uc.name AS created_by_name
     FROM quotes q JOIN suppliers sp ON sp.id=q.supplier_id
     LEFT JOIN items i ON i.id=q.item_id
     LEFT JOIN demands d ON d.id=q.demand_id
     LEFT JOIN stores st ON st.id=COALESCE(i.store_id, d.store_id)
     LEFT JOIN users up ON up.id=q.uploaded_by
     LEFT JOIN users uc ON uc.id=q.created_by
     WHERE q.id=$1 ${s.clause} ${access.clause}`,
    params
  );
  if (!r.rows[0]) return res.status(404).json({ error: 'Devis introuvable' });
  res.json(r.rows[0]);
}));

router.delete('/:id', requireAuth, can('upload_quotes'), asyncRoute(async (req, res) => {
  const old = await quoteForAction(req, req.params.id);
  const state = String(old.state || '').toLowerCase();
  const blocked = ['soumis_cdg', 'soumis_dd', 'soumis_dg', 'approuve', 'approved', 'soumis', 'submitted'].includes(state)
    || !!old.submitted_at || !!old.approved_at
    || (old.approved_version !== null && old.approved_version !== undefined
      && Number(old.approved_version) === Number(old.version || 1));
  if (blocked) {
    return res.status(409).json({ error: 'Suppression interdite : devis soumis ou approuvé' });
  }
  const filePath = resolveUpload(old.file_url);
  if (filePath) {
    try { fs.unlinkSync(filePath); } catch (e) {}
  }
  await query('DELETE FROM quotes WHERE id=$1', [req.params.id]);
  await audit(req, 'DELETE_QUOTE', 'quote', req.params.id, {});
  res.json({ ok: true });
}));

export default router;
