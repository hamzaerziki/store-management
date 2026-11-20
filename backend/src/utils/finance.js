import { query } from '../db.js';
import { expectedProgressOn } from '../utils/progress.js';

const APPROVED_STATES = new Set(['approuve', 'approved', 'validee', 'valide']);
const ORDER_STATES = new Set(['autorise', 'commande', 'recu', 'clos']);
const CANCEL_STATES = new Set(['annule', 'suspendu']);
const VALID_INVOICE_STATES = new Set(['validee', 'partiellement_payee', 'payee']);

export function round2(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function asNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value && typeof value === 'object') return Number(value.amount ?? value.value ?? value.total ?? 0) || 0;
  return Number(value || 0) || 0;
}

function sumWhere(collection, predicate) {
  if (typeof collection === 'number' || typeof collection === 'string') return asNumber(collection);
  const list = Array.isArray(collection) ? collection : [];
  return list.reduce((sum, item) => {
    if (!predicate || predicate(item)) return sum + asNumber(item);
    return sum;
  }, 0);
}

export function budgetEnVigueur(initialApproved, approvedRevisions = []) {
  return round2(asNumber(initialApproved) + sumWhere(approvedRevisions, item => !item?.state || APPROVED_STATES.has(String(item.state).toLowerCase())));
}

export function engagementNet(orders, cancellations = 0, adjustments = 0) {
  const authorized = sumWhere(orders, item => !item?.state || ORDER_STATES.has(String(item.state).toLowerCase()));
  const cancelled = sumWhere(cancellations, item => !item?.state || CANCEL_STATES.has(String(item.state).toLowerCase()));
  const amended = sumWhere(adjustments, item => !item?.state || APPROVED_STATES.has(String(item.state).toLowerCase()));
  return round2(authorized + amended - cancelled);
}

export function disponibleAEtendre(budget, engaged) {
  return round2(asNumber(budget) - asNumber(engaged));
}

export function factureNet(invoices, creditNotes = 0) {
  const billed = sumWhere(invoices, item => !item?.state || VALID_INVOICE_STATES.has(String(item.state).toLowerCase()));
  const credits = sumWhere(creditNotes, item => !item?.state || APPROVED_STATES.has(String(item.state).toLowerCase()) || String(item.state).toLowerCase() === 'avoir');
  return round2(billed - credits);
}

export function resteAPayer(invoicedNet, netPayments) {
  return round2(asNumber(invoicedNet) - asNumber(netPayments));
}

export function coutFinalEstime(invoicedNet, remainingCommitments, plannedExtraWork = 0) {
  return round2(asNumber(invoicedNet) + Math.max(0, asNumber(remainingCommitments)) + asNumber(plannedExtraWork));
}

export function avancementProjet(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const usable = list.filter(task => Number(task?.weight) > 0);
  if (!usable.length) return 0;
  const totalWeight = usable.reduce((sum, task) => sum + Number(task.weight), 0);
  if (totalWeight <= 0) return 0;
  const weighted = usable.reduce((sum, task) => {
    const progress = Math.min(100, Math.max(0, Number(task.progress_pct ?? task.progress ?? 0) || 0));
    return sum + progress * Number(task.weight);
  }, 0);
  return Math.round((weighted / totalWeight) * 100) / 100;
}

export function ecartPlanning(actualProgress, theoreticalProgress) {
  return round2(asNumber(actualProgress) - asNumber(theoreticalProgress));
}

export function retardOuverture(revisedDate, initialDate) {
  if (!revisedDate || !initialDate) return 0;
  const revised = new Date(revisedDate);
  const initial = new Date(initialDate);
  if (Number.isNaN(revised.getTime()) || Number.isNaN(initial.getTime())) return 0;
  return Math.round((revised - initial) / 86400000);
}

export function niveauCriticite(score) {
  const value = Number(score) || 0;
  if (value <= 4) return 'faible';
  if (value <= 9) return 'moyen';
  if (value <= 15) return 'eleve';
  return 'critique';
}

export function criticiteRisque(probability, impact) {
  const p = Math.min(5, Math.max(1, Number(probability) || 1));
  const i = Math.min(5, Math.max(1, Number(impact) || 1));
  const score = p * i;
  return { score, level: niveauCriticite(score) };
}

const RISK_WORDS = {
  faible: 1, low: 1, mineur: 1, rare: 1,
  possible: 2, moyen: 2, moyenne: 2, moderate: 2, probable: 3,
  eleve: 4, élevé: 4, fort: 4, haute: 4, certain: 5, critique: 5,
};

export function riskScoreFromText(text) {
  if (typeof text === 'number') return Math.min(5, Math.max(1, Math.round(text)));
  const key = String(text || '').trim().toLowerCase();
  return RISK_WORDS[key] || 2;
}

export function alerteBudget(disponible) {
  const value = asNumber(disponible);
  if (value < 0) return 'depassement';
  if (value === 0) return 'epuise';
  return 'normal';
}

export function section8Kpis(input = {}) {
  const budget = budgetEnVigueur(input.initialBudget, input.approvedRevisions);
  const engaged = engagementNet(input.orders, input.cancellations, input.adjustments);
  const available = disponibleAEtendre(budget, engaged);
  const invoiced = factureNet(input.invoices, input.creditNotes);
  const paid = sumWhere(input.payments);
  const remaining = resteAPayer(invoiced, paid);
  const progress = avancementProjet(input.tasks);
  const theoretical = Number(input.theoreticalProgress) || 0;
  return {
    budget_en_vigueur: budget,
    engagement_net: engaged,
    disponible_a_engager: available,
    alerte_budget: alerteBudget(available),
    facture_net: invoiced,
    paiements_nets: round2(paid),
    reste_a_payer: remaining,
    engagement_restant_a_facturer: Math.max(0, round2(engaged - invoiced)),
    cout_final_estime: coutFinalEstime(invoiced, engaged - invoiced, input.plannedExtraWork),
    avancement_projet: progress,
    avancement_theorique: round2(theoretical),
    ecart_planning: ecartPlanning(progress, theoretical),
    retard_ouverture_jours: retardOuverture(input.revisedOpenDate, input.initialOpenDate),
  };
}

function runner(client) {
  return client ? client.query.bind(client) : query;
}

export async function fetchBudgetEnVigueur(projectId, client) {
  const run = runner(client);
  const r = await run(
    `WITH approved_versions AS (
       SELECT DISTINCT ON (budget_id) budget_id, amount
       FROM budget_versions WHERE state IN ('approuve','approved')
       ORDER BY budget_id, revision DESC
     )
     SELECT
       COALESCE((SELECT SUM(b.amount) FROM budgets b
         WHERE b.store_id=$1 AND b.state IN ('approuve','approved')
           AND NOT EXISTS (SELECT 1 FROM approved_versions av WHERE av.budget_id=b.id)),0) AS initial_amount,
       COALESCE((SELECT SUM(av.amount) FROM approved_versions av
         JOIN budgets b ON b.id=av.budget_id WHERE b.store_id=$1),0) AS revisions_amount,
       COALESCE((SELECT budget FROM stores WHERE id=$1),0) AS store_budget`,
    [projectId]
  );
  const row = r.rows[0] || {};
  const computed = budgetEnVigueur(Number(row.initial_amount) || 0, Number(row.revisions_amount) || 0);
  return { budget_en_vigueur: computed || round2(row.store_budget), source: computed > 0 ? 'budgets' : 'store' };
}

export async function fetchEngagementNet(projectId, client) {
  const run = runner(client);
  const r = await run(
    `SELECT
       (SELECT COALESCE(SUM(amount),0) FROM purchase_orders
         WHERE store_id=$1 AND state IN ('autorise','commande','recu','clos')) AS orders,
       (SELECT COALESCE(SUM(amount),0) FROM purchase_orders
         WHERE store_id=$1 AND state IN ('annule','suspendu')) AS cancellations,
       (SELECT COALESCE(SUM(a.amount),0) FROM purchase_order_amendments a
         JOIN purchase_orders po ON po.id=a.purchase_order_id WHERE po.store_id=$1) AS adjustments`,
    [projectId]
  );
  const row = r.rows[0] || {};
  return {
    engagement_net: engagementNet(Number(row.orders) || 0, Number(row.cancellations) || 0, Number(row.adjustments) || 0),
    orders: round2(row.orders),
    cancellations: round2(row.cancellations),
    adjustments: round2(row.adjustments),
  };
}

export async function fetchFactureNet(projectId, client) {
  const run = runner(client);
  const r = await run(
    `SELECT
       (SELECT COALESCE(SUM(amount_ttc),0) FROM invoices
         WHERE store_id=$1 AND state IN ('validee','partiellement_payee','payee')
           AND credit_note IS NOT TRUE) AS billed,
       (SELECT COALESCE(SUM(cn.amount_ttc),0) FROM credit_notes cn
         WHERE cn.state IN ('validee','approuvee')
           AND cn.invoice_id IN (SELECT id FROM invoices WHERE store_id=$1)) AS credit_notes,
       (SELECT COALESCE(SUM(amount_ttc),0) FROM invoices
         WHERE store_id=$1 AND credit_note IS TRUE
           AND state IN ('validee','partiellement_payee','payee')) AS legacy_credits`,
    [projectId]
  );
  const row = r.rows[0] || {};
  return factureNet(
    Number(row.billed) || 0,
    (Number(row.credit_notes) || 0) + (Number(row.legacy_credits) || 0)
  );
}

export async function fetchPaiementsNets(projectId, client) {
  const run = runner(client);
  const r = await run('SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE store_id=$1', [projectId]);
  return round2(r.rows[0]?.paid);
}

export async function fetchAvancementProjet(projectId, client) {
  const run = runner(client);
  const r = await run(
    `SELECT t.weight, t.progress_pct FROM tasks t
       JOIN work_packages wp ON wp.id=t.package_id
      WHERE wp.project_id=$1 AND t.deleted_at IS NULL AND t.weight > 0`,
    [projectId]
  );
  return avancementProjet(r.rows);
}

export async function fetchRisks(projectId, client) {
  const run = runner(client);
  const r = await run(
    `SELECT id, title, probability, impact, criticality_score, state FROM risks WHERE store_id=$1`,
    [projectId]
  );
  return r.rows.map(row => {
    const computed = criticiteRisque(
      row.criticality_score ? Math.ceil(Number(row.criticality_score) / 5) : riskScoreFromText(row.probability),
      row.criticality_score ? ((Number(row.criticality_score) - 1) % 5) + 1 : riskScoreFromText(row.impact)
    );
    return { ...row, score: computed.score, level: computed.level };
  });
}

export async function fetchSection8(projectId, client) {
  const run = runner(client);
  const store = await run(
    'SELECT id, name, initial_open_date, revised_open_date, opening_date, project_state FROM stores WHERE id=$1',
    [projectId]
  );
  if (!store.rows[0]) return null;
  const [budget, engagement, invoiced, paid, progress, risks] = await Promise.all([
    fetchBudgetEnVigueur(projectId, client),
    fetchEngagementNet(projectId, client),
    fetchFactureNet(projectId, client),
    fetchPaiementsNets(projectId, client),
    fetchAvancementProjet(projectId, client),
    fetchRisks(projectId, client),
  ]);
  const planned = await run(
    `SELECT COALESCE(SUM(amount),0) AS amount FROM change_requests
      WHERE store_id=$1 AND state NOT IN ('rejected','rejete','annule')`,
    [projectId]
  );
  const revised = store.rows[0].revised_open_date || store.rows[0].opening_date;
  const theoretical = expectedProgressOn(revised || store.rows[0].initial_open_date);
  const kpis = section8Kpis({
    initialBudget: budget.budget_en_vigueur,
    orders: engagement.orders,
    cancellations: engagement.cancellations,
    adjustments: engagement.adjustments,
    invoices: invoiced,
    payments: paid,
    plannedExtraWork: Number(planned.rows[0]?.amount) || 0,
    tasks: [],
    theoreticalProgress: theoretical,
    revisedOpenDate: revised,
    initialOpenDate: store.rows[0].initial_open_date,
  });
  kpis.avancement_projet = progress;
  kpis.ecart_planning = ecartPlanning(progress, theoretical);
  kpis.risques = {
    total: risks.length,
    ouverts: risks.filter(row => !['clos', 'resolu', 'closed'].includes(String(row.state).toLowerCase())).length,
    critiques: risks.filter(row => row.level === 'critique').length,
    detail: risks,
  };
  return {
    project_id: projectId,
    name: store.rows[0].name,
    project_state: store.rows[0].project_state,
    ...kpis,
  };
}

export async function fetchInvoiceBalance(invoiceId, client) {
  const run = runner(client);
  const r = await run(
    `SELECT i.amount_ttc, i.credit_note,
       COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id=i.id),0) AS paid,
       COALESCE((SELECT SUM(cn.amount_ttc) FROM credit_notes cn
          WHERE cn.invoice_id=i.id AND cn.state IN ('validee','approuvee')),0) AS credits
      FROM invoices i WHERE i.id=$1`,
    [invoiceId]
  );
  if (!r.rows[0]) return null;
  const row = r.rows[0];
  const gross = row.credit_note ? 0 : round2(row.amount_ttc);
  return {
    invoice_amount: gross,
    credits: round2(row.credits),
    paid: round2(row.paid),
    balance: resteAPayer(gross, (Number(row.paid) || 0) + (Number(row.credits) || 0)),
  };
}

export async function fetchCommitmentAvailable(projectId, lotId, client, excludeOrderId = null) {
  const run = runner(client);
  const budget = await run(
    `SELECT COALESCE(SUM(COALESCE(revised_amount, amount)),0) AS amount FROM budgets
      WHERE store_id=$1 AND lot_id IS NOT DISTINCT FROM $2
        AND state IN ('approuve','approved')`,
    [projectId, lotId || null]
  );
  let limit = round2(budget.rows[0]?.amount);
  if (limit <= 0) {
    const store = await run('SELECT budget FROM stores WHERE id=$1', [projectId]);
    limit = round2(store.rows[0]?.budget);
  }
  const used = await run(
    `SELECT COALESCE(SUM(amount),0) AS amount FROM purchase_orders
      WHERE store_id=$1 AND lot_id IS NOT DISTINCT FROM $2
        AND state NOT IN ('annule','suspendu') AND id IS DISTINCT FROM $3`,
    [projectId, lotId || null, excludeOrderId || null]
  );
  return {
    budget: limit,
    engaged: round2(used.rows[0]?.amount),
    available: disponibleAEtendre(limit, used.rows[0]?.amount),
  };
}
