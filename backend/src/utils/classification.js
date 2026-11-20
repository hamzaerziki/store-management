import { query } from '../db.js';

const RULES = [
  {
    category: 'Informatique',
    keywords: ['informatique', 'terminal', 'pos', 'ordinateur', 'pc', 'imprimante', 'serveur', 'nas', 'switch', 'scanner', 'code barres', 'reseau', 'wifi', 'cablage', 'ecran', 'clavier', 'souris', 'logiciel'],
  },
  {
    category: 'Signalétique',
    keywords: ['signaletique', 'enseigne', 'panneau', 'panneaux', 'affiche', 'totem', 'autocollant', 'vitrine'],
  },
  {
    category: 'Sécurité',
    keywords: ['securite', 'camera', 'alarme', 'extincteur', 'controle acces', 'coffre fort'],
  },
  {
    category: 'Mobilier',
    keywords: ['comptoir', 'etagere', 'rayonnage', 'meuble', 'chaise', 'banquette', 'table', 'accueil'],
  },
  {
    category: 'Équipement',
    keywords: ['equipement', 'chariot', 'balance', 'eclairage led', 'climatisation', 'ventilateur'],
  },
  {
    category: 'Fournitures',
    keywords: ['fourniture', 'emballage', 'sac', 'etiquette', 'papier caisse', 'nettoyant', 'gant', 'consommable'],
  },
];

const SERVICE_PATTERNS = [
  /\binstall(ation|er|e)?\b/,
  /\bprestation\b/,
  /\bservice\b/,
  /\bmise en (service|place|route)\b/,
  /\bformation\b/,
  /\bmaintenance\b/,
  /\bparam[ée]trage\b/,
  /\bconfiguration\b/,
  /\bint[ée]gration\b/,
  /\bd[ée]ploiement\b/,
  /\br[ée]glage\b/,
  /\bsupervision\b/,
];

const SERVICE_CATEGORY_HINTS = [
  { category: 'Informatique', keywords: ['it', 'informatique', 'reseau', 'serveur', 'pos', 'terminal', 'wifi', 'logiciel', 'configuration', 'paramétrage', 'intégration', 'déploiement'] },
  { category: 'Signalétique', keywords: ['signaletique', 'enseigne', 'panneau', 'vitrine'] },
  { category: 'Sécurité', keywords: ['securite', 'camera', 'alarme', 'controle acces'] },
  { category: 'Équipement', keywords: ['equipement', 'climatisation', 'eclairage'] },
];

function norm(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hasWord(text, value) {
  const needle = norm(value);
  if (!needle) return false;
  if (needle.length > 3 && needle.includes(' ')) return text.includes(needle);
  return new RegExp(`(^|[^a-z0-9])${needle}([^a-z0-9]|$)`).test(text);
}

function titleFrom(text) {
  const lines = String(text || '').split('\n').map(line => line.trim()).filter(Boolean);
  const candidate = lines.find(line => !/^(devis|fournisseur|societe|raison sociale|total|sous total|tva|ttc|ht|date|page|reference)/i.test(line));
  const cleaned = String(candidate || 'Article importé')
    .replace(/^(article|designation|produit|libelle)\s*[:\-]\s*/i, '')
    .replace(/[0-9][0-9\s.,]*(mad|dh|eur|€)?$/i, '')
    .trim();
  return cleaned.slice(0, 120) || 'Article importé';
}

export async function classifyDevise(text, fields = {}) {
  const [categories, templates] = await Promise.all([
    query('SELECT id,name,owner_role FROM categories ORDER BY id'),
    query('SELECT id,category_id,name,owner_role FROM item_templates ORDER BY id'),
  ]);

  const itemText = norm(fields.item_name || titleFrom(text));
  const bodyText = norm(`${text || ''} ${fields.supplier_name || ''}`)
    .replace(/\b(sous total|total|ttc|ht|tva|quantite|qte|devis|article|designation|produit|libelle|date|page|reference|fournisseur|societe|raison sociale|mad|dh)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const haystack = `${itemText} ${bodyText}`;
  const weight = keyword => keyword.split(' ').length * 3 + norm(keyword).length / 10;
  const scores = RULES.map(rule => {
    const primaryHits = rule.keywords.filter(keyword => hasWord(itemText, keyword));
    const secondaryHits = rule.keywords.filter(keyword => !primaryHits.includes(keyword) && hasWord(bodyText, keyword));
    const score = primaryHits.reduce((sum, keyword) => sum + weight(keyword) * 2, 0)
      + secondaryHits.reduce((sum, keyword) => sum + weight(keyword), 0);
    return { category: rule.category, keywords: [...primaryHits, ...secondaryHits], score };
  }).sort((a, b) => b.score - a.score);

  const isService = SERVICE_PATTERNS.some(pattern => pattern.test(itemText) || pattern.test(bodyText));
  let categoryName = scores[0]?.score > 0 ? scores[0].category : 'Autre';
  let hintKeywords = [];
  if (isService && scores[0]?.score === 0) {
    const hint = SERVICE_CATEGORY_HINTS.find(entry => entry.keywords.some(keyword => hasWord(haystack, keyword)));
    if (hint) {
      categoryName = hint.category;
      hintKeywords = hint.keywords.filter(keyword => hasWord(haystack, keyword));
    }
  }

  const templateHits = templates.rows
    .map(template => ({ template, score: haystack.includes(norm(template.name)) ? 6 + norm(template.name).length / 20 : 0 }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const category = categories.rows.find(row => norm(row.name) === norm(categoryName))
    || categories.rows.find(row => norm(row.name) === 'autre');
  const template = isService ? null
    : templateHits[0]?.template
      || templates.rows.find(row => row.category_id === category?.id && norm(row.name) === norm(fields.item_name));
  const bestScore = (scores[0]?.score || 0) + (templateHits[0]?.score || 0) + (isService && categoryName !== 'Autre' ? 3 : 0);
  const confidence = Math.min(0.99, Math.round((0.4 + bestScore / 10) * 100) / 100);

  return {
    category_id: category?.id || null,
    category_name: category?.name || 'Autre',
    owner_role: category?.owner_role === 'IT' ? 'IT' : 'MG',
    item_name: fields.item_name || template?.name || titleFrom(text),
    matched_template_id: template?.id || null,
    is_service: isService,
    confidence,
    keywords: [...new Set([...(scores[0]?.keywords || []), ...hintKeywords])],
  };
}
