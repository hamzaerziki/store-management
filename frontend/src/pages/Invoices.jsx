import { useEffect, useMemo, useState } from 'react';
import { useDataRefresh } from '../hooks/useDataRefresh';
import { Receipt, CreditCard, FileText, Plus, Wallet } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Field, Modal, ErrorBox, money } from '../components/ui';

const LABELS = { recue: 'Reçue', verifiee: 'Vérifiée', payee: 'Payée', brouillon: 'Brouillon', annulee: 'Annulée' };
const num = value => Number(value) || 0;
const dateFR = value => value ? new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

const EMPTY_INVOICE = { store_id: '', lot_label: '', supplier_id: '', purchase_order_id: '', reference: '', amount_ht: '', amount_ttc: '', invoice_date: '', due_date: '' };
const EMPTY_PAYMENT = { invoice_id: '', amount: '', finance_reference: '', support_name: '', paid_at: '', method: 'Virement' };

function Kpi({ label, value, tone = '#0E7A5F' }) {
  return (
    <div className="bento-kpi !p-4">
      <div className="text-[10px] font-bold uppercase tracking-wide text-[#8B93A1]">{label}</div>
      <div className="mt-1 text-[18px] font-extrabold" style={{ color: tone }}>{value}</div>
    </div>
  );
}

export default function Invoices({ embedded = false, fixedStoreId = null }) {
  const { can } = useAuth();
  const [tab, setTab] = useState('invoices');
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [stores, setStores] = useState([]);
  const [storeId, setStoreId] = useState('');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [formInvoice, setFormInvoice] = useState({ ...EMPTY_INVOICE, store_id: fixedStoreId ? String(fixedStoreId) : '' });
  const [formPayment, setFormPayment] = useState(EMPTY_PAYMENT);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const scopeStoreId = fixedStoreId ? String(fixedStoreId) : storeId;
  const withStore = path => scopeStoreId ? `${path}${path.includes('?') ? '&' : '?'}store_id=${scopeStoreId}` : path;

  const load = () => {
    api.get(withStore('/operations/invoices')).then(r => setInvoices(r.data)).catch(setError);
    api.get(withStore('/operations/payments')).then(r => setPayments(r.data)).catch(() => {});
    api.get('/suppliers').then(r => setSuppliers(r.data)).catch(() => {});
    api.get(withStore('/operations/purchase_orders')).then(r => setOrders(r.data)).catch(() => {});
    api.get('/stores').then(r => setStores(r.data)).catch(() => {});
  };

  useEffect(() => { load(); }, [scopeStoreId]);
  useDataRefresh(load, []);

  const paidByInvoice = useMemo(() => payments.reduce((acc, p) => {
    const key = String(p.invoice_id);
    acc[key] = (acc[key] || 0) + num(p.amount);
    return acc;
  }, {}), [payments]);

  const balanceOf = inv => Math.max(0, num(inv.amount_ttc) - (paidByInvoice[String(inv.id)] || 0) - (inv.credit_note ? num(inv.amount_ttc) : 0));
  const supplierName = id => suppliers.find(s => String(s.id) === String(id))?.name || '-';
  const invoiceRef = id => invoices.find(i => String(i.id) === String(id))?.reference || `Facture #${id}`;
  const orderRef = id => orders.find(o => String(o.id) === String(id))?.reference || (id ? `#${id}` : '-');
  const storeName = id => stores.find(s => String(s.id) === String(id))?.name || '-';

  const filtered = invoices.filter(inv =>
    (!scopeStoreId || String(inv.store_id) === String(scopeStoreId))
    && (!search || `${inv.reference || ''} ${supplierName(inv.supplier_id)}`.toLowerCase().includes(search.toLowerCase()))
  );
  const normalInvoices = filtered.filter(i => !i.credit_note);
  const creditNotes = filtered.filter(i => i.credit_note);
  const filteredPayments = payments.filter(p => !scopeStoreId || String(invoices.find(i => String(i.id) === String(p.invoice_id))?.store_id) === String(scopeStoreId));

  async function createInvoice(e) {
    e.preventDefault(); setError(''); setNotice('');
    try {
      await api.post('/operations/invoices', {
        store_id: scopeStoreId || formInvoice.store_id,
        lot_label: formInvoice.lot_label || null,
        supplier_id: formInvoice.supplier_id || null,
        purchase_order_id: formInvoice.purchase_order_id || null,
        reference: formInvoice.reference,
        amount_ht: num(formInvoice.amount_ht),
        amount_ttc: num(formInvoice.amount_ttc),
        invoice_date: formInvoice.invoice_date || null,
        due_date: formInvoice.due_date || null,
      });
      setModal(null); setFormInvoice({ ...EMPTY_INVOICE, store_id: scopeStoreId || '' }); setNotice('Facture créée'); load();
    } catch (e) { setError(e); }
  }

  async function createPayment(e) {
    e.preventDefault(); setError(''); setNotice('');
    try {
      await api.post('/operations/payments', {
        invoice_id: formPayment.invoice_id,
        store_id: scopeStoreId || invoices.find(i => String(i.id) === String(formPayment.invoice_id))?.store_id || null,
        amount: num(formPayment.amount),
        finance_reference: formPayment.finance_reference || null,
        support_name: formPayment.support_name || null,
        paid_at: formPayment.paid_at || null,
        method: formPayment.method,
      });
      setModal(null); setFormPayment(EMPTY_PAYMENT); setNotice('Paiement enregistré'); load();
    } catch (e) { setError(e); }
  }

  const controlBadge = inv => inv.controlled_at || ['verifiee', 'payee'].includes(inv.state)
    ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-extrabold text-emerald-700">Contrôlée</span>
    : <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-extrabold text-amber-700">En attente</span>;

  const totalTtc = normalInvoices.reduce((s, i) => s + num(i.amount_ttc), 0);
  const totalPaid = filteredPayments.reduce((s, p) => s + num(p.amount), 0);
  const totalDue = normalInvoices.reduce((s, i) => s + balanceOf(i), 0);

  const tabs = [
    { id: 'invoices', label: 'Factures', icon: Receipt, count: normalInvoices.length },
    { id: 'payments', label: 'Paiements', icon: CreditCard, count: filteredPayments.length },
    { id: 'credits', label: 'Avoirs', icon: FileText, count: creditNotes.length },
  ];

  return (
    <div className={embedded ? '' : 'reporting-shell -mx-5 -mt-5 -mb-5 min-h-screen px-5 py-6 sm:-mx-7 sm:-mt-7 sm:-mb-7 sm:px-7'}>
      {!embedded && (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="bento-chip mb-3"><Wallet size={13} className="text-[#0E7A5F]" /> Suivi financier</div>
            <h1 className="text-[24px] font-extrabold tracking-tight text-[#1E2229]">Factures et paiements</h1>
            <p className="mt-1 text-[12.5px] text-[#727A88]">Contrôle des factures, échéances, soldes et avoirs</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className="bento-select w-56" value={storeId} onChange={e => setStoreId(e.target.value)}>
              <option value="">Tous les magasins</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {can('manage_operations') && (
              <>
                <button className="bento-btn" onClick={() => { setFormPayment(f => ({ ...EMPTY_PAYMENT, paid_at: new Date().toISOString().slice(0, 10) })); setModal('payment'); }}><CreditCard size={15} /> Paiement</button>
                <button className="bento-btn bento-btn-primary" onClick={() => setModal('invoice')}><Plus size={15} /> Nouvelle facture</button>
              </>
            )}
          </div>
        </div>
      )}
      {embedded && can('manage_operations') && (
        <div className="mb-4 flex justify-end gap-2">
          <button className="bento-btn" onClick={() => { setFormPayment(f => ({ ...EMPTY_PAYMENT, paid_at: new Date().toISOString().slice(0, 10) })); setModal('payment'); }}><CreditCard size={15} /> Paiement</button>
          <button className="bento-btn bento-btn-primary" onClick={() => setModal('invoice')}><Plus size={15} /> Nouvelle facture</button>
        </div>
      )}

      <ErrorBox error={error} />
      {notice && <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-[12px] font-semibold text-emerald-700">{notice}</div>}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Factures" value={normalInvoices.length} tone="#1E2229" />
        <Kpi label="Total TTC" value={money(totalTtc)} tone="#0E7A5F" />
        <Kpi label="Pay?" value={money(totalPaid)} tone="#16A37C" />
        <Kpi label="Solde d?" value={money(totalDue)} tone="#B8862F" />
      </div>

      <div className="bento-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/60 px-5 py-4">
          <div className="flex flex-wrap gap-2">
            {tabs.map(t => (
              <button key={t.id} className={`bento-chip !py-1.5 transition ${tab === t.id ? 'ring-2 ring-emerald-500 bg-white' : ''}`} onClick={() => setTab(t.id)}>
                <t.icon size={13} /> {t.label} <span className="opacity-60">({t.count})</span>
              </button>
            ))}
          </div>
          <input className="bento-input w-full max-w-xs" placeholder="Rechercher une facture?" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="p-5">
          {tab === 'invoices' && (
            normalInvoices.length === 0 ? <div className="py-10 text-center text-[12px] text-[#8B93A1]">Aucune facture</div> : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr><th className="bento-th">Référence</th><th className="bento-th">Fournisseur</th><th className="bento-th">Commande</th><th className="bento-th">Montant TTC</th><th className="bento-th">Contrôle</th><th className="bento-th">échéance</th><th className="bento-th">Payé</th><th className="bento-th">Solde</th><th className="bento-th">État</th></tr></thead>
                  <tbody>
                    {normalInvoices.map(inv => (
                      <tr key={inv.id} className="hover:bg-white/50">
                        <td className="bento-td"><div className="font-bold text-[12px] text-[#1E2229]">{inv.reference || `#${inv.id}`}</div><div className="text-[10.5px] text-[#8B93A1]">{storeName(inv.store_id)} ? {dateFR(inv.invoice_date)}</div></td>
                        <td className="bento-td text-[11.5px]">{supplierName(inv.supplier_id)}</td>
                        <td className="bento-td text-[11.5px]">{orderRef(inv.purchase_order_id)}</td>
                        <td className="bento-td font-extrabold text-[12px]">{money(inv.amount_ttc)}</td>
                        <td className="bento-td">{controlBadge(inv)}{inv.control_comment && <div className="text-[10px] text-muted mt-0.5">{inv.control_comment}</div>}</td>
                        <td className="bento-td text-[11.5px]">{dateFR(inv.due_date)}</td>
                        <td className="bento-td text-[11.5px] font-semibold text-emerald-700">{money(paidByInvoice[String(inv.id)] || 0)}</td>
                        <td className={`bento-td text-[11.5px] font-extrabold ${balanceOf(inv) > 0 ? 'text-amber-600' : 'text-emerald-700'}`}>{money(balanceOf(inv))}</td>
                        <td className="bento-td"><span className="bento-chip !py-1 !text-[10px]">{LABELS[inv.state] || inv.state || 'Reçue'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {tab === 'payments' && (
            filteredPayments.length === 0 ? <div className="py-10 text-center text-[12px] text-[#8B93A1]">Aucun paiement</div> : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr><th className="bento-th">Facture</th><th className="bento-th">Montant</th><th className="bento-th">Méthode</th><th className="bento-th">Référence financière</th><th className="bento-th">Support</th><th className="bento-th">Date</th></tr></thead>
                  <tbody>
                    {filteredPayments.map(p => (
                      <tr key={p.id} className="hover:bg-white/50">
                        <td className="bento-td font-bold text-[11.5px]">{invoiceRef(p.invoice_id)}</td>
                        <td className="bento-td font-extrabold text-[12px] text-emerald-700">{money(p.amount)}</td>
                        <td className="bento-td text-[11.5px]">{p.method || '-'}</td>
                        <td className="bento-td text-[11.5px]">{p.finance_reference || p.reference || '-'}</td>
                        <td className="bento-td text-[11.5px]">{p.support_name || '-'}</td>
                        <td className="bento-td text-[11px] text-[#8B93A1]">{dateFR(p.paid_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {tab === 'credits' && (
            creditNotes.length === 0 ? <div className="py-10 text-center text-[12px] text-[#8B93A1]">Aucun avoir</div> : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr><th className="bento-th">Référence avoir</th><th className="bento-th">Fournisseur</th><th className="bento-th">Montant</th><th className="bento-th">Motif</th><th className="bento-th">Contrôle</th><th className="bento-th">Date</th></tr></thead>
                  <tbody>
                    {creditNotes.map(inv => (
                      <tr key={inv.id} className="hover:bg-white/50">
                        <td className="bento-td font-bold text-[11.5px]">{inv.reference || `#${inv.id}`}</td>
                        <td className="bento-td text-[11.5px]">{supplierName(inv.supplier_id)}</td>
                        <td className="bento-td font-extrabold text-[12px] text-red-600">- {money(inv.amount_ttc)}</td>
                        <td className="bento-td text-[11.5px]">{inv.credit_reason || inv.control_comment || '-'}</td>
                        <td className="bento-td">{controlBadge(inv)}</td>
                        <td className="bento-td text-[11px] text-[#8B93A1]">{dateFR(inv.invoice_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      </div>

      <Modal open={modal === 'invoice'} onClose={() => setModal(null)} title="Nouvelle facture" wide>
        <form onSubmit={createInvoice} className="grid md:grid-cols-2 gap-4">
          {!fixedStoreId && <Field label="Magasin"><select className="bento-select" value={formInvoice.store_id} onChange={e => setFormInvoice(f => ({ ...f, store_id: e.target.value }))} required><option value="">Choisir?</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
          <Field label="Fournisseur"><select className="bento-select" value={formInvoice.supplier_id} onChange={e => setFormInvoice(f => ({ ...f, supplier_id: e.target.value }))}><option value="">Choisir?</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Commande liée"><select className="bento-select" value={formInvoice.purchase_order_id} onChange={e => setFormInvoice(f => ({ ...f, purchase_order_id: e.target.value }))}><option value="">Aucune</option>{orders.filter(o => !formInvoice.store_id || String(o.store_id) === String(formInvoice.store_id)).map(o => <option key={o.id} value={o.id}>{o.reference || `PO-${o.id}`}</option>)}</select></Field>
          <Field label="Zone / chantier (libre)"><input className="bento-input" value={formInvoice.lot_label} onChange={e => setFormInvoice(f => ({ ...f, lot_label: e.target.value }))} placeholder="Ex. Cuisine, terrasse?" /></Field>
          <Field label="Référence facture"><input className="bento-input" value={formInvoice.reference} onChange={e => setFormInvoice(f => ({ ...f, reference: e.target.value }))} required /></Field>
          <Field label="Montant HT (MAD)"><input type="number" step="0.01" className="bento-input" value={formInvoice.amount_ht} onChange={e => setFormInvoice(f => ({ ...f, amount_ht: e.target.value }))} /></Field>
          <Field label="Montant TTC (MAD)"><input type="number" step="0.01" className="bento-input" value={formInvoice.amount_ttc} onChange={e => setFormInvoice(f => ({ ...f, amount_ttc: e.target.value }))} required /></Field>
          <Field label="Date de facture"><input type="date" className="bento-input" value={formInvoice.invoice_date} onChange={e => setFormInvoice(f => ({ ...f, invoice_date: e.target.value }))} /></Field>
          <Field label="Date d'échéance"><input type="date" className="bento-input" value={formInvoice.due_date} onChange={e => setFormInvoice(f => ({ ...f, due_date: e.target.value }))} /></Field>
          <div className="md:col-span-2 flex justify-end gap-2 pt-2"><button type="button" className="bento-btn" onClick={() => setModal(null)}>Annuler</button><button className="bento-btn bento-btn-primary">Enregistrer la facture</button></div>
        </form>
      </Modal>

      <Modal open={modal === 'payment'} onClose={() => setModal(null)} title="Nouveau paiement" wide>
        <form onSubmit={createPayment} className="grid md:grid-cols-2 gap-4">
          <Field label="Facture" className="md:col-span-2"><select className="bento-select" value={formPayment.invoice_id} onChange={e => setFormPayment(f => ({ ...f, invoice_id: e.target.value }))} required><option value="">Choisir?</option>{invoices.filter(i => !i.credit_note && (!scopeStoreId || String(i.store_id) === String(scopeStoreId))).map(i => <option key={i.id} value={i.id}>{i.reference || `#${i.id}`}  ? solde {money(balanceOf(i))}</option>)}</select></Field>
          <Field label="Montant (MAD)"><input type="number" step="0.01" className="bento-input" value={formPayment.amount} onChange={e => setFormPayment(f => ({ ...f, amount: e.target.value }))} required /></Field>
          <Field label="Méthode"><select className="bento-select" value={formPayment.method} onChange={e => setFormPayment(f => ({ ...f, method: e.target.value }))}><option>Virement</option><option>Espèces</option><option>Chèque</option><option>Prélèvement</option></select></Field>
          <Field label="Référence financière"><input className="bento-input" value={formPayment.finance_reference} onChange={e => setFormPayment(f => ({ ...f, finance_reference: e.target.value }))} placeholder="Ex. VIR-2026-001" /></Field>
          <Field label="Nom du support"><input className="bento-input" value={formPayment.support_name} onChange={e => setFormPayment(f => ({ ...f, support_name: e.target.value }))} placeholder="Ex. Reçu de virement" /></Field>
          <Field label="Date de paiement"><input type="date" className="bento-input" value={formPayment.paid_at} onChange={e => setFormPayment(f => ({ ...f, paid_at: e.target.value }))} required /></Field>
          <div className="md:col-span-2 flex justify-end gap-2 pt-2"><button type="button" className="bento-btn" onClick={() => setModal(null)}>Annuler</button><button className="bento-btn bento-btn-primary">Enregistrer le paiement</button></div>
        </form>
      </Modal>
    </div>
  );
}
