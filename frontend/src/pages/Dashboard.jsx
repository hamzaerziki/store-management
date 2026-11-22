import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDataRefresh } from '../hooks/useDataRefresh';
import {
  AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  Store as StoreIcon, TrendingUp, AlertTriangle, Wallet, ArrowRight,
  Filter, RotateCcw, ClipboardList, ShieldAlert, CalendarClock, Sparkles, Download,
  Users, Boxes, Tags,
} from 'lucide-react';
import api, { downloadReport } from '../api/client';
import { money, dateFR, STATUS_LABELS_FR } from '../components/ui';

const STAGE_COLORS = { pending_cdg: '#D8A441', pending_dd: '#0E7A5F', pending_dg: '#9BBF7A' };
const STAGE_LABELS = { pending_cdg: 'CDG', pending_dd: 'DD', pending_dg: 'DG' };
const STAGES = ['pending_cdg', 'pending_dd', 'pending_dg'];
const AGING_BUCKETS = ['0-3 j', '4-7 j', '8-14 j', '+14 j'];
const RISK_BANDS = ['Critique', 'Élevé', 'Modéré'];

const shortName = value => String(value || '').replace('Sandro ', 'S. ').replace('Capital Mall', 'CM');
const riskBand = score => {
  const value = Number(score || 0);
  return value >= 15 ? 'Critique' : value >= 8 ? 'Élevé' : 'Modéré';
};

function MiniBar({ value, tone = '#0E7A5F' }) {
  return <div className="bento-track flex-1"><div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, Number(value) || 0))}%`, background: tone }} /></div>;
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filterOptions, setFilterOptions] = useState({ years: [], brands: [], cities: [], owners: [], enterprises: [], statuses: [] });
  const [filters, setFilters] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('safari_dashboard_filters') || '{}'); }
    catch { return {}; }
  });

  useEffect(() => {
    api.get('/dashboard/filters').then(r => setFilterOptions(r.data)).catch(() => {});
  }, []);

  const load = () => {
    sessionStorage.setItem('safari_dashboard_filters', JSON.stringify(filters));
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value).map(([key, value]) => [key, String(value)])).toString();
    setError('');
    api.get(`/dashboard/global${query ? `?${query}` : ''}`).then(r => setData(r.data)).catch(setError);
  };

  useEffect(() => { load(); }, [filters]);
  useDataRefresh(load, [JSON.stringify(filters)]);

  const shellClass = 'reporting-shell -mx-5 -mt-5 -mb-5 min-h-screen px-5 py-6 sm:-mx-7 sm:-mt-7 sm:-mb-7 sm:px-7';

  if (error) return <div className={shellClass}><div className="bento-card p-6 text-[13px] font-semibold text-red-600">{error}</div></div>;
  if (!data) return <div className={shellClass}><div className="bento-card p-6 text-[13px] text-muted">Chargement du tableau de bord…</div></div>;

  const { kpis, stores, trend, demand_aging, smart } = data;
  const counts = data.counts || {};
  const budgetByStore = data.budget_by_store || [];
  const risks = data.risks || [];
  const lateTasks = data.late_tasks || [];
  const demandCounts = kpis.demand_status_counts || {};
  const demandTotal = Object.values(demandCounts).reduce((sum, value) => sum + Number(value || 0), 0);
  const demandApprovedPct = demandTotal ? Math.round(((demandCounts.approved || 0) / demandTotal) * 100) : 0;
  const demandStatusData = [
    { name: 'Approuvées', value: Number(demandCounts.approved || 0), color: '#0E7A5F' },
    { name: 'CDG', value: Number(demandCounts.pending_cdg || 0), color: '#D8A441' },
    { name: 'DD', value: Number(demandCounts.pending_dd || 0), color: '#16A37C' },
    { name: 'DG', value: Number(demandCounts.pending_dg || 0), color: '#E8BC63' },
    { name: 'Rejetées', value: Number(demandCounts.rejected || 0), color: '#E05A4F' },
    { name: 'Brouillons', value: Number(demandCounts.draft || 0), color: '#94A3B8' },
  ].filter(row => row.value > 0);
  const trendGap = trend.length ? trend[trend.length - 1].progress - trend[trend.length - 1].target : 0;
  const todayLabel = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const cityCount = new Set(stores.map(store => store.city)).size;

  const priorityData = stores.map(store => ({
    id: store.id,
    name: store.name,
    opening_date: store.opening_date,
    days: store.days_to_opening,
    progress: store.progress,
    count: store.items_count,
    status: store.computed_status,
  })).sort((a, b) => Number(a.days ?? 9999) - Number(b.days ?? 9999));

  const budgetData = stores.map(store => {
    const budget = Number(store.budget || 0);
    const engaged = Number(store.engaged || 0);
    return {
      id: store.id,
      name: store.name,
      budget,
      engaged,
      available: Math.max(0, budget - engaged),
      over: Math.max(0, engaged - budget),
    };
  });

  const agingData = AGING_BUCKETS.map(bucket => {
    const row = { bucket };
    STAGES.forEach(stage => {
      row[stage] = (demand_aging || []).find(item => item.bucket === bucket && item.status === stage)?.count || 0;
    });
    return row;
  });

  const riskMap = {};
  risks.forEach(risk => {
    const name = shortName(risk.store_name || 'Magasin');
    if (!riskMap[name]) riskMap[name] = { name, Critique: 0, Élevé: 0, Modéré: 0 };
    riskMap[name][riskBand(risk.criticality_score)] += 1;
  });
  const riskData = Object.values(riskMap);

  const kpiCards = [
    { label: 'Utilisateurs', value: String(counts.users || 0).padStart(2, '0'), sub: 'comptes actifs du système', icon: Users, accent: '#0E7A5F', badge: 'Équipe', progress: 100 },
    { label: 'Magasins', value: String(counts.stores || kpis.stores || 0).padStart(2, '0'), sub: `${cityCount} villes actives`, icon: StoreIcon, accent: '#16A37C', badge: 'Projets', progress: kpis.stores_progress },
    { label: 'Demandes', value: String(counts.demands || demandTotal || 0).padStart(2, '0'), sub: `${demandCounts.approved || 0} approuvées`, icon: ClipboardList, accent: '#D8A441', badge: `${demandApprovedPct}% validé`, progress: demandApprovedPct },
    { label: 'Articles / missions', value: String(counts.items || kpis.items_total || 0).padStart(2, '0'), sub: `${kpis.items_installed || 0} installés`, icon: Boxes, accent: '#B8862F', badge: `${kpis.items_progress || 0}%`, progress: kpis.items_progress || 0 },
    { label: 'Catégories', value: String(counts.categories || 0).padStart(2, '0'), sub: `${counts.suppliers || 0} prestataires`, icon: Tags, accent: '#7FB69A', badge: 'Catalogue', progress: 100 },
  ];

  return (
    <div className={shellClass}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="bento-chip mb-3"><Sparkles size={13} className="text-[#0E7A5F]" /> Vue exécutive · ouvertures</div>
          <h1 className="text-[26px] font-extrabold tracking-tight text-[#1E2229]">Pilotage des ouvertures</h1>
          <p className="mt-1 text-[12.5px] text-[#727A88]">Décisions magasin : priorités, budget, délais et risques</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="bento-chip capitalize"><CalendarClock size={13} className="text-[#D8A441]" /> {todayLabel}</span>
          <button className="bento-btn bento-btn-primary" onClick={() => downloadReport('xlsx').catch(() => {})}><Download size={14} /> Exporter</button>
        </div>
      </div>

      <section className="bento-card mb-5 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 p-6 pb-3">
          <div>
            <div className="text-[10.5px] font-extrabold uppercase tracking-[0.2em] text-[#0E7A5F]">Résumé budgétaire · Exercice {new Date().getFullYear()}</div>
            <div className="mt-1 text-[12px] text-[#727A88]">Taux d’utilisation, engagement HT et enveloppe restante</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="bento-chip !py-1 !text-[10px]">Avancement réel {kpis.global_progress}%</span>
          </div>
        </div>
        <div className="grid gap-3 px-6 pb-6 md:grid-cols-4">
          <div className="rounded-2xl bg-[#EAF6F2] p-4"><div className="text-[10px] font-bold uppercase text-[#8B93A1]">Budget total</div><div className="mt-1 text-[19px] font-extrabold text-[#1E2229]">{money(kpis.budget_total)}</div></div>
          <div className="rounded-2xl bg-[#FFF3D6] p-4"><div className="text-[10px] font-bold uppercase text-[#8B93A1]">Engagé</div><div className="mt-1 text-[19px] font-extrabold text-[#B8862F]">{money(kpis.budget_engaged)}</div></div>
          <div className="rounded-2xl bg-white p-4"><div className="text-[10px] font-bold uppercase text-[#8B93A1]">Disponible</div><div className="mt-1 text-[19px] font-extrabold text-[#0E7A5F]">{money(Math.max(0, kpis.budget_total - kpis.budget_engaged))}</div></div>
          <div className="rounded-2xl bg-[#E6F8F4] p-4"><div className="text-[10px] font-bold uppercase text-[#8B93A1]">Utilisé</div><div className="mt-1 text-[19px] font-extrabold text-[#0E7A5F]">{kpis.budget_pct}%</div><div className="mt-2"><MiniBar value={kpis.budget_pct} tone="#D8A441" /></div></div>
        </div>
      </section>

      <section className="bento-card mb-5 p-4 print:hidden">
        <div className="flex flex-wrap items-center gap-3">
          <span className="bento-chip"><Filter size={13} className="text-[#0E7A5F]" /> Filtres</span>
          <select className="bento-select w-40" value={filters.year || ''} onChange={e => setFilters(f => ({ ...f, year: e.target.value }))}>
            <option value="">Tous les exercices</option>
            {filterOptions.years.map(year => <option key={year} value={year}>{year}</option>)}
          </select>
          <select className="bento-select w-44" value={filters.brand || ''} onChange={e => setFilters(f => ({ ...f, brand: e.target.value }))}>
            <option value="">Toutes les enseignes</option>
            {filterOptions.brands.map(brand => <option key={brand} value={brand}>{brand}</option>)}
          </select>
          <select className="bento-select w-36" value={filters.city || ''} onChange={e => setFilters(f => ({ ...f, city: e.target.value }))}>
            <option value="">Toutes les villes</option>
            {filterOptions.cities.map(city => <option key={city} value={city}>{city}</option>)}
          </select>
          <select className="bento-select w-36" value={filters.owner || ''} onChange={e => setFilters(f => ({ ...f, owner: e.target.value }))}>
            <option value="">Tous les responsables</option>
            {filterOptions.owners.map(owner => <option key={owner} value={owner}>{owner}</option>)}
          </select>
          <select className="bento-select w-44" value={filters.enterprise || ''} onChange={e => setFilters(f => ({ ...f, enterprise: e.target.value }))}>
            <option value="">Toutes les entreprises</option>
            {filterOptions.enterprises.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          <select className="bento-select w-40" value={filters.status || ''} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
            <option value="">Tous les statuts</option>
            {filterOptions.statuses.map(status => <option key={status} value={status}>{STATUS_LABELS_FR[status] || status.replaceAll('_', ' ')}</option>)}
          </select>
          {Object.values(filters).some(Boolean) && <button className="bento-btn" onClick={() => setFilters({})}><RotateCcw size={13} /> Réinitialiser</button>}
        </div>
        {Object.values(filters).some(Boolean) && (
          <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-semibold text-[#0E7A5F]">
            <span>Périmètre actif :</span>
            {Object.entries(filters).filter(([, value]) => value).map(([key, value]) => (
              <span key={key} className="bento-chip !py-1 !text-[10px]" style={{ background: '#EAF6F2', borderColor: '#F6E7C8', color: '#0E7A5F' }}>{key === 'enterprise' ? 'Entreprise' : key === 'owner' ? 'Responsable' : key} · {value}</span>
            ))}
          </div>
        )}
      </section>

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {kpiCards.map(item => (
          <div className="bento-kpi" key={item.label}>
            <div className="flex items-start justify-between gap-2">
              <div className="grid h-10 w-10 place-items-center rounded-2xl" style={{ background: `${item.accent}1A`, color: item.accent }}><item.icon size={18} /></div>
              <span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: '#EAF6F2', color: item.accent }}>{item.badge}</span>
            </div>
            <div className="mt-4 text-[11px] font-bold uppercase tracking-wide text-[#8B93A1]">{item.label}</div>
            <div className="mt-1 text-[19px] font-extrabold tracking-tight text-[#1E2229]">{item.value}</div>
            <div className="mt-2 text-[10px] leading-snug text-[#8B93A1]">{item.sub}</div>
            <div className="mt-3"><MiniBar value={item.progress} tone={item.accent} /></div>
          </div>
        ))}
      </div>

      <section className="bento-card mb-5 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-extrabold text-[#1E2229]">Avancement des besoins</h2>
            <p className="text-[11px] text-[#8B93A1]">Installation et suivi financier HT de chaque besoin</p>
          </div>
          <div className="text-3xl font-extrabold text-[#0E7A5F]">{kpis.items_progress}%</div>
        </div>
        <div className="mt-3"><MiniBar value={kpis.items_progress} /></div>
        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-[#E2E8F0] pt-4 md:grid-cols-4">
          <div><div className="text-[11px] text-[#8B93A1]">Installés</div><div className="text-[14px] font-extrabold text-[#1E2229]">{kpis.items_installed}/{kpis.items_total}</div></div>
          <div><div className="text-[11px] text-[#8B93A1]">Moyenne magasins</div><div className="text-[14px] font-extrabold text-[#1E2229]">{kpis.stores_progress}%</div></div>
          <div><div className="text-[11px] text-[#8B93A1]">Montant HT estimé</div><div className="text-[14px] font-extrabold text-[#1E2229]">{money(kpis.estimated_total)}</div></div>
          <div><div className="text-[11px] text-[#8B93A1]">Montant HT engagé</div><div className="text-[14px] font-extrabold text-[#0E7A5F]">{money(kpis.budget_engaged)} <span className="text-[11px] font-normal text-[#8B93A1]">· {kpis.budget_pct}%</span></div></div>
        </div>
      </section>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <section className="bento-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="text-[14px] font-extrabold text-[#1E2229]">Demandes par statut</h2><p className="text-[11px] text-[#8B93A1]">Répartition des demandes du périmètre</p></div>
            <span className="bento-chip !py-1 !text-[10px]">{demandTotal} demandes</span>
          </div>
          <div className="h-[250px] pt-2">
            {demandStatusData.length === 0 ? (
              <div className="grid h-full place-items-center text-[12px] text-[#8B93A1]">Aucune demande enregistrée</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={demandStatusData} margin={{ top: 10, right: 18, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,.18)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#9AA2AF' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 14, border: '1px solid #F1E4C8', fontSize: 11 }} />
                  <Bar dataKey="value" name="Demandes" radius={[6, 6, 0, 0]}>
                    {demandStatusData.map(row => <Cell key={row.name} fill={row.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="bento-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="text-[14px] font-extrabold text-[#1E2229]">Budget par magasin</h2><p className="text-[11px] text-[#8B93A1]">Enveloppe versus engagements HT</p></div>
            <span className="bento-chip !py-1 !text-[10px]">HT</span>
          </div>
          <div className="h-[250px] pt-2">
            {budgetByStore.length === 0 ? (
              <div className="grid h-full place-items-center text-[12px] text-[#8B93A1]">Aucun budget dans le périmètre</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={budgetByStore} margin={{ top: 10, right: 18, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,.18)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval={0} angle={-18} textAnchor="end" height={55} />
                  <YAxis tick={{ fontSize: 11, fill: '#9AA2AF' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 14, border: '1px solid #F1E4C8', fontSize: 11 }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="budget" name="Budget" fill="#7FB69A" radius={[5, 5, 0, 0]} />
                  <Bar dataKey="engaged" name="Engagé" fill="#D8A441" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </div>

      <section className="bento-card mb-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-[14px] font-extrabold text-[#1E2229]">Détail des budgets par magasin</h2><p className="text-[11px] text-[#8B93A1]">Enveloppe, engagement, disponible et ventilation par catégorie</p></div>
          <span className="bento-chip !py-1 !text-[10px]">{budgetByStore.length} magasin(s)</span>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {budgetByStore.length === 0 && <div className="py-10 text-center text-[12px] text-[#8B93A1]">Aucun détail budgétaire disponible</div>}
          {budgetByStore.map(store => (
            <details key={store.id} className="rounded-2xl border border-white/80 bg-white/70 p-4">
              <summary className="cursor-pointer list-none">
                <div className="flex items-start justify-between gap-3">
                  <div><div className="text-[12.5px] font-extrabold text-[#1E2229]">{store.name}</div><div className="text-[10px] text-[#8B93A1]">{store.categories.length} catégorie(s)</div></div>
                  <span className="bento-chip !py-1 !text-[10px]" style={{ background: store.pct >= 90 ? '#FDECEA' : '#EAF6F2', borderColor: 'transparent', color: store.pct >= 90 ? '#E05A4F' : '#0E7A5F' }}>{store.pct}% utilisé</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-[10.5px]">
                  <div><div className="text-[#8B93A1]">Budget</div><div className="font-extrabold text-[#1E2229]">{money(store.budget)}</div></div>
                  <div><div className="text-[#8B93A1]">Engagé</div><div className="font-extrabold text-[#B8862F]">{money(store.engaged)}</div></div>
                  <div><div className="text-[#8B93A1]">Disponible</div><div className="font-extrabold text-[#0E7A5F]">{money(store.available)}</div></div>
                </div>
                <div className="mt-3"><MiniBar value={store.pct} tone={store.pct >= 90 ? '#E05A4F' : '#D8A441'} /></div>
              </summary>
              {store.categories.length > 0 && (
                <div className="mt-4 space-y-2 border-t border-[#E2E8F0] pt-3">
                  {store.categories.map(category => (
                    <div key={category.id} className="flex items-center justify-between gap-3 text-[11px]">
                      <span className="truncate text-[#5F6875]">{category.name} <span className="text-[#9AA2AF]">· {category.items}</span></span>
                      <span className="font-extrabold text-[#1E2229]">{money(category.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </details>
          ))}
        </div>
      </section>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <section className="bento-card overflow-hidden">
          <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
            <div><h2 className="text-[14px] font-extrabold text-[#1E2229]">Priorité d’ouverture</h2><p className="text-[11px] text-[#8B93A1]">Échéance, avancement et besoins</p></div>
            <span className="bento-chip !py-1 !text-[10px]">{priorityData.length} magasins</span>
          </div>
          <div className="px-5 pb-5 overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="bento-th">Magasin</th><th className="bento-th">Ouverture</th><th className="bento-th">Échéance</th><th className="bento-th">Avancement</th><th className="bento-th">Besoins</th><th className="bento-th">Signal</th></tr></thead>
              <tbody>
                {priorityData.length === 0 && <tr><td colSpan={6} className="bento-td text-center text-muted py-8">Aucun magasin dans le périmètre</td></tr>}
                {priorityData.map(store => {
                  const dayValue = Number(store.days);
                  const late = Number.isFinite(dayValue) && dayValue < 0;
                  const urgent = Number.isFinite(dayValue) && dayValue <= 14;
                  const dayText = !Number.isFinite(dayValue) ? 'À définir' : late ? `Retard ${Math.abs(dayValue)} j` : `J-${dayValue}`;
                  const tone = ['on_track', 'ready', 'ouvert'].includes(store.status) ? '#0E7A5F' : store.status === 'at_risk' ? '#D8A441' : '#E05A4F';
                  return (
                    <tr key={store.id} className="hover:bg-white/50">
                      <td className="bento-td font-bold text-[#1E2229]"><Link to={`/stores/${store.id}`} className="hover:text-[#0E7A5F]">{store.name}</Link></td>
                      <td className="bento-td whitespace-nowrap">{store.opening_date ? dateFR(store.opening_date) : '—'}</td>
                      <td className="bento-td"><span className="bento-chip !py-1 !text-[10px]" style={{ background: `${tone}18`, borderColor: 'transparent', color: tone }}>{dayText}</span></td>
                      <td className="bento-td"><div className="flex items-center gap-2 min-w-[120px]"><MiniBar value={store.progress} tone={tone} /><b className="text-[11px] w-9 text-right">{store.progress}%</b></div></td>
                      <td className="bento-td font-semibold">{store.count}</td>
                      <td className="bento-td"><span className="bento-chip !py-1 !text-[10px]" style={{ background: `${tone}18`, borderColor: 'transparent', color: tone }}>{STATUS_LABELS_FR[store.status] || store.status}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bento-card overflow-hidden">
          <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
            <div><h2 className="text-[14px] font-extrabold text-[#1E2229]">Budget : engagé vs disponible</h2><p className="text-[11px] text-[#8B93A1]">Montants HT par magasin</p></div>
            <span className="bento-chip !py-1 !text-[10px]">HT</span>
          </div>
          <div className="px-5 pb-5 overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="bento-th">Magasin</th><th className="bento-th">Budget</th><th className="bento-th">Engagé</th><th className="bento-th">Disponible</th><th className="bento-th">Utilisation</th></tr></thead>
              <tbody>
                {budgetData.length === 0 && <tr><td colSpan={5} className="bento-td text-center text-muted py-8">Aucun budget dans le périmètre</td></tr>}
                {budgetData.map(row => {
                  const engagedPct = row.budget > 0 ? Math.min(100, Math.round((row.engaged / row.budget) * 100)) : row.over > 0 ? 100 : 0;
                  const overPct = row.budget > 0 ? Math.min(100, Math.round((row.over / row.budget) * 100)) : 0;
                  const availablePct = Math.max(0, 100 - engagedPct - overPct);
                  return (
                    <tr key={row.id} className="hover:bg-white/50">
                      <td className="bento-td font-bold text-[#1E2229]"><Link to={`/stores/${row.id}`} className="hover:text-[#0E7A5F]">{row.name}</Link></td>
                      <td className="bento-td whitespace-nowrap">{money(row.budget)}</td>
                      <td className="bento-td font-bold text-[#0E7A5F] whitespace-nowrap">{money(row.engaged)}</td>
                      <td className="bento-td whitespace-nowrap">{money(row.available)}{row.over > 0 && <div className="text-[#E05A4F] font-bold">+ {money(row.over)} dépassés</div>}</td>
                      <td className="bento-td"><div className="flex items-center gap-2 min-w-[120px]"><div className="flex h-2 flex-1 overflow-hidden rounded-full bg-[#EEF1F6]"><div className="bg-[#0E7A5F]" style={{ width: `${engagedPct}%` }} /><div className="bg-[#E05A4F]" style={{ width: `${overPct}%` }} /><div className="bg-[#D8A441]" style={{ width: `${availablePct}%` }} /></div><b className="text-[11px] w-9 text-right">{engagedPct}%</b></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <section className="bento-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="text-[14px] font-extrabold text-[#1E2229]">Ancienneté des validations</h2><p className="text-[11px] text-[#8B93A1]">Demandes en attente par étape et ancienneté</p></div>
            <span className="bento-chip !py-1 !text-[10px]">Escalade</span>
          </div>
          <div className="h-[270px] pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agingData} margin={{ top: 10, right: 18, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,.18)" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#9AA2AF' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 14, border: '1px solid #F1E4C8', fontSize: 11 }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                {STAGES.map(stage => <Bar key={stage} dataKey={stage} name={STAGE_LABELS[stage]} stackId="stage" fill={STAGE_COLORS[stage]} radius={stage === 'pending_dg' ? [5, 5, 0, 0] : undefined} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="bento-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="text-[14px] font-extrabold text-[#1E2229]">Risques par magasin</h2><p className="text-[11px] text-[#8B93A1]">Criticité calculée : gravité × probabilité</p></div>
            <span className="bento-chip !py-1 !text-[10px]">{risks.length} ouverts</span>
          </div>
          <div className="h-[270px] pt-2">
            {riskData.length === 0 ? (
              <div className="grid h-full place-items-center text-[12px] text-[#8B93A1]">Aucun risque ouvert</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={riskData} margin={{ top: 10, right: 18, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,.18)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#9AA2AF' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 14, border: '1px solid #F1E4C8', fontSize: 11 }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="Critique" stackId="risk" fill="#E05A4F" radius={[5, 5, 0, 0]} />
                  <Bar dataKey="Élevé" stackId="risk" fill="#D8A441" />
                  <Bar dataKey="Modéré" stackId="risk" fill="#7FB69A" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </div>

      <section className="bento-card mb-5 p-5">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="text-[14px] font-extrabold text-[#1E2229]">Avancement réel dans le temps</h2><p className="text-[11px] text-[#8B93A1]">Progression réelle des projets</p></div>
          <span className="bento-chip !py-1 !text-[10px]">6 derniers mois</span>
        </div>
        <div className="h-[260px] pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ top: 10, right: 18, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="dashboardBentoProgress" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#FFF3D6" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="#D8A441" stopOpacity={0.3} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,.18)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9AA2AF' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#9AA2AF' }} axisLine={false} tickLine={false} unit="%" />
              <Tooltip contentStyle={{ borderRadius: 14, border: '1px solid #F1E4C8', fontSize: 11 }} />
              <Area type="monotone" dataKey="progress" name="Avancement réel" stroke="#0E7A5F" fill="url(#dashboardBentoProgress)" strokeWidth={3} dot={{ r: 4, fill: '#fff', stroke: '#0E7A5F', strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="bento-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="text-[14px] font-extrabold text-[#1E2229]">Pipeline des besoins</h2><p className="text-[11px] text-[#8B93A1]">Conversion de chaque étape de la checklist</p></div>
            <span className="bento-chip !py-1 !text-[10px]">{kpis.items_total} besoins</span>
          </div>
          <div className="mt-4 space-y-3">
            {smart.pipeline.map((step, index) => {
              const pct = kpis.items_total ? Math.round((step.count / kpis.items_total) * 100) : 0;
              return (
                <div key={step.key}>
                  <div className="flex justify-between text-[11px]"><span className="text-[#8B93A1]">{step.label}</span><b className="text-[#1E2229]">{step.count} <span className="font-normal text-[#8B93A1]">· {pct}%</span></b></div>
                  <div className="mt-1.5"><MiniBar value={pct} tone={index === 0 ? '#D8A441' : '#0E7A5F'} /></div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="bento-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="text-[14px] font-extrabold text-[#1E2229]">Risques & retards</h2><p className="text-[11px] text-[#8B93A1]">Points de vigilance par magasin</p></div>
            <span className="bento-chip !py-1 !text-[10px]">{risks.length + lateTasks.length} alertes</span>
          </div>
          <div className="mt-4 space-y-2">
            {risks.length === 0 && lateTasks.length === 0 && <div className="py-8 text-center text-[12px] text-[#8B93A1]">Aucun risque ni retard signalé</div>}
            {risks.slice(0, 4).map(risk => (
              <Link key={`risk-${risk.id}`} to={risk.url} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-white/60">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#FDECEA] text-[#E05A4F]"><AlertTriangle size={15} /></div>
                <div className="min-w-0 flex-1"><div className="truncate text-[12px] font-bold text-[#1E2229]">{risk.title}</div><div className="text-[10.5px] text-[#8B93A1]">{risk.store_name} · {risk.severity || 'risque'} {risk.due_date ? `· ${dateFR(risk.due_date)}` : ''}</div></div>
                <ArrowRight size={14} className="shrink-0 text-[#8B93A1]" />
              </Link>
            ))}
            {lateTasks.slice(0, 3).map(task => (
              <Link key={`task-${task.id}`} to={task.url} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-white/60">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#FFF3D6] text-[#B8862F]"><CalendarClock size={15} /></div>
                <div className="min-w-0 flex-1"><div className="truncate text-[12px] font-bold text-[#1E2229]">{task.title}</div><div className="text-[10.5px] text-[#8B93A1]">{task.store_name} · échéance {dateFR(task.end_date)} · {task.progress || 0}%</div></div>
                <ArrowRight size={14} className="shrink-0 text-[#8B93A1]" />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
