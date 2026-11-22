import { Router } from 'express';
import { query, tx } from '../../db.js';
import {
  asyncV1, setETag, assertVersion, badRequest, conflict, forbidden, notFound,
  requireIdempotencyKey, idempotent,
} from '../../middleware/standard.js';
import {
  auditV1, auditInTx, transitionInTx, assertAssignment, assertWritable, getProject,
  parseId, requireFields, documentHash, approvalObject, assertStepRole, assertActor,
  applyApprovalToObject, approvalNotificationEvent, approvalNotificationContext,
  effectiveRole, CDG_ROLES, DG_ROLES, FINANCIAL_READ_ROLES, PROJECT_EDIT_ROLES,
  assertIfMatchRow, assertNotDuplicate, DD,
} from './shared.js';
import { publishEvent } from '../../services/notification-service.js';
import {
  fetchCommitmentAvailable, fetchInvoiceBalance, round2, disponibleAEtendre,
} from '../../utils/finance.js';
import {
  buildComputedLines, persistLineSnapshots, computeDocument,
} from '../../services/tax-service.js';

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

function submitContext(type, row, requestRow, req, projectId, extra = {}) {
  return {
    aggregate_type: type,
    aggregate_id: row.id,
    object_type: type,
    object_id: row.id,
    project_id: projectId,
    store_id: projectId,
    approval_request_id: requestRow.id,
    requester_id: req.user.id,
    demandeur_id: req.user.id,
    current_step: 'CDG',
    validator_role: 'CDG',
    reference: `${String(type).toUpperCase()}-${row.id}`,
    amount: type === 'budget' ? round2(row.revised_amount ?? row.amount) : round2(row.amount_ttc),
    ...extra,
  };
}

async function activeApproval(objectType, objectId, version, client) {
  return client.query(
    `SELECT id FROM approval_requests
      WHERE object_type=$1 AND object_id=$2 AND object_version=$3
        AND status IN ('soumis','en_attente')
      LIMIT 1`,
    [objectType, objectId, version]
  );
}

router.post('/budgets/:id/submit', asyncV1(async (req, res) => {
  const id = parseId(req.params.id, 'identifiant budget');
  const source = (await query('SELECT * FROM budgets WHERE id=$1', [id])).rows[0];
  if (!source) throw notFound('Budget introuvable');
  if (!['brouillon', 'corrige', 'brouillon_r', 'correction'].includes(source.state)) {
    throw conflict(`Budget à l’état ${source.state} : soumission impossible`);
  }
  await assertWritable(req, source.store_id);
  await assertAssignment(req, source.store_id, source.lot_id);
  const role = await effectiveRole(req, source.store_id, source.lot_id);
  if (![...PROJECT_EDIT_ROLES, 'IT'].includes(role)) throw forbidden('Rôle non autorisé à soumettre un budget');

  const version = Number(source.revision || 1);
  const result = await tx(async client => {
    const duplicate = await activeApproval('budget', id, version, client);
    assertNotDuplicate(duplicate.rowCount, 'Une demande d’approbation est déjà active pour cette version du budget');
    const requestRow = await client.query(
      `INSERT INTO approval_requests
         (object_type, object_id, object_version, current_step, status, submitted_by, submitted_at, created_by, updated_by)
       VALUES ('budget',$1,$2,'CDG','soumis',$3,NOW(),$3,$3)
       RETURNING *`,
      [id, version, req.user.id]
    );
    await client.query("UPDATE budgets SET state='soumis_cdg', submitted_at=NOW(), updated_at=NOW() WHERE id=$1", [id]);
    const object = await client.query('SELECT * FROM budgets WHERE id=$1', [id]);
    await transitionInTx(client, req, 'budget', id, source.state, 'soumis_cdg', req.body?.justification || null, version, documentHash({ id, version, amount: source.amount }));
    await auditInTx(client, req, 'BUDGET_SUBMIT', 'budget', id, { version, from: source.state, to: 'soumis_cdg' });
    return { request: requestRow.rows[0], object: object.rows[0] };
  });

  const context = submitContext('budget', result.object, result.request, req, source.store_id);
  await publishEvent('demande_soumise', context, { actorId: req.user.id, correlationId: req.correlationId });
  const previous = round2(source.amount);
  const next = round2(source.revised_amount ?? source.amount);
  if (version > 1 && next !== previous) {
    await publishEvent('revision_budget_soumise', {
      ...context,
      old_amount: previous,
      new_amount: next,
      delta: round2(next - previous),
      justification: req.body?.justification || req.body?.reason || null,
    }, { actorId: req.user.id, correlationId: req.correlationId });
  }
  setETag(res, result.object, 'revision');
  res.status(201).json({ approval_request: result.request, budget: result.object });
}));

router.post('/quotes/:id/submit', asyncV1(async (req, res) => {
  const id = parseId(req.params.id, 'identifiant devis');
  const found = (await query(
    `SELECT q.*, COALESCE(i.store_id, l.store_id) AS resolved_store_id
       FROM quotes q LEFT JOIN items i ON i.id=q.item_id LEFT JOIN lots l ON l.id=q.lot_id
      WHERE q.id=$1`,
    [id]
  )).rows[0];
  if (!found) throw notFound('Devis introuvable');
  if (!['brouillon', 'corrige', 'correction', 'expire'].includes(found.state)) {
    throw conflict(`Devis à l’état ${found.state} : soumission impossible`);
  }
  await assertWritable(req, found.resolved_store_id);
  await assertAssignment(req, found.resolved_store_id, found.lot_id);
  const role = await effectiveRole(req, found.resolved_store_id, found.lot_id);
  if (![...PROJECT_EDIT_ROLES, 'IT'].includes(role)) throw forbidden('Rôle non autorisé à soumettre un devis');
  const quoteLines = (await query('SELECT * FROM quote_lines WHERE quote_id=$1 AND deleted_at IS NULL ORDER BY id', [id])).rows;
  const version = Number(found.version || 1);
  const computedLines = await buildComputedLines(quoteLines.map(line => ({
    document_type: 'quote',
    document_id: id,
    quantity: line.qty,
    unit_price_ht: line.unit_price,
    tax_rate_snapshot: line.vat_rate,
    regime: 'taxable',
    base_ht: line.amount_ht,
    tax_rate_code: null,
  })), { document_type: 'quote', document_id: id, rounding_rule: 'line' });

  const result = await tx(async client => {
    const duplicate = await activeApproval('quote', id, version, client);
    assertNotDuplicate(duplicate.rowCount, 'Une demande d’approbation est déjà active pour cette version du devis');
    const requestRow = await client.query(
      `INSERT INTO approval_requests
         (object_type, object_id, object_version, current_step, status, submitted_by, submitted_at, created_by, updated_by)
       VALUES ('quote',$1,$2,'CDG','soumis',$3,NOW(),$3,$3)
       RETURNING *`,
      [id, version, req.user.id]
    );
    await client.query("UPDATE quotes SET state='soumis_cdg', submitted_at=NOW(), updated_at=NOW() WHERE id=$1", [id]);
    const object = await client.query('SELECT * FROM quotes WHERE id=$1', [id]);
    if (computedLines.length) {
      await persistLineSnapshots('quote', id, computedLines, client, req.user.id, true);
    }
    await transitionInTx(client, req, 'quote', id, found.state, 'soumis_cdg', req.body?.justification || null, version, documentHash({ id, version, amount_ttc: found.amount_ttc }));
    await auditInTx(client, req, 'QUOTE_SUBMIT', 'quote', id, { version, from: found.state, to: 'soumis_cdg' });
    return { request: requestRow.rows[0], object: object.rows[0] };
  });

  await publishEvent('demande_soumise', submitContext('quote', result.object, result.request, req, found.resolved_store_id, {
    quote_id: id,
    lot_id: found.lot_id,
  }), { actorId: req.user.id, correlationId: req.correlationId });
  setETag(res, result.object);
  res.status(201).json({ approval_request: result.request, quote: result.object });
}));

router.post('/approvals/:id/decisions', asyncV1(async (req, res) => {
  const id = parseId(req.params.id, 'identifiant demande d’approbation');
  const decision = String(req.body?.decision || '').trim();
  const decisions = ['approved', 'rejected', 'correction', 'approuve', 'rejete', 'demande_correction'];
  if (!decisions.includes(decision)) throw badRequest('Décision invalide : approved, rejected ou correction attendu');
  const isRefusal = ['rejected', 'rejete', 'correction', 'demande_correction'].includes(decision);
  if (isRefusal && !String(req.body?.comment || '').trim()) {
    throw badRequest('Motif obligatoire pour un rejet ou une demande de correction');
  }
  assertActor(req, req.body);

  const result = await tx(async client => {
    const requestRes = await client.query('SELECT * FROM approval_requests WHERE id=$1 FOR UPDATE', [id]);
    if (!requestRes.rows[0]) throw notFound('Demande d’approbation introuvable');
    const requestRow = requestRes.rows[0];
    if (requestRow.status !== 'soumis') throw conflict(`Demande d’approbation à l’état ${requestRow.status}`);
    const step = requestRow.current_step;
    const approval = await approvalObject(client, requestRow.object_type, requestRow.object_id);
    await assertWritable(req, approval.projectId, client);
    await assertAssignment(req, approval.projectId, approval.lotId, client);
    const role = await effectiveRole(req, approval.projectId, approval.lotId, client);
    assertStepRole(step, role);
    assertIfMatchRow(req, requestRow, 'demande d’approbation');
    assertVersion(req, req.body?.version, requestRow.object_version, approval.type);
    assertVersion(req, req.body?.row_version, requestRow.row_version, 'demande d’approbation');
    if (Number(requestRow.object_version) !== Number(approval.version)) {
      throw conflict('Version du document modifiée depuis la soumission : nouvelle validation requise');
    }
    const prior = await client.query('SELECT id FROM approval_decisions WHERE request_id=$1 AND step=$2', [id, step]);
    assertNotDuplicate(prior.rowCount, `L’étape ${step} a déjà été traitée`);

    const canonicalHash = documentHash({
      request_id: id,
      object_type: requestRow.object_type,
      object_id: requestRow.object_id,
      version: approval.version,
      step,
      decision,
      comment: req.body?.comment || null,
      actor: req.user.id,
      amount: approval.amount,
      state: approval.state,
      at: new Date().toISOString(),
    });
    const hash = String(req.body?.document_hash || canonicalHash);
    const decisionRow = await client.query(
      `INSERT INTO approval_decisions
         (request_id, step, actor_id, decision, comment, decided_at, document_hash, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,NOW(),$6,$3,$3)
       RETURNING *`,
      [id, step, req.user.id, decision, req.body?.comment || null, hash]
    );
    let nextStep = step;
    let nextStatus = 'soumis';
    if (isRefusal) {
      nextStatus = ['rejected', 'rejete'].includes(decision) ? 'rejete' : 'correction';
    } else if (step === 'CDG') {
      nextStep = 'DD';
    } else if (step === 'DD') {
      nextStep = 'DG';
    } else {
      nextStatus = 'approuve';
    }
    const updatedRequest = await client.query(
      `UPDATE approval_requests
          SET current_step=$1, status=$2, updated_by=$3, updated_at=NOW()
        WHERE id=$4 AND row_version=$5 RETURNING *`,
      [nextStep, nextStatus, req.user.id, id, requestRow.row_version]
    );
    if (!updatedRequest.rows[0]) throw conflict('Conflit de concurrence : la demande a été modifiée');
    const objectRow = await applyApprovalToObject(client, approval, step, decision, req, hash);
    await transitionInTx(client, req, requestRow.object_type, requestRow.object_id, approval.state, objectRow.state, req.body?.comment || null, approval.version, hash);
    await auditInTx(client, req, `APPROVAL_${decision.toUpperCase()}`, requestRow.object_type, requestRow.object_id, {
      approval_request_id: id, step, version: approval.version, decision,
      comment: req.body?.comment || null, document_hash: hash, canonical_hash: canonicalHash,
    });
    return { request: updatedRequest.rows[0], decision: decisionRow.rows[0], objectRow, approval, step, nextStep, nextStatus };
  });

  const context = await approvalNotificationContext(result.approval, result.request, req, result.objectRow, {
    status: result.nextStatus,
    decision: result.decision.decision,
  });
  await publishEvent(approvalNotificationEvent(result.step, decision), context, { actorId: req.user.id, correlationId: req.correlationId });
  if (result.approval.type === 'budget' && result.approval.version > 1 && result.step === 'DG' && !isRefusal) {
    await publishEvent('revision_budget_approuvee', {
      ...context,
      old_amount: round2(result.approval.row.amount),
      new_amount: round2(result.approval.row.revised_amount ?? result.approval.row.amount),
      delta: round2((result.approval.row.revised_amount ?? result.approval.row.amount) - result.approval.row.amount),
    }, { actorId: req.user.id, correlationId: req.correlationId });
  }
  const versionKey = result.approval.type === 'quote' ? 'row_version' : 'revision';
  setETag(res, result.objectRow, versionKey);
  res.json({ approval_request: result.request, decision: result.decision, object: result.objectRow });
}));

async function commitmentSource(req) {
  const quoteId = parseId(req.body.quote_id, 'devis à l’origine de l’engagement');
  const quote = (await query(
    `SELECT q.*, COALESCE(i.store_id, l.store_id) AS resolved_store_id
       FROM quotes q LEFT JOIN items i ON i.id=q.item_id LEFT JOIN lots l ON l.id=q.lot_id
      WHERE q.id=$1`,
    [quoteId]
  )).rows[0];
  if (!quote) throw notFound('Devis introuvable');
  if (!['approuve', 'approved'].includes(quote.state)) {
    throw conflict('Aucun engagement ne peut provenir d’un devis non approuvé');
  }
  if (quote.approved_version !== null && quote.approved_version !== undefined && Number(quote.approved_version) !== Number(quote.version || 1)) {
    throw conflict('Version approuvée du devis obsolète');
  }
  if (req.body.vendor_id && Number(req.body.vendor_id) !== Number(quote.supplier_id)) {
    throw badRequest('Le prestataire doit correspondre à celui du devis approuvé');
  }
  return quote;
}

function commitmentLinesFromQuote(quoteLines) {
  return quoteLines.map(line => ({
    package_id: line.package_id || null,
    amount_ht: round2(line.amount_ht),
    amount_ttc: round2(Number(line.amount_ht) * (1 + Number(line.vat_rate || 0) / 100)),
    quantity: line.qty,
    unit_price_ht: line.unit_price,
    tax_rate_snapshot: line.vat_rate,
    regime: 'taxable',
  }));
}

router.post('/commitments', requireIdempotencyKey, idempotent(), asyncV1(async (req, res) => {
  requireFields(req.body, ['quote_id']);
  const quote = await commitmentSource(req);
  const projectId = quote.resolved_store_id;
  await assertWritable(req, projectId);
  await assertAssignment(req, projectId, quote.lot_id);
  const role = await effectiveRole(req, projectId, quote.lot_id);
  if (!['CDG', 'CG', 'DG', ...DD, 'IT'].includes(role)) throw forbidden('Rôle non autorisé à créer un engagement');
  const quoteLines = (await query('SELECT * FROM quote_lines WHERE quote_id=$1 AND deleted_at IS NULL ORDER BY id', [quote.id])).rows;
  const sourceLines = Array.isArray(req.body.lines) && req.body.lines.length ? req.body.lines : commitmentLinesFromQuote(quoteLines);
  if (!sourceLines.length) throw badRequest('Aucune ligne d’engagement fournie et devis sans lignes');
  const amount = req.body.amount !== undefined ? round2(req.body.amount) : round2(quote.amount_ttc);
  const computed = await buildComputedLines(sourceLines.map(line => ({
    ...line,
    document_type: 'commitment',
    quantity: line.quantity ?? 1,
    unit_price_ht: line.unit_price_ht ?? line.unit_price ?? 0,
    base_ht: line.base_ht ?? line.amount_ht,
  })), { document_type: 'commitment', rounding_rule: req.body.rounding_rule || 'line' });

  const result = await tx(async client => {
    await client.query('SELECT id FROM stores WHERE id=$1 FOR UPDATE', [projectId]);
    const replay = await client.query('SELECT * FROM purchase_orders WHERE idempotency_key=$1 LIMIT 1', [req.idempotencyKey]);
    if (replay.rowCount) return { object: replay.rows[0], replay: true, available: null };
    const available = await fetchCommitmentAvailable(projectId, quote.lot_id, client);
    if (amount > available.available) {
      throw conflict('Dépassement du budget disponible : révision budgétaire à approuver', {
        budget: available.budget, engaged: available.engaged, available: available.available, requested: amount,
      });
    }
    const reference = req.body.order_ref || req.body.reference || `CMD-${quote.id}-${Date.now()}`;
    const inserted = await client.query(
      `INSERT INTO purchase_orders
         (store_id, lot_id, supplier_id, item_id, quote_id, reference, amount, state, ordered_at,
          planned_date, revision, currency, idempotency_key, created_by, authorized_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'autorise',$8,$9,1,$10,$11,$12,NOW(),NOW())
       RETURNING *`,
      [
        projectId, quote.lot_id || null, quote.supplier_id, quote.item_id || null, quote.id,
        reference, amount, req.body.date || req.body.ordered_at || new Date().toISOString().slice(0, 10),
        req.body.planned_date || null, req.body.currency || quote.currency || 'MAD',
        req.idempotencyKey, req.user.id,
      ]
    );
    const order = inserted.rows[0];
    for (const line of sourceLines) {
      await client.query(
        `INSERT INTO commitment_lines (commitment_id, package_id, amount_ht, amount_ttc, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$5)`,
        [order.id, line.package_id || null, round2(line.amount_ht ?? line.base_ht ?? 0), round2(line.amount_ttc ?? line.total_ttc ?? line.base_ht ?? 0), req.user.id]
      );
    }
    await persistLineSnapshots('commitment', order.id, computed, client, req.user.id);
    await transitionInTx(client, req, 'purchase_order', order.id, 'brouillon', 'autorise', 'Devis approuvé', 1, documentHash({ order_id: order.id, quote_id: quote.id, amount }));
    await auditInTx(client, req, 'COMMITMENT_CREATE', 'purchase_order', order.id, { quote_id: quote.id, amount, available });
    return { object: order, replay: false, available };
  });
  setETag(res, result.object);
  res.status(201).json({ commitment: result.object, budget: result.available, replay: result.replay });
}));

router.post('/invoices', requireIdempotencyKey, idempotent(), asyncV1(async (req, res) => {
  requireFields(req.body, ['invoice_ref', 'amount_ttc']);
  const commitmentId = parseId(req.body.commitment_id ?? req.body.purchase_order_id, 'engagement');
  const po = (await query(
    `SELECT po.*, q.supplier_id AS quote_supplier_id
       FROM purchase_orders po LEFT JOIN quotes q ON q.id=po.quote_id WHERE po.id=$1`,
    [commitmentId]
  )).rows[0];
  if (!po) throw notFound('Engagement introuvable');
  if (!['autorise', 'commande', 'recu', 'clos'].includes(po.state)) throw conflict('Engagement non autorisé : facturation impossible');
  const vendorId = Number(req.body.vendor_id ?? po.supplier_id ?? po.quote_supplier_id);
  if (!vendorId) throw badRequest('Prestataire de la facture requis');
  await assertWritable(req, po.store_id);
  await assertAssignment(req, po.store_id, po.lot_id);
  const role = await effectiveRole(req, po.store_id, po.lot_id);
  if (!['CDG', 'CG', 'DG', ...DD, 'IT'].includes(role)) throw forbidden('Rôle non autorisé à créer une facture');

  const reference = String(req.body.invoice_ref).trim();
  const duplicate = await query('SELECT id FROM invoices WHERE supplier_id=$1 AND lower(reference)=lower($2)', [vendorId, reference]);
  assertNotDuplicate(duplicate.rowCount, 'Référence facture déjà utilisée pour ce prestataire');
  const amountHt = round2(req.body.amount_ht ?? 0);
  const amountTtc = round2(req.body.amount_ttc);
  const vatAmount = req.body.vat_amount !== undefined ? round2(req.body.vat_amount) : round2(amountTtc - amountHt);
  if (round2(amountHt + vatAmount) !== amountTtc) throw badRequest('TTC incohérent : HT + TVA doit égaler TTC');

  const sourceLines = Array.isArray(req.body.lines) ? req.body.lines : [];
  const computed = sourceLines.length ? await buildComputedLines(sourceLines.map(line => ({ ...line, document_type: 'invoice' })), { document_type: 'invoice', rounding_rule: req.body.rounding_rule || 'line' }) : [];

  const result = await tx(async client => {
    const replay = await client.query('SELECT * FROM invoices WHERE idempotency_key=$1 LIMIT 1', [req.idempotencyKey]);
    if (replay.rowCount) return { object: replay.rows[0], replay: true };
    await client.query('SELECT id FROM purchase_orders WHERE id=$1 FOR UPDATE', [commitmentId]);
    const committed = await client.query(
      `SELECT po.amount + COALESCE((SELECT SUM(amount) FROM purchase_order_amendments WHERE purchase_order_id=po.id),0) AS limit
         FROM purchase_orders po WHERE po.id=$1`,
      [commitmentId]
    );
    const used = await client.query(
      `SELECT COALESCE(SUM(amount_ttc),0) AS amount FROM invoices
        WHERE purchase_order_id=$1 AND credit_note IS NOT TRUE AND state NOT IN ('annulee','litige')`,
      [commitmentId]
    );
    const remaining = disponibleAEtendre(committed.rows[0]?.limit, used.rows[0]?.amount);
    if (amountTtc > remaining) throw conflict('Dépassement de l’engagement : régularisation requise', { remaining, requested: amountTtc });
    const controlled = CDG_ROLES.includes(req.user.role) || DG_ROLES.includes(req.user.role) || DD.includes(req.user.role);
    const inserted = await client.query(
      `INSERT INTO invoices
         (store_id, lot_id, supplier_id, purchase_order_id, reference, amount_ht, vat_amount, amount_ttc,
          state, invoice_date, due_date, currency, controlled_at, controller_id, control_comment,
          idempotency_key, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
       RETURNING *`,
      [
        po.store_id, po.lot_id || null, vendorId, commitmentId, reference, amountHt, vatAmount, amountTtc,
        controlled ? 'validee' : 'a_controle',
        req.body.invoice_date || new Date().toISOString().slice(0, 10), req.body.due_date || null,
        req.body.currency || 'MAD', controlled ? new Date().toISOString() : null,
        controlled ? req.user.id : null, req.body.control_comment || null,
        req.idempotencyKey, req.user.id,
      ]
    );
    const invoice = inserted.rows[0];
    if (req.body.document_id && computed.length) {
      const exists = await client.query('SELECT id FROM documents WHERE id=$1', [req.body.document_id]);
      if (!exists.rowCount) throw notFound('Document joint introuvable');
      await persistLineSnapshots('document', req.body.document_id, computed, client, req.user.id);
    }
    await transitionInTx(client, req, 'invoice', invoice.id, null, invoice.state, 'Création facture', 1, documentHash({ invoice: reference, amount_ttc: amountTtc }));
    await auditInTx(client, req, 'INVOICE_CREATE', 'invoice', invoice.id, { reference, amount_ht: amountHt, amount_ttc: amountTtc, commitment_id: commitmentId });
    return { object: invoice, replay: false };
  });
  setETag(res, result.object);
  res.status(201).json({ invoice: result.object, replay: result.replay });
}));

router.post('/payments', requireIdempotencyKey, idempotent(), asyncV1(async (req, res) => {
  if (!CDG_ROLES.includes(req.user.role)) {
    throw forbidden('Saisie des paiements réservée au contrôle de gestion (CDG)');
  }
  requireFields(req.body, ['invoice_id', 'amount', 'finance_reference']);
  const invoiceId = parseId(req.body.invoice_id, 'facture');
  const proofDocumentId = req.body.proof_document_id ?? req.body.support_document_id;
  const supportName = req.body.support_name || (proofDocumentId ? `document:${proofDocumentId}` : null);
  if (!supportName && !req.body.support_url) {
    throw badRequest('Justificatif Finance obligatoire : pièce jointe ou référence de support requise');
  }
  if (proofDocumentId) {
    const doc = await query('SELECT id FROM documents WHERE id=$1', [proofDocumentId]);
    if (!doc.rowCount) throw notFound('Justificatif Finance introuvable');
  }
  const amount = round2(req.body.amount);
  if (amount <= 0) throw badRequest('Montant du paiement invalide');
  const invoice = (await query('SELECT * FROM invoices WHERE id=$1', [invoiceId])).rows[0];
  if (!invoice) throw notFound('Facture introuvable');
  await assertWritable(req, invoice.store_id);
  const result = await tx(async client => {
    const replay = await client.query('SELECT * FROM payments WHERE idempotency_key=$1 LIMIT 1', [req.idempotencyKey]);
    if (replay.rowCount) return { object: replay.rows[0], replay: true };
    await client.query('SELECT id FROM invoices WHERE id=$1 FOR UPDATE', [invoiceId]);
    const balance = await fetchInvoiceBalance(invoiceId, client);
    if (!balance) throw notFound('Facture introuvable');
    if (amount > balance.balance) {
      throw conflict('Montant supérieur au solde de la facture', { balance: balance.balance, requested: amount });
    }
    const inserted = await client.query(
      `INSERT INTO payments
         (store_id, invoice_id, amount, method, reference, paid_at, finance_reference,
          support_name, support_url, recorded_by, idempotency_key, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
       RETURNING *`,
      [
        invoice.store_id, invoiceId, amount, req.body.method || null, req.body.reference || null,
        req.body.payment_date || req.body.paid_at || new Date().toISOString().slice(0, 10),
        String(req.body.finance_reference).trim(), supportName, req.body.support_url || null,
        req.user.id, req.idempotencyKey,
      ]
    );
    const newBalance = round2(balance.balance - amount);
    await client.query(
      'UPDATE invoices SET state=$1, updated_at=NOW() WHERE id=$2',
      [newBalance <= 0 ? 'payee' : 'partiellement_payee', invoiceId]
    );
    await transitionInTx(client, req, 'payment', inserted.rows[0].id, invoice.state, 'saisi', 'Justificatif Finance', 1, documentHash({ invoice_id: invoiceId, amount, finance_reference: req.body.finance_reference }));
    await auditInTx(client, req, 'PAYMENT_CREATE', 'payment', inserted.rows[0].id, {
      invoice_id: invoiceId, amount, finance_reference: req.body.finance_reference, support: supportName,
    });
    return { object: inserted.rows[0], replay: false, balance_after: newBalance };
  });
  setETag(res, result.object);
  res.status(201).json({ payment: result.object, replay: result.replay, balance_after: result.balance_after });
}));

router.post('/change-requests', asyncV1(async (req, res) => {
  requireFields(req.body, ['project_id', 'reason']);
  const projectId = parseId(req.body.project_id, 'projet');
  await getProject(projectId);
  await assertWritable(req, projectId);
  await assertAssignment(req, projectId, req.body.lot_id || null);
  const title = req.body.title || String(req.body.reason).slice(0, 190);
  const amount = round2(req.body.impact_amount ?? req.body.amount ?? 0);
  const impact = req.body.impact || [amount ? `${amount} MAD` : null, req.body.impact_days ? `${req.body.impact_days} jours` : null].filter(Boolean).join(' — ') || null;
  const inserted = await query(
    `INSERT INTO change_requests
       (store_id, lot_id, title, description, impact, quote_id, amount, state, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,NOW())
     RETURNING *`,
    [
      projectId, req.body.lot_id || null, title, req.body.reason, impact,
      req.body.quote_id || null, amount, req.user.id,
    ]
  );
  await auditV1(req, 'CHANGE_REQUEST_CREATE', 'change_request', inserted.rows[0].id, req.body);
  setETag(res, inserted.rows[0]);
  res.status(201).json({ change_request: inserted.rows[0] });
}));

export default router;
