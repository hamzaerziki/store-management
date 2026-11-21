import { useEffect, useState } from 'react';
import { useDataRefresh } from '../hooks/useDataRefresh';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Search, Plus, FileUp, Wallet, ClipboardList, Clock3, Coins, CalendarClock, Eye, Sparkles, ListChecks, AlertTriangle, TrendingUp, Users, Filter, Gauge } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell } from 'recharts';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, CardHead, StatusBadge, PageHeader, Modal, Field, DecisionModal, Tabs, DecisionProof, WorkflowStrip, ExecutionStatusSelect, STATUS_LABELS_FR, money, dateFR, ConfirmDialog } from '../components/ui';
import { DemandDetailsModal } from '../components/DemandDetails';
import BudgetCategories from './BudgetCategories';

import Invoices from './Invoices';
import Planning from './Planning';
import Risks from './Risks';
import Site from './Site';
import { WORKFLOW_LIST } from '../data/workflows';

const STATUSES = ['to_quote', 'quotes_received', 'compared', 'ordered', 'delivered', 'installed'];
const DEMAND_LABELS = {
  pending_cdg: 'Soumis', pending_dd: 'Attente DD', pending_dg: 'Attente DG',
  approved: 'Approuvée', rejected: 'Rejetée', draft: 'Brouillon',
};
const PROJECT_LABELS = {
  brouillon: 'Brouillon', preparation: 'Préparation', validation_budget: 'Validation budget', approuve: 'Approuvé',
  execution: 'Exécution', ouvert: 'Ouvert', cloture: 'Clôturé',
  corrige: 'Correction', suspendu: 'Suspendu', annule: 'Annulé',
};
const ITEM_STEPS = [
  { value: 'ordered', label: 'En cours / commandé' },
  { value: 'delivered', label: 'Livré' },
  { value: 'installed', label: 'Terminé / installé' },
];
const CHART_COLORS = ['#0E7A5F', '#D8A441', '#16A37C', '#E8BC63', '#7FB69A', '#94A3B8'];

const PROJECT_TABS = [
  { id: 'resume', label: 'Synthèse' },
  { id: 'devis', label: 'Demandes' },
  { id: 'budget', label: 'Budget' },
  { id: 'factures', label: 'Factures' },
  { id: 'planning', label: 'Planning' },
  { id: 'risques', label: 'Risques' },
  { id: 'reception', label: 'Documents' },
  { id: 'historique', label: 'Historique' },
];

function BentoTrack({ value, tone = '#0E7A5F' }) {
  return <div className="bento-track flex-1"><div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, Number(value) || 0))}%`, background: tone }} /></div>;
}

function BentoKpi({ label, value, sub, icon: Icon, accent, badge, progress }) {
  return (
    <div className="bento-kpi">
      <div className="flex items-start justify-between gap-2">
        <div className="grid h-10 w-10 place-items-center rounded-2xl" style={{ background: `${accent}1A`, color: accent }}><Icon size={18} /></div>
        <span className="rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: '#EAF6F2', color: accent }}>{badge}</span>
      </div>
      <div className="mt-4 text-[11px] font-bold uppercase tracking-wide text-[#8B93A1]">{label}</div>
      <div className="mt-1 text-[19px] font-extrabold tracking-tight text-[#1E2229]">{value}</div>
      <div className="mt-2 text-[10px] leading-snug text-[#8B93A1]">{sub}</div>
      <div className="mt-3"><BentoTrack value={progress} tone={accent} /></div>
    </div>
  );
}

function ApprovalChain({ status, decisions = [] }) {
  const steps = ['CDG', 'DD', 'DG'];
  const active = status === 'approved' ? 3 : status === 'pending_dd' ? 1 : status === 'pending_dg' ? 2 : status === 'rejected' ? -1 : 0;
  const decisionOf = role => decisions.find(row => (row.role || row.validator_role) === role);
  const recorded = decisions.filter(row => row.decision);
  return (
    <div>
      <div className="flex items-center gap-1" title="Chaîne d’approbation : CDG → DD → DG">
        {steps.map((step, index) => {
          const decision = decisionOf(step);
          const tone = decision?.decision === 'rejected' ? 'bg-red-600 text-white'
            : decision?.decision === 'approved' ? 'bg-emerald-600 text-white'
              : status === 'rejected' ? 'bg-red-50 text-red-500'
                : index < active ? 'bg-emerald-600 text-white'
                  : index === active ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-600'
                    : 'bg-slate-100 text-slate-400';
          return <span key={step} className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold ${tone}`}>{step}</span>;
        })}
      </div>
      {recorded.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5">
          {recorded.map((row, index) => (
            <span key={index} title={row.comment || ''} className={`text-[8.5px] font-semibold ${row.decision === 'rejected' ? 'text-red-600' : 'text-emerald-700'}`}>
              {row.role || row.validator_role} {row.decision === 'rejected' ? '✕' : '✓'}{row.actor ? ` ${row.actor}` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StoreDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [generating, setGenerating] = useState(false);
  const [savingOverride, setSavingOverride] = useState(false);
  const [categories, setCategories] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [templateSearch, setTemplateSearch] = useState('');
  const [pickedTemplates, setPickedTemplates] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [storeDemands, setStoreDemands] = useState([]);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetForm, setBudgetForm] = useState(0);
  const [planningTasks, setPlanningTasks] = useState([]);
  const [planningMonth, setPlanningMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [planOpen, setPlanOpen] = useState(false);
  const [planForm, setPlanForm] = useState({ id: null, title: '', start_date: '', end_date: '', progress: 0 });
  const [decisionTarget, setDecisionTarget] = useState(null);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [enterpriseOpen, setEnterpriseOpen] = useState(false);
  const [enterpriseName, setEnterpriseName] = useState('');
  const [enterpriseBusy, setEnterpriseBusy] = useState(false);
  const [bundleOpen, setBundleOpen] = useState(false);
  const [bundleForm, setBundleForm] = useState({ title: '', kind: 'article', category_id: '', description: '', deadline: '', supplier_id: '', amount_ht: '', vat_mode: '20', vat_rate: '20', amount_tva: '', amount_ttc: '', notes: '' });
  const [bundleFile, setBundleFile] = useState(null);
  const [workflowTab, setWorkflowTab] = useState(WORKFLOW_LIST[0]?.id || 'demande');
  const [transitions, setTransitions] = useState([]);
  const [confirmDeleteDemand, setConfirmDeleteDemand] = useState(null);
  const [confirmFinalDecision, setConfirmFinalDecision] = useState(null);
  const [detailsTarget, setDetailsTarget] = useState(null);
  const [showAllDemands, setShowAllDemands] = useState(false);
  const [supplierFilter, setSupplierFilter] = useState('');
  const { can, user } = useAuth();
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const projectTab = PROJECT_TABS.some(tab => tab.id === requestedTab)
    && (requestedTab !== 'historique' || user?.role === 'admin')
    && (requestedTab !== 'budget' || can('view_budget'))
    ? requestedTab
    : 'resume';

  const allowedCategory = c => {
    const role = user?.role;
    if (['admin', 'DD', 'DG', 'CDG', 'CG'].includes(role)) return true;
    if (role === 'IT') return ['IT', 'BOTH'].includes(c.owner_role);
    if (['MG', 'RMG'].includes(role)) return ['MG', 'BOTH'].includes(c.owner_role);
    return true;
  };
  const visibleCategories = categories.filter(c => /^\d{2} — /.test(c.name) && allowedCategory(c));
  const categoryGroups = [
    { label: 'IT', rows: visibleCategories.filter(c => c.owner_role === 'IT' || c.owner_role === 'BOTH') },
    { label: 'MG', rows: visibleCategories.filter(c => c.owner_role === 'MG' || c.owner_role === 'BOTH') },
  ].filter(group => group.rows.length);

  const loadDocuments = () => api.get(`/documents?store_id=${id}`).then(r => setDocuments(r.data)).catch(() => {});
  const loadPlanning = () => api.get(`/operations/planning_tasks?store_id=${id}`).then(r => setPlanningTasks(r.data)).catch(() => {});
  const load = () => {
    setData(null); setItems([]); setError('');
    api.get(`/dashboard/store/${id}`).then(r => setData(r.data)).catch(setError);
    api.get(`/items?store_id=${id}`).then(r => setItems(r.data)).catch(() => {});
    api.get(`/demands?store_id=${id}`).then(r => setStoreDemands(r.data)).catch(() => {});
    api.get(`/transitions?store_id=${id}`).then(r => setTransitions(r.data)).catch(() => {});
    loadDocuments();
    loadPlanning();
  };
  useEffect(() => {
    load();
    api.get('/categories').then(r => setCategories(r.data)).catch(() => {});
    api.get('/templates').then(r => setTemplates(r.data)).catch(() => {});
    api.get('/suppliers').then(r => setSuppliers(r.data)).catch(() => {});
  }, [id]);
  useDataRefresh(() => load(), [id]);

  async function generateChecklist() {
    setGenerating(true); setNotice('');
    try {
      const r = await api.post(`/stores/${id}/generate-items`, {});
      setNotice(`${r.data.created} article(s) ajouté(s)${r.data.skipped ? ` · ${r.data.skipped} déjà présents` : ''}`);
      load();
    } catch (e) { setError(e); }
    finally { setGenerating(false); }
  }

  async function changeOverride(e) {
    setSavingOverride(true); setError('');
    try { await api.put(`/stores/${id}`, { status_override: e.target.value || null }); load(); }
    catch (e) { setError(e); }
    finally { setSavingOverride(false); }
  }

  async function updateItemStatus(item, status) {
    setError(''); setNotice('');
    try {
      await api.patch(`/items/${item.id}/status`, { status });
      setNotice(`Étape mise à jour : ${ITEM_STEPS.find(step => step.value === status)?.label || status}`);
      load();
    } catch (e) { setError(e); }
  }

  async function runProjectTransition(to, reason = '') {
    setError(''); setNotice(''); setDecisionBusy(true);
    try {
      await api.post(`/operations/stores/${id}/project-state`, { to, reason });
      setNotice(`Étape projet : ${PROJECT_LABELS[to] || to}`);
      load();
    } catch (e) { setError(e); }
    finally { setDecisionBusy(false); }
  }

  function advanceProject(to) {
    if (['corrige', 'suspendu', 'annule'].includes(to)) setDecisionTarget({ kind: 'project', to, title: data?.name });
    else if (['ouvert', 'cloture'].includes(to)) setConfirmFinalDecision({ to, title: data?.name });
    else runProjectTransition(to);
  }

  async function confirmDecision(reason) {
    if (!decisionTarget) return;
    if (decisionTarget.kind === 'project') await runProjectTransition(decisionTarget.to, reason);
    else await validateDemand(decisionTarget.demandId, 'rejected', reason);
    setDecisionTarget(null);
  }

  async function deleteDemand(demand) {
    setError(''); setNotice('');
    try {
      const r = await api.delete(`/demands/${demand.id}`);
      const released = Number(r.data.amount_released || 0);
      setNotice(r.data.budget_released && released > 0
        ? `Demande supprimée — ${money(released)} restitués au budget DG`
        : 'Demande supprimée');
      load();
    } catch (e) { setError(e); }
  }

  async function updateStatus(itemId, status) {
    setError('');
    try { await api.patch(`/items/${itemId}/status`, { status }); load(); }
    catch (e) { setError(e); }
  }

  async function validateDemand(demandId, decision, comment = '') {
    setError(''); setNotice(''); setDecisionBusy(true);
    try {
      const r = await api.post(`/demands/${demandId}/validate`, { decision, comment });
      setNotice(`Demande ${DEMAND_LABELS[r.data.status] || r.data.status}`);
      load();
    } catch (e) { setError(e); }
    finally { setDecisionBusy(false); }
  }

  async function submitDemand(demandId) {
    setError(''); setNotice(''); setDecisionBusy(true);
    try {
      await api.post(`/demands/${demandId}/submit`, {});
      setNotice('Demande envoyée à CDG');
      load();
    } catch (e) { setError(e); }
    finally { setDecisionBusy(false); }
  }

  function updateDemandExecution(updated) {
    setStoreDemands(current => current.map(d => d.id === updated.id ? { ...d, ...updated } : d));
    setDetailsTarget(current => current?.id === updated.id ? { ...current, ...updated } : current);
    const execLabels = { accepte_dg: 'accepté DG (0%)', en_cours: 'en cours (50%)', livre: 'livré (100%)', installe: 'installé (100%)' };
    setNotice(`Suivi d’exécution : ${execLabels[updated.execution_status] || 'mis à jour'} — planning synchronisé`);
    loadPlanning();
  }

  async function saveBudget(e) {
    e.preventDefault(); setError(''); setNotice('');
    try {
      await api.put(`/stores/${id}/budget`, { budget: Number(budgetForm) });
      setNotice('Budget du magasin mis à jour et synchronisé avec le dossier');
      setBudgetOpen(false); load();
    } catch (e) { setError(e); }
  }

  function shiftMonth(delta) {
    setPlanningMonth(current => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  function openPlanning(task) {
    setPlanForm(task ? { id: task.id, title: task.title, start_date: String(task.start_date || '').slice(0, 10), end_date: String(task.end_date || '').slice(0, 10), progress: task.progress || 0 } : { id: null, title: '', start_date: '', end_date: '', progress: 0 });
    setPlanOpen(true);
  }

  async function savePlanning(e) {
    e.preventDefault(); setError(''); setNotice('');
    const payload = { title: planForm.title, start_date: planForm.start_date, end_date: planForm.end_date, progress: Number(planForm.progress) || 0 };
    try {
      if (planForm.id) await api.put(`/operations/planning_tasks/${planForm.id}`, payload);
      else await api.post('/operations/planning_tasks', { store_id: id, ...payload, owner_role: 'IT', state: payload.progress > 0 ? 'en_cours' : 'a_faire' });
      setNotice('Planning mis à jour');
      setPlanOpen(false); loadPlanning();
    } catch (e) { setError(e); }
  }

  function toggleTemplate(templateId) {
    setPickedTemplates(current => current.includes(templateId) ? current.filter(x => x !== templateId) : [...current, templateId]);
  }

  async function createEnterprise(e) {
    e.preventDefault(); setError(''); setEnterpriseBusy(true);
    try {
      const { data } = await api.post('/suppliers', { name: enterpriseName, kind: 'Entreprise' });
      setSuppliers(current => [...current, data].sort((a, b) => a.name.localeCompare(b.name)));
      setBundleForm(current => ({ ...current, supplier_id: String(data.id) }));
      setEnterpriseName(''); setEnterpriseOpen(false);
      setNotice(`Entreprise « ${data.name} » créée et sélectionnée`);
    } catch (err) { setError(err); }
    finally { setEnterpriseBusy(false); }
  }

  function recalcBundleTtc(updates) {
    setBundleForm(current => {
      const next = { ...current, ...updates };
      const ht = Number(next.amount_ht || 0);
      const rate = Number(next.vat_rate || 0);
      if (next.amount_ht !== '' && ht > 0) {
        next.amount_tva = String(Math.round(ht * rate) / 100);
        next.amount_ttc = String(Math.round(ht * (100 + rate)) / 100);
      }
      return next;
    });
  }

  function openBundle() {
    setError(''); setNotice(''); setBundleFile(null); setEnterpriseOpen(false); setEnterpriseName('');
    setBundleForm({ title: '', kind: 'article', category_id: '', description: '', deadline: '', supplier_id: '', amount_ht: '', vat_mode: '20', vat_rate: '20', amount_tva: '', amount_ttc: '', notes: '' });
    setBundleOpen(true);
  }

  async function createBundle(e) {
    e.preventDefault(); setError(''); setNotice('');
    const fd = new FormData();
    fd.append('store_id', id);
    Object.entries(bundleForm).forEach(([key, value]) => fd.append(key, value));
    if (bundleFile) fd.append('file', bundleFile);
    try {
      const { data } = await api.post('/quotes/with-demand', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setNotice(`Brouillon créé · ${money(data.quote.amount_ht)} HT · cliquez « Soumettre » pour l’envoyer au CDG (Soumis) · PDF classé sous « ${bundleForm.title} »`);      setBundleOpen(false); setBundleFile(null);
      load();
    } catch (e) { setError(e); }
  }

  async function addPickedTemplates() {
    setError(''); setNotice('');
    try {
      const r = await api.post('/items/quick', { store_id: id, template_ids: pickedTemplates });
      if (!r.data.created && !r.data.skipped) throw new Error('Aucun article ajouté');
      setNotice(`${r.data.created} article(s) ajouté(s)${r.data.skipped ? ` · ${r.data.skipped} déjà présents` : ''} · dashboard recalculé`);
      setPickedTemplates([]);
      setAddOpen(false);
      load();
    } catch (e) { setError(e); }
  }

  if (error) return <div className="text-red-600 text-sm">{error}</div>;
  if (!data) return <div className="text-muted text-sm">Chargement…</div>;

  const installed = data.items_by_status?.installed || 0;
  const shownItems = items.filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase()));
  const monthStart = planningMonth;
  const monthEnd = new Date(planningMonth.getFullYear(), planningMonth.getMonth() + 1, 0);
  const monthTasks = planningTasks.filter(t => {
    const start = new Date(t.start_date || t.created_at);
    const end = new Date(t.end_date || t.start_date || t.created_at);
    return start <= monthEnd && end >= monthStart;
  });
  const monthLabel = planningMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const demandStatusData = ['pending_cdg', 'pending_dd', 'pending_dg', 'approved', 'rejected'].map(status => ({
    name: DEMAND_LABELS[status], value: storeDemands.filter(d => d.status === status).length,
  }));
  const demandKindData = [
    { name: 'Articles', value: storeDemands.filter(d => d.kind === 'article').length },
    { name: 'Missions', value: storeDemands.filter(d => d.kind === 'mission').length },
  ].filter(entry => entry.value > 0);
  const itemCategoryData = Object.entries(items.reduce((acc, item) => {
    const key = item.category_name || item.category || 'Sans catégorie';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})).map(([name, value]) => ({ name, value }));
  const devisDocs = documents.filter(d => d.folder.startsWith('Devis'));
  const devisCount = devisDocs.length;
  const budgetUsed = data.budget > 0 ? Math.min(100, Math.round((Number(data.engaged || 0) / Number(data.budget)) * 100)) : 0;
  const demandPendingCount = storeDemands.filter(d => d.status.startsWith('pending_')).length;
  const demandApprovedCount = storeDemands.filter(d => d.status === 'approved').length;
  const demandRejectedCount = storeDemands.filter(d => d.status === 'rejected').length;
  const demandApprovedPct = storeDemands.length ? Math.round((demandApprovedCount / storeDemands.length) * 100) : 0;
  const demandPendingPct = storeDemands.length ? Math.round((demandPendingCount / storeDemands.length) * 100) : 0;
  const devisPct = storeDemands.length ? Math.min(100, Math.round((devisCount / storeDemands.length) * 100)) : 0;
  const openingPct = Math.max(0, Math.min(100, 100 - Number(data.days_to_opening || 0)));
  const averageProgress = items.length
    ? Math.round(items.reduce((sum, item) => sum + Number(item.progress || 0), 0) / items.length)
    : Number(data.progress || 0);
  const latePlanningCount = planningTasks.filter(task => task.end_date && new Date(task.end_date) < new Date() && Number(task.progress || 0) < 100).length;
  const planningDoneCount = planningTasks.filter(task => Number(task.progress || 0) >= 100).length;
  const executionData = Object.entries(data.items_by_status || {})
    .filter(([, value]) => Number(value) > 0)
    .map(([status, value]) => ({ name: STATUS_LABELS_FR[status] || status.replaceAll('_', ' '), value }));
  const planningStatusData = [
    { name: 'Terminées', value: planningDoneCount },
    { name: 'En cours', value: Math.max(0, planningTasks.length - planningDoneCount - latePlanningCount) },
    { name: 'En retard', value: latePlanningCount },
  ].filter(row => row.value > 0);
  const supplierOptions = Array.from(new Map(storeDemands.flatMap(d => d.quotes || [])
    .filter(q => q.supplier_id)
    .map(q => [String(q.supplier_id), { id: q.supplier_id, name: q.supplier_name || 'Prestataire' }])).values())
    .sort((a, b) => a.name.localeCompare(b.name));
  const canTrackExecution = ['admin', 'IT', 'MG', 'CG', 'CDG', 'DD', 'DG'].includes(user?.role);
  const canEditExecutionFor = row => Number(row?.created_by) === Number(user?.id);
  const showDept = ['admin','CDG','CG','DD','DG'].includes(user?.role);
  const filteredDemands = storeDemands
    .filter(d => !search || `${d.title} ${d.kind}`.toLowerCase().includes(search.toLowerCase()))
    .filter(d => !supplierFilter || (d.quotes || []).some(q => String(q.supplier_id) === String(supplierFilter)))
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime() || Number(b.id) - Number(a.id));
  const visibleDemands = showAllDemands ? filteredDemands : filteredDemands.slice(0, 6);
  const usableCategories = categories.filter(c => user?.role === 'admin' || c.owner_role === user?.role || c.owner_role === 'BOTH');
  const usableTemplates = templates.filter(t => user?.role === 'admin' || t.owner_role === user?.role);
  const filteredTemplates = usableTemplates.filter(t =>
    !templateSearch || `${t.name} ${t.category_name}`.toLowerCase().includes(templateSearch.toLowerCase())
  );
  const templateGroups = [...new Set(filteredTemplates.map(t => t.category_name))].map(name => ({
    name, rows: filteredTemplates.filter(t => t.category_name === name),
  }));

  return (
    <>
      <Link to="/stores" className="inline-flex items-center gap-1.5 text-[12px] font-bold text-muted hover:text-emerald-600 mb-4"><ArrowLeft size={14} /> Magasins</Link>
      <PageHeader title={data.name} subtitle={`${data.city} · Ouverture prévue le ${dateFR(data.opening_date)}`} actions={<StatusBadge status={data.computed_status} />} />
      {notice && <div className="mb-4 rounded-lg bg-emerald-50 text-emerald-700 text-[12px] font-semibold px-4 py-3">{notice}</div>}
      <section className="bento-card mb-5 p-4" title={data.status_reason}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <span className="bento-chip !py-1 !text-[9px]"><Gauge size={12} /> Signal</span>
            <StatusBadge status={data.computed_status} />
            <span className="text-[11.5px] font-semibold text-ink">{data.status_reason}</span>
          </div>
          {can('manage_stores') && (
            <label className="flex items-center gap-2 text-[11px] font-bold text-muted">
              Forcer le signal :
              <select className="input !py-1.5 !text-[11px] w-36" disabled={savingOverride} value={data.status_override || ''} onChange={changeOverride}>
                <option value="">Automatique</option>
                <option value="on_track">En bonne voie</option>
                <option value="at_risk">À risque</option>
                <option value="en_retard">En retard</option>
                <option value="ready">Prêt</option>
                <option value="ouvert">Ouvert</option>
              </select>
            </label>
          )}
        </div>
      </section>

      {projectTab === 'historique' && (<>
      <Card className="mb-5 overflow-hidden">
        <Tabs className="px-4 pt-2 bg-canvas/60" value={workflowTab} onChange={setWorkflowTab}
          tabs={[...WORKFLOW_LIST.map(w => ({ id: w.id, label: w.label })), { id: 'preuves', label: 'Preuves de décision', count: transitions.length }]} />
        <div className="tab-panel px-5 pb-5">
          {workflowTab === 'preuves' ? (
            <>
              <CardHead title="Historique des décisions" subtitle="Approbations, rejets et corrections conservés avec auteur, date et motif" />
              <DecisionProof rows={transitions} />
            </>
          ) : (
            <>
              <CardHead title={(WORKFLOW_LIST.find(w => w.id === workflowTab) || WORKFLOW_LIST[0]).label} subtitle={(WORKFLOW_LIST.find(w => w.id === workflowTab) || WORKFLOW_LIST[0]).note} />
              <WorkflowStrip states={(WORKFLOW_LIST.find(w => w.id === workflowTab) || WORKFLOW_LIST[0]).states}
                terminal={(WORKFLOW_LIST.find(w => w.id === workflowTab) || WORKFLOW_LIST[0]).terminal}
                current={data?.project_state} />
            </>
          )}
        </div>
      </Card>
      </>)}

      {projectTab === 'budget' && <BudgetCategories embedded fixedStoreId={id} />}

      {projectTab === 'planning' && <Planning embedded fixedStoreId={id} />}

      {projectTab === 'resume' && (
      <div className="reporting-shell mb-5 rounded-3xl p-5">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="bento-chip mb-3"><Sparkles size={13} className="text-[#0E7A5F]" /> Synthèse magasin · temps réel</div>
            <h2 className="text-[22px] font-extrabold tracking-tight text-[#1E2229]">Indicateurs du magasin</h2>
            <p className="mt-1 text-[12px] text-[#727A88]">Décisions rapides sur les demandes, le budget, l’échéance et les devis</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="bento-chip"><ClipboardList size={13} className="text-[#0E7A5F]" /> {shownItems.length} besoins</span>
            <span className="bento-chip"><FileUp size={13} className="text-[#D8A441]" /> {devisCount} devis</span>
          </div>
        </div>

        <section className="bento-card mb-5 p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-[14px] font-extrabold text-[#1E2229]">Vue d’ensemble</h3>
              <p className="text-[11px] text-[#8B93A1]">Montants HT, validation hiérarchique et suivi d’ouverture</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="bento-chip !py-1 !text-[10px]">Budget {money(data.budget)}</span>
              <span className="bento-chip !py-1 !text-[10px]">Engagé {money(data.engaged)}</span>
              <span className="bento-chip !py-1 !text-[10px]">Ouverture {dateFR(data.opening_date)}</span>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-8">
            <BentoKpi label="Demandes" value={storeDemands.length} sub={`${demandApprovedCount} approuvées`} icon={ClipboardList} accent="#0E7A5F" badge={`${demandApprovedPct}%`} progress={demandApprovedPct} />
            <BentoKpi label="En validation" value={demandPendingCount} sub="CDG → DD → DG" icon={Clock3} accent="#D8A441" badge="Pipeline" progress={demandPendingPct} />
            <BentoKpi label="Montant HT demandé" value={money(storeDemands.reduce((sum, demand) => sum + Number(demand.amount || 0), 0))} sub="total hors taxe" icon={Coins} accent="#16A37C" badge="HT" progress={budgetUsed} />
            <BentoKpi label="Échéance" value={`${data.days_to_opening} j`} sub={`Ouverture ${dateFR(data.opening_date)}`} icon={CalendarClock} accent="#B8862F" badge="J-" progress={openingPct} />
            <BentoKpi label="Devis" value={devisCount} sub="dans le dossier" icon={FileUp} accent="#7FB69A" badge="PDF" progress={devisPct} />
            <BentoKpi label="Budget utilisé" value={`${budgetUsed}%`} sub={`${money(data.engaged)} engagés`} icon={Wallet} accent="#0E7A5F" badge="Suivi" progress={budgetUsed} />
            <BentoKpi label="Avancement moyen" value={`${averageProgress}%`} sub={`${items.length} articles / missions`} icon={ListChecks} accent="#16A37C" badge="Réel" progress={averageProgress} />
            <BentoKpi label="Planning en retard" value={latePlanningCount} sub={`${planningTasks.length} tâches suivies`} icon={AlertTriangle} accent="#E05A4F" badge="Alerte" progress={planningTasks.length ? Math.round((latePlanningCount / planningTasks.length) * 100) : 0} />
          </div>
        </section>



        <section className="bento-card overflow-hidden">
          <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
            <div>
              <h3 className="text-[14px] font-extrabold text-[#1E2229]">Graphiques du magasin</h3>
              <p className="text-[11px] text-[#8B93A1]">Répartition des demandes et des articles</p>
            </div>
            <span className="bento-chip !py-1 !text-[10px]">Analyse</span>
          </div>
          <div className="grid gap-5 px-5 pb-5 lg:grid-cols-2">
            <div className="h-64">
              <div className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-[#8B93A1]">Demandes par statut</div>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={demandStatusData} margin={{ top: 5, right: 12, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,.18)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 14, border: '1px solid #F1E4C8', fontSize: 11 }} />
                  <Bar dataKey="value" name="Demandes" radius={[6, 6, 0, 0]}>
                    {demandStatusData.map((entry, index) => <Cell key={entry.name} fill={index % 2 ? '#D8A441' : '#0E7A5F'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="h-64">
              <div className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-[#8B93A1]">Répartition</div>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={demandKindData.length ? demandKindData : itemCategoryData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={3} label>
                    {(demandKindData.length ? demandKindData : itemCategoryData).map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 14, border: '1px solid #F1E4C8', fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <section className="bento-card mb-5 overflow-hidden">
          <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
            <div>
              <h3 className="text-[14px] font-extrabold text-[#1E2229]">Exécution et planning</h3>
              <p className="text-[11px] text-[#8B93A1]">Avancement réel, étapes d’exécution et tâches en retard</p>
            </div>
            <span className="bento-chip !py-1 !text-[10px]"><TrendingUp size={12} className="text-[#0E7A5F]" /> {averageProgress}%</span>
          </div>
          <div className="grid gap-5 px-5 pb-5 lg:grid-cols-2">
            <div className="h-56">
              <div className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-[#8B93A1]">Articles par étape</div>
              {executionData.length === 0 ? <div className="grid h-[184px] place-items-center text-[11px] text-[#8B93A1]">Aucun article suivi</div> : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={executionData} margin={{ top: 5, right: 12, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,.18)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval={0} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 14, border: '1px solid #F1E4C8', fontSize: 11 }} />
                    <Bar dataKey="value" name="Articles" radius={[6, 6, 0, 0]} fill="#16A37C" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="h-56">
              <div className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-[#8B93A1]">Santé du planning · {monthLabel}</div>
              {planningStatusData.length === 0 ? <div className="grid h-[184px] place-items-center text-[11px] text-[#8B93A1]">Aucune tâche planifiée</div> : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={planningStatusData} margin={{ top: 5, right: 12, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,.18)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 14, border: '1px solid #F1E4C8', fontSize: 11 }} />
                    <Bar dataKey="value" name="Tâches" radius={[6, 6, 0, 0]}>
                      {planningStatusData.map((entry, index) => <Cell key={entry.name} fill={entry.name === 'En retard' ? '#E05A4F' : index % 2 ? '#D8A441' : '#0E7A5F'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </section>
      </div>
      )}

      {projectTab === 'devis' && (<>
      <section className="reporting-shell mb-5 rounded-3xl p-5">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="bento-chip mb-3"><ClipboardList size={13} className="text-[#0E7A5F]" /> Suivi des demandes · magasin</div>
            <h2 className="text-[20px] font-extrabold tracking-tight text-[#1E2229]">Demandes du magasin</h2>
            <p className="mt-1 text-[11.5px] text-[#727A88]">L’essentiel : montant HT, chaîne de validation et action à mener</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {can('manage_demands') && can('upload_quotes') && (
              <button className="bento-btn bento-btn-primary" onClick={openBundle}><FileUp size={14} /> Article / mission + devis</button>
            )}
            <div className="flex items-center gap-2 rounded-xl border border-white/80 bg-white/75 px-3 py-2">
              <Search size={14} className="text-[#8B93A1]" />
              <input className="w-44 bg-transparent text-[11.5px] outline-none" placeholder="Filtrer…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-white/80 bg-white/75 px-2.5 py-1.5">
              <Users size={14} className="text-[#0E7A5F]" />
              <select className="bg-transparent text-[11px] font-semibold outline-none max-w-[170px]" value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)} title="Filtrer par prestataire">
                <option value="">Tous les prestataires</option>
                {supplierOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {supplierFilter && <button className="bento-btn !py-1.5 !px-2.5 !text-[10px]" onClick={() => setSupplierFilter('')}><Filter size={12} /> Effacer</button>}
          </div>
        </div>
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <BentoKpi label="Demandes" value={storeDemands.length} sub={`${demandPendingCount} en cours`} icon={ClipboardList} accent="#0E7A5F" badge="Total" progress={storeDemands.length ? 100 : 0} />
          <BentoKpi label="Approuvées" value={demandApprovedCount} sub={`${demandApprovedPct}% du total`} icon={TrendingUp} accent="#16A37C" badge="CDG → DG" progress={demandApprovedPct} />
          <BentoKpi label="Rejetées" value={demandRejectedCount} sub="à corriger" icon={AlertTriangle} accent="#E05A4F" badge="Action" progress={storeDemands.length ? Math.round((demandRejectedCount / storeDemands.length) * 100) : 0} />
          <BentoKpi label="Montant HT" value={money(storeDemands.reduce((sum, demand) => sum + Number(demand.amount || 0), 0))} sub={`${demandPendingCount} demandes en cours`} icon={Coins} accent="#D8A441" badge="HT" progress={budgetUsed} />
        </div>
        <div className="bento-card overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
            <div>
              <h3 className="text-[13px] font-extrabold text-[#1E2229]">Registre compact</h3>
              <p className="text-[10.5px] text-[#8B93A1]">Colonnes utiles uniquement · {visibleDemands.length} sur {filteredDemands.length} affichées</p>
            </div>
            {filteredDemands.length > 6 && (
              <button className="bento-btn !py-1.5 !px-2.5 !text-[10px]" onClick={() => setShowAllDemands(value => !value)}>
                {showAllDemands ? 'Réduire' : `Voir les ${filteredDemands.length - 6} autres`}
              </button>
            )}
          </div>
          <div className="px-5 pb-5 overflow-x-auto">
            {visibleDemands.length === 0 ? (
              <div className="py-10 text-center text-[12px] text-[#8B93A1]">Aucune demande pour ce magasin</div>
            ) : (
              <table className="w-full">
                <thead><tr><th className="bento-th min-w-[190px]">Demande</th><th className="bento-th">Montant HT</th><th className="bento-th min-w-[120px]">Chaîne</th><th className="bento-th min-w-[150px]">Exécution</th><th className="bento-th">Statut</th><th className="bento-th min-w-[190px]">Action</th></tr></thead>
                <tbody>
                  {visibleDemands.map(d => (
                    <tr key={d.id} className="hover:bg-white/55 align-top">
                      <td className="bento-td">
                        <div className="text-[12px] font-bold text-[#1E2229]">{d.title}</div>
                        <div className="mt-0.5 text-[10px] text-[#8B93A1]">{d.kind === 'mission' ? 'Mission' : 'Article'}{d.deadline ? ` · ${dateFR(d.deadline)}` : ''}</div>
                      
                        {showDept && <div className="mt-0.5 text-[10px] font-semibold text-[#0E7A5F]">{d.created_by_name || '—'}{d.created_by_department ? ` (${d.created_by_department})` : ''}</div>}
                      </td>
                      <td className="bento-td text-[11.5px] font-extrabold text-[#0E7A5F]">{money(d.amount)}</td>
                      <td className="bento-td"><ApprovalChain status={d.status} decisions={d.decisions || []} /></td>
                      <td className="bento-td"><ExecutionStatusSelect demand={d} canEdit={canEditExecutionFor(d)} onChange={updateDemandExecution} /></td>
                      <td className="bento-td"><span className="bento-chip !py-1 !text-[9.5px]" style={{ background: `${d.status === 'approved' ? '#0E7A5F' : d.status === 'rejected' ? '#E05A4F' : '#D8A441'}18`, borderColor: 'transparent', color: d.status === 'approved' ? '#0E7A5F' : d.status === 'rejected' ? '#E05A4F' : '#B8862F' }}>{DEMAND_LABELS[d.status] || d.status}</span></td>
                      <td className="bento-td">
                        <div className="flex flex-wrap gap-1.5">
                          <button type="button" className="bento-btn !py-1 !px-2 !text-[10px]" onClick={() => setDetailsTarget(d)}><Eye size={12} /> Voir</button>
                          {d.can_submit && <button className="bento-btn !py-1 !px-2 !text-[10px]" onClick={() => submitDemand(d.id)}>Soumettre</button>}
                          {d.can_validate && (
                            <>
                              <button className="bento-btn !py-1 !px-2 !text-[10px]" onClick={() => validateDemand(d.id, 'approved')}>Approuver</button>
                              <button className="bento-btn !py-1 !px-2 !text-[10px]" onClick={() => setDecisionTarget({ kind: 'demand', demandId: d.id, title: d.title })}>Rejeter</button>
                            </>
                          )}
                          {!d.can_submit && !d.can_validate && <span className="text-[10px] text-[#8B93A1]">{d.next_validator_role ? `En attente ${d.next_validator_role}` : '—'}</span>}
                          {d.can_delete && <button className="bento-btn !py-1 !px-2 !text-[10px]" onClick={() => setConfirmDeleteDemand(d)}>Supprimer</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>
      </>)}

      {projectTab === 'factures' && <Invoices embedded fixedStoreId={id} />}
      {projectTab === 'risques' && <Risks embedded fixedStoreId={id} />}
      {projectTab === 'reception' && <Site embedded fixedStoreId={id} />}

      <Modal open={bundleOpen} onClose={() => setBundleOpen(false)} title={`Article / mission + devis — ${data.name}`} xlarge>
        <form onSubmit={createBundle} className="space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-[11.5px] text-emerald-900">
            Créé en brouillon (modifiable) avec devis joint. Après clic sur « Soumettre », le statut passe à Soumis et la demande part au CDG (plus modifiable).
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-4">
              <div className="text-[12px] font-extrabold text-ink">1 · Besoin</div>
              <Field label="Type">
                <select className="input" value={bundleForm.kind} onChange={e => setBundleForm(f => ({ ...f, kind: e.target.value }))}>
                  <option value="article">Article</option><option value="mission">Mission</option>
                </select>
              </Field>
              <Field label="Catégorie">
                <select className="input" value={bundleForm.category_id} onChange={e => setBundleForm(f => ({ ...f, category_id: e.target.value }))} required>
                  <option value="">Choisir une catégorie…</option>
                  {categoryGroups.map(group => (
                    <optgroup key={group.label} label={group.label}>
                      {group.rows.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </Field>
              <Field label="Intitulé"><input className="input" value={bundleForm.title} onChange={e => setBundleForm(f => ({ ...f, title: e.target.value }))} placeholder="Ex. Mobilier accueil, installation CCTV…" required /></Field>
              <Field label="Description"><input className="input" value={bundleForm.description} onChange={e => setBundleForm(f => ({ ...f, description: e.target.value }))} placeholder="Quantité, référence, précisions…" /></Field>
              <Field label="Échéance"><input type="date" className="input" value={bundleForm.deadline} onChange={e => setBundleForm(f => ({ ...f, deadline: e.target.value }))} /></Field>
            </div>
            <div className="space-y-4">
              <div className="text-[12px] font-extrabold text-ink">2 · Devis joint</div>
              <input type="file" accept="application/pdf,.pdf" className="input !py-2 !text-[12px] w-full" onChange={e => setBundleFile(e.target.files?.[0] || null)} required />
              <Field label="Entreprise">
                <div className="flex gap-2">
                  <select className="input" value={bundleForm.supplier_id} onChange={e => setBundleForm(f => ({ ...f, supplier_id: e.target.value }))} required><option value="">Choisir…</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                  {can('manage_catalog') && <button type="button" className="btn-ghost shrink-0" onClick={() => setEnterpriseOpen(value => !value)}><Plus size={14} /> Nouvelle</button>}
                </div>
                {enterpriseOpen && (
                  <div className="flex gap-2 mt-2">
                    <input className="input !py-1.5 !text-[11.5px]" placeholder="Nom de l’entreprise" value={enterpriseName} onChange={e => setEnterpriseName(e.target.value)} required autoFocus />
                    <button type="button" className="btn-primary !py-1.5 !text-[11.5px]" disabled={enterpriseBusy} onClick={createEnterprise}>Ajouter</button>
                  </div>
                )}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Montant HT (MAD)"><input type="number" step="0.01" className="input" value={bundleForm.amount_ht} onChange={e => recalcBundleTtc({ amount_ht: e.target.value })} required /></Field>
                <Field label="TVA">
                  <select className="input" value={bundleForm.vat_mode} onChange={e => recalcBundleTtc({ vat_mode: e.target.value, vat_rate: e.target.value === 'personalise' ? bundleForm.vat_rate : e.target.value })}>
                    <option value="20">20 %</option><option value="10">10 %</option><option value="personalise">Personnalise</option>
                  </select>
                </Field>
              </div>
              {bundleForm.vat_mode === 'personalise' && (
                <Field label="TVA personnalisée (%)"><input type="number" step="0.01" min="0" max="100" className="input" value={bundleForm.vat_rate} onChange={e => recalcBundleTtc({ vat_rate: e.target.value })} required /></Field>
              )}
              <div className="rounded-lg border border-line bg-canvas/60 px-3 py-2 text-[11.5px] text-muted">
                TVA calculée : <b className="text-ink">{money(bundleForm.amount_tva)}</b> · TTC calculé : <b className="text-ink">{money(bundleForm.amount_ttc)}</b>
              </div>
              <Field label="Notes"><textarea className="input min-h-[60px]" value={bundleForm.notes} onChange={e => setBundleForm(f => ({ ...f, notes: e.target.value }))} placeholder="Conditions, garantie, remarques…" /></Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={() => setBundleOpen(false)}>Annuler</button><button className="btn-primary"><FileUp size={15} /> Créer l’ensemble</button></div>
        </form>
      </Modal>

      <DemandDetailsModal
        open={!!detailsTarget}
        onClose={() => setDetailsTarget(null)}
        demand={detailsTarget}
        busy={decisionBusy}
        canTrackExecution={canTrackExecution}
        canEditExecution={detailsTarget ? canEditExecutionFor(detailsTarget) : false}
        currentUserId={user?.id}
        onExecutionChange={updateDemandExecution}
        onApprove={() => { const target = detailsTarget; setDetailsTarget(null); if (target) validateDemand(target.id, 'approved'); }}
        onReject={() => { const target = detailsTarget; setDetailsTarget(null); if (target) setDecisionTarget({ kind: 'demand', demandId: target.id, title: target.title }); }}
      />

      <DecisionModal open={!!decisionTarget} onClose={() => setDecisionTarget(null)} title={decisionTarget?.title} busy={decisionBusy} onConfirm={confirmDecision} />

      <ConfirmDialog
        open={!!confirmDeleteDemand}
        onClose={() => setConfirmDeleteDemand(null)}
        onConfirm={() => { const demand = confirmDeleteDemand; setConfirmDeleteDemand(null); if (demand) deleteDemand(demand); }}
        title="Supprimer cette demande ?"
        message={confirmDeleteDemand?.status === 'approved'
          ? `La demande « ${confirmDeleteDemand?.title || ''} » a été approuvée par DG. Sa suppression la retirera comme si elle n'avait jamais existé et restituera ${money(confirmDeleteDemand?.amount || 0)} HT au budget DG.`
          : `La demande « ${confirmDeleteDemand?.title || ''} » sera supprimée.`}
        confirmLabel={confirmDeleteDemand?.status === 'approved' ? 'Supprimer et restituer le budget' : 'Supprimer'}
      />

      <ConfirmDialog
        open={!!confirmFinalDecision}
        onClose={() => setConfirmFinalDecision(null)}
        onConfirm={() => { const to = confirmFinalDecision?.to; setConfirmFinalDecision(null); if (to) runProjectTransition(to); }}
        title={confirmFinalDecision?.to === 'ouvert' ? 'Autoriser l’ouverture ?' : 'Clôturer le projet ?'}
        message={`Décision finale sur « ${confirmFinalDecision?.title || 'ce projet'} » : elle est enregistrée dans l’historique avec acteur, date UTC, rôle et version. Vérifiez au préalable la checklist bloquante et la validation DD.`}
        confirmLabel="Confirmer la décision"
      />

    </>
  );
}
