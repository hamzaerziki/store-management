import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Download, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PageHeader, Card, CardHead, Field, Modal, Tabs, ErrorBox, Empty, StatusBadge, ProgressBar, money, dateFR } from '../components/ui';
import useSessionState from '../hooks/useSessionState';

const PAGE_SIZE = 10;

const STATUS_TABS = [
  { id: 'all', label: 'Tous' },
  { id: 'on_track', label: 'En bonne voie' },
  { id: 'at_risk', label: 'À risque' },
  { id: 'en_retard', label: 'En retard' },
  { id: 'ready', label: 'Prêts' },
  { id: 'ouvert', label: 'Ouvert' },
];

const COLUMNS = [
  { key: 'code', label: 'Code' },
  { key: 'year', label: 'Année' },
  { key: 'brand', label: 'Enseigne' },
  { key: 'city', label: 'Ville' },
  { key: 'owner', label: 'Responsable' },
  { key: 'computed_status', label: 'Statut' },
  { key: 'opening_date', label: 'Ouverture' },
  { key: 'progress', label: 'Progression' },
  { key: 'budget', label: 'Budget' },
];

const EMPTY_FORM = { name: '', code: '', brand: '', city: '', owner: '', opening_date: '', budget: '' };
const norm = value => String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export default function Portfolio() {
  const { can } = useAuth();
  const [stores, setStores] = useState([]);
  const [tab, setTab] = useSessionState('safari_portfolio_tab', 'all');
  const [search, setSearch] = useSessionState('safari_portfolio_search', '');
  const [brand, setBrand] = useSessionState('safari_portfolio_brand', '');
  const [city, setCity] = useSessionState('safari_portfolio_city', '');
  const [sort, setSort] = useSessionState('safari_portfolio_sort', { key: 'code', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

  const load = () => api.get('/stores').then(r => setStores(Array.isArray(r.data) ? r.data : [])).catch(setError);
  useEffect(() => { load(); }, []);

  const enriched = useMemo(() => stores.map(s => ({
    ...s,
    code: s.code || s.reference || `MG-${String(s.id).padStart(4, '0')}`,
    brand: s.brand || s.enseigne || s.name || '—',
    owner: s.owner || s.owner_name || s.responsable || '—',
    year: s.project_year || s.year || (s.opening_date ? new Date(s.opening_date).getFullYear() : null) || (s.created_at ? new Date(s.created_at).getFullYear() : null) || '—',
    computed_status: s.computed_status || s.status || 'planning',
    progress: Number(s.progress) || 0,
  })), [stores]);

  const brands = useMemo(() => [...new Set(enriched.map(s => s.brand))].sort((a, b) => String(a).localeCompare(String(b), 'fr')), [enriched]);
  const cities = useMemo(() => [...new Set(enriched.map(s => s.city).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'fr')), [enriched]);

  const filtered = useMemo(() => {
    const query = norm(search);
    const list = enriched.filter(s =>
      (tab === 'all' || s.computed_status === tab) &&
      (!brand || s.brand === brand) &&
      (!city || s.city === city) &&
      (!query || norm(`${s.code} ${s.brand} ${s.name} ${s.city} ${s.owner}`).includes(query))
    );
    const { key, dir } = sort;
    return list.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (typeof av === 'number' && typeof bv === 'number') return dir === 'asc' ? av - bv : bv - av;
      const cmp = String(av ?? '').localeCompare(String(bv ?? ''), 'fr', { numeric: true });
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [enriched, tab, brand, city, search, sort]);

  useEffect(() => { setPage(1); }, [tab, brand, city, search]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  function toggleSort(key) {
    setSort(previous => previous.key === key
      ? { key, dir: previous.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' });
  }

  function downloadCsv() {
    const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const header = ['Code', 'Année', 'Enseigne', 'Ville', 'Responsable', 'Statut', 'Date ouverture', 'Créé le', 'Progression', 'Budget'];
    const lines = filtered.map(s => [
      s.code, s.year, s.brand, s.city, s.owner, s.computed_status,
      s.opening_date, s.created_at, `${s.progress}%`, s.budget,
    ].map(escape).join(';'));
    const csv = '\uFEFF' + [header.map(escape).join(';'), ...lines].join('\r\n');
    const url = window.URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `portefeuille-magasins-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  async function create(event) {
    event.preventDefault();
    setError('');
    try {
      await api.post('/stores', { ...form, budget: form.budget === '' ? 0 : Number(form.budget) });
      setOpen(false);
      setForm(EMPTY_FORM);
      load();
    } catch (e) { setError(e); }
  }

  return (
    <>
      <PageHeader title="Portefeuille magasins" subtitle="Vue filtrable et exportable de tous les points de vente Safari" actions={
        <>
          <button className="btn-ghost" onClick={downloadCsv}><Download size={15} /> Exporter CSV</button>
          {can('manage_stores') && <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Nouveau magasin</button>}
        </>
      } />
      <ErrorBox error={error} />

      <Card className="mb-5 overflow-hidden">
        <Tabs value={tab} onChange={setTab} className="px-4 pt-2 bg-canvas/60" tabs={STATUS_TABS.map(item => ({
          ...item,
          count: item.id === 'all' ? enriched.length : enriched.filter(s => s.computed_status === item.id).length,
        }))} />
        <div className="px-5 pb-4 pt-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input !pl-9" placeholder="Rechercher par code, enseigne, ville, responsable…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input w-full sm:w-48" value={brand} onChange={e => setBrand(e.target.value)}>
            <option value="">Toutes les enseignes</option>
            {brands.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="input w-full sm:w-40" value={city} onChange={e => setCity(e.target.value)}>
            <option value="">Toutes les villes</option>
            {cities.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHead title="Liste des magasins" subtitle={`${filtered.length} magasin(s) · tri sur ${COLUMNS.find(c => c.key === sort.key)?.label}`} />
        {rows.length === 0 ? <Empty text="Aucun magasin ne correspond aux filtres sélectionnés" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[1180px]">
            <thead><tr>
              {COLUMNS.map(column => (
                <th key={column.key} className="th">
                  <button type="button" onClick={() => toggleSort(column.key)} className="flex items-center gap-1 hover:text-emerald-600">
                    {column.label}
                    <ArrowUpDown size={12} className={sort.key === column.key ? 'text-emerald-600' : 'text-muted'} />
                  </button>
                </th>
              ))}
            </tr></thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.id} className="hover:bg-canvas/60">
                  <td className="td font-extrabold text-[12px]"><Link to={`/stores/${s.id}`} className="hover:text-emerald-600">{s.code}</Link></td>
                  <td className="td text-muted text-[11.5px]">{s.year}</td>
                  <td className="td"><Link to={`/stores/${s.id}`} className="font-bold text-[12px] hover:text-emerald-600">{s.brand}</Link></td>
                  <td className="td text-[11.5px]">{s.city || '—'}</td>
                  <td className="td text-[11.5px]">{s.owner}</td>
                  <td className="td"><StatusBadge status={s.computed_status} /></td>
                  <td className="td text-[11px] text-muted">
                    <div>{dateFR(s.opening_date)}</div>
                    <div className="text-[10px]">Créé {dateFR(s.created_at)}</div>
                  </td>
                  <td className="td">
                    <div className="flex items-center gap-2 min-w-[110px]">
                      <ProgressBar value={s.progress} tone={(s.computed_status === 'late' || s.computed_status === 'en_retard') ? 'red' : s.computed_status === 'at_risk' ? 'gold' : 'green'} />
                      <span className="text-[11px] font-bold w-9 text-right">{s.progress}%</span>
                    </div>
                  </td>
                  <td className="td font-bold text-[12px] text-emerald-700">{money(s.budget)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-line text-[11.5px] text-muted">
          <span>Page {current} sur {pages} · {(current - 1) * PAGE_SIZE + (rows.length ? 1 : 0)}–{(current - 1) * PAGE_SIZE + rows.length} sur {filtered.length}</span>
          <div className="flex gap-2">
            <button className="btn-ghost !py-1.5 disabled:opacity-40" disabled={current <= 1} onClick={() => setPage(current - 1)}><ChevronLeft size={14} /> Précédent</button>
            <button className="btn-ghost !py-1.5 disabled:opacity-40" disabled={current >= pages} onClick={() => setPage(current + 1)}>Suivant <ChevronRight size={14} /></button>
          </div>
        </div>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Nouveau magasin" wide>
        <form onSubmit={create} className="grid md:grid-cols-2 gap-4">
          <Field label="Nom du magasin" className="md:col-span-2">
            <input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="Safari Tanger Centre" />
          </Field>
          <Field label="Code"><input className="input" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="MG-0012" /></Field>
          <Field label="Enseigne"><input className="input" value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} placeholder="Sandro, Maje, Lacoste…" /></Field>
          <Field label="Ville"><input className="input" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} required /></Field>
          <Field label="Responsable"><input className="input" value={form.owner} onChange={e => setForm({ ...form, owner: e.target.value })} /></Field>
          <Field label="Date d'ouverture"><input type="date" className="input" value={form.opening_date} onChange={e => setForm({ ...form, opening_date: e.target.value })} required /></Field>
          <Field label="Budget prévisionnel (MAD)"><input type="number" className="input" value={form.budget} onChange={e => setForm({ ...form, budget: e.target.value })} /></Field>
          <div className="md:col-span-2 flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Annuler</button>
            <button className="btn-primary">Créer le magasin</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
