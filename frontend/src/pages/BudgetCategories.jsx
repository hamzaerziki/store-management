import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Building2, ChevronRight, CircleDollarSign, ClipboardList, GitBranch, Layers, Plus, RefreshCcw, SlidersHorizontal, TrendingUp, Users, Wallet } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, CardHead, PageHeader, Field, Modal, ErrorBox, ExecutionStatusSelect, StatusBadge, money, dateFR } from '../components/ui';

const DEPARTMENTS = [
  { id: 'IT', label: 'IT', color: '#0E7A5F', soft: '#E8F6F1', icon: Layers },
  { id: 'MG', label: 'MG', color: '#B8862F', soft: '#FBF3E2', icon: Building2 },
];

function Metric({ icon: Icon, label, value, tone = '#0E7A5F', danger = false }) {
  return (
    <div className="rounded-2xl border border-line/70 bg-white/80 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9.5px] font-bold uppercase tracking-wide text-muted">{label}</span>
        <Icon size={14} style={{ color: danger ? '#D14B4B' : tone }} />
      </div>
      <div className={`mt-2 text-[14px] font-black ${danger ? 'text-red-600' : 'text-ink'}`}>{value}</div>
    </div>
  );
}

export default function BudgetCategories({ embedded = false, fixedStoreId = null }) {
  const { can, user } = useAuth();
  const [data, setData] = useState(null);
  const [storeId, setStoreId] = useState(fixedStoreId ? String(fixedStoreId) : '');
  const [department, setDepartment] = useState('ALL');
  const [selected, setSelected] = useState(null);
  const [supplierId, setSupplierId] = useState('');
  const [supplierDemands, setSupplierDemands] = useState([]);
  const [supplierError, setSupplierError] = useState('');
  const [openCategory, setOpenCategory] = useState(false);
  const [categoryForm, setCategoryForm] = useState({ name: '', department: 'MG', owner_role: 'MG', planned_amount: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const effectiveStoreId = fixedStoreId ? String(fixedStoreId) : storeId;
  const shellClass = embedded ? 'budget-shell mb-5 rounded-3xl p-5' : 'budget-shell';

  const load = (nextStoreId = effectiveStoreId) => {
    setError('');
    api.get(`/category-budgets${nextStoreId ? `?store_id=${nextStoreId}` : ''}`)
      .then(r => {
        setData(r.data);
        if (!fixedStoreId && !storeId && r.data.store) setStoreId(String(r.data.store.id));
      })
      .catch(setError);
  };

  useEffect(() => { load(); }, [fixedStoreId]);

  const supplierOptions = useMemo(() => {
    const map = new Map();
    (data?.categories || []).forEach(c => (c.suppliers || []).forEach(s => {
      if (!map.has(String(s.id))) map.set(String(s.id), s);
    }));
    return Array.from(map.values()).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [data]);

  const canTrackExecution = ['admin', 'IT', 'MG', 'CG', 'CDG', 'DD', 'DG'].includes(user?.role);

  useEffect(() => {
    setSupplierError('');
    if (!supplierId || !effectiveStoreId) { setSupplierDemands([]); return; }
    api.get('/demands', { params: { store_id: effectiveStoreId, supplier_id: supplierId } })
      .then(r => setSupplierDemands(r.data))
      .catch(e => { setSupplierDemands([]); setSupplierError(e?.message || 'Chargement impossible'); });
  }, [supplierId, effectiveStoreId]);

  const departmentRows = useMemo(() => DEPARTMENTS.map(meta => {
    const apiRow = (data?.departments || []).find(row => row.department === meta.id);
    const rows = (data?.categories || []).filter(row => row.department === meta.id);
    const planned = Number(apiRow?.planned_amount ?? rows.reduce((sum, row) => sum + Number(row.planned_amount || 0), 0));
    const used = Number(apiRow?.used_amount ?? rows.reduce((sum, row) => sum + Number(row.used_amount || 0), 0));
    return {
      ...meta,
      planned_amount: planned,
      used_amount: used,
      approved_demand_count: Number(apiRow?.approved_demand_count || 0),
      allocated_budget: Number(apiRow?.allocated_budget || 0),
      available_amount: Math.round((Number(apiRow?.allocated_budget || 0) - used) * 100) / 100,
      category_count: rows.length,
    };
  }), [data]);

  const activeDepartment = departmentRows.find(row => row.id === department);
  const categories = useMemo(() => {
    if (!data) return [];
    return department === 'ALL' ? data.categories : data.categories.filter(c => c.department === department);
  }, [data, department]);

  const selectedCategory = data?.categories.find(c => String(c.id) === String(selected));
  const selectedLines = (data?.lines || []).filter(l => String(l.category_id) === String(selected));

  const totals = useMemo(() => {
    const planned = (data?.categories || []).reduce((sum, c) => sum + Number(c.planned_amount || 0), 0);
    const used = departmentRows.reduce((sum, d) => sum + Number(d.used_amount || 0), 0);
    const allPlanned = departmentRows.reduce((sum, d) => sum + Number(d.planned_amount || 0), 0);
    return {
      planned,
      used,
      storeBudget: Number(data?.total_budget || 0),
      unallocated: Math.round((Number(data?.total_budget || 0) - planned) * 100) / 100,
      planningPct: planned ? Math.min(100, Math.round(used / planned * 100)) : 0,
      allocatedPct: allPlanned ? Math.min(100, Math.round(planned / allPlanned * 100)) : 0,
    };
  }, [data, departmentRows]);

  async function createCategory(e) {
    e.preventDefault(); setError(''); setNotice('');
    try {
      await api.post('/category-budgets/categories', categoryForm);
      setOpenCategory(false);
      setCategoryForm({ name: '', department: 'MG', owner_role: 'MG', planned_amount: '' });
      setNotice('Catégorie ajoutée (visible sur tous les magasins)');
      load();
    } catch (e) { setError(e); }
  }

  function chooseDepartment(id) {
    setDepartment(id);
    setSelected(null);
  }

  function updateSupplierDemand(updated) {
    setSupplierDemands(current => current.map(row => row.id === updated.id ? { ...row, ...updated } : row));
  }

  function focusSupplier(supplier) {
    setSupplierId(String(supplier.id));
    document.getElementById('suivi-prestataire')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (error) return <div className={shellClass}><ErrorBox error={error} /></div>;
  if (!data) return <div className={shellClass}><div className="bento-card p-6 text-[12px] text-muted">Chargement du budget catégories…</div></div>;

  return (
    <div className={shellClass}>
      {!embedded && <PageHeader
        eyebrow="Budget"
        title="Budget par catégorie"
        subtitle="Magasin → IT / MG → catégories → articles. La consommation est comptée après validation DG ; les demandes rejetées n'impactent pas le budget."
        actions={can('manage_catalog') && <button className="bento-btn bento-btn-primary" onClick={() => setOpenCategory(true)}><Plus size={15} /> Nouvelle catégorie</button>}
      />}

      <div className="mb-5 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
        <div className="min-w-0">
          <div className="bento-chip mb-2"><GitBranch size={13} /> Budget en branches</div>
          <h3 className="text-[18px] font-extrabold text-ink">IT / MG → catégories → articles</h3>
          <p className="mt-1 text-[12px] text-muted">Cliquez sur une branche pour voir son budget, ses catégories et la consommation DG.</p>
        </div>
        {can('manage_catalog') && <div className="flex justify-start xl:justify-end"><button className="bento-btn bento-btn-primary" onClick={() => setOpenCategory(true)}><Plus size={15} /> Nouvelle catégorie</button></div>}
      </div>

      {notice && <div className="bento-card mb-4 border-emerald-200 bg-emerald-50/70 p-3 text-[12px] font-semibold text-emerald-800">{notice}</div>}

      <div className="bento-card mb-5 p-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="bento-chip"><Wallet size={14} /> Enveloppe magasin</div>
              <button className="bento-chip !py-1 !text-[9px]" onClick={() => load()} title="Recalculer depuis les demandes approuvées"><RefreshCcw size={11} /> Recalculer</button>
            </div>
            <div className="mt-2 text-[16px] font-black text-ink">{!embedded ? (
              <select className="bento-select !text-[14px]" value={storeId} onChange={e => { setStoreId(e.target.value); setSelected(null); chooseDepartment('ALL'); load(e.target.value); }}>
                {(data.stores || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : data.store?.name || 'Magasin'}</div>
            <div className="mt-1 text-[11px] text-muted">Répartition par département et suivi de la consommation</div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric icon={Wallet} label="Budget magasin" value={money(totals.storeBudget)} />
            <Metric icon={ClipboardList} label="Prévu catégories" value={money(totals.planned)} tone="#B8862F" />
            <Metric icon={TrendingUp} label="Consommé DG" value={money(totals.used)} />
            <Metric icon={CircleDollarSign} label="Non réparti" value={money(totals.unallocated)} danger={totals.unallocated < 0} />
          </div>
        </div>
        <div className="bento-track mt-4"><span style={{ width: `${totals.planningPct}%` }} /></div>
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-[10.5px] text-muted">
          <span>{totals.planningPct} % du prévu consommé</span>
          <span>{totals.allocatedPct} % de l’enveloppe répartie entre IT et MG</span>
        </div>

      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-[13px] font-extrabold text-ink">Branches du magasin</h4>
          <p className="text-[10.5px] text-muted">Deux budgets distincts, chacun relié à ses catégories.</p>
        </div>
        {department !== 'ALL' && <button className="bento-btn !py-1.5 !px-3 !text-[10.5px]" onClick={() => chooseDepartment('ALL')}><ArrowLeft size={12} /> Toutes les branches</button>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {departmentRows.map(dept => {
          const Icon = dept.icon;
          const isActive = department === dept.id;
          const usedPct = dept.allocated_budget ? Math.min(100, Math.round(dept.used_amount / dept.allocated_budget * 100)) : 0;
          const sharePct = totals.storeBudget ? Math.round(dept.allocated_budget / totals.storeBudget * 100) : 0;
          return (
            <button key={dept.id} className={`bento-card relative overflow-hidden p-5 text-left transition ${isActive ? 'ring-2 ring-emerald-500' : 'hover:-translate-y-0.5 hover:shadow-lg'}`} onClick={() => chooseDepartment(isActive ? 'ALL' : dept.id)}>
              <span className="absolute inset-x-0 top-0 h-1" style={{ background: dept.color }} />
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: dept.soft, color: dept.color }}><Icon size={18} /></span>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.14em] text-muted">Branche {dept.id}</div>
                    <div className="text-[15px] font-black text-ink">Budget {dept.label}</div>
                  </div>
                </div>
                <ChevronRight size={17} className={`mt-1 transition ${isActive ? 'rotate-90 text-emerald-600' : 'text-muted'}`} />
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <div><div className="text-[10px] text-muted">Budget attribué</div><div className="text-[14px] font-black text-ink">{money(dept.allocated_budget)}</div></div>
                <div><div className="text-[10px] text-muted">Prévu catégories</div><div className="text-[14px] font-black text-ink">{money(dept.planned_amount)}</div></div>
                <div><div className="text-[10px] text-muted">Consommé DG</div><div className="text-[14px] font-black" style={{ color: dept.color }}>{money(dept.used_amount)}</div></div>
                <div><div className="text-[10px] text-muted">Disponible</div><div className={`text-[14px] font-black ${dept.available_amount >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{money(dept.available_amount)}</div></div>
              </div>
              <div className="bento-track mt-4"><span style={{ width: `${usedPct}%`, background: dept.color }} /></div>
              <div className="mt-2 text-[10px] text-muted">{dept.category_count} catégorie(s) · {dept.approved_demand_count || 0} demande(s) approuvée(s) DG · {usedPct} % consommé · {sharePct} % de l’enveloppe magasin</div>
            </button>
          );
        })}
      </div>

      {activeDepartment && (
        <>
          <div className="bento-card mt-5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-[11px] font-bold text-muted">
                  <span>Magasin</span><ChevronRight size={12} /><span style={{ color: activeDepartment.color }}>{activeDepartment.id}</span>
                </div>
                <h4 className="mt-2 text-[17px] font-black text-ink">Budget {activeDepartment.id} — {activeDepartment.category_count} catégories</h4>
                <p className="mt-1 text-[11px] text-muted">Le budget attribué est la part de l’enveloppe magasin affectée à cette branche.</p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl px-4 py-3" style={{ background: activeDepartment.soft }}>
                  <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: activeDepartment.color }}>Budget {activeDepartment.id}</div>
                  <div className="mt-1 text-[15px] font-black text-ink">{money(activeDepartment.allocated_budget)}</div>
                </div>
                <div className="rounded-xl border border-line/70 bg-white/70 px-4 py-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Prévu</div>
                  <div className="mt-1 text-[15px] font-black text-ink">{money(activeDepartment.planned_amount)}</div>
                </div>
                <div className="rounded-xl border border-line/70 bg-white/70 px-4 py-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Consommé DG</div>
                  <div className="mt-1 text-[15px] font-black" style={{ color: activeDepartment.color }}>{money(activeDepartment.used_amount)}</div>
                </div>
                <div className="rounded-xl border border-line/70 bg-white/70 px-4 py-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Solde</div>
                  <div className={`mt-1 text-[15px] font-black ${activeDepartment.available_amount >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{money(activeDepartment.available_amount)}</div>
                </div>
              </div>
            </div>
          </div>

          <Card className="mt-5 overflow-hidden">
            <CardHead title={`Catégories ${activeDepartment.id}`} subtitle="Cliquez sur une catégorie pour afficher ses articles et prestataires" />
            <div className="p-5">
              <div className="border-l-2 pl-5" style={{ borderColor: `${activeDepartment.color}55` }}>
                <div className="space-y-3">
                  {categories.map(c => {
                    const pct = c.planned_amount ? Math.min(100, Math.round(c.used_amount / c.planned_amount * 100)) : 0;
                    const isActive = String(selected) === String(c.id);
                    return (
                      <div key={`${c.id}-${c.department}`} className="relative">
                        <span className="absolute -left-[27px] top-6 h-3 w-3 rounded-full border-2 border-white shadow" style={{ background: activeDepartment.color }} />
                        <button className={`w-full rounded-2xl border p-4 text-left transition ${isActive ? 'border-emerald-500 bg-emerald-50/60' : 'border-line bg-canvas/50 hover:border-emerald-300'}`} onClick={() => setSelected(isActive ? null : c.id)}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-[13px] font-black text-ink">{c.name}</div>
                              {c.items_included && <div className="mt-1 text-[10.5px] leading-snug text-muted">{c.items_included}</div>}
                              <div className="mt-1 text-[10px] font-bold" style={{ color: activeDepartment.color }}>{c.department} · {c.owner_role} · {c.demand_count} demande(s)</div>
                            </div>
                            <ChevronRight size={16} className={`mt-1 transition ${isActive ? 'rotate-90 text-emerald-600' : 'text-muted'}`} />
                          </div>
                          <div className="mt-4 grid grid-cols-2 gap-3 text-[11px] sm:grid-cols-4">
                            <div><div className="text-muted">Prévu</div><div className="font-black text-ink">{money(c.planned_amount)}</div></div>
                            <div><div className="text-muted">Consommé</div><div className="font-black" style={{ color: activeDepartment.color }}>{money(c.used_amount)}</div></div>
                            <div><div className="text-muted">Disponible</div><div className={`font-black ${c.available_amount >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{money(c.available_amount)}</div></div>
                            <div><div className="text-muted">Articles / prestataires</div><div className="font-black text-ink">{selectedLines.length && isActive ? selectedLines.length : 0} / {(c.suppliers || []).length}</div></div>
                          </div>
                          <div className="bento-track mt-3"><span style={{ width: `${pct}%`, background: activeDepartment.color }} /></div>
                          <div className="mt-2 text-[10px] text-muted">{pct} % consommé · {c.approved_demand_count || 0} demande(s) approuvée(s)</div>
                        </button>
                        {isActive && (
                          <div className="ml-4 mt-2 rounded-2xl border border-line bg-white/75 p-4">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <div className="text-[11px] font-black text-ink">Articles importés — {c.name}</div>
                              <div className="text-[10px] text-muted">{selectedLines.length} ligne(s)</div>
                            </div>
                            <div className="mb-4 flex flex-wrap gap-2">
                               {(c.suppliers || []).map(s => <button key={s.id} className={`bento-chip ${String(supplierId) === String(s.id) ? 'ring-2 ring-emerald-500' : ''}`} onClick={() => focusSupplier(s)}><Building2 size={13} /> {s.name} · {s.demand_count} demande(s) · {money(s.planned_amount)}</button>)}
                              {!c.suppliers?.length && <span className="text-[11px] text-muted">Aucun prestataire dans les demandes</span>}
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full">
                                <thead><tr><th className="bento-th">Article</th><th className="bento-th">Prestataire</th><th className="bento-th">Ligne</th><th className="bento-th">Montant HT</th></tr></thead>
                                <tbody>
                                  {selectedLines.map(l => <tr key={l.id} className="hover:bg-canvas/60">
                                    <td className="bento-td">{l.article}</td>
                                    <td className="bento-td">{l.supplier_name || '—'}</td>
                                    <td className="bento-td">{l.source_row || '—'}</td>
                                    <td className="bento-td font-bold">{money(l.amount_ht)}</td>
                                  </tr>)}
                                  {!selectedLines.length && <tr><td colSpan="4" className="bento-td text-center text-muted">Aucun article importé</td></tr>}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {categories.length === 0 && <div className="py-10 text-center text-[12px] text-muted">Aucune catégorie pour cette branche</div>}
                </div>
              </div>
            </div>
          </Card>
        </>
      )}

      {!activeDepartment && (
        <div className="bento-card mt-5 p-5 text-[12px] text-muted">
          Sélectionnez la branche <b className="text-ink">IT</b> ou <b className="text-ink">MG</b> pour afficher ses catégories, ses articles et la consommation du budget.
        </div>
      )}

      {can('view_demands') && <section id="suivi-prestataire" className="bento-card mt-5 scroll-mt-4 p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
          <div className="min-w-0">
            <div className="bento-chip mb-2"><Users size={13} /> Suivi par prestataire</div>
            <h3 className="text-[16px] font-extrabold text-ink">Toutes les demandes d’un prestataire</h3>
            <p className="mt-1 text-[11px] text-muted">Sélectionnez un prestataire pour afficher ses demandes dans ce magasin et suivre leur exécution.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2 lg:justify-end">
            <SlidersHorizontal size={14} className="mb-3 text-[#0E7A5F]" />
            <select className="bento-select min-w-[240px]" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
              <option value="">Choisir un prestataire…</option>
              {supplierOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {supplierId && <button className="bento-btn !py-2 !px-3 !text-[10.5px]" onClick={() => setSupplierId('')}>Effacer</button>}
          </div>
        </div>
        {supplierError && <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">{supplierError}</div>}
        {!supplierId && <div className="mt-4 rounded-xl border border-dashed border-line bg-canvas/40 px-4 py-5 text-center text-[11px] text-muted">
          Aucun prestataire sélectionné. Choisissez un prestataire ci-dessus ou cliquez sur un prestataire dans une catégorie.
        </div>}
        {supplierId && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="bento-th">Demande</th><th className="bento-th">Catégorie</th><th className="bento-th">Montant HT</th><th className="bento-th">Statut</th><th className="bento-th">Date</th><th className="bento-th min-w-[150px]">Exécution</th></tr></thead>
              <tbody>
                {supplierDemands.map(d => <tr key={d.id} className="hover:bg-canvas/60">
                  <td className="bento-td font-bold">{d.title}</td>
                  <td className="bento-td">{d.category_name || '—'}</td>
                  <td className="bento-td">{money(d.amount)}</td>
                  <td className="bento-td"><StatusBadge status={d.status} /></td>
                  <td className="bento-td">{dateFR(d.created_at)}</td>
                  <td className="bento-td"><ExecutionStatusSelect demand={d} disabled={!canTrackExecution} onChange={updateSupplierDemand} /></td>
                </tr>)}
                {supplierDemands.length === 0 && <tr><td colSpan="6" className="bento-td text-center text-muted">Aucune demande pour ce prestataire</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>}

      <Modal open={openCategory} onClose={() => setOpenCategory(false)} title="Nouvelle catégorie budgétaire" wide>
        <form className="space-y-5" onSubmit={createCategory}>
          <div className="grid gap-4 md:grid-cols-[1.5fr_1fr]">
            <Field label="Nom de la catégorie">
              <div className="relative">
                <Layers size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input className="bento-input !pl-9" value={categoryForm.name} onChange={e => setCategoryForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex. Signalétique événementielle" required />
              </div>
            </Field>
            <Field label="Budget prévu (MAD)">
              <div className="relative">
                <CircleDollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input type="number" step="0.01" className="bento-input !pl-9" value={categoryForm.planned_amount} onChange={e => setCategoryForm(f => ({ ...f, planned_amount: e.target.value }))} placeholder="0.00" />
              </div>
            </Field>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Branche">
              <select className="bento-select" value={categoryForm.department} onChange={e => setCategoryForm(f => ({ ...f, department: e.target.value, owner_role: e.target.value }))}>
                <option value="IT">IT — technologies et sécurité</option><option value="MG">MG — travaux et aménagement</option>
              </select>
            </Field>
            <Field label="Périmètre">
              <select className="bento-select" value={categoryForm.owner_role} onChange={e => setCategoryForm(f => ({ ...f, owner_role: e.target.value }))}>
                <option value="IT">IT</option><option value="MG">MG</option><option value="BOTH">Commun</option>
              </select>
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-line/70 pt-4"><button type="button" className="bento-btn" onClick={() => setOpenCategory(false)}>Annuler</button><button className="bento-btn bento-btn-primary">Créer la catégorie</button></div>
        </form>
      </Modal>
    </div>
  );
}
