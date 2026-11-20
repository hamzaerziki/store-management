import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Plus, Check, X, Clock, GitBranch, Sparkles, ShieldCheck, ClipboardList } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Modal, Field, DecisionModal, money, dateFR } from '../components/ui';

const EMPTY_RISK = { store_id: '', lot_label: '', title: '', description: '', severity: '3', probability: '3', impact: '', owner_role: 'IT', due_date: '', action: '', attachment_name: '', attachment_url: '' };
const EMPTY_CHANGE = { store_id: '', title: '', description: '', impact: '', quote_id: '', amount: '' };
const DIRECTORS = ['admin', 'DG', 'CDG', 'CG', 'DD'];
const CRITICAL = 16;

const compact = payload => Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== '' && value !== null && value !== undefined));

const criticalityLabel = value => {
  const n = Number(value);
  if (!n) return '—';
  if (n <= 4) return 'Faible';
  if (n <= 9) return 'Moyenne';
  if (n <= 15) return 'Élevée';
  return 'Critique';
};

const critColor = value => Number(value) >= CRITICAL ? '#E05A4F' : Number(value) > 9 ? '#D8A441' : '#0E7A5F';
const stateColor = state => ['approved', 'resolu', 'clos'].includes(state) ? '#0E7A5F' : state === 'rejected' ? '#E05A4F' : '#D8A441';

function BentoKpi({ label, value, sub, icon: Icon, accent, badge }) {
  return (
    <div className="bento-kpi">
      <div className="flex items-start justify-between gap-2">
        <div className="grid h-10 w-10 place-items-center rounded-2xl" style={{ background: `${accent}1A`, color: accent }}><Icon size={18} /></div>
        <span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: '#EAF6F2', color: accent }}>{badge}</span>
      </div>
      <div className="mt-4 text-[11px] font-bold uppercase tracking-wide text-[#8B93A1]">{label}</div>
      <div className="mt-1 text-[19px] font-extrabold text-[#1E2229]">{value}</div>
      <div className="mt-2 text-[10px] leading-snug text-[#8B93A1]">{sub}</div>
    </div>
  );
}

export default function Risks({ embedded = false, fixedStoreId = null }) {
  const { user, can } = useAuth();
  const [tab, setTab] = useState('risks');
  const [storeId, setStoreId] = useState(fixedStoreId ? String(fixedStoreId) : '');
  const [stores, setStores] = useState([]);
  const [lots, setLots] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [risks, setRisks] = useState([]);
  const [changes, setChanges] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [demands, setDemands] = useState([]);
  const [items, setItems] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [riskOpen, setRiskOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [riskForm, setRiskForm] = useState({ ...EMPTY_RISK, store_id: fixedStoreId ? String(fixedStoreId) : '' });
  const [changeForm, setChangeForm] = useState({ ...EMPTY_CHANGE, store_id: fixedStoreId ? String(fixedStoreId) : '' });
  const [rejectTarget, setRejectTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const scopeStoreId = fixedStoreId ? String(fixedStoreId) : storeId;
  const query = scopeStoreId ? `?store_id=${scopeStoreId}` : '';

  const loadRisks = () => api.get(`/operations/risks${query}`).then(r => setRisks(r.data)).catch(setError);
  const loadChanges = () => api.get(`/governance/change-requests${query}`).then(r => setChanges(r.data)).catch(setError);

  useEffect(() => {
    api.get('/stores').then(r => setStores(r.data)).catch(() => {});
    api.get('/quotes').then(r => setQuotes(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    api.get(`/operations/lots${query}`).then(r => setLots(r.data)).catch(() => {});
    api.get(`/operations/planning_tasks${query}`).then(r => setTasks(r.data)).catch(() => {});
    api.get(`/operations/budgets${query}`).then(r => setBudgets(r.data)).catch(() => {});
    api.get(`/demands${query}`).then(r => setDemands(r.data)).catch(() => {});
    api.get(`/items${query}`).then(r => setItems(r.data)).catch(() => {});
    api.get(`/operations/purchase_orders${query}`).then(r => setPurchaseOrders(r.data)).catch(() => {});
    api.get(`/documents${query}`).then(r => setDocuments(r.data)).catch(() => {});
    loadRisks();
    loadChanges();
  }, [scopeStoreId]);

  const riskCriticality = Number(riskForm.severity || 0) * Number(riskForm.probability || 0);
  const canDecide = DIRECTORS.includes(user?.role);
  const storeName = id => stores.find(s => String(s.id) === String(id))?.name || '—';

  const autoRisks = useMemo(() => {
    const today = new Date();
    const iso = value => new Date(value).toISOString().slice(0, 10);
    const inDays = days => { const date = new Date(today); date.setDate(date.getDate() + days); return iso(date); };
    const build = (key, store_id, title, description, severity, probability, impact, due_date, action) => ({
      id: `auto-${key}`, auto: true, store_id: String(store_id), title, description,
      severity, probability, criticality: String(severity * probability), criticality_score: severity * probability,
      impact, owner_role: 'RMG', due_date, action, state: 'ouvert', created_at: today.toISOString(),
    });
    const rows = [];

    tasks.filter(task => task.end_date && new Date(task.end_date) < today && Number(task.progress || 0) < 100)
      .forEach(task => rows.push(build(`task-${task.id}`, task.store_id, 'Tâche de planning en retard',
        `« ${task.title} » dépasse son échéance avec ${Number(task.progress || 0)} % d’avancement.`,
        4, 4, 'Retard planning', iso(task.end_date), 'Mettre à jour le planning et rattraper la tâche')));

    const engagedFor = budget => purchaseOrders
      .filter(order => String(order.store_id) === String(budget.store_id)
        && (!budget.lot_id || String(order.lot_id) === String(budget.lot_id))
        && ['commande', 'recu', 'clos'].includes(order.state))
      .reduce((sum, order) => sum + Number(order.amount || 0), 0);

    budgets.forEach(budget => {
      const amount = Number(budget.amount || 0);
      const available = Number(budget.available ?? (amount - Math.max(Number(budget.engaged || 0), engagedFor(budget))));
      if (available < 0) rows.push(build(`budget-${budget.id}`, budget.store_id, 'Dépassement budgétaire',
        `Le budget « ${budget.label} » est dépassé de ${money(Math.abs(available))}.`,
        5, 5, 'Budget', inDays(7), 'Réviser le budget et soumettre une demande de changement'));
      else if (amount > 0 && ((amount - available) / amount) * 100 >= 90) rows.push(build(`budget-high-${budget.id}`, budget.store_id, 'Consommation budgétaire élevée',
        `Le budget « ${budget.label} » dépasse 90 % de son enveloppe.`,
        4, 3, 'Budget', inDays(7), 'Anticiper une révision avant nouvel engagement'));
    });

    demands.filter(demand => String(demand.status || '').startsWith('pending_') && (today - new Date(demand.submitted_at || demand.created_at)) / 86400000 > 7)
      .forEach(demand => rows.push(build(`demand-${demand.id}`, demand.store_id, 'Validation bloquée depuis plus de 7 jours',
        `La demande « ${demand.title || demand.item_name || `#${demand.id}`} » attend encore une validation.`,
        4, 3, 'Délai de validation', inDays(3), 'Relancer la chaîne CDG / DD / DG')));


    items.filter(item => ['to_quote', 'quotes_received'].includes(item.status) && item.created_at && (today - new Date(item.created_at)) / 86400000 > 10)
      .forEach(item => rows.push(build(`item-${item.id}`, item.store_id, 'Besoin sans avancement depuis 10 jours',
        `« ${item.name || `#${item.id}`} » attend encore ses devis ou sa comparaison.`,
        3, 3, 'Retard achat', inDays(5), 'Relancer les devis et la comparaison')));

    purchaseOrders.filter(order => order.state === 'commande' && order.planned_date && new Date(order.planned_date) < today)
      .forEach(order => rows.push(build(`po-${order.id}`, order.store_id, 'Bon de commande en retard',
        `La commande « ${order.reference || `#${order.id}`} » dépasse sa date de livraison prévue.`,
        4, 4, 'Logistique', iso(order.planned_date), 'Relancer le fournisseur et mettre à jour la réception')));

    stores.filter(store => store.opening_date && new Date(store.opening_date) < today && Number(store.progress || 0) < 100)
      .forEach(store => rows.push(build(`store-${store.id}`, store.id, 'Ouverture dépassée',
        `La date d’ouverture de ${store.name} est passée avec ${Number(store.progress || 0)} % d’avancement.`,
        5, 4, 'Ouverture', inDays(3), 'Réviser le planning et arbitrer les blocages')));


    return rows.filter(row => !scopeStoreId || String(row.store_id) === scopeStoreId);
  }, [tasks, budgets, demands, items, purchaseOrders, documents, stores, scopeStoreId]);

  const allRisks = useMemo(() => [...autoRisks, ...risks]
    .sort((a, b) => Number(b.criticality_score || b.criticality || 0) - Number(a.criticality_score || a.criticality || 0)), [autoRisks, risks]);
  const criticalCount = allRisks.filter(row => Number(row.criticality_score || row.criticality || 0) >= CRITICAL).length;
  const pendingChanges = changes.filter(change => !change.decided_at).length;

  async function createRisk(event) {
    event.preventDefault(); setError(''); setNotice('');
    const payload = compact({ ...riskForm, store_id: scopeStoreId || riskForm.store_id, severity: Number(riskForm.severity), probability: Number(riskForm.probability), criticality: String(riskCriticality) });
    try {
      await api.post('/operations/risks', payload);
      setRiskOpen(false); setRiskForm({ ...EMPTY_RISK, store_id: scopeStoreId || '' }); setNotice('Risque enregistré · criticité calculée automatiquement');
      loadRisks();
    } catch (err) { setError(err); }
  }

  async function createChange(event) {
    event.preventDefault(); setError(''); setNotice('');
    const payload = compact({ ...changeForm, store_id: scopeStoreId || changeForm.store_id, amount: Number(changeForm.amount || 0), quote_id: changeForm.quote_id ? Number(changeForm.quote_id) : undefined });
    try {
      await api.post('/governance/change-requests', payload);
      setChangeOpen(false); setChangeForm({ ...EMPTY_CHANGE, store_id: scopeStoreId || '' }); setNotice('Demande de changement créée');
      loadChanges();
    } catch (err) { setError(err); }
  }

  async function decide(row, decision, comment = '') {
    setError(''); setNotice(''); setBusy(true);
    try {
      await api.post(`/governance/change-requests/${row.id}/decision`, { decision, comment });
      setRejectTarget(null);
      setNotice(decision === 'approved' ? 'Demande de changement approuvée' : 'Demande de changement rejetée');
      loadChanges();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  const shellClass = embedded
    ? 'reporting-shell mb-5 rounded-3xl p-5'
    : 'reporting-shell -mx-5 -mt-5 -mb-5 min-h-screen px-5 py-6 sm:-mx-7 sm:-mt-7 sm:-mb-7 sm:px-7';

  return (
    <div className={shellClass}>
      {!embedded && (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="bento-chip mb-3"><Sparkles size={13} className="text-[#0E7A5F]" /> Détection intelligente · risques projets</div>
            <h1 className="text-[26px] font-extrabold tracking-tight text-[#1E2229]">Risques et changements</h1>
            <p className="mt-1 text-[12.5px] text-[#727A88]">Le système détecte les retards, dépassements et blocages à partir des données réelles</p>
          </div>
          <select className="bento-select w-64" value={storeId} onChange={event => setStoreId(event.target.value)}>
            <option value="">Tous les magasins</option>
            {stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
        </div>
      )}

      {error && <div className="bento-card mb-5 p-4 text-[12px] font-semibold text-red-600">{error}</div>}
      {notice && <div className="bento-chip mb-5 !py-2 !text-[11px]">{notice}</div>}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <BentoKpi label="Risques détectés" value={String(allRisks.length).padStart(2, '0')} sub="automatiques et manuels" icon={AlertTriangle} accent="#0E7A5F" badge="Total" />
        <BentoKpi label="Détection auto" value={String(autoRisks.length).padStart(2, '0')} sub="calculée depuis les données" icon={Sparkles} accent="#16A37C" badge="Smart" />
        <BentoKpi label="Critiques" value={String(criticalCount).padStart(2, '0')} sub="criticité 16 et plus" icon={ShieldCheck} accent="#E05A4F" badge="Urgent" />
        <BentoKpi label="Saisis" value={String(risks.length).padStart(2, '0')} sub="risques enregistrés" icon={ClipboardList} accent="#D8A441" badge="Manuel" />
        <BentoKpi label="Changements" value={String(pendingChanges).padStart(2, '0')} sub="en attente de décision" icon={GitBranch} accent="#B8862F" badge="Décision" />
      </div>

      <section className="bento-card overflow-hidden">
        <div className="flex flex-wrap gap-2 px-5 pt-5">
          <button type="button" className={`bento-btn ${tab === 'risks' ? 'bento-btn-primary' : ''}`} onClick={() => setTab('risks')}><AlertTriangle size={14} /> Risques <span className="bento-chip !py-0.5 !px-1.5 !text-[9px]">{allRisks.length}</span></button>
          <button type="button" className={`bento-btn ${tab === 'changes' ? 'bento-btn-primary' : ''}`} onClick={() => setTab('changes')}><GitBranch size={14} /> Changements <span className="bento-chip !py-0.5 !px-1.5 !text-[9px]">{changes.length}</span></button>
        </div>
        <div className="px-5 pb-5 pt-5">
          {tab === 'risks' ? (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="text-[14px] font-extrabold text-[#1E2229]">Registre des risques</h2><p className="text-[11px] text-[#8B93A1]">Criticité = gravité × probabilité · détection continue</p></div>
                {can('manage_operations') && <button className="bento-btn bento-btn-primary !py-2" onClick={() => { setRiskForm({ ...EMPTY_RISK, store_id: scopeStoreId || '' }); setRiskOpen(true); }}><Plus size={15} /> Ajouter un risque</button>}
              </div>
              {allRisks.length === 0 ? <div className="py-10 text-center text-[12px] text-[#8B93A1]">Aucun risque détecté ni enregistré</div> : (
                <div className="overflow-x-auto"><table className="w-full">
                  <thead><tr><th className="bento-th">Risque</th><th className="bento-th">Magasin / Zone</th><th className="bento-th">Gravité</th><th className="bento-th">Probabilité</th><th className="bento-th">Criticité</th><th className="bento-th">Impact</th><th className="bento-th">Responsable</th><th className="bento-th">Échéance</th><th className="bento-th">Action</th><th className="bento-th">Pièce jointe</th><th className="bento-th">État</th></tr></thead>
                  <tbody>
                    {allRisks.map(row => {
                      const crit = Number(row.criticality_score || row.criticality || 0);
                      return (
                        <tr key={row.id} className="hover:bg-white/50 align-top">
                          <td className="bento-td min-w-[180px]"><div className="text-[12.5px] font-bold text-[#1E2229]">{row.title} {row.auto && <span className="bento-chip !py-0.5 !px-1.5 !text-[9px]" style={{ background: '#EAF6F2', borderColor: 'transparent', color: '#0E7A5F' }}>Auto</span>}</div>{row.description && <div className="mt-0.5 max-w-xs text-[10.5px] text-[#8B93A1]">{row.description}</div>}</td>
                          <td className="bento-td text-[11.5px] text-[#5F6875]">{storeName(row.store_id)}{row.lot_id ? ` · ${lots.find(lot => String(lot.id) === String(row.lot_id))?.name || row.lot_id}` : row.lot_label ? ` · ${row.lot_label}` : ''}</td>
                          <td className="bento-td text-[12px] font-bold">{row.severity ?? '—'}</td>
                          <td className="bento-td text-[12px] font-bold">{row.probability ?? '—'}</td>
                          <td className="bento-td"><span className="bento-chip !py-1 !text-[10px]" style={{ background: `${critColor(crit)}18`, borderColor: 'transparent', color: critColor(crit) }}>{crit} · {criticalityLabel(crit)}</span></td>
                          <td className="bento-td text-[11.5px] text-[#5F6875]">{row.impact || '—'}</td>
                          <td className="bento-td text-[11.5px] text-[#5F6875]">{row.owner_role || '—'}</td>
                          <td className="bento-td text-[11px] text-[#8B93A1]">{dateFR(row.due_date)}</td>
                          <td className="bento-td text-[11px] text-[#8B93A1] max-w-[220px]">{row.action || '—'}</td>
                          <td className="bento-td text-[11px]">{row.attachment_url ? <a href={row.attachment_url} target="_blank" rel="noreferrer" className="font-bold text-[#0E7A5F] hover:underline">{row.attachment_name || 'Ouvrir'}</a> : (row.attachment_name || '—')}</td>
                          <td className="bento-td"><span className="bento-chip !py-1 !text-[10px]" style={{ background: `${stateColor(row.state)}18`, borderColor: 'transparent', color: stateColor(row.state) }}>{String(row.state || 'ouvert').replaceAll('_', ' ')}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div>
              )}
            </>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="text-[14px] font-extrabold text-[#1E2229]">Demandes de changement</h2><p className="text-[11px] text-[#8B93A1]">Approbation ou rejet par la direction · décisions conservées</p></div>
                {can('manage_operations') && <button className="bento-btn bento-btn-primary !py-2" onClick={() => { setChangeForm({ ...EMPTY_CHANGE, store_id: scopeStoreId || '' }); setChangeOpen(true); }}><Plus size={15} /> Nouveau changement</button>}
              </div>
              {changes.length === 0 ? <div className="py-10 text-center text-[12px] text-[#8B93A1]">Aucune demande de changement</div> : (
                <div className="overflow-x-auto"><table className="w-full">
                  <thead><tr><th className="bento-th">Demande</th><th className="bento-th">Magasin / Zone</th><th className="bento-th">Bon de commande</th><th className="bento-th">Montant</th><th className="bento-th">Impact</th><th className="bento-th">Justification</th><th className="bento-th">Preuve</th><th className="bento-th">Décision</th></tr></thead>
                  <tbody>
                    {changes.map(row => {
                      const decided = !!row.decided_at;
                      const proof = decided ? [{ role: 'Direction', decision: row.state, reason: row.decision_comment, date: row.decided_at }] : [];
                      return (
                        <tr key={row.id} className="hover:bg-white/50 align-top">
                          <td className="bento-td min-w-[180px]"><div className="text-[12.5px] font-bold text-[#1E2229]">{row.title}</div><div className="text-[10.5px] text-[#8B93A1]">{dateFR(row.created_at)}</div></td>
                          <td className="bento-td text-[11.5px] text-[#5F6875]">{row.store_name || storeName(row.store_id)}{row.lot_name ? ` · ${row.lot_name}` : ''}</td>
                          <td className="bento-td text-[11.5px] text-[#5F6875]">{row.quote_id ? `#${row.quote_id}${row.quote_amount ? ` · ${money(row.quote_amount)}` : ''}` : '—'}</td>
                          <td className="bento-td text-[12px] font-extrabold text-[#0E7A5F]">{money(row.amount)}</td>
                          <td className="bento-td text-[11.5px] max-w-[200px] text-[#5F6875]">{row.impact || '—'}</td>
                          <td className="bento-td text-[11px] text-[#8B93A1] max-w-[260px]">{row.description || row.justification || '—'}{row.decision_comment ? <div className="mt-1 text-red-600">Motif : {row.decision_comment}</div> : null}</td>
                          <td className="bento-td min-w-[170px]">{proof.map((item, index) => <div key={index} className="text-[10.5px] text-[#5F6875]">{item.role} · {item.decision} · {dateFR(item.date)}</div>)}</td>
                          <td className="bento-td">
                            {!decided ? (
                              canDecide ? <div className="flex flex-wrap gap-1.5">
                                <button className="bento-btn !py-1.5 !px-2.5 !text-[10px]" onClick={() => decide(row, 'approved')}><Check size={13} /> Approuver</button>
                                <button className="bento-btn !py-1.5 !px-2.5 !text-[10px]" onClick={() => setRejectTarget(row)}><X size={13} /> Rejeter</button>
                              </div> : <span className="text-[#8B93A1] text-[11px]"><Clock size={12} className="inline mr-1" />En attente</span>
                            ) : <span className="bento-chip !py-1 !text-[10px]" style={{ background: `${stateColor(row.state)}18`, borderColor: 'transparent', color: stateColor(row.state) }}>{row.state === 'approved' ? 'Approuvée' : 'Rejetée'}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div>
              )}
            </>
          )}
        </div>
      </section>

      <Modal open={riskOpen} onClose={() => setRiskOpen(false)} title="Ajouter un risque" wide>
        <form onSubmit={createRisk} className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            {!fixedStoreId && <Field label="Magasin"><select className="bento-select" value={riskForm.store_id} onChange={event => setRiskForm(form => ({ ...form, store_id: event.target.value }))} required><option value="">Choisir…</option>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></Field>}
            <Field label="Zone / chantier (libre)"><input className="bento-input" value={riskForm.lot_label} onChange={event => setRiskForm(form => ({ ...form, lot_label: event.target.value }))} placeholder="Ex. Sécurité, voirie, signalétique…" /></Field>
          </div>
          <Field label="Intitulé du risque"><input className="bento-input" value={riskForm.title} onChange={event => setRiskForm(form => ({ ...form, title: event.target.value }))} required placeholder="Ex. Retard de livraison" /></Field>
          <Field label="Description"><textarea className="bento-input min-h-[70px]" value={riskForm.description} onChange={event => setRiskForm(form => ({ ...form, description: event.target.value }))} /></Field>
          <div className="grid md:grid-cols-3 gap-4">
            <Field label="Gravité (1-5)"><select className="bento-select" value={riskForm.severity} onChange={event => setRiskForm(form => ({ ...form, severity: event.target.value }))}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</select></Field>
            <Field label="Probabilité (1-5)"><select className="bento-select" value={riskForm.probability} onChange={event => setRiskForm(form => ({ ...form, probability: event.target.value }))}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</select></Field>
            <Field label="Criticité (gravité × probabilité)"><input className="bento-input font-extrabold" readOnly value={riskCriticality || ''} placeholder="Calculée automatiquement" /></Field>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Impact"><input className="bento-input" value={riskForm.impact} onChange={event => setRiskForm(form => ({ ...form, impact: event.target.value }))} placeholder="Budget, délai, qualité…" /></Field>
            <Field label="Responsable (rôle)"><select className="bento-select" value={riskForm.owner_role} onChange={event => setRiskForm(form => ({ ...form, owner_role: event.target.value }))}>{['IT', 'MG', 'RMG', 'CDG', 'CG', 'DD', 'DG'].map(role => <option key={role} value={role}>{role}</option>)}
</select></Field>
            <Field label="Échéance"><input type="date" className="bento-input" value={riskForm.due_date} onChange={event => setRiskForm(form => ({ ...form, due_date: event.target.value }))} /></Field>
            <Field label="Action corrective"><input className="bento-input" value={riskForm.action} onChange={event => setRiskForm(form => ({ ...form, action: event.target.value }))} /></Field>
            <Field label="Nom de la pièce jointe"><input className="bento-input" value={riskForm.attachment_name} onChange={event => setRiskForm(form => ({ ...form, attachment_name: event.target.value }))} /></Field>
            <Field label="URL de la pièce jointe"><input className="bento-input" value={riskForm.attachment_url} onChange={event => setRiskForm(form => ({ ...form, attachment_url: event.target.value }))} placeholder="https://…" /></Field>
          </div>
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="bento-btn" onClick={() => setRiskOpen(false)}>Annuler</button><button className="bento-btn bento-btn-primary">Enregistrer le risque</button></div>
        </form>
      </Modal>

      <Modal open={changeOpen} onClose={() => setChangeOpen(false)} title="Nouvelle demande de changement" wide>
        <form onSubmit={createChange} className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            {!fixedStoreId && <Field label="Magasin"><select className="bento-select" value={changeForm.store_id} onChange={event => setChangeForm(form => ({ ...form, store_id: event.target.value }))} required><option value="">Choisir…</option>{stores.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></Field>}
            <Field label="Impact"><input className="bento-input" value={changeForm.impact} onChange={event => setChangeForm(form => ({ ...form, impact: event.target.value }))} placeholder="Coût, délai, périmètre…" /></Field>
          </div>
          <Field label="Intitulé"><input className="bento-input" value={changeForm.title} onChange={event => setChangeForm(form => ({ ...form, title: event.target.value }))} required /></Field>
          <Field label="Justification"><textarea className="bento-input min-h-[75px]" value={changeForm.description} onChange={event => setChangeForm(form => ({ ...form, description: event.target.value }))} placeholder="Pourquoi ce changement est-il nécessaire ?" /></Field>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Devis associé"><select className="bento-select" value={changeForm.quote_id} onChange={event => setChangeForm(form => ({ ...form, quote_id: event.target.value }))}><option value="">Aucun</option>{quotes.filter(quote => (!scopeStoreId || String(quote.store_id) === String(scopeStoreId)) && (!changeForm.store_id || String(quote.store_id) === String(changeForm.store_id))).map(quote => <option key={quote.id} value={quote.id}>#{quote.id} · {quote.supplier_name} · {money(quote.amount_ttc)}</option>)}</select></Field>
            <Field label="Montant (MAD)"><input type="number" step="0.01" className="bento-input" value={changeForm.amount} onChange={event => setChangeForm(form => ({ ...form, amount: event.target.value }))} /></Field>
          </div>
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="bento-btn" onClick={() => setChangeOpen(false)}>Annuler</button><button className="bento-btn bento-btn-primary">Créer la demande</button></div>
        </form>
      </Modal>

      <DecisionModal open={!!rejectTarget} onClose={() => setRejectTarget(null)} title={rejectTarget?.title} busy={busy} onConfirm={reason => decide(rejectTarget, 'rejected', reason)} />
    </div>
  );
}
