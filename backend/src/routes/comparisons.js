import { Router } from 'express';
import { query, tx } from '../db.js';
import {
  requireAuth, asyncRoute, can, scope, ownsItem, DD_ROLES, canValidateDepartment, ddRolesForOwner,
  assertAssignment, readScope,
} from '../middleware/auth.js';
import { audit, notify, usersWithRoles } from '../utils/audit.js';
import { decisionFingerprint } from '../utils/decision.js';

const router = Router();

function stageOf(role) {
  if (['CDG', 'CG'].includes(role)) return 'CDG';
  if (DD_ROLES.includes(role)) return 'DD';
  if (role === 'DG') return 'DG';
  return null;
}

function scoreQuote(q, minAmount) {
  const amount = Number(q.amount_ttc) || 0;
  const priceScore = amount > 0 && minAmount > 0 ? Math.min(40, 40 * minAmount / amount) : 40;
  const reliabilityScore = (Number(q.reliability_score) || 3) * 8;
  const deliveryScore = Math.max(0, 12 - (Number(q.delivery_days) || 30) / 5);
  const warrantyScore = Math.min(10, (Number(q.warranty_months) || 0) / 6);
  return Math.round((priceScore + reliabilityScore + deliveryScore + warrantyScore) * 10) / 10;
}

async function createComparison(itemId, quoteIds, selectedQuoteId, justification, req) {
  return tx(async client => {
    const r = await client.query(
      `INSERT INTO comparisons (item_id,selected_quote_id,justification,status,created_by)
       VALUES ($1,$2,$3,'draft',$4) RETURNING *`,
      [itemId, selectedQuoteId || quoteIds[0], justification || null, req.user.id]
    );
    const cid = r.rows[0].id;
    await client.query(
      `INSERT INTO state_transitions (entity,entity_id,from_state,to_state,actor_id,actor_role,reason,version,document_hash)
       VALUES ('comparison',$1,NULL,'draft',$2,$3,NULL,1,$4)`,
      [cid, req.user.id, req.user.role, decisionFingerprint({ comparison: cid, actor: req.user.id, action: 'create' })]
    );
    for (const qid of quoteIds) {
      const check = await client.query('SELECT id FROM quotes WHERE id=$1 AND item_id=$2', [qid, itemId]);
      if (!check.rows[0]) throw Object.assign(new Error('Devis invalide pour cet article'), { status: 400 });
      await client.query('INSERT INTO comparison_quotes (comparison_id,quote_id) VALUES ($1,$2)', [cid, qid]);
    }
    await client.query("UPDATE items SET status='compared', updated_at=NOW() WHERE id=$1", [itemId]);
    return r.rows[0];
  });
}

async function assertItemWritable(req, itemId) {
  if (!(await ownsItem(req, itemId))) throw Object.assign(new Error('Hors périmètre'), { status: 403 });
  const r = await query('SELECT store_id, lot_id FROM items WHERE id=$1', [itemId]);
  if (r.rows[0]) await assertAssignment(req, r.rows[0].store_id, r.rows[0].lot_id);
}

router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const s = scope(req);
  const params = [...s.params];
  let where = '1=1';
  if (s.clause) where += ' ' + s.clause.replace(/^AND\s*/, 'AND ');
  if (req.query.active === '1') where += " AND c.status IN ('pending_cdg','pending_dd','pending_dg')";
  if (req.query.decided === '1') where += " AND c.status IN ('validated','rejected')";
  if (req.query.status) { params.push(req.query.status); where += ` AND c.status = $${params.length}`; }
  const access = await readScope(req, 'i.store_id', params.length + 1);
  params.push(...access.params);
  where += ` ${access.clause}`;
  const r = await query(
    `SELECT c.*, i.name AS item_name, i.store_id, i.estimated_budget AS item_budget,
      st.name AS store_name, sp.name AS supplier_name, q.amount_ttc,
      (SELECT count(*) FROM comparison_quotes cq WHERE cq.comparison_id=c.id) AS quotes_count,
      (SELECT COALESCE(json_agg(json_build_object('role',v.validator_role,'decision',v.decision,'comment',v.comment,'date',v.decided_at,'actor',vu.name) ORDER BY v.id),'[]'::json)
         FROM validations v LEFT JOIN users vu ON vu.id=v.validator_id WHERE v.comparison_id=c.id) AS decisions
     FROM comparisons c JOIN items i ON i.id=c.item_id
     JOIN stores st ON st.id=i.store_id
     LEFT JOIN quotes q ON q.id=c.selected_quote_id
     LEFT JOIN suppliers sp ON sp.id=q.supplier_id
     WHERE ${where} ORDER BY c.created_at DESC`,
    params
  );
  res.json(r.rows.map(row => ({ ...row, decisions: row.decisions || [] })));
}));

router.get('/cross-store', requireAuth, can('view_budget'), asyncRoute(async (req, res) => {
  const scope = await readScope(req, 'id', 1);
  const storeFilter = scope.clause ? `WHERE 1=1 ${scope.clause}` : '';
  const storeRows = await query(`SELECT id, name, city FROM stores ${storeFilter} ORDER BY opening_date, id`, scope.params);
  const stores = storeRows.rows.map(row => ({ ...row, id: Number(row.id) }));

  const r = await query(
    `SELECT i.id AS item_id, i.store_id, st.name AS store_name, i.name AS item_name,
       c.name AS category_name, i.owner_role, i.status, i.quantity, i.estimated_budget, i.updated_at,
       COALESCE(
         (SELECT q.amount_ttc FROM comparisons cmp JOIN quotes q ON q.id=cmp.selected_quote_id
          WHERE cmp.item_id=i.id AND cmp.status IN ('validated','pending_cdg','pending_dd','pending_dg')
          ORDER BY cmp.created_at DESC LIMIT 1),
         (SELECT MIN(q2.amount_ttc) FROM quotes q2 WHERE q2.item_id=i.id),
         i.estimated_budget
       ) AS price,
       (SELECT count(*) FROM quotes q3 WHERE q3.item_id=i.id) AS quotes_count,
       (SELECT MIN(q4.amount_ttc) FROM quotes q4 WHERE q4.item_id=i.id) AS min_quote,
       (SELECT cmp.id FROM comparisons cmp WHERE cmp.item_id=i.id
          AND cmp.status IN ('validated','pending_cdg','pending_dd','pending_dg') ORDER BY cmp.created_at DESC LIMIT 1) AS comparison_id,
       (SELECT cmp.status FROM comparisons cmp WHERE cmp.item_id=i.id
          AND cmp.status IN ('validated','pending_cdg','pending_dd','pending_dg') ORDER BY cmp.created_at DESC LIMIT 1) AS comparison_status,
       chosen.supplier_name, chosen.delivery_days, chosen.warranty_months
     FROM items i
     JOIN stores st ON st.id=i.store_id
     JOIN categories c ON c.id=i.category_id
     LEFT JOIN LATERAL (
       SELECT q.id, q.amount_ttc, q.delivery_days, q.warranty_months, s.name AS supplier_name
       FROM quotes q LEFT JOIN suppliers s ON s.id=q.supplier_id
       WHERE q.item_id=i.id
       ORDER BY
         CASE WHEN q.id IN (
           SELECT cmp.selected_quote_id FROM comparisons cmp
           WHERE cmp.item_id=i.id AND cmp.status IN ('validated','pending_cdg','pending_dd','pending_dg')
         ) THEN 0 ELSE 1 END,
         q.amount_ttc ASC
       LIMIT 1
      ) chosen ON true
      WHERE 1=1 ${scope.clause.replace('id', 'st.id')}
      ORDER BY st.opening_date, st.id, i.name`,
     scope.params
   );

  const normalize = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const grouped = new Map();
  r.rows.forEach(row => {
    const key = normalize(row.item_name);
    if (!grouped.has(key)) {
      grouped.set(key, {
        name: row.item_name,
        category: row.category_name,
        owner_role: row.owner_role,
        cells: {},
      });
    }
    grouped.get(key).cells[Number(row.store_id)] = {
      item_id: Number(row.item_id),
      store_id: Number(row.store_id),
      store_name: row.store_name,
      status: row.status,
      quantity: Number(row.quantity || 1),
      price: Number(row.price || 0),
      estimated_budget: Number(row.estimated_budget || 0),
      quotes_count: Number(row.quotes_count || 0),
      min_quote: Number(row.min_quote || 0),
      supplier_name: row.supplier_name || null,
      delivery_days: row.delivery_days ?? null,
      warranty_months: row.warranty_months ?? null,
      comparison_id: row.comparison_id ? Number(row.comparison_id) : null,
      comparison_status: row.comparison_status || null,
      updated_at: row.updated_at,
    };
  });

  const groups = Array.from(grouped.values()).map(group => {
    const cells = stores.map(store => group.cells[store.id] || null);
    const prices = cells.map(cell => cell?.price || 0).filter(price => price > 0);
    const min = prices.length ? Math.min(...prices) : 0;
    const max = prices.length ? Math.max(...prices) : 0;
    return {
      ...group,
      cells,
      presence: cells.filter(Boolean).length,
      min_price: min,
      max_price: max,
      spread: max - min,
      avg_price: prices.length
        ? Math.round((prices.reduce((sum, price) => sum + price, 0) / prices.length) * 100) / 100
        : 0,
      best_store_ids: stores.filter((store, index) => cells[index] && cells[index].price === min).map(store => store.id),
    };
  }).sort((a, b) => b.presence - a.presence || a.name.localeCompare(b.name, 'fr'));

  res.json({ stores, groups, total_items: r.rows.length });
}));

router.post('/auto', requireAuth, can('manage_comparisons'), asyncRoute(async (req, res) => {
  const { item_id } = req.body || {};
  if (!item_id) return res.status(400).json({ error: 'Article requis' });
  try { await assertItemWritable(req, item_id); }
  catch (e) { return res.status(e.status || 403).json({ error: e.message }); }

  const s = scope(req);
  const r = await query(
    `SELECT q.*, s.name AS supplier_name FROM quotes q
     JOIN items i ON i.id=q.item_id JOIN suppliers s ON s.id=q.supplier_id
     WHERE q.item_id=$1 ${s.clause} ORDER BY q.amount_ttc ASC`,
    [item_id, ...s.params]
  );
  if (r.rows.length < 2) return res.status(400).json({ error: 'Au moins 2 devis sont nécessaires' });

  const minAmount = Math.min(...r.rows.map(q => Number(q.amount_ttc) || 0));
  const scored = r.rows.map(q => ({ ...q, score: scoreQuote(q, minAmount) }));
  scored.sort((a, b) => b.score - a.score);
  scored.forEach((q, index) => { q.rank = index + 1; });
  const selected = scored[0];
  const justification = `Comparatif généré automatiquement à partir de ${scored.length} devis extraits. Offre recommandée : ${selected.supplier_name || 'fournisseur'} (score ${selected.score}).`;
  const created = await createComparison(
    item_id,
    scored.map(q => q.id),
    selected.id,
    justification,
    req
  );
  await audit(req, 'AUTO_COMPARISON', 'comparison', created.id, {
    item_id, quotes: scored.length, recommended_quote_id: selected.id, score: selected.score,
  });
  res.status(201).json({ ...created, recommended_quote_id: selected.id, recommendations: scored });
}));

router.get('/:id/history', requireAuth, asyncRoute(async (req, res) => {
  const access = await readScope(req, 'i.store_id', 2);
  const comp = await query(
    `SELECT c.id FROM comparisons c JOIN items i ON i.id=c.item_id WHERE c.id=$1 ${access.clause}`,
    [req.params.id, ...access.params]
  );
  if (!comp.rows[0]) return res.status(404).json({ error: 'Comparatif introuvable' });
  const decisions = await query(
    `SELECT v.*, u.name AS actor_name FROM validations v
     LEFT JOIN users u ON u.id=v.validator_id WHERE v.comparison_id=$1 ORDER BY v.id`,
    [req.params.id]
  );
  const transitions = await query(
    `SELECT st.*, u.name AS actor_name FROM state_transitions st
     LEFT JOIN users u ON u.id=st.actor_id
     WHERE st.entity='comparison' AND st.entity_id=$1 ORDER BY st.id`,
    [req.params.id]
  );
  res.json({ decisions: decisions.rows, transitions: transitions.rows });
}));

router.get('/:id', requireAuth, asyncRoute(async (req, res) => {
  const access = await readScope(req, 'i.store_id', 2);
  const r = await query(
    `SELECT c.*, i.name AS item_name, i.status AS item_status, i.store_id, i.estimated_budget, i.owner_role,
      st.name AS store_name, s.name AS supplier_name, q.amount_ttc, q.amount_ht, q.delivery_days,
      u.name AS created_by_name
     FROM comparisons c JOIN items i ON i.id=c.item_id
     JOIN stores st ON st.id=i.store_id
     LEFT JOIN quotes q ON q.id=c.selected_quote_id
     LEFT JOIN suppliers s ON s.id=q.supplier_id
     LEFT JOIN users u ON u.id=c.created_by
     WHERE c.id=$1 ${access.clause}`,
    [req.params.id, ...access.params]
  );
  if (!r.rows[0]) return res.status(404).json({ error: 'Comparatif introuvable' });
  const quotes = await query(
    `SELECT q.*, s.name AS supplier_name FROM comparison_quotes cq
     JOIN quotes q ON q.id=cq.quote_id JOIN suppliers s ON s.id=q.supplier_id
     WHERE cq.comparison_id=$1 ORDER BY q.amount_ttc ASC`,
    [req.params.id]
  );
  const validations = await query(
    `SELECT v.*, u.name AS validator_name FROM validations v
     LEFT JOIN users u ON u.id=v.validator_id WHERE v.comparison_id=$1 ORDER BY v.id`,
    [req.params.id]
  );
  const minAmount = quotes.rows.length ? Math.min(...quotes.rows.map(q => Number(q.amount_ttc) || 0)) : 0;
  const scored = quotes.rows.map(q => ({
    ...q,
    is_cheapest: Number(q.amount_ttc) === minAmount,
    score: scoreQuote(q, minAmount),
  }));
  scored.sort((a, b) => b.score - a.score);
  scored.forEach((q, index) => { q.rank = index + 1; });
  const status = r.rows[0].status;
  const currentStage = status === 'pending_cdg' ? 'CDG'
    : status === 'pending_dd' ? 'DD'
      : status === 'pending_dg' ? 'DG' : null;
  res.json({
    ...r.rows[0],
    quotes: scored,
    validations: validations.rows,
    workflow: ['CDG', 'DD', 'DG'],
    current_stage: currentStage,
    can_validate: stageOf(req.user.role) === currentStage && canValidateDepartment(req.user.role, r.rows[0].owner_role),
  });
}));

router.post('/', requireAuth, can('manage_comparisons'), asyncRoute(async (req, res) => {
  const { item_id, quote_ids, justification, selected_quote_id } = req.body || {};
  if (!item_id || !Array.isArray(quote_ids) || quote_ids.length < 2) {
    return res.status(400).json({ error: 'Un article et au moins 2 devis sont requis' });
  }
  try { await assertItemWritable(req, item_id); }
  catch (e) { return res.status(e.status || 403).json({ error: e.message }); }
  const created = await createComparison(item_id, quote_ids, selected_quote_id, justification, req);
  await audit(req, 'CREATE_COMPARISON', 'comparison', created.id, { item_id, quotes: quote_ids.length });
  res.status(201).json(created);
}));

router.put('/:id', requireAuth, can('manage_comparisons'), asyncRoute(async (req, res) => {
  const old = await query('SELECT c.*, i.owner_role, i.store_id, i.lot_id FROM comparisons c JOIN items i ON i.id=c.item_id WHERE c.id=$1', [req.params.id]);
  if (!old.rows[0]) return res.status(404).json({ error: 'Comparatif introuvable' });
  if (!['CDG', 'CG', ...DD_ROLES, 'DG'].includes(req.user.role) && old.rows[0].owner_role !== req.user.role) {
    return res.status(403).json({ error: 'Hors périmètre' });
  }
  await assertAssignment(req, old.rows[0].store_id, old.rows[0].lot_id);
  if (!['draft', 'rejected'].includes(old.rows[0].status)) {
    return res.status(400).json({ error: 'Ce comparatif ne peut plus être modifié' });
  }
  const { selected_quote_id, justification } = req.body || {};
  const r = await query(
    `UPDATE comparisons SET selected_quote_id=COALESCE($1,selected_quote_id),
     justification=COALESCE($2,justification), updated_at=NOW() WHERE id=$3 RETURNING *`,
    [selected_quote_id, justification, req.params.id]
  );
  await audit(req, 'UPDATE_COMPARISON', 'comparison', req.params.id, req.body);
  res.json(r.rows[0]);
}));

router.post('/:id/submit', requireAuth, can('manage_comparisons'), asyncRoute(async (req, res) => {
  const old = await query('SELECT c.*, i.owner_role, i.store_id, i.lot_id FROM comparisons c JOIN items i ON i.id=c.item_id WHERE c.id=$1', [req.params.id]);
  if (!old.rows[0]) return res.status(404).json({ error: 'Comparatif introuvable' });
  if (!['CDG', 'CG', ...DD_ROLES, 'DG'].includes(req.user.role) && old.rows[0].owner_role !== req.user.role) {
    return res.status(403).json({ error: 'Hors périmètre' });
  }
  await assertAssignment(req, old.rows[0].store_id, old.rows[0].lot_id);
  if (!['draft', 'rejected'].includes(old.rows[0].status)) return res.status(400).json({ error: 'Statut invalide' });
  await query("UPDATE comparisons SET status='pending_cdg', updated_at=NOW() WHERE id=$1", [req.params.id]);
  await query("UPDATE items SET status='compared', updated_at=NOW() WHERE id=$1", [old.rows[0].item_id]);
  await audit(req, 'SUBMIT_COMPARISON', 'comparison', req.params.id, {});
  const cdg = await usersWithRoles(['CDG', 'CG']);
  await notify(cdg.rows.map(u => u.id), 'Un comparatif attend la validation CDG', 'validation');
  res.json({ ok: true, status: 'pending_cdg' });
}));

router.post('/:id/validate', requireAuth, asyncRoute(async (req, res) => {
  const role = req.user.role;
  const stage = stageOf(role);
  if (!stage) {
    return res.status(403).json({ error: 'Validation réservée à CDG / DD / DG' });
  }
  const { decision, comment } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Décision invalide' });

  const access = await readScope(req, 'i.store_id', 2);
  const result = await tx(async client => {
    const r = await client.query(
      `SELECT c.*, i.estimated_budget, i.name AS item_name, i.store_id, i.lot_id, i.owner_role, q.amount_ttc
       FROM comparisons c JOIN items i ON i.id=c.item_id
       LEFT JOIN quotes q ON q.id=c.selected_quote_id
       WHERE c.id=$1 ${access.clause} FOR UPDATE OF c`,
      [req.params.id, ...access.params]
    );
    const cmp = r.rows[0];
    if (!cmp) throw Object.assign(new Error('Comparatif introuvable'), { status: 404 });
    await assertAssignment(req, cmp.store_id, cmp.lot_id || null);
    if (!canValidateDepartment(role, cmp.owner_role)) {
      throw Object.assign(new Error('Ce comparatif appartient à un autre département'), { status: 403 });
    }
    if (Number(cmp.created_by) === Number(req.user.id)) {
      throw Object.assign(new Error('Le créateur ne peut pas valider son propre comparatif'), { status: 403 });
    }
    const priorActor = await client.query(
      'SELECT id FROM validations WHERE comparison_id=$1 AND validator_id=$2 LIMIT 1',
      [cmp.id, req.user.id]
    );
    if (priorActor.rows[0]) {
      throw Object.assign(new Error('Un acteur ne peut pas décider deux étapes pour la même version'), { status: 403 });
    }
    const expected = stage === 'CDG' ? 'pending_cdg' : stage === 'DD' ? 'pending_dd' : 'pending_dg';
    if (cmp.status !== expected) {
      throw Object.assign(new Error(`Ce comparatif n'attend pas la validation ${stage} (statut: ${cmp.status})`), { status: 400 });
    }
    const prior = await client.query(
      'SELECT id FROM validations WHERE comparison_id=$1 AND validator_role=$2',
      [cmp.id, stage]
    );
    if (prior.rows[0]) throw Object.assign(new Error(`${stage} a déjà validé ce comparatif`), { status: 400 });

    await client.query(
      `INSERT INTO validations (comparison_id,validator_id,validator_role,decision,comment)
       VALUES ($1,$2,$3,$4,$5)`,
      [cmp.id, req.user.id, stage, decision, comment || null]
    );

    let status, itemStatus;
    if (decision === 'rejected') {
      status = 'rejected';
      itemStatus = 'compared';
    } else if (stage === 'CDG') {
      status = 'pending_dd';
      itemStatus = 'validated';
    } else if (stage === 'DD') {
      status = 'pending_dg';
      itemStatus = 'validated';
    } else {
      status = 'validated';
      itemStatus = 'approved';
    }
    await client.query('UPDATE comparisons SET status=$1, updated_at=NOW() WHERE id=$2', [status, cmp.id]);
    await client.query('UPDATE items SET status=$1, updated_at=NOW() WHERE id=$2', [itemStatus, cmp.item_id]);
    if (status === 'validated' && decision === 'approved' && cmp.selected_quote_id) {
      await client.query(
        `UPDATE quotes SET state='approuve', approved_version=version, approved_at=NOW(), updated_at=NOW()
         WHERE id=$1`,
        [cmp.selected_quote_id]
      );
    }
    await client.query(
      `INSERT INTO state_transitions (entity,entity_id,from_state,to_state,actor_id,actor_role,reason,version,document_hash)
       VALUES ('comparison',$1,$2,$3,$4,$5,$6,1,$7)`,
      [cmp.id, cmp.status, status, req.user.id, req.user.role, comment || null,
        decisionFingerprint({ comparison: cmp.id, decision, comment, actor: req.user.id, stage })]
    );
    return { cmp, status, itemStatus, stage };
  });

  const auditAction = result.stage === 'CDG' ? 'CDG_VALIDATION'
    : result.stage === 'DD' ? 'DD_VALIDATION' : 'FINAL_APPROVAL';
  await audit(req, auditAction, 'comparison', req.params.id, {
    decision, comment, resulting_status: result.status,
  });

  const nextRoles = result.status === 'pending_dd' ? ddRolesForOwner(result.cmp.owner_role)
    : result.status === 'pending_dg' ? ['DG'] : [];
  const recipients = nextRoles.length
    ? (await usersWithRoles(nextRoles)).rows.map(u => u.id)
    : [result.cmp.created_by].filter(Boolean);
  const stageLabel = result.stage === 'CDG' ? 'CDG' : result.stage === 'DD' ? 'DD' : 'DG';
  await notify(recipients,
    decision === 'approved'
      ? `Comparatif approuvé par ${stageLabel} — ${result.cmp.item_name} (${result.status})`
      : `Comparatif rejeté par ${stageLabel} — ${result.cmp.item_name}`,
    decision === 'approved' ? 'approval' : 'rejection');

  res.json({ ok: true, status: result.status, item_status: result.itemStatus, next_stage: nextRoles[0] || null });
}));

router.delete('/:id', requireAuth, can('manage_comparisons'), asyncRoute(async (req, res) => {
  const old = await query(
    `SELECT c.*, i.store_id, i.lot_id FROM comparisons c JOIN items i ON i.id=c.item_id WHERE c.id=$1`,
    [req.params.id]
  );
  if (!old.rows[0]) return res.status(404).json({ error: 'Comparatif introuvable' });
  await assertAssignment(req, old.rows[0].store_id, old.rows[0].lot_id);
  if (['pending_cdg', 'pending_dd', 'pending_dg', 'validated'].includes(old.rows[0].status)) {
    return res.status(409).json({ error: 'Suppression interdite : comparatif engagé dans le workflow' });
  }
  const r = await query('DELETE FROM comparisons WHERE id=$1 RETURNING id', [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Comparatif introuvable' });
  await audit(req, 'DELETE_COMPARISON', 'comparison', req.params.id, {});
  res.json({ ok: true });
}));

export default router;
