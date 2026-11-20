import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, GitCompareArrows, Sparkles, Store as StoreIcon, Package, Layers, TrendingDown, Search, ArrowUpRight } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, CardHead, PageHeader, StatCard, StatusBadge, Modal, Field, ErrorBox, Tabs, DecisionProof, money, Empty, dateFR } from '../components/ui';

function scoreQuote(q, minAmount) {
  const amount = Number(q.amount_ttc) || 0;
  const priceScore = amount > 0 && minAmount > 0 ? Math.min(40, 40 * minAmount / amount) : 40;
  const reliabilityScore = (Number(q.reliability_score) || 3) * 8;
  const deliveryScore = Math.max(0, 12 - (Number(q.delivery_days) || 30) / 5);
  const warrantyScore = Math.min(10, (Number(q.warranty_months) || 0) / 6);
  return Math.round((priceScore + reliabilityScore + deliveryScore + warrantyScore) * 10) / 10;
}

const CHART_COLORS = ['#0e7a5f', '#e39b23', '#3b82f6', '#8b5cf6', '#e05a4f', '#14b8a6', '#64748b'];

function CrossStoreView({ matrix, search, setSearch, category, setCategory, categories, groups }) {
  const [selected, setSelected] = useState('');
  if (!matrix) return <Card><Empty text="Chargement du comparatif inter-magasins…" /></Card>;

  const covered = matrix.groups.filter(group => group.presence === matrix.stores.length).length;
  const opportunity = matrix.groups.reduce((sum, group) => sum + group.cells.reduce((cellSum, cell) =>
    cellSum + (cell && group.min_price > 0 && cell.price > group.min_price ? cell.price - group.min_price : 0), 0), 0);
  const spreadPct = matrix.groups.length
    ? Math.round(matrix.groups.reduce((sum, group) => sum + (group.min_price > 0 ? (group.spread / group.min_price) * 100 : 0), 0) / matrix.groups.length)
    : 0;
  const activeGroup = groups.find(group => group.name === selected) || groups[0] || null;
  const focusData = activeGroup ? matrix.stores.map((store, index) => {
    const cell = activeGroup.cells[index];
    return cell ? { name: store.city, price: cell.price, best: activeGroup.min_price > 0 && cell.price === activeGroup.min_price } : null;
  }).filter(Boolean) : [];
  const categoryTotals = {};
  matrix.groups.forEach(group => {
    const key = group.category || 'Autres';
    categoryTotals[key] = (categoryTotals[key] || 0) + group.avg_price * group.presence;
  });
  const categoryData = Object.entries(categoryTotals)
    .map(([name, value]) => ({ name, value: Math.round(value) }))
    .sort((a, b) => b.value - a.value);
  const topSpread = matrix.groups
    .filter(group => group.spread > 0)
    .sort((a, b) => b.spread - a.spread)
    .slice(0, 8)
    .map(group => ({ name: group.name.length > 20 ? `${group.name.slice(0, 19)}…` : group.name, spread: group.spread }));

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <StatCard label="Articles suivis" value={String(matrix.total_items).padStart(2, '0')} sub={`${matrix.groups.length} références uniques`} icon={Package} tint="emerald" />
        <StatCard label="Économie potentielle" value={money(opportunity)} sub="Si chaque magasin prenait le meilleur prix" icon={TrendingDown} tint="emerald" />
        <StatCard label="Écart moyen" value={`${spreadPct}%`} sub="Par rapport au meilleur prix" icon={Sparkles} tint="gold" />
        <StatCard label="Couverture complète" value={`${covered}/${matrix.groups.length}`} sub="Références dans les 7 magasins" icon={StoreIcon} tint="blue" />
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input !pl-9" placeholder="Rechercher un article…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input w-full sm:w-56" value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">Toutes les catégories</option>
          {categories.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>

      {groups.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <span className="text-[10px] font-extrabold uppercase tracking-wide text-muted py-1.5">Focus</span>
            {groups.slice(0, 10).map(group => (
              <button key={group.name} onClick={() => setSelected(group.name)} className={`chip ${activeGroup?.name === group.name ? 'chip-active' : ''}`}>{group.name}</button>
            ))}
          </div>

          <div className="grid lg:grid-cols-[1.4fr_1fr] gap-5 mb-5">
            <Card>
              <CardHead title="Prix par magasin" subtitle={activeGroup ? `${activeGroup.name} · meilleur ${money(activeGroup.min_price)}` : 'Prix retenu ou meilleur devis'} right={<StoreIcon size={16} className="text-muted" />} />
              <div className="h-[280px] px-3 pb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={focusData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={value => `${Math.round(value / 1000)}k`} />
                    <Tooltip formatter={value => money(value)} />
                    <Bar dataKey="price" radius={[6, 6, 0, 0]}>
                      {focusData.map((entry, index) => <Cell key={index} fill={entry.best ? '#16a37c' : '#e39b23'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <CardHead title="Budget par catégorie" subtitle="Prix moyen × magasins couverts" right={<Layers size={16} className="text-muted" />} />
              <div className="h-[280px] px-3 pb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                      {categoryData.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={value => money(value)} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {topSpread.length > 0 && (
            <Card className="mb-5">
              <CardHead title="Top écarts de prix" subtitle="Les références où négocier en priorité" right={<TrendingDown size={16} className="text-red-500" />} />
              <div className="h-[260px] px-3 pb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topSpread} layout="vertical" margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={value => `${Math.round(value / 1000)}k`} />
                    <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={value => money(value)} />
                    <Bar dataKey="spread" fill="#e05a4f" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </>
      )}

      <Card className="overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-sm font-extrabold">Matrice inter-magasins</h2>
          <p className="text-[11.5px] text-muted mt-0.5">Prix retenu ou meilleur devis par article · détail des statuts et fournisseurs</p>
        </div>
        {groups.length === 0 ? <Empty text="Aucun article ne correspond à cette recherche" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[1560px]">
            <thead><tr>
              <th className="th sticky left-0 bg-white z-10 min-w-[190px]">Article</th>
              <th className="th min-w-[130px]">Catégorie</th>
              {matrix.stores.map(store => <th key={store.id} className="th min-w-[190px] align-top">{store.name}<div className="font-normal text-[10px] text-muted mt-0.5">{store.city}</div></th>)}
              <th className="th min-w-[140px]">Écart / meilleur prix</th>
            </tr></thead>
            <tbody>
              {groups.map(group => (
                <tr key={group.name} className="hover:bg-canvas/60">
                  <td className="td sticky left-0 bg-white z-10">
                    <div className="font-bold">{group.name}</div>
                    <div className="text-[10px] text-muted mt-0.5">{group.presence}/{matrix.stores.length} magasins · {group.owner_role}</div>
                    {group.avg_price > 0 && <div className="text-[10px] text-muted">Moy. {money(group.avg_price)}</div>}
                  </td>
                  <td className="td text-muted text-[11px]">{group.category}</td>
                  {matrix.stores.map((store, index) => {
                    const cell = group.cells[index];
                    if (!cell) return <td key={store.id} className="td text-center text-muted">—</td>;
                    const isBest = group.min_price > 0 && cell.price === group.min_price;
                    const intensity = group.max_price > group.min_price && group.min_price > 0
                      ? (cell.price - group.min_price) / (group.max_price - group.min_price)
                      : 0;
                    const heat = isBest ? 'border-emerald-600/30 bg-emerald-600/10'
                      : intensity > 0.66 ? 'border-red-500/30 bg-red-500/10'
                        : intensity > 0.33 ? 'border-gold-500/30 bg-gold-500/10'
                          : 'border-line bg-white';
                    const barColor = isBest ? 'bg-emerald-600'
                      : intensity > 0.66 ? 'bg-red-500'
                        : intensity > 0.33 ? 'bg-gold-500'
                          : 'bg-blue-500';
                    return (
                      <td key={store.id} className="td align-top">
                        <div className={`p-2.5 rounded-xl border ${heat}`}>
                          <div className="flex items-center justify-between gap-2">
                            <b className={isBest ? 'text-emerald-600' : ''}>{money(cell.price)}</b>
                            {isBest && <span className="badge-ok !text-[8px]">Meilleur</span>}
                          </div>
                          <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden mt-2">
                            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.max(8, Math.round((cell.price / (group.max_price || 1)) * 100))}%` }} />
                          </div>
                          <div className="mt-1.5"><StatusBadge status={cell.status} /></div>
                          <div className="text-[10px] text-muted mt-1.5 truncate">{cell.supplier_name || 'Aucun devis'}</div>
                          <div className="text-[9.5px] text-muted mt-0.5">Qté {cell.quantity} · {cell.quotes_count} devis</div>
                          {(cell.delivery_days || cell.warranty_months) > 0 && <div className="text-[9.5px] text-muted mt-0.5">{cell.delivery_days || '—'} j · {cell.warranty_months || 0} mois</div>}
                          <div className="mt-1.5">
                            {cell.comparison_id
                              ? <Link to={`/comparisons/${cell.comparison_id}`} className="text-[10px] font-bold text-emerald-600 inline-flex items-center gap-0.5">Voir <ArrowUpRight size={10} /></Link>
                              : <Link to={`/stores/${cell.store_id}`} className="text-[10px] font-bold text-muted inline-flex items-center gap-0.5">Magasin <ArrowUpRight size={10} /></Link>}
                          </div>
                        </div>
                      </td>
                    );
                  })}
                  <td className="td align-top">
                    <div className="font-extrabold">{group.spread > 0 ? money(group.spread) : '—'}</div>
                    <div className="text-[10px] text-muted mt-1">
                      {group.best_store_ids.map(id => matrix.stores.find(store => store.id === id)?.city).filter(Boolean).join(', ') || '—'}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}

export default function Comparisons({ embedded = false, fixedStoreId = null }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('');
  const [view, setView] = useState(() => (!embedded && can('view_budget')) ? 'cross' : 'list');
  const [matrix, setMatrix] = useState(null);
  const [matrixSearch, setMatrixSearch] = useState('');
  const [matrixCategory, setMatrixCategory] = useState('');
  const [open, setOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoItem, setAutoItem] = useState('');
  const [autoBusy, setAutoBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ item_id: '', quote_ids: [], selected_quote_id: '', justification: '' });
  const scopeStoreId = fixedStoreId ? String(fixedStoreId) : '';
  const withStore = path => scopeStoreId ? `${path}${path.includes('?') ? '&' : '?'}store_id=${scopeStoreId}` : path;

  const load = () => api.get(withStore('/comparisons')).then(r => setRows(r.data)).catch(setError);
  useEffect(() => {
    load();
    api.get(withStore('/items')).then(r => setItems(r.data.filter(i => ['quotes_received', 'compared', 'to_quote'].includes(i.status)))).catch(() => {});
    api.get(withStore('/quotes')).then(r => setQuotes(r.data)).catch(() => {});
    if (!embedded && can('view_budget')) api.get('/comparisons/cross-store').then(r => setMatrix(r.data)).catch(() => {});
  }, [scopeStoreId]);

  const itemQuotes = quotes.filter(q => String(q.item_id) === String(form.item_id));
  const quotesFor = id => quotes.filter(q => String(q.item_id) === String(id));
  const autoItems = items.filter(i => (!scopeStoreId || String(i.store_id) === scopeStoreId) && quotesFor(i.id).length >= 2);
  const autoQuotes = quotesFor(autoItem)
    .map(q => ({ ...q, score: scoreQuote(q, Math.min(...quotesFor(autoItem).map(x => Number(x.amount_ttc) || 0))) }))
    .sort((a, b) => b.score - a.score);
  const scopedRows = rows.filter(r => !scopeStoreId || String(r.store_id) === scopeStoreId);
  const shown = scopedRows.filter(r =>
    (filter === 'active' ? ['pending_cdg', 'pending_dd', 'pending_dg'].includes(r.status)
      : filter === 'history' ? ['validated', 'rejected'].includes(r.status)
        : filter === '' || r.status === filter));
  const matrixCategories = [...new Set((matrix?.groups || []).map(group => group.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const matrixGroups = (matrix?.groups || []).filter(group =>
    (!matrixCategory || group.category === matrixCategory) &&
    (!matrixSearch || `${group.name} ${group.category}`.toLowerCase().includes(matrixSearch.toLowerCase()))
  );

  function toggleQuote(id) {
    setForm(f => {
      const has = f.quote_ids.includes(id);
      const quote_ids = has ? f.quote_ids.filter(x => x !== id) : [...f.quote_ids, id];
      return { ...f, quote_ids, selected_quote_id: has && f.selected_quote_id === id ? '' : f.selected_quote_id };
    });
  }

  async function create(e) {
    e.preventDefault(); setError('');
    try {
      await api.post('/comparisons', {
        item_id: Number(form.item_id), quote_ids: form.quote_ids.map(Number),
        selected_quote_id: form.selected_quote_id ? Number(form.selected_quote_id) : form.quote_ids[0],
        justification: form.justification,
      });
      setOpen(false); setForm({ item_id: '', quote_ids: [], selected_quote_id: '', justification: '' }); load();
    } catch (e) { setError(e); }
  }

  async function generateAuto() {
    if (!autoItem) return;
    setError(''); setAutoBusy(true);
    try {
      const { data } = await api.post('/comparisons/auto', { item_id: Number(autoItem) });
      setAutoOpen(false); setAutoItem('');
      navigate(`/comparisons/${data.id}`);
    } catch (e) { setError(e); }
    finally { setAutoBusy(false); }
  }

  async function submit(id) {
    try { await api.post(`/comparisons/${id}/submit`); load(); } catch (e) { setError(e); }
  }

  return (
    <>
      {!embedded && <PageHeader title="Comparatifs" subtitle="Comparaison des devis et circuit de validation" actions={
        can('manage_comparisons') && <>
          <button className="btn-ghost" onClick={() => setAutoOpen(true)}><Sparkles size={16} /> Comparatif automatique</button>
          <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Nouveau comparatif</button>
        </>
      } />}
      {embedded && can('manage_comparisons') && <div className="mb-4 flex justify-end gap-3">
        <button className="btn-ghost" onClick={() => setAutoOpen(true)}><Sparkles size={16} /> Comparatif automatique</button>
        <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Nouveau comparatif</button>
      </div>}
      <ErrorBox error={error} />
      {!embedded && can('view_budget') && (
        <div className="mb-5">
          <Tabs value={view} onChange={setView} tabs={[
            { id: 'list', label: 'Comparatifs', icon: GitCompareArrows },
            { id: 'cross', label: 'Comparatif entre magasins', icon: StoreIcon },
          ]} />
        </div>
      )}

      {view === 'cross' ? (
        <CrossStoreView
          matrix={matrix}
          search={matrixSearch}
          setSearch={setMatrixSearch}
          category={matrixCategory}
          setCategory={setMatrixCategory}
          categories={matrixCategories}
          groups={matrixGroups}
        />
      ) : (
        <>
          <div className="mb-5">
            <Tabs value={filter} onChange={setFilter} tabs={[
              { id: '', label: 'Tous', count: scopedRows.length },
              { id: 'active', label: 'À traiter', count: scopedRows.filter(r => ['pending_cdg', 'pending_dd', 'pending_dg'].includes(r.status)).length },
              { id: 'history', label: 'Historique', count: scopedRows.filter(r => ['validated', 'rejected'].includes(r.status)).length },
              { id: 'pending_cdg', label: 'Attente CDG' },
              { id: 'pending_dd', label: 'Attente DD' },
              { id: 'pending_dg', label: 'Attente DG' },
            ]} />
          </div>

          <Card className="overflow-hidden">
            {shown.length === 0 ? <Empty text="Aucun comparatif pour ce filtre" /> : (
              <div className="overflow-x-auto"><table className="w-full">
                <thead><tr><th className="th">Article</th><th className="th">Magasin</th><th className="th">Fournisseur retenu</th><th className="th">Montant</th><th className="th">Devis</th><th className="th">Statut</th><th className="th">Preuve</th><th className="th">Date</th><th className="th"></th></tr></thead>
                <tbody>
                  {shown.map(c => (
                    <tr key={c.id} className="hover:bg-canvas/60">
                      <td className="td font-bold"><Link to={`/comparisons/${c.id}`} className="hover:text-emerald-600">{c.item_name}</Link></td>
                      <td className="td text-muted">{c.store_name}</td>
                      <td className="td">{c.supplier_name || '—'}</td>
                      <td className="td font-bold text-emerald-600">{money(c.amount_ttc)}</td>
                      <td className="td text-muted">{c.quotes_count}</td>
                      <td className="td"><StatusBadge status={c.status} /></td>
                      <td className="td"><DecisionProof compact rows={c.decisions || []} /></td>
                      <td className="td text-muted text-[11px]">{dateFR(c.created_at)}</td>
                      <td className="td">{['draft', 'rejected'].includes(c.status) && can('manage_comparisons') && <button onClick={() => submit(c.id)} className="text-[11px] font-bold text-emerald-600">Soumettre</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </Card>
        </>
      )}

      <Modal open={autoOpen} onClose={() => setAutoOpen(false)} title="Comparatif automatique" wide>
        <div className="space-y-4">
          <Field label="Article à comparer automatiquement">
            <select className="input" value={autoItem} onChange={e => setAutoItem(e.target.value)}>
              <option value="">Choisir…</option>
              {autoItems.map(i => <option key={i.id} value={i.id}>{i.name} — {i.store_name} ({quotesFor(i.id).length} devis)</option>)}
            </select>
          </Field>
          {autoItems.length === 0 && <div className="text-[12px] text-muted">Aucun article ne dispose encore d’au moins 2 devis.</div>}
          {autoItem && (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full">
                <thead><tr><th className="th">Fournisseur</th><th className="th">TTC</th><th className="th">Délai</th><th className="th">Garantie</th><th className="th">Score</th></tr></thead>
                <tbody>
                  {autoQuotes.map((q, index) => (
                    <tr key={q.id} className={index === 0 ? 'bg-emerald-600/5' : ''}>
                      <td className="td font-bold">{q.supplier_name}{index === 0 && <span className="badge-ok ml-1 !text-[9px]">Recommandé</span>}</td>
                      <td className="td">{money(q.amount_ttc)}</td>
                      <td className="td">{q.delivery_days || '—'} j</td>
                      <td className="td">{q.warranty_months || 0} mois</td>
                      <td className="td font-extrabold text-emerald-600">{q.score.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-[11.5px] text-muted">Le système utilise tous les devis disponibles, calcule un score prix / délai / garantie / fiabilité et crée le tableau comparatif avec l’offre recommandée.</div>
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={() => setAutoOpen(false)}>Annuler</button><button className="btn-primary" onClick={generateAuto} disabled={!autoItem || autoBusy}><GitCompareArrows size={15} /> {autoBusy ? 'Génération…' : 'Générer le comparatif'}</button></div>
        </div>
      </Modal>

      <Modal open={open} onClose={() => setOpen(false)} title="Nouveau comparatif" wide>
        <form onSubmit={create} className="space-y-4">
          <Field label="Article à comparer"><select className="input" value={form.item_id} onChange={e => setForm({ ...form, item_id: e.target.value, quote_ids: [], selected_quote_id: '' })} required><option value="">Choisir…</option>{items.filter(i => !scopeStoreId || String(i.store_id) === scopeStoreId).map(i => <option key={i.id} value={i.id}>{i.name} — {i.store_name}</option>)}</select></Field>
          {form.item_id && (
            <div>
              <span className="label">Sélectionner au moins 2 devis</span>
              <div className="space-y-2 mt-1 max-h-52 overflow-auto rounded-xl border border-line p-3">
                {itemQuotes.length === 0 && <div className="text-[12px] text-muted">Aucun devis pour cet article.</div>}
                {itemQuotes.map(q => (
                  <label key={q.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-canvas cursor-pointer">
                    <input type="checkbox" checked={form.quote_ids.includes(q.id)} onChange={() => toggleQuote(q.id)} />
                    <div className="flex-1"><div className="text-[12px] font-bold">{q.supplier_name}</div><div className="text-[10.5px] text-muted">{q.delivery_days} j · Garantie {q.warranty_months} mois</div></div>
                    <div className="font-bold text-emerald-600 text-[12px]">{money(q.amount_ttc)}</div>
                  </label>
                ))}
              </div>
            </div>
          )}
          <Field label="Fournisseur recommandé"><select className="input" value={form.selected_quote_id} onChange={e => setForm({ ...form, selected_quote_id: e.target.value })}><option value="">Choisir…</option>{form.quote_ids.map(id => { const q = quotes.find(x => x.id === id); return q ? <option key={id} value={id}>{q.supplier_name} — {money(q.amount_ttc)}</option> : null; })}</select></Field>
          <Field label="Justification"><textarea rows="3" className="input" value={form.justification} onChange={e => setForm({ ...form, justification: e.target.value })} placeholder="Pourquoi cette offre est-elle recommandée ?" /></Field>
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Annuler</button><button className="btn-primary"><GitCompareArrows size={15} /> Créer le comparatif</button></div>
        </form>
      </Modal>
    </>
  );
}
