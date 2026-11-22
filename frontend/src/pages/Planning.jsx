import { useEffect, useMemo, useState } from 'react';
import { useDataRefresh } from '../hooks/useDataRefresh';
import { CalendarRange, ClipboardList, History, Plus, Pencil, AlertTriangle, CalendarDays, GitBranch } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Field, Modal, ErrorBox } from '../components/ui';

  const LABELS = { a_faire: 'À faire', en_cours: 'En cours', terminee: 'Terminée', suspendue: 'Suspendue' };
const num = value => Number(value) || 0;
const dateFR = value => value ? new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const iso = value => value ? new Date(value).toISOString().slice(0, 10) : '';

const EMPTY_FORM = {
  id: null, title: '', store_id: '', lot_label: '', start_date: '', end_date: '',
  owner_role: '', execution_status: 'accepte_dg', progress: 0, weight: 1, depends_on: '', milestone: false,
  change_reason: '', state: 'a_faire',
};

const EXECUTION_OPTIONS = [
  { value: 'accepte_dg', label: 'Validé (0%)', progress: 0, state: 'a_faire' },
  { value: 'en_cours', label: 'En cours (50%)', progress: 50, state: 'en_cours' },
  { value: 'livre', label: 'Livré (100%)', progress: 100, state: 'terminee' },
  { value: 'installe', label: 'Installé (100%)', progress: 100, state: 'terminee' },
];

function rangeFromTasks(tasks) {
  const dates = [new Date()];
  tasks.forEach(t => {
    [t.start_date, t.end_date, t.baseline_start_date, t.baseline_end_date].forEach(value => {
      if (!value) return;
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) dates.push(date);
    });
  });
  const min = new Date(Math.min(...dates.map(d => d.getTime())));
  const max = new Date(Math.max(...dates.map(d => d.getTime())));
  const start = new Date(min.getFullYear(), min.getMonth(), 1);
  const end = new Date(max.getFullYear(), max.getMonth() + 1, 1);
  const months = [];
  for (let cursor = new Date(start); cursor < end; cursor.setMonth(cursor.getMonth() + 1)) months.push(new Date(cursor));
  if (!months.length) months.push(new Date(start));
  return { start, end, months };
}

function chainOf(task, byId) {
  const chain = [];
  const seen = new Set();
  let current = task;
  while (current && !seen.has(String(current.id))) {
    seen.add(String(current.id));
    chain.unshift(current);
    current = byId.get(String(current.depends_on));
  }
  return chain;
}

function Kpi({ label, value, sub, tone = '#1E2229' }) {
  return (
    <div className="bento-kpi !p-4">
      <div className="text-[10.5px] font-semibold text-[#8B93A1]">{label}</div>
      <div className="mt-1 text-[22px] font-extrabold" style={{ color: tone }}>{value}</div>
      {sub && <div className="mt-1 text-[10px] text-[#8B93A1]">{sub}</div>}
    </div>
  );
}

export default function Planning({ embedded = false, fixedStoreId = null }) {
  const { can } = useAuth();
  const [tab, setTab] = useState('gantt');
  const [tasks, setTasks] = useState([]);
  const [stores, setStores] = useState([]);
  const [lots, setLots] = useState([]);
  const [storeId, setStoreId] = useState(fixedStoreId ? String(fixedStoreId) : '');
  const [zone, setZone] = useState('');
  const [owner, setOwner] = useState('');
  const [search, setSearch] = useState('');
  const [statusView, setStatusView] = useState('active');
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [versions, setVersions] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM, store_id: fixedStoreId ? String(fixedStoreId) : '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const scopeStoreId = fixedStoreId ? String(fixedStoreId) : storeId;
  const withStore = path => scopeStoreId ? `${path}${path.includes('?') ? '&' : '?'}store_id=${scopeStoreId}` : path;

  const load = () => {
    api.get(withStore('/operations/planning_tasks'), { params: zone ? { lot_label: zone } : {} }).then(r => {
      setTasks(r.data);
      setSelectedTaskId(current => current && r.data.some(t => String(t.id) === String(current)) ? current : (r.data[0] ? String(r.data[0].id) : ''));
    }).catch(setError);
    api.get('/stores').then(r => setStores(r.data)).catch(() => {});
    api.get(withStore('/operations/lots')).then(r => setLots(r.data)).catch(setError);
  };

  useEffect(() => { load(); }, [scopeStoreId, zone]);
  useDataRefresh(load, []);
  useEffect(() => {
    if (!selectedTaskId) { setVersions([]); return; }
    api.get('/governance/planning-versions', { params: { task_id: selectedTaskId } }).then(r => setVersions(r.data)).catch(() => setVersions([]));
  }, [selectedTaskId]);

  const byId = useMemo(() => new Map(tasks.map(t => [String(t.id), t])), [tasks]);
  const storeName = id => stores.find(s => String(s.id) === String(id))?.name || '-';
  const lotName = id => lots.find(l => String(l.id) === String(id))?.name || '-';
  const taskZone = t => t.lot_name || lotName(t.lot_id) || 'Sans zone';

  const delayOf = t => {
    const baselineDelay = t.end_date && t.baseline_end_date ? Math.max(0, Math.round((new Date(t.end_date) - new Date(t.baseline_end_date)) / 86400000)) : 0;
    const todayDelay = t.end_date && num(t.progress) < 100 ? Math.max(0, Math.round((Date.now() - new Date(t.end_date).getTime()) / 86400000)) : 0;
    return Math.max(num(t.delay_days), baselineDelay, todayDelay);
  };
  const progressOfTask = t => Math.max(0, Math.min(100, num(t.progress)));
  const isDone = t => progressOfTask(t) >= 100 || t.state === 'terminee' || t.execution_status === 'livre' || t.execution_status === 'installe';

  const shown = tasks.filter(t =>
    (!scopeStoreId || String(t.store_id) === String(scopeStoreId))
    && (!zone || taskZone(t).toLowerCase().includes(zone.toLowerCase()))
    && (!owner || t.owner_role === owner)
  );

  const gantTasks = shown.filter(t => {
    const q = search.trim().toLowerCase();
    if (q && ![t.title, taskZone(t), storeName(t.store_id), t.owner_role].some(v => String(v || '').toLowerCase().includes(q))) return false;
    if (statusView === 'active') return !isDone(t);
    if (statusView === 'done') return isDone(t);
    if (statusView === 'late') return delayOf(t) > 0 && !isDone(t);
    if (statusView === 'not_started') return progressOfTask(t) === 0 && !isDone(t);
    if (statusView === 'in_progress') return progressOfTask(t) > 0 && !isDone(t);
    return true;
  });

  const range = useMemo(() => rangeFromTasks(gantTasks.length ? gantTasks : shown.length ? shown : tasks), [gantTasks, shown, tasks]);
  const criticalIds = useMemo(() => {
    let bestChain = [];
    gantTasks.forEach(t => {
      const chain = chainOf(t, byId);
      const weight = chain.reduce((sum, item) => sum + (num(item.weight) || 1), 0);
      const bestWeight = bestChain.reduce((sum, item) => sum + (num(item.weight) || 1), 0);
      if (chain.length > bestChain.length || (chain.length === bestChain.length && weight > bestWeight)) bestChain = chain;
    });
    return new Set(bestChain.map(t => String(t.id)));
  }, [gantTasks, byId]);

  const groups = useMemo(() => {
    const map = new Map();
    gantTasks.forEach(t => { const key = taskZone(t); if (!map.has(key)) map.set(key, []); map.get(key).push(t); });
    return Array.from(map.entries()).map(([name, items]) => ({
      name, items,
      progress: items.length ? Math.round(items.reduce((s, i) => s + progressOfTask(i), 0) / items.length) : 0,
      late: items.filter(i => delayOf(i) > 0 && !isDone(i)).length,
    }));
  }, [gantTasks]);

  const owners = Array.from(new Set(shown.map(t => t.owner_role).filter(Boolean)));
  const pos = value => { if (!value) return 0; const time = new Date(value).getTime(); if (Number.isNaN(time)) return 0; return Math.max(0, Math.min(100, ((time - range.start.getTime()) / (range.end.getTime() - range.start.getTime())) * 100)); };
  const barStyle = (start, end) => { const left = pos(start); const right = pos(end); return { left: `${left}%`, width: `${Math.max(1.5, right - left)}%` }; };
  const gridStyle = { gridTemplateColumns: `repeat(${Math.max(1, range.months.length)}, minmax(0, 1fr))` };
  const boardStyle = { minWidth: `${Math.max(880, range.months.length * 120)}px` };

  function toneOf(t) {
    const p = progressOfTask(t);
    const late = delayOf(t) > 0 && !isDone(t);
    if (late) return { bar: 'bg-red-500', chip: 'En retard', chipClass: 'bg-red-50 text-red-700' };
    if (isDone(t)) return { bar: 'bg-emerald-500', chip: 'Terminée 100%', chipClass: 'bg-emerald-50 text-emerald-700' };
    if (p > 0 || t.state === 'en_cours') return { bar: 'bg-sky-500', chip: 'En cours 50%', chipClass: 'bg-sky-50 text-sky-700' };
    return { bar: 'bg-slate-400', chip: 'Validé 0%', chipClass: 'bg-slate-100 text-slate-600' };
  }

  function openCreate() { setForm({ ...EMPTY_FORM, store_id: scopeStoreId, lot_label: zone, start_date: new Date().toISOString().slice(0, 10) }); setModal(true); }
  function openEdit(task) {
    const inferred = task.execution_status || (num(task.progress) >= 100 ? 'installe' : num(task.progress) > 0 ? 'en_cours' : 'accepte_dg');
    const opt = EXECUTION_OPTIONS.find(o => o.value === inferred) || EXECUTION_OPTIONS[0];
    setForm({ id: task.id, title: task.title || '', store_id: String(task.store_id || ''), lot_label: task.lot_name || lots.find(l => String(l.id) === String(task.lot_id))?.name || '', start_date: iso(task.start_date), end_date: iso(task.end_date), owner_role: task.owner_role || '', execution_status: opt.value, progress: opt.progress, weight: num(task.weight) || 1, depends_on: String(task.depends_on || ''), milestone: !!task.milestone, change_reason: '', state: opt.state });
    setModal(true);
  }

  async function save(e) {
    e.preventDefault(); setError(''); setNotice('');
    const opt = EXECUTION_OPTIONS.find(o => o.value === form.execution_status) || EXECUTION_OPTIONS[0];
    const payload = { title: form.title, store_id: scopeStoreId || form.store_id, lot_label: form.lot_label || null, start_date: form.start_date || null, end_date: form.end_date || null, owner_role: form.owner_role || null, execution_status: opt.value, progress: opt.progress, state: opt.state, weight: num(form.weight) || 1, depends_on: form.depends_on || null, milestone: !!form.milestone, change_reason: form.change_reason || null };
    try {
      if (form.id) { await api.put(`/operations/planning_tasks/${form.id}`, payload); setNotice('Tâche mise à jour'); }
      else { await api.post('/operations/planning_tasks', payload); setNotice('Tâche créée'); }
      setModal(false); setForm({ ...EMPTY_FORM, store_id: scopeStoreId || '' }); load();
    } catch (e) { setError(e); }
  }

  const tabs = [
    { id: 'gantt', label: 'Gantt', icon: CalendarRange, count: gantTasks.length },
    { id: 'tasks', label: 'Tâches', icon: ClipboardList, count: shown.length },
    { id: 'versions', label: 'Versions', icon: History, count: versions.length },
  ];

  const shell = embedded ? '' : 'reporting-shell -mx-5 -mt-5 -mb-5 min-h-screen px-5 py-6 sm:-mx-7 sm:-mt-7 sm:-mb-7 sm:px-7';

  return (
    <div className={shell}>
      {!embedded && (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="bento-chip mb-3"><CalendarRange size={13} className="text-[#0E7A5F]" /> Pilotage planning</div>
            <h1 className="text-[24px] font-extrabold tracking-tight text-[#1E2229]">Planning</h1>
            <p className="mt-1 text-[12.5px] text-[#727A88]">Gantt, dépendances, jalons, lignes de base et révisions</p>
          </div>
          {can('manage_operations') && <button className="bento-btn bento-btn-primary" onClick={openCreate}><Plus size={15} /> Nouvelle tâche</button>}
        </div>
      )}
      {embedded && can('manage_operations') && <div className="mb-4 flex justify-end"><button className="bento-btn bento-btn-primary" onClick={openCreate}><Plus size={15} /> Nouvelle tâche</button></div>}
      <ErrorBox error={error} />
      {notice && <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-[12px] font-semibold text-emerald-700">{notice}</div>}

      <div className="bento-card mb-5 p-4">
        <div className="flex flex-wrap items-center gap-3">
          {!fixedStoreId && <select className="bento-select w-52" value={storeId} onChange={e => { setStoreId(e.target.value); setZone(''); }}><option value="">Tous les magasins</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
          <input className="bento-input w-52" value={zone} onChange={e => setZone(e.target.value)} placeholder="Filtrer par zone / lot?" />
          <select className="bento-select w-44" value={owner} onChange={e => setOwner(e.target.value)}><option value="">Tous les responsables</option>{owners.map(o => <option key={o} value={o}>{o}</option>)}</select>
          <input className="bento-input w-56" value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher une tâche…" />
          <select className="bento-select w-44" value={statusView} onChange={e => setStatusView(e.target.value)}>
            <option value="active">Actives (défaut)</option><option value="in_progress">En cours (50%)</option><option value="not_started">Validé (0%)</option><option value="late">En retard</option><option value="all">Tout</option>
          </select>
          <div className="ml-auto flex flex-wrap items-center gap-3 text-[10.5px] text-[#8B93A1]">
            <span className="flex items-center gap-1.5"><i className="w-5 h-3 rounded bg-slate-400 inline-block" /> 0%</span>
            <span className="flex items-center gap-1.5"><i className="w-5 h-3 rounded bg-sky-500 inline-block" /> 50%</span>
            <span className="flex items-center gap-1.5"><i className="w-5 h-3 rounded bg-emerald-500 inline-block" /> 100%</span>
            <span className="flex items-center gap-1.5"><i className="w-5 h-3 rounded bg-red-500 inline-block" /> Retard</span>
          </div>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi label="Affichées" value={gantTasks.length} sub={`sur ${shown.length} tâche(s)`} />
        <Kpi label="En cours (50%)" value={gantTasks.filter(t => progressOfTask(t) > 0 && !isDone(t)).length} tone="#0284c7" />
        <Kpi label="Terminées (100%)" value={gantTasks.filter(t => isDone(t)).length} tone="#0E7A5F" />
        <Kpi label="En retard" value={gantTasks.filter(t => delayOf(t) > 0 && !isDone(t)).length} tone="#dc2626" />
        <Kpi label="Zones / lots" value={groups.length} sub="groupés" />
      </div>

      <div className="bento-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/60 px-5 py-3 bg-white/40">
          {tabs.map(t => (
            <button key={t.id} className={`bento-chip !py-1.5 ${tab === t.id ? 'ring-2 ring-emerald-500 bg-white' : ''}`} onClick={() => setTab(t.id)}>
              <t.icon size={13} /> {t.label} <span className="opacity-60">({t.count})</span>
            </button>
          ))}
        </div>
        <div className="p-5">
          {tab === 'gantt' && (
            gantTasks.length === 0 ? <div className="py-10 text-center text-[12px] text-[#8B93A1]">Aucune tâche pour ces filtres</div> : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-[10.5px]">
                  <span className="bento-chip">Vue groupée par zone</span>
                  <button className="bento-btn !py-1.5 !px-2.5 !text-[10.5px]" onClick={() => setCollapsedGroups({})}>Tout déplier</button>
                  <button className="bento-btn !py-1.5 !px-2.5 !text-[10.5px]" onClick={() => setCollapsedGroups(Object.fromEntries(groups.map(g => [g.name, true])))}>Tout replier</button>
                </div>
                <div className="overflow-x-auto rounded-2xl border border-white/70 bg-white/40">
                  <div style={boardStyle}>
                    <div className="sticky top-0 z-10 flex border-b border-line bg-[#f7fbf9]/95 backdrop-blur">
                      <div className="w-72 shrink-0 px-3 py-2 text-[10.5px] font-extrabold uppercase tracking-wider text-[#8B93A1]">Zone / tâche</div>
                      <div className="flex-1 grid" style={gridStyle}>{range.months.map(m => <div key={m.toISOString()} className="px-2 py-2 text-center text-[10.5px] font-bold text-[#8B93A1] border-l border-line/70">{m.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })}</div>)}</div>
                    </div>
                    {groups.map(group => {
                      const collapsed = !!collapsedGroups[group.name];
                      return (
                        <div key={group.name} className="border-b border-line/70">
                          <button type="button" className="flex w-full items-stretch bg-[#eef7f3]/70 text-left hover:bg-[#e7f3ee]" onClick={() => setCollapsedGroups(v => ({ ...v, [group.name]: !v[group.name] }))}>
                            <div className="w-72 shrink-0 px-3 py-2.5">
                              <div className="flex items-center gap-2"><span className={`grid h-5 w-5 place-items-center rounded bg-white/80 text-[10px] font-black text-emerald-700 transition ${collapsed ? '' : 'rotate-90'}`}>?</span><span className="text-[11.5px] font-extrabold text-[#1E2229] truncate">{group.name}</span><span className="bento-chip !py-0.5 !px-1.5 !text-[10px]">{group.items.length}</span></div>
                              <div className="mt-1 text-[10px] text-[#8B93A1]">Moy. {group.progress}% ? {group.late ? `${group.late} en retard` : 'aucun retard'}</div>
                            </div>
                            <div className="relative flex-1 grid items-center" style={gridStyle}>
                              {range.months.map(m => <div key={m.toISOString()} className="h-full border-l border-line/40" />)}
                              <div className="absolute left-2 right-2 top-1/2 -translate-y-1/2 h-2 rounded-full bg-white/70"><div className={`h-full rounded-full ${group.late ? 'bg-red-400' : group.progress >= 100 ? 'bg-emerald-500' : group.progress > 0 ? 'bg-sky-500' : 'bg-slate-400'}`} style={{ width: `${Math.max(2, group.progress)}%` }} /></div>
                            </div>
                          </button>
                          {!collapsed && group.items.map(t => {
                            const critical = criticalIds.has(String(t.id));
                            const dependency = byId.get(String(t.depends_on));
                            const tone = toneOf(t);
                            const late = delayOf(t);
                            return (
                              <div key={t.id} className="flex items-stretch border-t border-line/50 hover:bg-white/40">
                                <div className="w-72 shrink-0 px-3 py-2 pl-10">
                                  <div className="flex items-center gap-1.5 min-w-0">{t.milestone && <CalendarDays size={11} className="text-amber-500 shrink-0" />}<span className="text-[11.5px] font-bold truncate" title={t.title}>{t.title}</span></div>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5"><span className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-bold ${tone.chipClass}`}>{tone.chip}</span>{critical && <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[9.5px] font-bold text-red-700">Critique</span>}</div>
                                  <div className="text-[10px] text-[#8B93A1] truncate mt-0.5">{storeName(t.store_id)} ? {t.owner_role || '-'}{dependency ? ` ? ? ${dependency.title}` : ''}</div>
                                </div>
                                <div className="relative flex-1 h-14 grid" style={gridStyle}>
                                  {range.months.map(m => <div key={m.toISOString()} className="border-l border-line/40" />)}
                                  {(t.baseline_start_date || t.baseline_end_date) && <div className="absolute top-[11px] h-1 rounded bg-slate-500/40" style={barStyle(t.baseline_start_date || t.start_date, t.baseline_end_date || t.end_date)} />}
                                  <div className={`absolute top-[18px] h-4 rounded-md flex items-center justify-center shadow-sm ring-1 ring-white/60 ${tone.bar}`} style={barStyle(t.start_date, t.end_date)} title={`${t.title} ? ${tone.chip} ? D?but: ${dateFR(t.start_date)} ? Fin: ${dateFR(t.end_date)}`}>
                                    <span className="text-[9px] font-extrabold text-white truncate px-1">{progressOfTask(t)}%</span>
                                  </div>
                                  {t.milestone && <div className="absolute top-[16px] w-3 h-3 rotate-45 bg-amber-500 border border-white" style={{ left: `calc(${pos(t.start_date)}% - 6px)` }} />}
                                  {late > 0 && <span className="absolute right-1 top-1 rounded bg-red-50 px-1.5 py-0.5 text-[9px] font-bold text-red-600">+{late} j</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                    <div className="flex justify-between text-[10px] text-[#8B93A1] px-3 py-3 bg-[#f7fbf9]/60"><span>{dateFR(range.start)}</span><span className="flex items-center gap-1"><GitBranch size={11} /> Gris 0% ? Bleu 50% ? Vert 100% ? Rouge en retard</span><span>{dateFR(range.end)}</span></div>
                  </div>
                </div>
              </div>
            )
          )}

          {tab === 'tasks' && (
            shown.length === 0 ? <div className="py-10 text-center text-[12px] text-[#8B93A1]">Aucune tâche</div> : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr><th className="bento-th">Tâche</th><th className="bento-th">Magasin / Zone</th><th className="bento-th">Début</th><th className="bento-th">Fin</th><th className="bento-th">Statut</th><th className="bento-th">Avancement</th><th className="bento-th">Base</th><th className="bento-th w-24">Actions</th></tr></thead>
                  <tbody>
                    {shown.map(t => (
                      <tr key={t.id} className="hover:bg-white/50">
                        <td className="bento-td"><div className="font-bold text-[11.5px]">{t.milestone && <CalendarDays size={11} className="inline text-amber-500 mr-1" />}{t.title}</div><div className="text-[10px] text-[#8B93A1]">{t.owner_role || '-'}  ? v{num(t.revision) || 1}</div></td>
                        <td className="bento-td text-[11px]"><div>{storeName(t.store_id)}</div><div className="text-[#8B93A1]">{lotName(t.lot_id)}</div></td>
                        <td className="bento-td text-[11px]">{dateFR(t.start_date)}</td>
                        <td className="bento-td text-[11px]">{dateFR(t.end_date)}</td>
                        <td className="bento-td text-[10.5px] text-[#8B93A1]">{dateFR(t.baseline_start_date)} ? {dateFR(t.baseline_end_date)}</td>
                        <td className="bento-td">{delayOf(t) > 0 ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700"><AlertTriangle size={10} className="inline" /> +{delayOf(t)} j</span> : <span className="text-[11px] text-emerald-700">0 j</span>}</td>
                        <td className="bento-td"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${toneOf(t).chipClass}`}>{progressOfTask(t)}%</span></td>
                        <td className="bento-td">
                          <div className="flex flex-wrap gap-1.5">
                            {can('manage_operations') && <button className="bento-btn !py-1 !px-2 !text-[10.5px]" onClick={() => openEdit(t)}><Pencil size={11} /> Modifier</button>}
                            <button className="bento-btn !py-1 !px-2 !text-[10.5px]" onClick={() => { setSelectedTaskId(String(t.id)); setTab('versions'); }}>Versions</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {tab === 'versions' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h3 className="text-[14px] font-extrabold text-[#1E2229]">Historique des versions</h3><p className="text-[11px] text-[#8B93A1]">Révisions de dates et d'avancement avec motif</p></div>
                <select className="bento-select w-64" value={selectedTaskId} onChange={e => setSelectedTaskId(e.target.value)}><option value="">Choisir une tâche…</option>{tasks.map(t => <option key={t.id} value={t.id}>{t.store_name} ? {t.name}</option>)}</select>
              </div>
              {!selectedTaskId ? <div className="py-8 text-center text-[12px] text-[#8B93A1]">Sélectionnez une tâche</div> : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead><tr><th className="bento-th">Révision</th><th className="bento-th">Début</th><th className="bento-th">Fin</th><th className="bento-th">Avancement</th><th className="bento-th">Par</th><th className="bento-th">Motif</th><th className="bento-th">Date</th></tr></thead>
                    <tbody>
                      {versions.length === 0 && <tr><td colSpan="7" className="bento-td text-center text-[#8B93A1] py-8">Aucune version enregistrée</td></tr>}
                      {versions.map(v => (
                        <tr key={v.id} className="hover:bg-white/50">
                          <td className="bento-td font-bold">v{v.revision}</td>
                          <td className="bento-td text-[11px]">{dateFR(v.start_date)}</td>
                          <td className="bento-td text-[11px]">{dateFR(v.end_date)}</td>
                          <td className="bento-td text-[11px]">{num(v.progress)}%</td>
                          <td className="bento-td text-[11px]">{v.changed_by_name || '-'}</td>
                          <td className="bento-td text-[11px] text-[#8B93A1]">{v.reason || '-'}</td>
                          <td className="bento-td text-[11px] text-[#8B93A1]">{dateFR(v.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={form.id ? 'Modifier la tâche' : 'Nouvelle tâche de planning'} wide>
        <form onSubmit={save} className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Intitul?" className="md:col-span-2"><input className="bento-input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required /></Field>
            {!fixedStoreId && <Field label="Magasin"><select className="bento-select" value={form.store_id} onChange={e => setForm(f => ({ ...f, store_id: e.target.value }))} required><option value="">Choisir?</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
            <Field label="Zone / chantier (libre)"><input className="bento-input" value={form.lot_label} onChange={e => setForm(f => ({ ...f, lot_label: e.target.value }))} placeholder="Ex. Génie civil, enseigne?" /></Field>
            <Field label="Date de début"><input type="date" className="bento-input" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} required /></Field>
            <Field label="Date de fin"><input type="date" className="bento-input" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} required /></Field>
            <Field label="Responsable"><input className="bento-input" value={form.owner_role} onChange={e => setForm(f => ({ ...f, owner_role: e.target.value }))} placeholder="Ex. IT, MG, RMG?" /></Field>
            <Field label="Statut d'exécution">
              <select className="bento-select" value={form.execution_status} onChange={e => { const opt = EXECUTION_OPTIONS.find(o => o.value === e.target.value) || EXECUTION_OPTIONS[0]; setForm(f => ({ ...f, execution_status: opt.value, progress: opt.progress, state: opt.state })); }}>
                {EXECUTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <div className="mt-1 text-[10px] text-[#8B93A1]">Validé (0%) ? En cours (50%) ? Livré/Installé (100%)</div>
            </Field>
            <Field label="Poids"><input type="number" min="1" className="bento-input" value={form.weight} onChange={e => setForm(f => ({ ...f, weight: e.target.value }))} /></Field>
            <Field label="Dépend de"><select className="bento-select" value={form.depends_on} onChange={e => setForm(f => ({ ...f, depends_on: e.target.value }))}><option value="">Aucune dépendance</option>{tasks.filter(t => !form.id || t.id !== form.id).map(t => <option key={t.id} value={t.id}>{t.store_name} ? {t.name}</option>)}</select></Field>
            <Field label="Jalon"><select className="bento-select" value={form.milestone ? 'true' : 'false'} onChange={e => setForm(f => ({ ...f, milestone: e.target.value === 'true' }))}><option value="false">Non</option><option value="true">Oui</option></select></Field>
            <Field label="Motif de modification" className="md:col-span-2"><textarea className="bento-input min-h-[80px]" value={form.change_reason} onChange={e => setForm(f => ({ ...f, change_reason: e.target.value }))} placeholder="Motif du changement?" /></Field>
          </div>
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="bento-btn" onClick={() => setModal(false)}>Annuler</button><button className="bento-btn bento-btn-primary">{form.id ? 'Enregistrer les modifications' : 'Créer la tâche'}</button></div>
        </form>
      </Modal>
    </div>
  );
}
