import { useEffect, useMemo, useState } from 'react';
import { Percent, Receipt, Wallet, BadgePercent, RotateCcw } from 'lucide-react';
import api from '../api/client';
import { Card, CardHead, money } from '../components/ui';
import useSessionState from '../hooks/useSessionState';

const VIEWS = [
  { id: 'ht', label: 'HT' },
  { id: 'ttc', label: 'TTC' },
  { id: 'net', label: 'Net' },
];

const isRegime = (row, ...values) => values.includes(String(row?.regime || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));

export function TaxRegimeBadge({ regime, rate }) {
  if (isRegime({ regime }, 'exonere', 'exonerated')) return <span className="badge-bad !text-[9px]">Exonéré</span>;
  if (isRegime({ regime }, 'hors_champ', 'hors champ', 'hors-champ', 'out_of_scope')) return <span className="badge-muted !text-[9px]">Hors champ</span>;
  if (Number(rate) === 0) return <span className="badge-warn !text-[9px]">0 % taxable</span>;
  return <span className="badge-ok !text-[9px]">Taxable {Number(rate) || 0} %</span>;
}

export default function TaxPanel({
  title = 'Fiscalité & coût net',
  subtitle = 'HT / TVA / TTC, TVA récupérable et coût d’investissement net',
  lines = [],
  summary = {},
  amountHt = 0,
  projectId,
  className = '',
}) {
  const [view, setView] = useSessionState('safari_tax_view', 'ttc');
  const [rates, setRates] = useState([]);
  const [rateId, setRateId] = useState('');
  const [deductible, setDeductible] = useState(() => Number(summary.deductible_percentage) || 0);
  const [remote, setRemote] = useState({});

  useEffect(() => {
    api.get('/v1/tax-rates').catch(() => api.get('/tax-rates')).then(r => {
      const payload = r.data;
      setRates(Array.isArray(payload) ? payload : (payload?.items || payload?.data || []));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!projectId) return;
    api.get(`/v1/projects/${projectId}/tax-summary`)
      .catch(() => api.get(`/projects/${projectId}/tax-summary`))
      .then(r => setRemote(r.data || {}))
      .catch(() => {});
  }, [projectId]);

  const numbers = useMemo(() => {
    const src = { ...remote, ...summary };
    const lineHt = lines.reduce((sum, line) => sum + (Number(line.base_ht) || 0), 0);
    const lineVat = lines.reduce((sum, line) => sum + (Number(line.tax_amount) || 0), 0);
    const lineTtc = lines.reduce((sum, line) => sum + (Number(line.total_ttc) || 0), 0);
    const ht = Number(src.ht ?? src.amount_ht ?? (lineHt || amountHt || 0)) || 0;
    const vat = Number(src.vat ?? src.vat_amount ?? src.tax_amount ?? lineVat) || 0;
    const ttc = Number(src.ttc ?? src.amount_ttc ?? (lineTtc || ht + vat)) || 0;
    const selected = rates.find(rate => String(rate.id) === String(rateId));
    const rate = Number(selected?.rate) || 0;
    const simVat = Math.round(ht * rate) / 100;
    const simTtc = Math.round(ht * (100 + rate)) / 100;
    const pct = Number(src.deductible_percentage ?? deductible) || 0;
    const recoverable = Number(src.recoverable_vat ?? (Math.round(simVat * pct) / 100)) || 0;
    const netCost = Number(src.net_cost ?? (simTtc - recoverable)) || 0;
    return { ht, vat, ttc, rate, simVat, simTtc, recoverable, netCost, pct, selected };
  }, [remote, summary, lines, amountHt, rates, rateId, deductible]);

  const headline = view === 'ht' ? numbers.ht : view === 'net' ? numbers.netCost : numbers.ttc;
  const headlineLabel = view === 'ht' ? 'Base HT' : view === 'net' ? 'Coût net investissement' : 'Total TTC';

  return (
    <Card className={className}>
      <CardHead title={title} subtitle={subtitle} right={<BadgePercent size={17} className="text-emerald-600" />} />
      <div className="px-5 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-1 rounded-xl border border-line bg-canvas p-1" role="group" aria-label="Unité d’affichage des montants">
            {VIEWS.map(option => (
              <button key={option.id} type="button" aria-pressed={view === option.id}
                onClick={() => setView(option.id)}
                className={`px-3 py-1.5 rounded-lg text-[11.5px] font-extrabold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${view === option.id ? 'bg-emerald-600 text-white shadow-sm' : 'text-muted hover:text-ink'}`}>
                {option.label}
              </button>
            ))}
          </div>
          <div className="text-right">
            <div className="text-[10px] font-extrabold uppercase tracking-widest text-muted">{headlineLabel}</div>
            <div className="text-2xl font-extrabold text-emerald-700 leading-tight">{money(headline)}</div>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 mb-4">
          <div className="rounded-xl border border-line bg-canvas/60 p-3"><div className="text-[10.5px] font-bold text-muted uppercase tracking-wide">Base HT</div><div className="text-[15px] font-extrabold mt-1">{money(numbers.ht)}</div></div>
          <div className="rounded-xl border border-line bg-canvas/60 p-3"><div className="text-[10.5px] font-bold text-muted uppercase tracking-wide">TVA</div><div className="text-[15px] font-extrabold mt-1">{money(numbers.vat || numbers.simVat)}</div></div>
          <div className="rounded-xl border border-line bg-canvas/60 p-3"><div className="text-[10.5px] font-bold text-muted uppercase tracking-wide">Total TTC</div><div className="text-[15px] font-extrabold mt-1">{money(numbers.ttc || numbers.simTtc)}</div></div>
        </div>

        {lines.length > 0 ? (
          <div className="overflow-x-auto border border-line rounded-xl mb-4">
            <table className="w-full min-w-[520px]">
              <thead><tr><th className="th">Ligne</th><th className="th">Base HT</th><th className="th">Taux</th><th className="th">TVA</th><th className="th">TTC</th></tr></thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.id ?? index} className="hover:bg-canvas/50">
                    <td className="td text-[12px] font-semibold">{line.label || line.description || `Ligne ${index + 1}`}</td>
                    <td className="td text-[12px]">{money(line.base_ht)}</td>
                    <td className="td"><TaxRegimeBadge regime={line.regime} rate={line.tax_rate ?? line.rate} /></td>
                    <td className="td text-[12px]">{money(line.tax_amount)}</td>
                    <td className="td text-[12px] font-bold">{money(line.total_ttc)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="bg-canvas/70 font-extrabold">
                <td className="td">Total</td><td className="td">{money(numbers.ht)}</td><td className="td">—</td>
                <td className="td">{money(numbers.vat)}</td><td className="td text-emerald-700">{money(numbers.ttc)}</td>
              </tr></tfoot>
            </table>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-line px-4 py-3 mb-4 text-[11.5px] text-muted">
            Aucune ligne fiscale détaillée remontée par l’API. Les montants ci-dessus servent de base à la simulation.
          </div>
        )}

        <div className="grid md:grid-cols-[1fr_1fr_auto] gap-3 items-end rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
          <label className="block">
            <span className="label flex items-center gap-1"><Percent size={13} /> Taux de TVA de référence</span>
            <select className="input" value={rateId} onChange={e => setRateId(e.target.value)}>
              <option value="">Aucun taux sélectionné</option>
              {rates.map(rate => (
                <option key={rate.id} value={rate.id}>{rate.code ? `${rate.code} · ` : ''}{rate.label || `${rate.rate} %`} — {rate.rate} % · {isRegime(rate, 'exonere') ? 'exonéré' : isRegime(rate, 'hors_champ', 'hors champ') ? 'hors champ' : 'taxable'}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Part de TVA récupérable (%)</span>
            <input type="number" min="0" max="100" step="0.01" className="input" value={numbers.pct} onChange={e => setDeductible(Number(e.target.value) || 0)} />
          </label>
          <div className="flex items-center gap-2 text-[11px] text-muted pb-2">
            <Receipt size={14} className="text-emerald-600" />
            <span>{numbers.selected ? `${numbers.selected.code || 'Taux'} · ${numbers.rate} %` : 'Sélectionnez un taux'}</span>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 mt-4 pt-4 border-t border-line">
          <div><div className="text-[10.5px] text-muted font-bold uppercase tracking-wide">Simulation TVA</div><div className="text-[14px] font-extrabold mt-0.5">{money(numbers.simVat)}</div></div>
          <div><div className="text-[10.5px] text-muted font-bold uppercase tracking-wide">TVA récupérable</div><div className="text-[14px] font-extrabold mt-0.5 text-blue-600">{money(numbers.recoverable)}</div></div>
          <div><div className="text-[10.5px] text-muted font-bold uppercase tracking-wide"><Wallet size={12} className="inline" /> Coût net investissement</div><div className="text-[14px] font-extrabold mt-0.5 text-emerald-700">{money(numbers.netCost)}</div></div>
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-[10.5px] text-muted">
          <RotateCcw size={12} /> Affichage HT / TTC / Net mémorisé pour cette session.
        </div>
      </div>
    </Card>
  );
}
