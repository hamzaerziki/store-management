export const EXECUTION_PROGRESS = Object.freeze({
  accepte_dg: 0,
  en_cours: 50,
  livre: 100,
  installe: 100,
});

export function demandProgress(demand) {
  const status = String(demand?.status || '');
  if (status === 'rejected') return { progress: 0, bucket: 'rejected', rejected: true };
  if (status !== 'approved') return { progress: 0, bucket: 'zero', rejected: false };
  const progress = EXECUTION_PROGRESS[demand?.execution_status] ?? 0;
  const bucket = progress >= 100 ? 'hundred' : progress >= 50 ? 'fifty' : 'zero';
  return { progress, bucket, rejected: false };
}

export function demandEventDate(demand) {
  const status = String(demand?.status || '');
  const value = status === 'rejected'
    ? demand?.updated_at || demand?.submitted_at || demand?.created_at
    : status === 'approved'
      ? demand?.execution_updated_at || demand?.updated_at || demand?.submitted_at || demand?.created_at
      : demand?.submitted_at || demand?.updated_at || demand?.created_at;
  return new Date(value || 0);
}

export function summarizeDemandProgress(demands = []) {
  const totals = {
    total: 0,
    approved: 0,
    rejected: 0,
    zero: 0,
    fifty: 0,
    hundred: 0,
    amount: 0,
    scored: 0,
    progress_sum: 0,
    average: 0,
  };
  demands.forEach(demand => {
    const info = demandProgress(demand);
    totals.total += 1;
    totals[info.bucket] += 1;
    if (String(demand?.status || '') === 'approved') totals.approved += 1;
    totals.amount += Number(demand?.amount || 0);
    if (!info.rejected) {
      totals.scored += 1;
      totals.progress_sum += info.progress;
    }
  });
  totals.average = totals.scored ? Math.round(totals.progress_sum / totals.scored) : 0;
  delete totals.scored;
  delete totals.progress_sum;
  return totals;
}

export function buildDemandTrend(demands = [], months = 7) {
  const dated = demands
    .map(demand => ({ demand, eventDate: demandEventDate(demand) }))
    .filter(row => !Number.isNaN(row.eventDate.getTime()));
  if (!dated.length) return [];

  const monthKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const keys = [...new Set(dated.map(row => monthKey(row.eventDate)))].sort().slice(-months);
  const formatter = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit' });

  return keys.map(key => {
    const [year, month] = key.split('-').map(Number);
    const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
    const included = dated
      .filter(row => row.eventDate <= monthEnd)
      .map(row => row.demand);
    const stats = summarizeDemandProgress(included);
    return {
      month: formatter.format(new Date(year, month - 1, 1)).replace('.', ''),
      demands: stats.total,
      approved: stats.approved,
      zero: stats.zero,
      fifty: stats.fifty,
      hundred: stats.hundred,
      rejected: stats.rejected,
      progress: stats.average,
    };
  });
}
