import { useEffect, useMemo, useState } from 'react';
import { useDataRefresh } from '../hooks/useDataRefresh';
import { ShoppingCart, FileText, CalendarClock, Plus, ArrowRight } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, CardHead, PageHeader, Field, Modal, Tabs, ErrorBox, money } from '../components/ui';

const LABELS = {
  brouillon: 'Brouillon', commande: 'Commandé', recu: 'Reçu', clos: 'Clos', suspendu: 'Suspendu',
  a_faire: 'À faire', en_cours: 'En cours', terminee: 'Terminée', draft: 'Brouillon',
  approved: 'Approuvé', rejected: 'Rejeté',
};

const num = value => Number(value) || 0;
const dateFR = value => value ? new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const kindOf = row => /avenant/i.test(row.reference || '') ? 'Avenant' : /contrat/i.test(row.reference || '') ? 'Contrat' : 'Commande';

const EMPTY_ORDER = { store_id: '', lot_label: '', supplier_id: '', quote_id: '', reference: '', amount: '', ordered_at: '', planned_date: '' };
const EMPTY_AMEND = { reference: '', amount: '', justification: '', change_request_id: '' };

export default function Engagements({ embedded = false, fixedStoreId = null }) {
  const { can } = useAuth();
  const [tab, setTab] = useState('orders');
  const [orders, setOrders] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [stores, setStores] = useState([]);
  const [changeRequests, setChangeRequests] = useState([]);
  const [amendments, setAmendments] = useState([]);
  const [storeId, setStoreId] = useState(fixedStoreId ? String(fixedStoreId) : '');
  const [supplierId, setSupplierId] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [amendTarget, setAmendTarget] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_ORDER, store_id: fixedStoreId ? String(fixedStoreId) : '' });
  const [amendForm, setAmendForm] = useState(EMPTY_AMEND);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const scopeStoreId = fixedStoreId ? String(fixedStoreId) : storeId;
  const withStore = path => scopeStoreId ? `${path}${path.includes('?') ? '&' : '?'}store_id=${scopeStoreId}` : path;

  const load = () => {
    api.get(withStore('/operations/purchase_orders')).then(r => setOrders(r.data)).catch(setError);
    api.get(withStore('/operations/planning_tasks')).then(r => setTasks(r.data)).catch(() => {});
    api.get(withStore('/operations/budgets')).then(r => setBudgets(r.data)).catch(() => {});
    api.get('/suppliers').then(r => setSuppliers(r.data)).catch(() => {});
    api.get(withStore('/quotes')).then(r => setQuotes(r.data)).catch(() => {});
    api.get('/stores').then(r => setStores(r.data)).catch(() => {});
    api.get(withStore('/governance/change-requests')).then(r => setChangeRequests(r.data)).catch(() => {});
  };

  useEffect(() => { load(); }, [scopeStoreId]);
  useDataRefresh(load, []);

  const lots = useMemo(() => {
    const seen = new Set();
    return budgets.filter(b => b.lot_id && !seen.has(String(b.lot_id)) && seen.add(String(b.lot_id)))
      .map(b => ({ id: b.lot_id, name: b.lot_name || '', store_id: b.store_id }));
  }, [budgets]);

  const shownOrders = orders.filter(o =>
    (!scopeStoreId || String(o.store_id) === String(scopeStoreId))
    && (!supplierId || String(o.supplier_id) === String(supplierId))
    && (!search || `${o.reference || ''} ${suppliers.find(s => String(s.id) === String(o.supplier_id))?.name || ''}`.toLowerCase().includes(search.toLowerCase()))
  );
  const shownTasks = tasks.filter(t => !scopeStoreId || String(t.store_id) === String(scopeStoreId));
  const storeName = id => stores.find(s => String(s.id) === String(id))?.name || '—';
  const supplierName = id => suppliers.find(s => String(s.id) === String(id))?.name || '—';
  const quoteLabel = id => {
    const q = quotes.find(item => String(item.id) === String(id));
    return q ? (q.reference || q.supplier_name || `Devis #${q.id}`) : (id ? `Devis #${id}` : '—');
  };
  const amendCount = id => amendments.filter(a => String(a.purchase_order_id) === String(id)).length;

  async function create(e) {
    e.preventDefault(); setError(''); setNotice('');
    try {
      await api.post('/operations/purchase_orders', {
        store_id: scopeStoreId || form.store_id,
        lot_label: form.lot_label || null,
        supplier_id: form.supplier_id || null,
        quote_id: form.quote_id || null,
        reference: form.reference,
        amount: num(form.amount),
        ordered_at: form.ordered_at || null,
        planned_date: form.planned_date || null,
      });
      setOpen(false); setForm({ ...EMPTY_ORDER, store_id: scopeStoreId || '' }); setNotice('Bon de commande créé'); load();
    } catch (e) { setError(e); }
  }

  function openAmend(order) {
    setAmendTarget(order);
    setAmendForm({ ...EMPTY_AMEND, reference: `${order.reference || 'PO'}-AV${amendCount(order.id) + 1}` });
  }

  async function createAmend(e) {
    e.preventDefault(); setError(''); setNotice('');
    try {
      const { data } = await api.post(`/governance/purchase-orders/${amendTarget.id}/amendments`, {
        reference: amendForm.reference,
        amount: num(amendForm.amount),
        justification: amendForm.justification || null,
        change_request_id: amendForm.change_request_id || null,
      });
      setAmendments(list => [data, ...list]);
      setNotice('Avenant enregistré · révision de la commande mise à jour');
      setAmendTarget(null); setAmendForm(EMPTY_AMEND); load();
    } catch (e) { setError(e); }
  }

  return (
    <>
      {!embedded && <PageHeader title="Bons de commande" subtitle="Commandes, contrats, avenants et échéancier des engagements" actions={
        <>
          <select className="input !py-2 !text-[12px] w-52" value={storeId} onChange={e => setStoreId(e.target.value)}>
            <option value="">Tous les magasins</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="input !py-2 !text-[12px] w-52" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
            <option value="">Tous les fournisseurs</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {can('manage_operations') && <button className="btn-primary" onClick={() => { setForm({ ...EMPTY_ORDER, store_id: storeId }); setOpen(true); }}><Plus size={16} /> Nouveau bon de commande</button>}
        </>
      } />}
      {embedded && <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
        <select className="input !py-2 !text-[12px] w-52" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
          <option value="">Tous les fournisseurs</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {can('manage_operations') && <button className="btn-primary" onClick={() => { setForm({ ...EMPTY_ORDER, store_id: scopeStoreId }); setOpen(true); }}><Plus size={16} /> Nouveau bon de commande</button>}
      </div>}
      <ErrorBox error={error} />
      {notice && <div className="mb-4 rounded-lg bg-emerald-50 text-emerald-700 text-[12px] font-semibold px-4 py-3">{notice}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <Card className="p-4"><div className="text-[11px] font-semibold text-muted">Bons de commande</div><div className="text-2xl font-extrabold mt-1">{shownOrders.length}</div></Card>
        <Card className="p-4"><div className="text-[11px] font-semibold text-muted">Montant engagé</div><div className="text-2xl font-extrabold mt-1">{money(shownOrders.reduce((s, o) => s + num(o.amount), 0))}</div></Card>
        <Card className="p-4"><div className="text-[11px] font-semibold text-muted">Avenants</div><div className="text-2xl font-extrabold mt-1">{amendments.length + changeRequests.filter(c => c.state === 'approved').length}</div></Card>
        <Card className="p-4"><div className="text-[11px] font-semibold text-muted">Tâches planifiées</div><div className="text-2xl font-extrabold mt-1">{shownTasks.length}</div></Card>
      </div>

      <Card className="overflow-hidden">
        <Tabs className="px-4 pt-2 bg-canvas/60" value={tab} onChange={setTab} tabs={[
          { id: 'orders', label: 'Bons de commande', icon: ShoppingCart, count: shownOrders.length },
          { id: 'amendments', label: 'Avenants', icon: FileText, count: amendments.length + changeRequests.length },
          { id: 'planning', label: 'Planning', icon: CalendarClock, count: shownTasks.length },
        ]} />
        <div className="px-5 pb-5 pt-5">
          {tab === 'orders' && (
            <>
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="flex items-center gap-2 border border-line rounded-lg px-3 py-2 max-w-md flex-1 min-w-[220px]">
                  <input className="outline-none text-[12.5px] w-full" placeholder="Rechercher une référence…" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
              </div>
              {shownOrders.length === 0 ? <div className="py-10 text-center text-muted text-[12px]">Aucun bon de commande</div> : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead><tr>
                      <th className="th">Référence</th><th className="th">Type</th><th className="th">Source devis</th>
                      <th className="th">Fournisseur</th><th className="th">Montant</th><th className="th">Échéance</th>
                      <th className="th">État</th><th className="th">Révision</th><th className="th">Actions</th>
                    </tr></thead>
                    <tbody>
                      {shownOrders.map(o => (
                        <tr key={o.id} className="hover:bg-canvas/60">
                          <td className="td"><div className="font-bold text-[12px]">{o.reference || `PO-${o.id}`}</div><div className="text-[10.5px] text-muted">{storeName(o.store_id)} · {dateFR(o.ordered_at)}</div></td>
                          <td className="td text-[11.5px]">{kindOf(o)}</td>
                          <td className="td text-[11.5px]">{quoteLabel(o.quote_id)}</td>
                          <td className="td text-[11.5px]">{supplierName(o.supplier_id)}</td>
                          <td className="td font-extrabold text-[12px]">{money(o.amount)}</td>
                          <td className="td text-[11.5px]">{dateFR(o.planned_date)}</td>
                          <td className="td"><span className={`badge !text-[10px] ${['clos', 'recu'].includes(o.state) ? 'badge-ok' : o.state === 'suspendu' ? 'badge-bad' : 'badge-warn'}`}>{LABELS[o.state] || o.state || 'Brouillon'}</span></td>
                          <td className="td text-[11.5px]">v{num(o.revision) || 1}</td>
                          <td className="td">
                            <div className="flex flex-wrap gap-1.5">
                              {can('manage_operations') && <button className="btn-ghost !py-1 !px-2 !text-[10.5px]" onClick={() => openAmend(o)}>+ Avenant</button>}
                              <button className="btn-ghost !py-1 !px-2 !text-[10.5px]" onClick={() => { setTab('planning'); }}>Planning <ArrowRight size={11} /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {tab === 'amendments' && (
            <div className="space-y-6">
              <CardHead title="Avenants enregistrés" subtitle="Référence, montant, justification et demande de changement liée" right={
                can('manage_operations') && orders.length > 0 && <button className="btn-ghost !py-1.5" onClick={() => openAmend(orders[0])}><Plus size={14} /> Ajouter un avenant</button>
              } />
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr><th className="th">Commande</th><th className="th">Référence avenant</th><th className="th">Montant</th><th className="th">Justification</th><th className="th">Demande de changement</th><th className="th">Date</th></tr></thead>
                  <tbody>
                    {amendments.length === 0 && <tr><td colSpan="6" className="td text-center text-muted text-[12px] py-6">Aucun avenant enregistré dans cette session</td></tr>}
                    {amendments.map(a => (
                      <tr key={a.id} className="hover:bg-canvas/60">
                        <td className="td text-[11.5px]">{orders.find(o => String(o.id) === String(a.purchase_order_id))?.reference || `#${a.purchase_order_id}`}</td>
                        <td className="td font-bold text-[11.5px]">{a.reference}</td>
                        <td className="td text-[11.5px] font-extrabold">{money(a.amount)}</td>
                        <td className="td text-[11px] text-muted">{a.justification || '—'}</td>
                        <td className="td text-[11px]">{changeRequests.find(c => String(c.id) === String(a.change_request_id))?.title || (a.change_request_id ? `#${a.change_request_id}` : '—')}</td>
                        <td className="td text-[11px] text-muted">{dateFR(a.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <CardHead title="Demandes de changement" subtitle="Source des avenants : décisions enregistrées" />
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr><th className="th">Intitulé</th><th className="th">Magasin</th><th className="th">Montant</th><th className="th">Décision</th><th className="th">Date</th></tr></thead>
                  <tbody>
                    {changeRequests.length === 0 && <tr><td colSpan="5" className="td text-center text-muted text-[12px] py-6">Aucune demande de changement</td></tr>}
                     {changeRequests.filter(c => !scopeStoreId || String(c.store_id) === String(scopeStoreId)).map(c => (
                      <tr key={c.id} className="hover:bg-canvas/60">
                        <td className="td text-[11.5px] font-bold">{c.title}</td>
                        <td className="td text-[11.5px]">{c.store_name || storeName(c.store_id)}</td>
                        <td className="td text-[11.5px]">{money(c.amount)}</td>
                        <td className="td"><span className={`badge !text-[10px] ${c.state === 'approved' ? 'badge-ok' : c.state === 'rejected' ? 'badge-bad' : 'badge-warn'}`}>{LABELS[c.state] || c.state}</span></td>
                        <td className="td text-[11px] text-muted">{dateFR(c.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'planning' && (
            <>
              <CardHead title="Échéancier des engagements" subtitle="Tâches de planning liées aux zones" />
              {shownTasks.length === 0 ? <div className="py-10 text-center text-muted text-[12px]">Aucune tâche planifiée</div> : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead><tr><th className="th">Tâche</th><th className="th">Magasin</th><th className="th">Début</th><th className="th">Fin</th><th className="th">Responsable</th><th className="th">Montant</th><th className="th">État</th></tr></thead>
                    <tbody>
                      {shownTasks.map(t => (
                        <tr key={t.id} className="hover:bg-canvas/60">
                          <td className="td font-bold text-[11.5px]">{t.title}</td>
                          <td className="td text-[11.5px]">{storeName(t.store_id)}</td>
                          <td className="td text-[11px]">{dateFR(t.start_date)}</td>
                          <td className="td text-[11px]">{dateFR(t.end_date)}</td>
                          <td className="td text-[11.5px]">{t.owner_role || '—'}</td>
                          <td className="td text-[11.5px]">{money(t.amount)}</td>
                          <td className="td"><span className="badge-muted !text-[10px]">{LABELS[t.state] || t.state}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Nouveau bon de commande" wide>
        <form onSubmit={create} className="grid md:grid-cols-2 gap-4">
          {!fixedStoreId && <Field label="Magasin"><select className="input" value={form.store_id} onChange={e => setForm(f => ({ ...f, store_id: e.target.value }))} required><option value="">Choisir…</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
          <Field label="Zone / chantier (libre)"><input className="input" value={form.lot_label} onChange={e => setForm(f => ({ ...f, lot_label: e.target.value }))} placeholder="Ex. Câblage, climatisation…" /></Field>
          <Field label="Fournisseur"><select className="input" value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}><option value="">Choisir…</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Devis source"><select className="input" value={form.quote_id} onChange={e => setForm(f => ({ ...f, quote_id: e.target.value }))}><option value="">Aucun</option>{quotes.filter(q => !scopeStoreId || String(q.store_id) === String(scopeStoreId)).map(q => <option key={q.id} value={q.id}>{q.reference || `Devis #${q.id}`} — {q.supplier_name || '—'}</option>)}</select></Field>
          <Field label="Référence"><input className="input" value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="Ex. CMD-2026-014" required /></Field>
          <Field label="Montant (MAD)"><input type="number" step="0.01" className="input" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required /></Field>
          <Field label="Date de commande"><input type="date" className="input" value={form.ordered_at} onChange={e => setForm(f => ({ ...f, ordered_at: e.target.value }))} /></Field>
          <Field label="Échéance prévue"><input type="date" className="input" value={form.planned_date} onChange={e => setForm(f => ({ ...f, planned_date: e.target.value }))} /></Field>
          <div className="md:col-span-2 flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Annuler</button><button className="btn-primary">Enregistrer le bon de commande</button></div>
        </form>
      </Modal>

      <Modal open={!!amendTarget} onClose={() => setAmendTarget(null)} title={`Avenant — ${amendTarget?.reference || ''}`} wide>
        <form onSubmit={createAmend} className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Référence de l'avenant"><input className="input" value={amendForm.reference} onChange={e => setAmendForm(f => ({ ...f, reference: e.target.value }))} required /></Field>
            <Field label="Montant (MAD)"><input type="number" step="0.01" className="input" value={amendForm.amount} onChange={e => setAmendForm(f => ({ ...f, amount: e.target.value }))} required /></Field>
          </div>
          <Field label="Demande de changement"><select className="input" value={amendForm.change_request_id} onChange={e => setAmendForm(f => ({ ...f, change_request_id: e.target.value }))}><option value="">Aucune</option>{changeRequests.map(c => <option key={c.id} value={c.id}>{c.title} — {LABELS[c.state] || c.state}</option>)}</select></Field>
          <Field label="Justification"><textarea className="input min-h-[90px]" value={amendForm.justification} onChange={e => setAmendForm(f => ({ ...f, justification: e.target.value }))} placeholder="Motif de l'avenant…" /></Field>
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={() => setAmendTarget(null)}>Annuler</button><button className="btn-primary">Enregistrer l'avenant</button></div>
        </form>
      </Modal>
    </>
  );
}
