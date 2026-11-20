import { useEffect, useMemo, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  CalendarDays, Download, Printer, RotateCcw, SlidersHorizontal, Wallet, TrendingUp,
  Receipt, CreditCard, AlertTriangle, Clock, FileBarChart, Sparkles, CircleUserRound,
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ErrorBox, money, dateFR } from '../components/ui';
import useSessionState from '../hooks/useSessionState';

const FILTER_KEYS = ['year', 'brand', 'city', 'owner', 'store_status'];
const FILTER_LABELS = { year: 'Exercice', brand: 'Enseigne', city: 'Ville', owner: 'Responsable', store_status: 'Statut' };
const FILTER_ALL = { year: 'Tous les exercices', brand: 'Toutes les enseignes', city: 'Toutes les villes', owner: 'Tous les responsables', store_status: 'Tous les statuts' };
const FILTER_OPTIONS = { year: 'years', brand: 'brands', city: 'cities', owner: 'owners', store_status: 'statuses' };
const STATUS_LABELS = {
  on_track: 'En bonne voie', at_risk: 'À risque', late: 'En retard', en_retard: 'En retard', ready: 'Prêt', ouvert: 'Ouvert', planning: 'Planifié',
};
const STATUS_COLORS = {
  on_track: '#6FD3C7', at_risk: '#F7C96B', late: '#D8A441', en_retard: '#D8A441', ready: '#16A37C', ouvert: '#0E7A5F', planning: '#7FB69A',
};
const CHART_COLORS = ['#16A37C', '#D8A441', '#0E7A5F', '#F7C96B', '#6FD3C7', '#7FB69A', '#E8BC63'];

const pick = (source, keys) => {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return 0;
};

const initials = name => String(name || 'U')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map(part => part[0]?.toUpperCase())
  .join('');

export default function Reporting() {
  const { user } = useAuth();
  const [options, setOptions] = useState({});
  const [filters, setFilters] = useSessionState('safari_reporting_filters', {});
  const [data, setData] = useState({});
  const [summary, setSummary] = useState({});
  const [generatedAt, setGeneratedAt] = useState(() => new Date());
  const [error, setError] = useState('');
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => {
    api.get('/reporting/filters').then(r => setOptions(r.data || {})).catch(() => {});
  }, []);

  useEffect(() => {
    const query = new URLSearchParams(FILTER_KEYS.filter(key => filters[key]).map(key => [key, String(filters[key])])).toString();
    const suffix = query ? `?${query}` : '';
    setError('');
    api.get(`/dashboard/global${suffix}`).then(r => {
      setData(r.data || {});
      setGeneratedAt(new Date());
    }).catch(setError);
    api.get(`/reporting/summary${suffix}`).then(r => setSummary(r.data || {})).catch(() => setSummary({}));
  }, [filters]);

  const stores = data.stores || [];
  const trend = data.trend || [];
  const breakdown = Object.entries(data.status_counts || {})
    .filter(([, value]) => Number(value) > 0)
    .map(([key, value]) => ({ name: STATUS_LABELS[key] || key.replaceAll('_', ' '), value: Number(value) }));
  const activeFilters = FILTER_KEYS.filter(key => filters[key]);

  const kpi = useMemo(() => {
    const totals = summary.totals || summary;
    return {
      budget: pick(totals, ['budget', 'budget_total', 'total_budget', 'estimated_total']),
      engaged: pick(totals, ['engaged', 'engage', 'budget_engaged', 'engagement']),
      invoiced: pick(totals, ['invoiced', 'facture', 'invoiced_amount', 'amount_invoiced']),
      paid: pick(totals, ['paid', 'paye', 'paid_amount', 'amount_paid']),
      risks: pick(totals, ['risks', 'risques', 'open_risks']),
      delays: pick(totals, ['delays', 'retards', 'late_stores']),
    };
  }, [summary]);

  const budgetFlow = useMemo(() => {
    const budget = Number(kpi.budget) || 0;
    const rows = [
      { label: 'Budget', value: budget, color: '#7FB69A' },
      { label: 'Engagé', value: Number(kpi.engaged) || 0, color: '#16A37C' },
      { label: 'Facturé', value: Number(kpi.invoiced) || 0, color: '#D8A441' },
      { label: 'Payé', value: Number(kpi.paid) || 0, color: '#6FD3C7' },
    ];
    const max = Math.max(...rows.map(row => row.value), 1);
    const percent = value => Math.round((Number(value) || 0) / max * 100);
    return {
      rows: rows.map(row => ({ ...row, width: percent(row.value), display: money(row.value) })),
      consumption: budget ? Math.round((Number(kpi.engaged) || 0) / budget * 100) : 0,
      invoicing: budget ? Math.round((Number(kpi.invoiced) || 0) / budget * 100) : 0,
      settlement: budget ? Math.round((Number(kpi.paid) || 0) / budget * 100) : 0,
    };
  }, [kpi]);

  const progressRows = useMemo(() => stores.slice(0, 6).map(store => ({
    name: store.brand || store.name,
    city: store.city || '—',
    progress: Number(store.progress) || 0,
    status: store.computed_status,
  })), [stores]);

  const kpis = [
    { label: 'Budget', value: money(kpi.budget), sub: 'Budget prévisionnel du périmètre', icon: Wallet, accent: '#0E7A5F', badge: 'Total' },
    { label: 'Engagé', value: money(kpi.engaged), sub: 'Montant des engagements', icon: TrendingUp, accent: '#16A37C', badge: `${budgetFlow.consumption}% du budget` },
    { label: 'Facturé', value: money(kpi.invoiced), sub: 'Factures enregistrées', icon: Receipt, accent: '#D8A441', badge: `${budgetFlow.invoicing}% facturé` },
    { label: 'Payé', value: money(kpi.paid), sub: 'Paiements effectués', icon: CreditCard, accent: '#6FD3C7', badge: `${budgetFlow.settlement}% réglé` },
    { label: 'Risques', value: String(kpi.risks), sub: 'Risques ouverts', icon: AlertTriangle, accent: '#F7C96B', badge: 'Alertes' },
    { label: 'Retards', value: String(kpi.delays), sub: 'Magasins ou articles en retard', icon: Clock, accent: '#E05A4F', badge: 'Suivi' },
  ];

  function exportCsv() {
    const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const line = values => values.map(escape).join(';');
    const rows = [
      line(['Rapport de portefeuille Safari']),
      line(['Généré le', generatedAt.toLocaleString('fr-FR')]),
      line(['Généré par', user?.name || '—']),
      line(['Filtres', activeFilters.map(key => `${FILTER_LABELS[key]} : ${filters[key]}`).join(' | ') || 'Aucun']),
      line([]),
      line(['Indicateur', 'Valeur']),
      line(['Budget', money(kpi.budget)]),
      line(['Engagé', money(kpi.engaged)]),
      line(['Facturé', money(kpi.invoiced)]),
      line(['Payé', money(kpi.paid)]),
      line(['Risques', kpi.risks]),
      line(['Retards', kpi.delays]),
      line([]),
      line(['Code', 'Enseigne', 'Ville', 'Responsable', 'Statut', 'Progression', 'Budget', 'Ouverture']),
      ...stores.map(store => line([
        store.code, store.brand || store.name, store.city, store.owner || store.owner_name,
        store.computed_status, `${store.progress || 0}%`, store.budget, store.opening_date,
      ])),
    ];
    const csv = '\uFEFF' + rows.join('\r\n');
    const url = window.URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `reporting-portefeuille-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  async function exportBackend(format = 'pdf') {
    setExportBusy(true); setError('');
    const query = new URLSearchParams(FILTER_KEYS.filter(key => filters[key]).map(key => [key, String(filters[key])])).toString();
    const suffix = query ? `&${query}` : '';
    try {
      let response;
      try { response = await api.get(`/reporting/export?format=${format}${suffix}`, { responseType: 'blob' }); }
      catch { response = await api.get(`/reports/progress.${format}`, { responseType: 'blob' }); }
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `reporting-safari-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) { setError(err); }
    finally { setExportBusy(false); }
  }

  return (
    <div className="reporting-shell -mx-5 -mt-5 -mb-5 min-h-screen px-5 py-6 sm:-mx-7 sm:-mt-7 sm:-mb-7 sm:px-7">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="bento-chip mb-3"><Sparkles size={13} className="text-[#0E7A5F]" /> Vue exécutive · portefeuille magasins</div>
          <h1 className="text-[26px] font-extrabold tracking-tight text-[#1E2229]">Reporting</h1>
          <p className="mt-1 text-[12.5px] text-[#727A88]">Synthèse budgétaire, avancement et alertes du portefeuille</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="bento-chip"><CalendarDays size={13} className="text-[#D8A441]" /> {generatedAt.getFullYear()} · {generatedAt.toLocaleDateString('fr-FR', { month: 'long' })}</span>
          <span className="bento-chip"><CircleUserRound size={13} className="text-[#0E7A5F]" /> {user?.name || 'Utilisateur'}</span>
          <button className="bento-btn bento-btn-primary" onClick={() => exportBackend('pdf')} disabled={exportBusy}><FileBarChart size={14} /> PDF serveur</button>
        </div>
      </div>

      <ErrorBox error={error} />

      <section className="bento-card mb-5 p-4 print:hidden">
        <div className="flex flex-wrap items-center gap-3">
          <span className="bento-chip"><SlidersHorizontal size={13} className="text-[#0E7A5F]" /> Filtres</span>
          {FILTER_KEYS.map(key => (
            <select key={key} className="bento-select w-40" value={filters[key] || ''}
              onChange={e => setFilters(previous => ({ ...previous, [key]: e.target.value }))}>
              <option value="">{FILTER_ALL[key]}</option>
              {(options[FILTER_OPTIONS[key]] || options[key] || []).map(value => (
                <option key={value} value={value}>{key === 'store_status' ? (STATUS_LABELS[value] || value.replaceAll('_', ' ')) : value}</option>
              ))}
            </select>
          ))}
          {activeFilters.length > 0 && <button className="bento-btn" onClick={() => setFilters({})}><RotateCcw size={13} /> Réinitialiser</button>}
        </div>
        {activeFilters.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-semibold text-[#0E7A5F]">
            <span>Périmètre actif :</span>
            {activeFilters.map(key => <span key={key} className="bento-chip !py-1 !text-[10px]" style={{ background: '#EAF6F2', borderColor: '#F6E7C8', color: '#0E7A5F' }}>{FILTER_LABELS[key]} · {filters[key]}</span>)}
          </div>
        )}
      </section>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#727A88]">
        <span className="bento-chip"><FileBarChart size={13} className="text-[#0E7A5F]" /> Généré le {dateFR(generatedAt)} à {generatedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} par {user?.name || 'utilisateur'}</span>
        <span className="font-bold">{stores.length} magasin(s) dans le périmètre</span>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map(item => (
          <div className="bento-kpi" key={item.label}>
            <div className="flex items-start justify-between gap-2">
              <div className="grid h-10 w-10 place-items-center rounded-2xl" style={{ background: `${item.accent}1A`, color: item.accent }}>
                <item.icon size={18} />
              </div>
              <span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: '#EAF6F2', color: item.accent }}>{item.badge}</span>
            </div>
            <div className="mt-4 text-[11px] font-bold uppercase tracking-wide text-[#8B93A1]">{item.label}</div>
            <div className="mt-1 text-[19px] font-extrabold tracking-tight text-[#1E2229]">{item.value}</div>
            <div className="mt-2 text-[10px] leading-snug text-[#8B93A1]">{item.sub}</div>
          </div>
        ))}
      </div>

      <div className="mb-5 grid gap-5 xl:grid-cols-[1.7fr_1fr]">
        <section className="bento-card p-5">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-extrabold text-[#1E2229]">Tendance de progression</h2>
              <p className="text-[11px] text-[#8B93A1]">Avancement réel des projets</p>
            </div>
            <span className="bento-chip !py-1 !text-[10px]"><TrendingUp size={12} className="text-[#0E7A5F]" /> Progression</span>
          </div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 10, right: 18, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="reportBentoProgress" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FFF2D6" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="#D8A441" stopOpacity={0.3} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,.18)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9AA2AF' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#9AA2AF' }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip contentStyle={{ borderRadius: 14, border: '1px solid #F1E4C8', fontSize: 11, boxShadow: '0 10px 30px rgba(0,0,0,.04)' }} />
                <Area type="monotone" dataKey="progress" name="Avancement réel" stroke="#0E7A5F" fill="url(#reportBentoProgress)" strokeWidth={3} dot={{ r: 4, fill: '#fff', stroke: '#0E7A5F', strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="bento-card p-5">
          <div className="mb-2">
            <h2 className="text-[14px] font-extrabold text-[#1E2229]">Répartition par statut</h2>
            <p className="text-[11px] text-[#8B93A1]">Signal des magasins dans le périmètre</p>
          </div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={breakdown} dataKey="value" nameKey="name" innerRadius={62} outerRadius={95} paddingAngle={4} cornerRadius={6} stroke="none">
                  {breakdown.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 14, border: '1px solid #F1E4C8', fontSize: 11 }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10, color: '#727A88' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <div className="mb-5 grid gap-5 xl:grid-cols-[1fr_1.3fr]">
        <section className="bento-card p-5">
          <h2 className="text-[14px] font-extrabold text-[#1E2229]">Flux budgétaire</h2>
          <p className="text-[11px] text-[#8B93A1]">Budget, engagement, facturation et règlement</p>
          <div className="mt-5 space-y-4">
            {budgetFlow.rows.map(row => (
              <div key={row.label}>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-[#5F6875]">{row.label}</span>
                  <span className="font-extrabold text-[#1E2229]">{row.display}</span>
                </div>
                <div className="bento-track mt-2">
                  <div className="h-full rounded-full transition-all" style={{ width: `${row.width}%`, background: row.color }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 grid grid-cols-3 gap-2">
            <div className="rounded-2xl p-3 text-center" style={{ background: '#EAF6F2' }}>
              <div className="text-[15px] font-extrabold text-[#0E7A5F]">{budgetFlow.consumption}%</div>
              <div className="text-[9px] font-bold text-[#8B93A1]">Engagé</div>
            </div>
            <div className="rounded-2xl p-3 text-center" style={{ background: '#FFF3D6' }}>
              <div className="text-[15px] font-extrabold text-[#B96A2B]">{budgetFlow.invoicing}%</div>
              <div className="text-[9px] font-bold text-[#8B93A1]">Facturé</div>
            </div>
            <div className="rounded-2xl p-3 text-center" style={{ background: '#E6F8F4' }}>
              <div className="text-[15px] font-extrabold text-[#177D6F]">{budgetFlow.settlement}%</div>
              <div className="text-[9px] font-bold text-[#8B93A1]">Payé</div>
            </div>
          </div>
        </section>

        <section className="bento-card p-5">
          <h2 className="text-[14px] font-extrabold text-[#1E2229]">Avancement par magasin</h2>
          <p className="text-[11px] text-[#8B93A1]">Lecture rapide des projets du périmètre</p>
          <div className="mt-5 space-y-3">
            {progressRows.length === 0 && <div className="py-8 text-center text-[11px] text-[#8B93A1]">Aucun magasin dans ce périmètre</div>}
            {progressRows.map(row => (
              <div className="flex items-center gap-3" key={row.name + row.city}>
                <div className="w-28 shrink-0 truncate text-[11px] font-bold text-[#3F4754]" title={row.name}>{row.name}</div>
                <div className="bento-track flex-1">
                  <div className="h-full rounded-full" style={{ width: `${row.progress}%`, background: STATUS_COLORS[row.status] || '#16A37C' }} />
                </div>
                <span className="w-9 text-right text-[11px] font-extrabold text-[#1E2229]">{row.progress}%</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="bento-card overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div>
            <h2 className="text-[14px] font-extrabold text-[#1E2229]">Détail des magasins</h2>
            <p className="text-[11px] text-[#8B93A1]">Base utilisée pour le calcul des indicateurs et des graphiques</p>
          </div>
          <span className="bento-chip !py-1 !text-[10px]">{stores.length} lignes</span>
        </div>
        {stores.length === 0 ? <div className="px-5 pb-5 text-center text-[12px] text-[#8B93A1] py-10">Aucun magasin dans ce périmètre</div> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[900px]">
            <thead><tr>
              <th className="bento-th">Code</th><th className="bento-th">Enseigne</th><th className="bento-th">Ville</th>
              <th className="bento-th">Responsable</th><th className="bento-th">Statut</th>
              <th className="bento-th">Progression</th><th className="bento-th">Budget</th>
            </tr></thead>
            <tbody>
              {stores.map(store => (
                <tr key={store.id} className="hover:bg-white/50">
                  <td className="bento-td font-bold text-[#1E2229]">{store.code || `MG-${store.id}`}</td>
                  <td className="bento-td font-bold text-[#3F4754]">{store.brand || store.name}</td>
                  <td className="bento-td">{store.city || '—'}</td>
                  <td className="bento-td">{store.owner || store.owner_name || '—'}</td>
                  <td className="bento-td">
                    <span className="bento-chip !py-1 !text-[10px]" style={{ background: `${STATUS_COLORS[store.computed_status] || '#7FB69A'}22`, borderColor: 'transparent', color: '#4B5563' }}>
                      {STATUS_LABELS[store.computed_status] || store.computed_status || '—'}
                    </span>
                  </td>
                  <td className="bento-td">
                    <div className="flex items-center gap-2">
                      <div className="bento-track w-16"><div className="h-full rounded-full" style={{ width: `${store.progress || 0}%`, background: STATUS_COLORS[store.computed_status] || '#16A37C' }} /></div>
                      <span className="font-extrabold text-[#1E2229]">{store.progress || 0}%</span>
                    </div>
                  </td>
                  <td className="bento-td font-extrabold text-[#0E7A5F]">{money(store.budget)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
