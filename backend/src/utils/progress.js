export const WEIGHTS = {
  to_quote: 0,
  quotes_received: 15,
  compared: 30,
  validated: 50,
  approved: 50,
  ordered: 70,
  delivered: 90,
  installed: 100,
};

export const STATUS_LABELS = {
  to_quote: 'À deviser',
  quotes_received: 'Devis reçus',
  compared: 'Comparé',
  validated: 'Validé (CDG/DD)',
  approved: 'Approuvé (DG)',
  ordered: 'Commandé',
  delivered: 'Livré',
  installed: 'Installé',
};

export function progressOf(status) {
  return WEIGHTS[status] ?? 0;
}

export function computeStoreProgress(rows) {
  if (!rows.length) return 0;
  const totalBudget = rows.reduce((s, r) => s + Number(r.estimated_budget || 0), 0);
  const weighted = rows.reduce((s, r) => {
    const w = totalBudget > 0 ? Number(r.estimated_budget || 0) / totalBudget : 1 / rows.length;
    return s + progressOf(r.status) * w;
  }, 0);
  return Math.round(weighted);
}

export function storeSignal(progress, openingDate, override = null, stats = {}) {
  const days = Math.ceil((new Date(openingDate) - new Date()) / 86400000);
  const total = stats.total || 0;
  const installed = stats.installed || 0;

  let status, reason;
  if (override) {
    status = override;
    reason = 'Statut fixé manuellement par le comité';
  } else if (days < 0 && progress >= 100) {
    status = 'ouvert';
    reason = `Magasin ouvert — progression à ${progress}%`;
  } else if (progress >= 100) {
    status = 'ready';
    reason = total && installed === total
      ? `Tous les articles sont installés (${installed}/${total})`
      : `Progression ${progress}%`;
  } else if (days < 0) {
    status = 'en_retard';
    reason = `Ouverture dépassée de ${Math.abs(days)} jour(s) — progression à ${progress}%`;
  } else if (progress > 0) {
    status = 'on_track';
    reason = `Progression réelle : ${progress}%`;
  } else {
    status = 'on_track';
    reason = 'Aucune progression enregistrée';
  }
  return { status, reason, expected: null, gap: null, days_to_opening: days };
}

export function deriveStoreStatus(progress, openingDate, override = null) {
  return storeSignal(progress, openingDate, override).status;
}

