import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, Plus, Layers, ArrowRight, AlertTriangle, CheckCircle2 } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, CardHead, PageHeader, Field, Modal, Tabs, DecisionModal, ErrorBox, money } from '../components/ui';
import TaxPanel from '../components/TaxPanel';

const NEXT = {
  brouillon: ['soumis_cdg'],
  soumis_cdg: ['soumis_dd', 'corrige'],
  soumis_dd: ['soumis_dg', 'corrige'],
  soumis_dg: ['approuve', 'corrige'],
  corrige: ['soumis_cdg'],
  approuve: [],
};

const TRANSITION_ROLES = {
  brouillon: { soumis_cdg: ['IT', 'MG', 'RMG'] },
  corrige: { soumis_cdg: ['IT', 'MG', 'RMG'] },
  soumis_cdg: { soumis_dd: ['CDG', 'CG'], corrige: ['CDG', 'CG'] },
  soumis_dd: { soumis_dg: ['DD'], corrige: ['DD'] },
  soumis_dg: { approuve: ['DG'], corrige: ['DG'] },
};

const LABELS = {
  brouillon: 'Brouillon', soumis_cdg: 'Soumis CDG', soumis_dd: 'Soumis DD',
  soumis_dg: 'Soumis DG', approuve: 'Approuvé', corrige: 'Correction',
};

const ACTION_LABELS = {
  soumis_cdg: 'Envoyer à CDG',
  soumis_dd: 'Valider → DD',
  soumis_dg: 'Valider → DG',
  approuve: 'Approuver DG',
  corrige: 'Demander correction',
};

const num = value => Number(value) || 0;
const dateFR = value => value ? new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function Budget({ embedded = false, fixedStoreId = null }) {
  const { can, user } = useAuth();
  const [tab, setTab] = useState('overview');
  const [budgets, setBudgets] = useState([]);
  const [lots, setLots] = useState([]);
  const [stores, setStores] = useState([]);
  const [orders, setOrders] = useState([]);
  const [demands, setDemands] = useState([]);
  const [storeId, setStoreId] = useState(fixedStoreId ? String(fixedStoreId) : '');
  const [selectedId, setSelectedId] = useState('');
  const [versions, setVersions] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ store_id: fixedStoreId ? String(fixedStoreId) : '', lot_label: '', label: '', amount: '' })
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [decision, setDecision] = useState(null);
  const [busy, setBusy] = useState(false);
  const scopeStoreId = fixedStoreId ? String(fixedStoreId) : storeId;

  const load = () => {
    const query = scopeStoreId ? `?store_id=${scopeStoreId}` : '';
    api.get(`/operations/budgets${query}`).then(r => {
      setBudgets(r.data);
      setSelectedId(current => current && r.data.some(b => String(b.id) === String(current)) ? current : (r.data[0] ? String(r.data[0].id) : ''));
    }).catch(setError);
    api.get('/operations/lots').then(r => setLots(r.data)).catch(() => {});
    api.get('/stores').then(r => setStores(r.data)).catch(() => {});
    api.get('/operations/purchase_orders').then(r => setOrders(r.data)).catch(() => {});
    api.get(`/demands${query}`).then(r => setDemands(r.data)).catch(() => {});
  };

  useEffect(() => { load(); }, [storeId, fixedStoreId]);

  useEffect(() => {
    if (!selectedId) { setVersions([]); return; }
    api.get('/governance/budget-versions', { params: { budget_id: selectedId } })
      .then(r => setVersions(r.data)).catch(() => setVersions([]));
  }, [selectedId]);

  const rows = useMemo(() => budgets.map(b => {
    const initial = num(b.amount);
    const revised = b.revised_amount === null || b.revised_amount === undefined ? initial : num(b.revised_amount);
    const scopedOrders = orders.filter(o => String(o.store_id) === String(b.store_id) && (!b.lot_id || String(o.lot_id) === String(b.lot_id)));
    const orderedQuoteIds = new Set(scopedOrders.map(o => o.quote_id).filter(Boolean).map(String));
    const reserved = demands
      .filter(d => d.status === 'approved' && String(d.store_id) === String(b.store_id) && (!b.lot_id || String(d.lot_id) === String(b.lot_id)))
      .filter(d => !(d.quotes || []).some(q => orderedQuoteIds.has(String(q.id))))
      .reduce((sum, d) => sum + num(d.amount), 0);
    const engaged = scopedOrders.reduce((sum, o) => sum + num(o.amount), 0) + reserved;
    const available = revised - engaged;
    const alerts = [];
    if (available < 0) alerts.push('Dépassement');
    if (b.state === 'corrige') alerts.push('Correction demandée');
    if (revised > initial) alerts.push('Montant révisé');
    if ((NEXT[b.state] || []).length === 0 && b.state !== 'approuve') alerts.push('Étape bloquée');
    return { ...b, initial, revised, engaged, available, alerts };
  }), [budgets, orders, demands]);

  async function transition(id, to, reason = '') {
    setError(''); setNotice(''); setBusy(true);
    try {
      await api.post(`/operations/budgets/${id}/transition`, { to, reason });
      setNotice(`Budget transité : ${LABELS[to] || to}`);
      setDecision(null);
      load();
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }

  function requestTransition(budget, to) {
    if (to === 'corrige') setDecision({ id: budget.id, to, title: budget.label });
    else transition(budget.id, to);
  }

  async function confirmDecision(reason) {
    if (!decision) return;
    await transition(decision.id, decision.to, reason);
  }

  async function create(e) {
    e.preventDefault(); setError(''); setNotice('');
    try {
      await api.post('/operations/budgets', {
        store_id: scopeStoreId || form.store_id,
        lot_label: form.lot_label || null,
        label: form.label,
        amount: num(form.amount),
      });
      setOpen(false);
      setForm({ store_id: scopeStoreId || '', lot_label: '', label: '', amount: '' });
      setNotice('Budget créé');
      load();
    } catch (e) { setError(e); }
  }

  const storeName = id => stores.find(s => String(s.id) === String(id))?.name || '—';
  const lotName = id => lots.find(l => String(l.id) === String(id))?.name || '';
  const selected = budgets.find(b => String(b.id) === String(selectedId));

  return (
    <>
      {!embedded && <PageHeader title="Budgets" subtitle="Suivi des montants initiaux, révisions, engagements et étapes de validation" actions={
        <>
          <select className="input !py-2 !text-[12px] w-56" value={storeId} onChange={e => setStoreId(e.target.value)}>
            <option value="">Tous les magasins</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {can('view_budget') && scopeStoreId && <Link className="btn-ghost" to={`/stores/${scopeStoreId}?tab=budget`}><Layers size={16} /> Vue catégories</Link>}
          {can('edit_budget') && <button className="btn-primary" onClick={() => { setForm({ store_id: storeId, lot_label: '', label: '', amount: '' }); setOpen(true); }}><Plus size={16} /> Réviser le budget</button>}
        </>
      } />}
      {embedded && can('edit_budget') && <div className="mb-4 flex justify-end"><button className="btn-primary" onClick={() => { setForm({ store_id: scopeStoreId, lot_label: '', label: '', amount: '' }); setOpen(true); }}><Plus size={16} /> Réviser le budget</button></div>}
      <ErrorBox error={error} />
      {notice && <div className="mb-4 rounded-lg bg-emerald-50 text-emerald-700 text-[12px] font-semibold px-4 py-3">{notice}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <Card className="p-4"><div className="text-[11px] font-semibold text-muted">Budgets</div><div className="text-2xl font-extrabold mt-1">{rows.length}</div></Card>
        <Card className="p-4"><div className="text-[11px] font-semibold text-muted">Montant initial</div><div className="text-2xl font-extrabold mt-1">{money(rows.reduce((s, r) => s + r.initial, 0))}</div></Card>
        <Card className="p-4"><div className="text-[11px] font-semibold text-muted">Engagé</div><div className="text-2xl font-extrabold mt-1">{money(rows.reduce((s, r) => s + r.engaged, 0))}</div></Card>
        <Card className="p-4"><div className="text-[11px] font-semibold text-muted">Disponible</div><div className="text-2xl font-extrabold mt-1 text-emerald-600">{money(rows.reduce((s, r) => s + r.available, 0))}</div></Card>
      </div>

      {!embedded && <TaxPanel className="mb-5" title="Fiscalité des budgets" subtitle="Ventilation HT / TVA / TTC, TVA récupérable et coût net d’investissement"
        amountHt={rows.reduce((sum, row) => sum + row.revised, 0)} />}

      <Card className="overflow-hidden">
        <Tabs className="px-4 pt-2 bg-canvas/60" value={tab}
          onChange={id => setTab(id)}
          tabs={[
            { id: 'overview', label: "Vue d'ensemble", icon: Wallet, count: rows.length },
            { id: 'versions', label: 'Versions', icon: Layers, count: versions.length },
          ]} />
        <div className="px-5 pb-5 pt-5">
          {tab === 'overview' ? (
            <>
              {rows.length === 0 ? <div className="py-10 text-center text-muted text-[12px]">Aucun budget</div> : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead><tr>
                      <th className="th">Libellé</th><th className="th">Magasin / Zone</th>
                      <th className="th">Initial</th><th className="th">Révisé</th>
                      <th className="th">Engagé</th><th className="th">Disponible</th>
                      <th className="th">État</th><th className="th">Alertes</th><th className="th">Transitions</th>
                    </tr></thead>
                    <tbody>
                      {rows.map(b => (
                        <tr key={b.id} className="hover:bg-canvas/60">
                          <td className="td"><div className="font-bold text-[12px]">{b.label}</div><div className="text-[10.5px] text-muted">Rév. {b.revision || 1} · {dateFR(b.created_at)}</div></td>
                          <td className="td text-[11.5px]"><div>{storeName(b.store_id)}</div><div className="text-muted">{lotName(b.lot_id)}</div></td>
                          <td className="td text-[11.5px]">{money(b.initial)}</td>
                          <td className="td text-[11.5px] font-bold">{money(b.revised)}</td>
                          <td className="td text-[11.5px]">{money(b.engaged)}</td>
                          <td className={`td text-[11.5px] font-extrabold ${b.available < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{money(b.available)}</td>
                          <td className="td"><span className={`badge !text-[10px] ${b.state === 'approuve' ? 'badge-ok' : b.state === 'corrige' ? 'badge-bad' : 'badge-warn'}`}>{LABELS[b.state] || b.state}</span></td>
                          <td className="td">
                            <div className="flex flex-wrap gap-1">
                              {b.alerts.length === 0 && <span className="inline-flex items-center gap-1 text-[10.5px] text-emerald-600"><CheckCircle2 size={12} /> Aucune</span>}
                              {b.alerts.map(a => <span key={a} className="badge-bad !text-[9.5px]"><AlertTriangle size={10} /> {a}</span>)}
                            </div>
                          </td>
                          <td className="td">
                            <div className="flex flex-wrap gap-1.5">
                              {(NEXT[b.state] || [])
                                .filter(to => (TRANSITION_ROLES[b.state]?.[to] || []).includes(user?.role))
                                .map(to => (
                                <button key={to} className={`btn-ghost !py-1 !px-2 !text-[10.5px] ${to === 'corrige' ? 'text-red-600' : ''}`} onClick={() => requestTransition(b, to)}>
                                  {ACTION_LABELS[to] || LABELS[to] || to} <ArrowRight size={11} />
                                </button>
                              ))}
                              <button className="btn-ghost !py-1 !px-2 !text-[10.5px]" onClick={() => { setSelectedId(String(b.id)); setTab('versions'); }}>Versions</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <CardHead title="Historique des versions" subtitle="Chaque révision conservée avec montant, état et motif" right={
                <select className="input !py-2 !text-[12px] w-64" value={selectedId} onChange={e => setSelectedId(e.target.value)}>
                  <option value="">Choisir un budget…</option>
                  {budgets.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                </select>
              } />
              {!selected ? <div className="py-8 text-center text-muted text-[12px]">Sélectionnez un budget</div> : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead><tr><th className="th">Révision</th><th className="th">Montant</th><th className="th">État</th><th className="th">Auteur</th><th className="th">Motif</th><th className="th">Date</th></tr></thead>
                    <tbody>
                      {versions.length === 0 && <tr><td colSpan="6" className="td text-center text-muted text-[12px] py-8">Aucune version enregistrée</td></tr>}
                      {versions.map(v => (
                        <tr key={v.id} className="hover:bg-canvas/60">
                          <td className="td font-bold">v{v.revision}</td>
                          <td className="td text-[11.5px]">{money(v.amount)}</td>
                          <td className="td text-[11.5px]">{LABELS[v.state] || v.state || '—'}</td>
                          <td className="td text-[11.5px]">{v.changed_by_name || '—'}</td>
                          <td className="td text-[11px] text-muted">{v.reason || '—'}</td>
                          <td className="td text-[11px] text-muted">{dateFR(v.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Révision du budget" wide>
        <form onSubmit={create} className="grid md:grid-cols-2 gap-4">
          {!fixedStoreId && <Field label="Magasin"><select className="input" value={form.store_id} onChange={e => setForm(f => ({ ...f, store_id: e.target.value }))} required><option value="">Choisir…</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
          <Field label="Zone / chantier (libre)"><input className="input" value={form.lot_label} onChange={e => setForm(f => ({ ...f, lot_label: e.target.value }))} placeholder="Ex. Électricité, façade, mobilier…" /></Field>
          <Field label="Libellé" className="md:col-span-2"><input className="input" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="Ex. Budget ouverture 2026" required /></Field>
          <Field label="Montant initial (MAD)"><input type="number" step="0.01" className="input" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required /></Field>
          <div className="md:col-span-2 flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Annuler</button><button className="btn-primary">Enregistrer la révision</button></div>
        </form>
      </Modal>

      <DecisionModal open={!!decision} onClose={() => setDecision(null)} title={decision?.title} busy={busy} onConfirm={confirmDecision} />
    </>
  );
}
