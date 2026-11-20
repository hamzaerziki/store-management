import { query } from '../db.js';
import { HttpError, badRequest, notFound } from '../middleware/standard.js';

export const REGIMES = ['taxable', 'exonere', 'hors_champ'];
export const ROUNDING_RULES = ['line', 'document', 'half_up', 'half_down', 'floor', 'ceil'];

export function round(value, decimals = 2, rule = 'half_up') {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** Math.max(0, Number(decimals) || 0);
  const scaled = Math.abs(n) * factor;
  let rounded;
  switch (rule) {
    case 'floor':
      rounded = Math.floor(scaled + 1e-9);
      break;
    case 'ceil':
      rounded = Math.ceil(scaled - 1e-9);
      break;
    case 'half_down':
      rounded = Math.floor(scaled + 0.5 - 1e-9);
      break;
    default:
      rounded = Math.round(scaled + 1e-9);
  }
  return (Math.sign(n) || 1) * rounded / factor;
}

export function isTaxableZero(regime, rate) {
  return String(regime || 'taxable') === 'taxable' && Number(rate || 0) === 0;
}

export function rateMultiplier(rate) {
  return 1 + (Number(rate || 0) / 100);
}

export function effectiveRate(row = {}) {
  const regime = String(row.regime || row.tax_rate?.regime || 'taxable');
  return REGIMES.includes(regime) && regime !== 'taxable' ? 0 : Number(row.tax_rate_snapshot ?? row.rate ?? row.tax_rate?.rate ?? 0);
}

export function computeLine(input = {}, options = {}) {
  const quantity = Number(input.quantity ?? input.qty ?? 1) || 0;
  const unitPriceHt = Number(input.unit_price_ht ?? input.unit_price ?? 0) || 0;
  const discountHt = Number(input.discount_ht ?? 0) || 0;
  const baseRaw = input.base_ht !== undefined && input.base_ht !== null
    ? Number(input.base_ht) || 0
    : quantity * unitPriceHt - discountHt;
  const taxRateId = input.tax_rate_id ?? input.tax_rate?.id ?? null;
  const rate = Number(input.tax_rate_snapshot ?? input.rate ?? input.tax_rate?.rate ?? 0) || 0;
  const regime = String(input.regime ?? input.tax_rate?.regime ?? 'taxable');
  if (!REGIMES.includes(regime)) throw badRequest(`Régime de TVA inconnu : ${regime}`, { regime });
  const appliedRate = effectiveRate({ ...input, tax_rate_snapshot: rate, regime });
  const roundingRule = options.rounding_rule || input.rounding_rule || 'line';
  if (!ROUNDING_RULES.includes(roundingRule)) throw badRequest(`Règle d’arrondi inconnue : ${roundingRule}`);
  const taxRaw = baseRaw * appliedRate / 100;
  const totalRaw = baseRaw + taxRaw;
  const lineLevel = roundingRule === 'line' || roundingRule === 'half_up' || roundingRule === 'half_down' || roundingRule === 'floor' || roundingRule === 'ceil';
  const baseHt = lineLevel ? round(baseRaw, 2, roundingRule) : baseRaw;
  const taxAmount = lineLevel ? round(taxRaw, 2, roundingRule) : taxRaw;
  const totalTtc = lineLevel ? round(baseHt + taxAmount, 2, roundingRule) : totalRaw;
  const deductiblePercentage = Number(input.deductible_percentage ?? options.deductible_percentage ?? 0) || 0;
  return {
    document_type: input.document_type ?? options.document_type ?? null,
    document_id: input.document_id ?? options.document_id ?? null,
    quantity,
    unit_price_ht: round(unitPriceHt, 4, 'half_up'),
    discount_ht: round(discountHt, 2, 'half_up'),
    base_ht: baseHt,
    tax_rate_id: taxRateId,
    tax_rate_snapshot: rate,
    tax_rate_code: input.tax_rate_code ?? input.tax_rate?.code ?? null,
    regime,
    taxable_zero: isTaxableZero(regime, rate),
    tax_rate_applied: appliedRate,
    tax_amount: taxAmount,
    total_ttc: totalTtc,
    rounding_rule: roundingRule,
    fiscal_reference: input.fiscal_reference ?? null,
    fiscal_date: input.fiscal_date ?? null,
    recoverable_vat: recoverableVat(taxAmount, deductiblePercentage),
    deductible_percentage: deductiblePercentage,
    _raw_base_ht: baseRaw,
    _raw_tax_amount: taxRaw,
    _raw_total_ttc: totalRaw,
  };
}

export function recoverableVat(taxAmount, deductiblePercentage = 0) {
  const percentage = Math.min(100, Math.max(0, Number(deductiblePercentage) || 0));
  return round((Number(taxAmount) || 0) * percentage / 100, 2, 'half_up');
}

export function netInvestmentCost(totalTtc, recoverable = 0) {
  return round((Number(totalTtc) || 0) - (Number(recoverable) || 0), 2, 'half_up');
}

export function reverseTtc(totalTtc, rate = 0, options = {}) {
  const ttc = Number(totalTtc || 0);
  if (!Number.isFinite(ttc)) throw badRequest('Montant TTC invalide');
  const appliedRate = Number(rate || 0);
  if (appliedRate < 0) throw badRequest('Taux de TVA négatif interdit');
  const roundingRule = options.rounding_rule || 'half_up';
  const decimals = Number(options.decimals ?? 2);
  const regime = options.regime || 'taxable';
  if (!REGIMES.includes(regime)) throw badRequest(`Régime de TVA inconnu : ${regime}`);
  const effective = regime === 'taxable' ? appliedRate : 0;
  const baseRaw = ttc / rateMultiplier(effective);
  const baseHt = round(baseRaw, decimals, roundingRule);
  const taxAmount = round(ttc - baseHt, decimals, roundingRule);
  return {
    base_ht: baseHt,
    tax_amount: taxAmount,
    total_ttc: round(baseHt + taxAmount, decimals, roundingRule),
    tax_rate_snapshot: appliedRate,
    regime,
    taxable_zero: isTaxableZero(regime, appliedRate),
    rounding_rule: roundingRule,
  };
}

export function computeDocument(lines = [], options = {}) {
  const roundingRule = options.rounding_rule || 'line';
  if (!ROUNDING_RULES.includes(roundingRule)) throw badRequest(`Règle d’arrondi inconnue : ${roundingRule}`);
  const computed = lines.map(line => computeLine(line, { ...options, rounding_rule: roundingRule }));
  const documentLevel = roundingRule === 'document';
  const groups = new Map();
  for (const line of computed) {
    const key = `${line.tax_rate_applied}|${line.regime}|${line.rounding_rule}`;
    if (!groups.has(key)) {
      groups.set(key, {
        tax_rate_code: line.tax_rate_code,
        tax_rate_snapshot: line.tax_rate_snapshot,
        tax_rate_applied: line.tax_rate_applied,
        regime: line.regime,
        taxable_zero: line.taxable_zero,
        rounding_rule: line.rounding_rule,
        baseRaw: 0,
        taxRaw: 0,
        totalRaw: 0,
        base_ht: 0,
        tax_amount: 0,
        total_ttc: 0,
      });
    }
    const group = groups.get(key);
    group.baseRaw += documentLevel ? line._raw_base_ht : line.base_ht;
    group.taxRaw += documentLevel ? line._raw_tax_amount : line.tax_amount;
    group.totalRaw += documentLevel ? line._raw_total_ttc : line.total_ttc;
    group.base_ht += line.base_ht;
    group.tax_amount += line.tax_amount;
    group.total_ttc += line.total_ttc;
  }
  const byRate = Array.from(groups.values()).map(group => {
    const baseHt = documentLevel ? round(group.baseRaw, 2, 'half_up') : round(group.base_ht, 2, 'half_up');
    const taxAmount = documentLevel ? round(group.taxRaw, 2, 'half_up') : round(group.tax_amount, 2, 'half_up');
    return {
      tax_rate_code: group.tax_rate_code,
      tax_rate_snapshot: round(group.tax_rate_snapshot, 3, 'half_up'),
      tax_rate_applied: group.tax_rate_applied,
      regime: group.regime,
      taxable_zero: group.taxable_zero,
      base_ht: baseHt,
      tax_amount: taxAmount,
      total_ttc: round(baseHt + taxAmount, 2, 'half_up'),
      rounding_rule: group.rounding_rule,
    };
  });
  const totals = byRate.reduce((acc, group) => ({
    base_ht: round(acc.base_ht + group.base_ht, 2, 'half_up'),
    tax_amount: round(acc.tax_amount + group.tax_amount, 2, 'half_up'),
    total_ttc: round(acc.total_ttc + group.total_ttc, 2, 'half_up'),
  }), { base_ht: 0, tax_amount: 0, total_ttc: 0 });
  totals.total_ttc = round(totals.base_ht + totals.tax_amount, 2, 'half_up');
  const recoverable = round(computed.reduce((sum, line) => sum + Number(line.recoverable_vat || 0), 0), 2, 'half_up');
  return {
    lines: computed,
    by_rate: byRate,
    totals,
    recoverable_vat: options.deductible_percentage ? round(computed.reduce((sum, line) => sum + recoverableVat(documentLevel ? line._raw_tax_amount : line.tax_amount, options.deductible_percentage), 0), 2, 'half_up') : recoverable,
    net_investment_cost: netInvestmentCost(totals.total_ttc, options.deductible_percentage ? round(computed.reduce((sum, line) => sum + recoverableVat(documentLevel ? line._raw_tax_amount : line.tax_amount, options.deductible_percentage), 0), 2, 'half_up') : recoverable),
    rounding_rule: roundingRule,
  };
}

export function snapshotForRate(rateRow, asOf = new Date()) {
  if (!rateRow) return null;
  const date = asOf ? new Date(asOf) : new Date();
  const from = rateRow.valid_from ? new Date(rateRow.valid_from) : null;
  const to = rateRow.valid_to ? new Date(rateRow.valid_to) : null;
  if (from && date < from) return null;
  if (to && date > to) return null;
  return {
    id: rateRow.id,
    code: rateRow.code,
    label: rateRow.label,
    rate: Number(rateRow.rate) || 0,
    regime: String(rateRow.regime || 'taxable'),
    valid_from: rateRow.valid_from,
    valid_to: rateRow.valid_to,
  };
}

function runner(client) {
  return client ? client.query.bind(client) : query;
}

export async function resolveTaxRate(identifier, asOf = new Date(), client) {
  const run = runner(client);
  const column = Number.isFinite(Number(identifier)) && /^\d+$/.test(String(identifier)) ? 'id' : 'code';
  const r = await run(`SELECT * FROM tax_rates WHERE ${column}=$1 AND deleted_at IS NULL`, [identifier]);
  const row = r.rows[0];
  if (!row) throw notFound(`Taux de TVA introuvable : ${identifier}`);
  const snapshot = snapshotForRate(row, asOf);
  if (!snapshot) throw badRequest(`Taux de TVA ${row.code} non applicable à la date de référence`, { valid_from: row.valid_from, valid_to: row.valid_to });
  return { ...row, ...snapshot };
}

export async function getDocumentLines(documentType, documentId, client) {
  const run = runner(client);
  const r = await run(
    `SELECT * FROM document_lines WHERE document_type=$1 AND document_id=$2 AND deleted_at IS NULL ORDER BY id`,
    [documentType, documentId]
  );
  return r.rows;
}

export async function isDocumentApproved(documentId, client) {
  const run = runner(client);
  const r = await run(
    `SELECT
       EXISTS (SELECT 1 FROM quotes q WHERE q.id=$1 AND q.state IN ('approuve','approved')) AS quote_approved,
       EXISTS (SELECT 1 FROM budgets b WHERE b.id=$1 AND b.state IN ('approuve','approved')) AS budget_approved,
       EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id=$1 AND po.state IN ('autorise','commande','recu','clos')) AS commitment_authorized,
       EXISTS (SELECT 1 FROM invoices i WHERE i.id=$1 AND i.state IN ('validee','partiellement_payee','payee')) AS invoice_validated`,
    [documentId]
  );
  const row = r.rows[0] || {};
  return Boolean(row.quote_approved || row.budget_approved || row.commitment_authorized || row.invoice_validated);
}

function storedLineToInput(row) {
  return {
    document_type: row.document_type,
    document_id: row.document_id,
    quantity: row.quantity,
    unit_price_ht: row.unit_price_ht,
    discount_ht: row.discount_ht,
    base_ht: row.base_ht,
    tax_rate_id: row.tax_rate_id,
    tax_rate_snapshot: row.tax_rate_snapshot,
    tax_rate_code: row.tax_rate_code,
    regime: row.regime || 'taxable',
    tax_amount: row.tax_amount,
    total_ttc: row.total_ttc,
    rounding_rule: row.rounding_rule,
    fiscal_reference: row.fiscal_reference,
    fiscal_date: row.fiscal_date,
    deductible_percentage: row.deductible_percentage,
  };
}

export async function calculateDocumentTotals(documentId, options = {}) {
  const run = runner(options.client);
  const doc = await run('SELECT * FROM documents WHERE id=$1', [documentId]);
  if (!doc.rows[0]) throw notFound('Document introuvable');
  const approved = await isDocumentApproved(documentId, options.client);
  const stored = options.lines ? [] : await getDocumentLines('document', documentId, options.client);
  const inputs = options.lines
    ? options.lines.map(line => ({ ...line, document_type: 'document', document_id: documentId }))
    : stored.map(storedLineToInput);
  if (!inputs.length) {
    return {
      document_id: documentId,
      lines: [],
      by_rate: [],
      totals: { base_ht: 0, tax_amount: 0, total_ttc: 0 },
      recoverable_vat: 0,
      net_investment_cost: 0,
      rounding_rule: options.rounding_rule || 'line',
      read_only: approved,
      generated_at: new Date().toISOString(),
    };
  }
  const result = computeDocument(inputs, {
    rounding_rule: options.rounding_rule || inputs[0].rounding_rule || 'line',
    deductible_percentage: options.deductible_percentage,
  });
  if (options.persist && !approved) {
    await persistLineSnapshots('document', documentId, result.lines, options.client, options.actorId, true);
  }
  return {
    document_id: documentId,
    ...result,
    read_only: approved,
    persisted: Boolean(options.persist && !approved),
    generated_at: new Date().toISOString(),
  };
}

export async function persistLineSnapshots(documentType, documentId, lines, client, actorId = null, replace = false) {
  const run = runner(client);
  if (replace) {
    await run('DELETE FROM document_lines WHERE document_type=$1 AND document_id=$2', [documentType, documentId]);
  }
  const saved = [];
  for (const line of lines || []) {
    const r = await run(
       `INSERT INTO document_lines
          (document_type, document_id, quantity, unit_price_ht, discount_ht, base_ht,
           tax_rate_id, tax_rate_code, tax_rate_snapshot, regime, taxable_zero,
           deductible_percentage, recoverable_vat, tax_amount, total_ttc, rounding_rule,
           fiscal_reference, fiscal_date, created_by, updated_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)
        RETURNING *`,
       [
         documentType, documentId,
         line.quantity ?? 1,
         line.unit_price_ht ?? 0,
         line.discount_ht ?? 0,
         line.base_ht ?? 0,
         line.tax_rate_id ?? null,
         line.tax_rate_code ?? null,
         line.tax_rate_snapshot ?? 0,
         line.regime || 'taxable',
         Boolean(line.taxable_zero || false),
         Number(line.deductible_percentage ?? 0),
         Number(line.recoverable_vat ?? 0),
         line.tax_amount ?? 0,
         line.total_ttc ?? 0,
         line.rounding_rule || 'line',
         line.fiscal_reference ?? null,
         line.fiscal_date ?? null,
         actorId,
       ]
    );
    saved.push(r.rows[0]);
  }
  return saved;
}

export async function buildComputedLines(lines = [], options = {}) {
  const client = options.client || null;
  const asOf = options.asOf || new Date();
  const result = [];
  for (const line of lines || []) {
    let rateRow = null;
    const identifier = line.tax_rate_id ?? line.tax_rate_code ?? line.rate_code;
    if (identifier !== undefined && identifier !== null && identifier !== '') {
      rateRow = await resolveTaxRate(identifier, line.fiscal_date || line.fiscal_reference || asOf, client);
    }
    const snapshot = rateRow
      ? rateRow.rate
      : Number(line.tax_rate_snapshot ?? line.vat_rate ?? line.rate ?? 0) || 0;
    result.push(computeLine({
      ...line,
      tax_rate_id: rateRow?.id ?? line.tax_rate_id ?? null,
      tax_rate_snapshot: snapshot,
      tax_rate_code: rateRow?.code ?? line.tax_rate_code ?? null,
      regime: rateRow?.regime ?? line.regime ?? 'taxable',
    }, {
      rounding_rule: line.rounding_rule || options.rounding_rule || 'line',
      document_type: options.document_type,
      document_id: options.document_id,
      deductible_percentage: line.deductible_percentage ?? options.deductible_percentage,
    }));
  }
  return result;
}

export function createLineSnapshot(line, rateRow, options = {}) {
  const snapshot = snapshotForRate(rateRow, options.asOf || new Date());
  return computeLine({
    ...line,
    tax_rate_id: rateRow?.id ?? null,
    tax_rate_snapshot: snapshot?.rate ?? Number(line.tax_rate_snapshot ?? 0),
    tax_rate_code: snapshot?.code ?? line.tax_rate_code ?? null,
    regime: snapshot?.regime ?? line.regime ?? 'taxable',
  }, options);
}

export async function taxSummaryForProject(projectId, client) {
  const run = runner(client);
  const [lines, recoverability, fallback] = await Promise.all([
    run(
      `SELECT dl.* FROM document_lines dl
         LEFT JOIN documents d ON d.id=dl.document_id AND dl.document_type='document'
        WHERE dl.deleted_at IS NULL AND (
          d.store_id=$1
          OR (dl.document_type='commitment' AND dl.document_id IN (SELECT id FROM purchase_orders WHERE store_id=$1))
          OR (dl.document_type='invoice' AND dl.document_id IN (SELECT id FROM invoices WHERE store_id=$1))
          OR (dl.document_type='quote' AND dl.document_id IN (SELECT id FROM quotes WHERE item_id IN (SELECT id FROM items WHERE store_id=$1)))
        )
        ORDER BY dl.id`,
      [projectId]
    ),
    run('SELECT * FROM tax_recoverability WHERE project_id=$1 AND deleted_at IS NULL', [projectId]),
    run(
      `SELECT
         (SELECT COALESCE(SUM(vat_amount),0) FROM invoices WHERE store_id=$1 AND state IN ('validee','partiellement_payee','payee')) AS invoice_vat,
         (SELECT COALESCE(SUM(amount_tva),0) FROM quotes q JOIN items i ON i.id=q.item_id
           WHERE i.store_id=$1 AND q.state IN ('approuve','approved')) AS quote_vat`,
      [projectId]
    ),
  ]);
  const byRegime = { taxable: 0, exonere: 0, hors_champ: 0 };
  const rateMap = new Map();
  let billedVat = 0;
  let totalTtc = 0;
  let baseHt = 0;
  for (const row of lines.rows) {
    const regime = REGIMES.includes(row.regime) ? row.regime : 'taxable';
    const tax = round(row.tax_amount, 2, 'half_up');
    byRegime[regime] = round(byRegime[regime] + tax, 2, 'half_up');
    billedVat = round(billedVat + tax, 2, 'half_up');
    totalTtc = round(totalTtc + Number(row.total_ttc || 0), 2, 'half_up');
    baseHt = round(baseHt + Number(row.base_ht || 0), 2, 'half_up');
    const key = `${regime}|${Number(row.tax_rate_snapshot || 0)}`;
    if (!rateMap.has(key)) rateMap.set(key, { regime, tax_rate_snapshot: Number(row.tax_rate_snapshot || 0), taxable_zero: isTaxableZero(regime, row.tax_rate_snapshot), base_ht: 0, tax_amount: 0, total_ttc: 0 });
    const group = rateMap.get(key);
    group.base_ht = round(group.base_ht + Number(row.base_ht || 0), 2, 'half_up');
    group.tax_amount = round(group.tax_amount + tax, 2, 'half_up');
    group.total_ttc = round(group.total_ttc + Number(row.total_ttc || 0), 2, 'half_up');
  }
  if (!lines.rows.length) {
    billedVat = round((Number(fallback.rows[0]?.invoice_vat) || 0) + (Number(fallback.rows[0]?.quote_vat) || 0), 2, 'half_up');
  }
  const recoverable = round(recoverability.rows.reduce((sum, row) => {
    return sum + (Number(row.deductible_amount) || recoverableVat(billedVat, row.deductible_percentage));
  }, 0), 2, 'half_up');
  return {
    project_id: projectId,
    generated_at: new Date().toISOString(),
    totals: { base_ht: baseHt, tax_amount: billedVat, total_ttc: totalTtc },
    billed_vat: billedVat,
    recoverable_vat: recoverable,
    net_investment_cost: netInvestmentCost(totalTtc || billedVat, recoverable),
    by_regime: byRegime,
    by_rate: Array.from(rateMap.values()),
    recoverability_lines: recoverability.rows,
    source: lines.rows.length ? 'document_lines' : 'financial_documents',
  };
}

export function validateTaxRateInput(body = {}, partial = false) {
  const out = {};
  if (!partial || body.code !== undefined) {
    if (!body.code || !String(body.code).trim()) throw badRequest('Code du taux de TVA requis');
    out.code = String(body.code).trim();
  }
  if (!partial || body.label !== undefined) {
    if (!body.label || !String(body.label).trim()) throw badRequest('Libellé du taux de TVA requis');
    out.label = String(body.label).trim();
  }
  if (!partial || body.rate !== undefined) {
    const rate = Number(body.rate);
    if (!Number.isFinite(rate) || rate < 0) throw badRequest('Taux de TVA invalide : valeur numérique positive attendue');
    out.rate = round(rate, 3, 'half_up');
  }
  if (!partial || body.regime !== undefined) {
    const regime = String(body.regime || 'taxable');
    if (!REGIMES.includes(regime)) throw badRequest(`Régime invalide : ${regime}`, { allowed: REGIMES });
    out.regime = regime;
  }
  if (body.valid_from !== undefined) out.valid_from = body.valid_from || new Date().toISOString().slice(0, 10);
  if (body.valid_to !== undefined) out.valid_to = body.valid_to || null;
  if (body.active !== undefined) out.active = Boolean(body.active);
  if (out.valid_from && out.valid_to && new Date(out.valid_to) < new Date(out.valid_from)) {
    throw badRequest('Dates de validité incohérentes : valid_to doit suivre valid_from');
  }
  return out;
}
