export function parseAmount(raw) {
  if (!raw) return null;
  let value = String(raw).trim();
  const comma = value.lastIndexOf(',');
  const dot = value.lastIndexOf('.');
  if (comma > dot) value = value.replace(/\./g, '').replace(',', '.');
  else if (dot > comma) value = value.replace(/,/g, '');
  value = value.replace(/[^\d.]/g, '');
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

function normalizeDate(raw) {
  if (!raw) return null;
  const match = String(raw).match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (!match) return raw;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

function first(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function extractFields(text) {
  const source = String(text || '').replace(/\r/g, '');
  const amountEnd = '(?=\\s*(?:mad|dh|€|eur|\\n|$))';

  const amountHt = first(source, [
    new RegExp(`(?:total|montant|sous[-\\s]?total)\\s*(?:hors\\s+taxes|ht)?\\s*[:\\-]?\\s*([0-9][0-9\\s.,]*?)${amountEnd}`, 'i'),
    new RegExp(`\\bht\\s*[:\\-]?\\s*([0-9][0-9\\s.,]*?)${amountEnd}`, 'i'),
  ]);
  const amountTtc = first(source, [
    new RegExp(`(?:total|montant|net\\s+[àa]\\s+payer)\\s*(?:g[ée]n[ée]ral|ttc)?\\s*[:\\-]?\\s*([0-9][0-9\\s.,]*?)${amountEnd}`, 'i'),
    new RegExp(`\\bttc\\s*[:\\-]?\\s*([0-9][0-9\\s.,]*?)${amountEnd}`, 'i'),
  ]);
  const deliveryDays = first(source, [
    /(?:d[ée]lai\s*(?:de\s*)?livraison|livraison\s*sous|d[ée]lai)\D{0,25}?(\d{1,3})\s*(?:jours?|j)\b/i,
  ]);
  const validityDate = first(source, [
    /(?:validit[ée]|valable(?:\s+(?:jusqu'[àa]|until))?)\D{0,30}?(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}-\d{2}-\d{2})/i,
  ]);
  const paymentTerms = first(source, [
    /(?:conditions?\s+de\s+paiement|paiement|r[èe]glement)\s*[:\-]?\s*([^\n]{3,120})/i,
  ]);
  const warranty = first(source, [
    /garantie\D{0,25}?(\d{1,3})\s*(mois|ans?)\b/i,
  ]);
  const supplier = first(source, [
    /(?:fournisseur|soci[ée]t[ée]|raison\s+sociale)\s*[:\-]?\s*([^\n]{2,100})/i,
  ]);
  const item = first(source, [
    /(?:article|d[ée]signation|produit|libell[ée])\s*[:\-]?\s*([^\n]{2,120})/i,
  ]);
  const quantity = first(source, [
    /(?:quantit[ée]|qt[ée])\s*[:\-]?\s*(\d{1,4})/i,
  ]);

  let warrantyMonths = null;
  if (warranty) {
    const match = source.match(/garantie\D{0,25}?(\d{1,3})\s*(mois|ans?)\b/i);
    if (match) warrantyMonths = /^an/i.test(match[2]) ? Number(match[1]) * 12 : Number(match[1]);
  }

  return {
    amount_ht: parseAmount(amountHt),
    amount_ttc: parseAmount(amountTtc),
    delivery_days: deliveryDays ? Number(deliveryDays) : null,
    validity_date: normalizeDate(validityDate),
    payment_terms: paymentTerms ? String(paymentTerms).trim().slice(0, 200) : null,
    warranty_months: warrantyMonths,
    supplier_name: supplier ? String(supplier).trim().slice(0, 100) : null,
    item_name: item ? String(item).trim().slice(0, 120) : null,
    quantity: quantity ? Number(quantity) : null,
    reliability_score: 3,
  };
}

export async function extractQuotePdf(buffer) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const text = String(result?.text || '');
    return { text, fields: extractFields(text) };
  } finally {
    await parser.destroy();
  }
}
