import { useEffect, useState } from 'react';
import { ShoppingCart, Receipt, CreditCard, CalendarClock, AlertTriangle, PackageCheck, UsersRound } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, CardHead, PageHeader, Modal, Field, ErrorBox, DecisionModal, Tabs, DecisionProof, money } from '../components/ui';

const STATE_LABELS = {
  brouillon: 'Brouillon', preparation: 'Préparation', validation_budget: 'Validation budget',
  approuve: 'Approuvé', execution: 'Exécution',
  ouvert: 'Ouvert', cloture: 'Clôturé', suspendu: 'Suspendu', annule: 'Annulé', corrige: 'Correction',
  soumis_cdg: 'Soumis CDG', soumis_dd: 'Soumis DD', soumis_dg: 'Soumis DG',
  commande: 'Commandé', recu: 'Reçu', clos: 'Clos', recue: 'Reçue',
  verifiee: 'Vérifiée', payee: 'Payée', ouvert_risk: 'Ouvert', en_cours: 'En cours',
  resolu: 'Résolu', effectuee: 'Effectuée', conforme: 'Conforme', non_conforme: 'Non conforme',
  a_faire: 'À faire', terminee: 'Terminée',
};

const BUDGET_NEXT = {
  brouillon: ['soumis_cdg'], soumis_cdg: ['soumis_dd', 'corrige'],
  soumis_dd: ['soumis_dg', 'corrige'], soumis_dg: ['approuve', 'corrige'],
  corrige: ['soumis_cdg'], approuve: [],
};

const PROJECT_NEXT = {
  brouillon: ['preparation'], preparation: ['validation_budget'],
  validation_budget: ['approuve', 'corrige'], approuve: ['execution'],
  execution: ['ouvert'], ouvert: ['cloture'],
  corrige: ['validation_budget', 'preparation'],
};

const RESOURCE_NEXT = {
  purchase_orders: { brouillon: ['commande'], commande: ['recu'], recu: ['clos'] },
  invoices: { recue: ['verifiee'], verifiee: ['payee'] },
  risks: { ouvert: ['en_cours', 'clos'], en_cours: ['resolu'] },
  receptions: { planifiee: ['effectuee'], effectuee: ['conforme', 'non_conforme'] },
  planning_tasks: { a_faire: ['en_cours'], en_cours: ['terminee'] },
};

const RESOURCES = {
  purchase_orders: { label: 'Commandes', icon: ShoppingCart, fields: ['store_id', 'lot_label', 'supplier_id', 'reference', 'amount', 'ordered_at'] },
  invoices: { label: 'Factures', icon: Receipt, fields: ['store_id', 'lot_label', 'supplier_id', 'reference', 'amount_ht', 'amount_ttc', 'invoice_date'] },
  payments: { label: 'Paiements', icon: CreditCard, fields: ['store_id', 'invoice_id', 'amount', 'method', 'reference', 'paid_at'] },
  planning_tasks: { label: 'Planning', icon: CalendarClock, fields: ['store_id', 'lot_label', 'title', 'start_date', 'end_date', 'owner_role'] },
  risks: { label: 'Risques', icon: AlertTriangle, fields: ['store_id', 'lot_label', 'title', 'severity', 'probability', 'owner_role', 'due_date'] },
  receptions: { label: 'Réception', icon: PackageCheck, fields: ['store_id', 'lot_label', 'reference', 'received_at', 'conform', 'notes'] },
  delegations: { label: 'Délégations', icon: UsersRound, fields: ['from_user_id', 'to_user_id', 'role', 'store_id', 'starts_at', 'ends_at'] },
};

const label = value => STATE_LABELS[value] || String(value || '—').replaceAll('_', ' ');
const cleanDate = value => value ? new Date(value).toLocaleDateString('fr-FR') : '—';

export default function Operations() {
  const { can, user } = useAuth();
  const [summary, setSummary] = useState({ counts: {}, budgets: [], projects: [] });
  const [stores, setStores] = useState([]);
  const [lots, setLots] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [users, setUsers] = useState([]);
  const [storeId, setStoreId] = useState('');
  const [tab, setTab] = useState('purchase_orders');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [transitions, setTransitions] = useState([]);
  const [rows, setRows] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [decisionTarget, setDecisionTarget] = useState(null);
  const [decisionBusy, setDecisionBusy] = useState(false);

  const loadBase = () => {
    api.get('/operations/summary').then(r => setSummary(r.data)).catch(() => {});
    api.get('/stores').then(r => setStores(r.data)).catch(() => {});
    api.get('/suppliers').then(r => setSuppliers(r.data)).catch(() => {});
    api.get('/users').then(r => setUsers(r.data)).catch(() => {});
  };
  useEffect(() => { loadBase(); }, []);

  useEffect(() => {
    const query = storeId ? `?store_id=${storeId}` : '';
    api.get(`/operations/lots${query}`).then(r => setLots(r.data)).catch(() => {});
    api.get(`/operations/budgets${query}`).then(r => setBudgets(r.data)).catch(() => {});
    api.get(`/operations/${tab}${query}`).then(r => setRows(r.data)).catch(setError);
    api.get(`/transitions?entity=${tab}${storeId ? `&store_id=${storeId}` : ''}`).then(r => setTransitions(r.data)).catch(() => {});
  }, [storeId, tab]);

  async function runTransition(kind, id, to, reason = '') {
    setError(''); setNotice(''); setDecisionBusy(true);
    try {
      await api.post(kind === 'budget' ? `/operations/budgets/${id}/transition` : `/operations/stores/${id}/project-state`, { to, reason });
      setNotice(`${kind === 'budget' ? 'Budget' : 'Projet'} : ${label(to)}`);
      loadBase();
      api.get(`/operations/budgets${storeId ? `?store_id=${storeId}` : ''}`).then(r => setBudgets(r.data));
    } catch (e) { setError(e); }
    finally { setDecisionBusy(false); }
  }

  function requestTransition(kind, id, to, title, needsReason) {
    if (needsReason) setDecisionTarget({ kind, id, to, title });
    else runTransition(kind, id, to);
  }

  async function confirmDecision(reason) {
    if (!decisionTarget) return;
    await runTransition(decisionTarget.kind, decisionTarget.id, decisionTarget.to, reason);
    setDecisionTarget(null);
  }

  async function transitionRow(id, to) {
    setError(''); setNotice('');
    try {
      await api.post(`/operations/${tab}/${id}/transition`, { to });
      setNotice(`Étape mise à jour : ${label(to)}`);
      api.get(`/operations/${tab}${storeId ? `?store_id=${storeId}` : ''}`).then(r => setRows(r.data));
      loadBase();
    } catch (e) { setError(e); }
  }

  async function createRow(e) {
    e.preventDefault(); setError('');
    const payload = {};
    Object.entries(form).forEach(([key, value]) => {
      if (value !== '' && value !== undefined) payload[key] = ['amount', 'amount_ht', 'amount_ttc'].includes(key) ? Number(value) : value;
    });
    try {
      await api.post(`/operations/${tab}`, payload);
      setModal(false); setForm({});
      const query = storeId ? `?store_id=${storeId}` : '';
      api.get(`/operations/${tab}${query}`).then(r => setRows(r.data));
      loadBase();
    } catch (e) { setError(e); }
  }

  const resource = RESOURCES[tab];
  const budgetStages = ['brouillon', 'soumis_cdg', 'soumis_dd', 'soumis_dg', 'approuve'];

  return (
    <>
      <PageHeader title="Opérations" subtitle="Workflow complet : zones libres, budgets, engagements, facturation, paiements, planning et réception" actions={
        <select className="input !py-2 !text-[12px] w-64" value={storeId} onChange={e => setStoreId(e.target.value)}>
          <option value="">Tous les magasins</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      } />
      <ErrorBox error={error} />
      {notice && <div className="mb-4 rounded-lg bg-emerald-50 text-emerald-700 text-[12px] font-semibold px-4 py-3">{notice}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <Card className="p-4"><div className="text-[11px] text-muted font-semibold">Zones</div><div className="text-2xl font-extrabold mt-1">{summary.counts.lots || 0}</div></Card>
        <Card className="p-4"><div className="text-[11px] text-muted font-semibold">Budgets</div><div className="text-2xl font-extrabold mt-1">{summary.counts.budgets || 0}</div></Card>
        <Card className="p-4"><div className="text-[11px] text-muted font-semibold">Commandes</div><div className="text-2xl font-extrabold mt-1">{summary.counts.purchase_orders || 0}</div></Card>
        <Card className="p-4"><div className="text-[11px] text-muted font-semibold">Factures</div><div className="text-2xl font-extrabold mt-1">{summary.counts.invoices || 0}</div></Card>
      </div>

      <Card className="mb-5 overflow-hidden">
        <CardHead title="Étape des projets" subtitle="Avancement du cycle de vie défini au dossier technique" />
        <div className="px-5 pb-5 space-y-2">
          {stores.filter(s => !storeId || String(s.id) === storeId).map(store => (
            <div key={store.id} className="flex flex-wrap items-center gap-3 py-2 border-b border-line/70 last:border-0">
              <div className="w-56 text-[12.5px] font-bold truncate">{store.name}</div>
              <span className="badge-warn !text-[10px]">{label(store.project_state)}</span>
              <div className="flex flex-wrap gap-1.5 ml-auto">
                {(PROJECT_NEXT[store.project_state] || [])
                  .filter(to => !['ouvert', 'cloture'].includes(to) || ['DG', 'admin'].includes(user?.role))
                  .map(to => (
                  <button key={to} className={`btn-ghost !py-1 !px-2 !text-[11px] ${to === 'corrige' ? 'text-red-600' : ''}`} onClick={() => requestTransition('project', store.id, to, store.name, to === 'corrige')}>
                    {label(to)} →
                  </button>
                ))}
                <button className="btn-ghost !py-1 !px-2 !text-[11px] text-red-600" onClick={() => setDecisionTarget({ kind: 'project', id: store.id, to: 'suspendu', title: store.name })}>Suspendre</button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mb-5 overflow-hidden">
        <CardHead title="Budgets — chaîne CDG → DD → DG" subtitle="Chaque transmission est tracée et vérifiée côté serveur" />
        <div className="px-5 pb-5">
          <div className="flex flex-wrap gap-2 mb-4 text-[10.5px] font-semibold text-muted">
            {budgetStages.map((stage, i) => <span key={stage} className="badge-muted !text-[10px]">{i + 1}. {label(stage)}</span>)}
          </div>
          <div className="divide-y divide-line/70 border border-line rounded-xl overflow-hidden">
            {budgets.length === 0 && <div className="py-6 text-center text-muted text-[12px]">Aucun budget</div>}
            {budgets.map(b => (
              <div key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1"><div className="text-[12.5px] font-bold truncate">{b.label}</div><div className="text-[10.5px] text-muted">{b.store_name}{b.lot_name ? ` · ${b.lot_name}` : ''}</div></div>
                <div className="text-[12px] font-extrabold">{money(b.amount)}</div>
                <span className="badge-warn !text-[10px]">{label(b.state)}</span>
                <div className="flex gap-1.5">
                  {(BUDGET_NEXT[b.state] || []).map(to => (
                    <button key={to} className={`btn-ghost !py-1 !px-2 !text-[11px] ${to === 'corrige' ? 'text-red-600' : ''}`} onClick={() => requestTransition('budget', b.id, to, b.label, to === 'corrige')}>
                      {label(to)} →
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <Tabs className="px-4 pt-2 bg-canvas/60"
          value={historyOpen ? 'history' : tab}
          onChange={id => { if (id === 'history') setHistoryOpen(true); else { setHistoryOpen(false); setTab(id); } }}
          tabs={[...Object.entries(RESOURCES).map(([key, cfg]) => ({ id: key, label: cfg.label, icon: cfg.icon })), { id: 'history', label: 'Historique', count: transitions.length }]} />
        <div className="px-5 pb-5 pt-5">
          {!historyOpen && can('manage_operations') && <div className="flex justify-end mb-3"><button className="btn-primary !py-1.5" onClick={() => { setForm({}); setModal(true); }}>+ Ajouter</button></div>}
          {historyOpen ? (
            <>
              <CardHead title="Historique des transitions" subtitle="Toutes les étapes conservées avec auteur, date et motif" />
              <DecisionProof rows={transitions} />
            </>
          ) : rows.length === 0 ? <div className="py-8 text-center text-muted text-[12px]">Aucun enregistrement</div> : (() => {
            const cols = Object.keys(rows[0]).filter(k => !['notes', 'description'].includes(k)).slice(0, 7);
            return (
              <table className="w-full">
                <thead><tr>{cols.map(k => <th key={k} className="th">{k.replaceAll('_', ' ')}</th>)}<th className="th">Étape suivante</th></tr></thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id} className="hover:bg-canvas/60">
                      {cols.map(k => (
                        <td key={k} className="td text-[11.5px]">
                          {k === 'state' ? <span className="badge-muted !text-[10px]">{label(row[k])}</span>
                            : /_at$|_date$/.test(k) ? cleanDate(row[k])
                              : typeof row[k] === 'boolean' ? (row[k] ? 'Oui' : 'Non')
                                : String(row[k] ?? '—')}
                        </td>
                      ))}
                      <td className="td">
                        <div className="flex flex-wrap gap-1.5">
                          {(RESOURCE_NEXT[tab]?.[row.state] || []).map(to => (
                            <button key={to} className="btn-ghost !py-1 !px-2 !text-[10.5px]" onClick={() => transitionRow(row.id, to)}>{label(to)} →</button>
                          ))}
                          {!RESOURCE_NEXT[tab]?.[row.state] && <span className="text-muted text-[11px]">—</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}
        </div>
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title={`Ajouter — ${resource?.label}`} wide>
        <form onSubmit={createRow} className="grid md:grid-cols-2 gap-4">
          {resource.fields.map(field => (
            <Field key={field} label={field === 'lot_label' ? 'Zone / chantier (libre)' : field.replaceAll('_', ' ')}>
              {field === 'store_id' ? (
                <select className="input" value={form[field] || ''} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))} required>
                  <option value="">Choisir…</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              ) : field === 'supplier_id' ? (
                <select className="input" value={form[field] || ''} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}>
                  <option value="">Entreprise…</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              ) : field === 'from_user_id' || field === 'to_user_id' ? (
                <select className="input" value={form[field] || ''} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}>
                  <option value="">Utilisateur…</option>{users.map(u => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
                </select>
              ) : field === 'conform' || field === 'active' ? (
                <select className="input" value={form[field] ?? 'true'} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}>
                  <option value="true">Oui</option><option value="false">Non</option>
                </select>
              ) : (
                <input className="input" type={/_date$|^amount|_at$/.test(field) ? /^amount/.test(field) ? 'number' : 'date' : 'text'} value={form[field] || ''} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))} />
              )}
            </Field>
          ))}
          <div className="md:col-span-2 flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={() => setModal(false)}>Annuler</button><button className="btn-primary">Enregistrer</button></div>
        </form>
      </Modal>

      <DecisionModal open={!!decisionTarget} onClose={() => setDecisionTarget(null)} title={decisionTarget?.title} busy={decisionBusy} onConfirm={confirmDecision} />
    </>
  );
}
