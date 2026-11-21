import { useEffect, useMemo, useState } from 'react';
import { useDataRefresh } from '../hooks/useDataRefresh';
import { Search, ScrollText, RefreshCcw, CalendarClock, LogIn, ShieldX, CheckCircle2, Globe, Eye } from 'lucide-react';
import api from '../api/client';
import { Card, PageHeader, Empty, ErrorBox, Modal } from '../components/ui';

const PAGE_SIZES = [10, 25, 50, 100];
const ACTION_LABELS = {
  LOGIN_SUCCESS: 'Connexion', LOGOUT: 'Déconnexion', LOGIN_FAILED: 'Échec connexion',
  CREATE_USER: 'Création', UPDATE_USER: 'Modification', RESET_PASSWORD: 'Réinitialisation', DEACTIVATE_USER: 'Désactivation',
  CREATE_DEMAND: 'Création', UPDATE_DEMAND: 'Modification', SUBMIT_DEMAND: 'Soumission', DELETE_DEMAND: 'Suppression',
  UPDATE_DEMAND_ACTION: 'Action', UPDATE_DEMAND_EXECUTION: 'Exécution',
  UPLOAD_QUOTE: 'Devis', CREATE_DEMAND_WITH_QUOTE: 'Demande + devis',
  CREATE_STORE: 'Création', UPDATE_STORE: 'Modification', DELETE_STORE: 'Suppression', UPDATE_STORE_BUDGET: 'Budget',
};
const ENTITY_LABELS = {
  user: 'Utilisateur', demand: "Demande d'achat", quote: 'Devis', store: 'Magasin', item: 'Article',
  comparison: 'Comparatif', document: 'Document', category: 'Catégorie', supplier: 'Fournisseur',
  notification: 'Notification', email: 'Email', planning_task: 'Planning', risk: 'Risque',
};

function titleCase(v) { return String(v || '').replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, t => t.toUpperCase()); }
function fmtDate(d) { try { return new Date(d).toLocaleDateString('fr-FR'); } catch { return '—'; } }
function fmtTime(d) { try { return new Date(d).toLocaleTimeString('fr-FR'); } catch { return ''; } }

function actionMeta(action = '') {
  const a = String(action).toUpperCase();
  if (a.includes('LOGIN_FAILED') || a.includes('ECHEC')) return { label: 'Échec connexion', cls: 'bg-red-100 text-red-700 border-red-200' };
  if (a.includes('LOGIN_SUCCESS') || a === 'CONNEXION') return { label: 'Connexion', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
  if (a.includes('LOGOUT') || a.includes('DECONNEX')) return { label: 'Déconnexion', cls: 'bg-slate-100 text-slate-700 border-slate-200' };
  if (a.includes('APPROV') || a.includes('VALID') || a.includes('APPROB')) return { label: ACTION_LABELS[action] || 'Approbation', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
  if (a.includes('REJET') || a.includes('REJECT') || a.includes('CORRECT')) return { label: 'Rejet / correction', cls: 'bg-red-100 text-red-700 border-red-200' };
  if (a.includes('EMAIL') || a.includes('MAIL') || a.includes('NOTIF')) return { label: 'Email envoyé', cls: 'bg-amber-100 text-amber-700 border-amber-200' };
  if (a.includes('DELETE') || a.includes('REMOVE') || a.includes('SUPPR') || a.includes('DEACTIV')) return { label: ACTION_LABELS[action] || 'Suppression', cls: 'bg-red-100 text-red-700 border-red-200' };
  if (a.includes('SUBMIT') || a.includes('SOUMIS')) return { label: ACTION_LABELS[action] || 'Soumission', cls: 'bg-sky-100 text-sky-700 border-sky-200' };
  if (a.includes('CREATE') || a.includes('UPLOAD') || a.includes('ADD')) return { label: ACTION_LABELS[action] || 'Création', cls: 'bg-indigo-100 text-indigo-700 border-indigo-200' };
  if (a.includes('UPDATE') || a.includes('EDIT') || a.includes('MODIF') || a.includes('RESET') || a.includes('CHANGE')) return { label: ACTION_LABELS[action] || 'Modification', cls: 'bg-blue-100 text-blue-700 border-blue-200' };
  return { label: ACTION_LABELS[action] || titleCase(action), cls: 'bg-slate-100 text-slate-700 border-slate-200' };
}

function describe(r) {
  const d = r.details || {};
  const user = r.user_name || 'Système';
  const a = String(r.action || '').toUpperCase();
  if (a === 'LOGIN_SUCCESS') return `${user} s'est connecté`;
  if (a === 'LOGOUT') return `${user} s'est déconnecté`;
  if (a === 'LOGIN_FAILED') return `Tentative de connexion échouée${d.email ? ` (${d.email})` : ''}`;
  if (a === 'CHANGE_PASSWORD') return `${user} a modifié son mot de passe`;
  if (a === 'RESET_PASSWORD') return `Mot de passe réinitialisé${d.email ? ` pour ${d.email}` : ''}`;
  if (a === 'CREATE_USER') return `Utilisateur créé${d.role ? ` (rôle ${d.role})` : ''}`;
  if (a === 'UPDATE_USER') return `Utilisateur mis à jour${r.entity_id ? ` #${r.entity_id}` : ''}`;
  if (a === 'DEACTIVATE_USER') return `Utilisateur désactivé${r.entity_id ? ` #${r.entity_id}` : ''}`;
  if (a.includes('SUBMIT')) return `${ENTITY_LABELS[r.entity] || titleCase(r.entity)} soumis(e)${r.entity_id ? ` #${r.entity_id}` : ''}`;
  if (a.includes('APPROV') || a.includes('VALID')) return `${ENTITY_LABELS[r.entity] || titleCase(r.entity)} approuvé(e)/validé(e)${r.entity_id ? ` #${r.entity_id}` : ''}${d.comment ? ` — ${d.comment}` : ''}`;
  if (a.includes('REJET') || a.includes('REJECT')) return `${ENTITY_LABELS[r.entity] || titleCase(r.entity)} rejeté(e)${r.entity_id ? ` #${r.entity_id}` : ''}${d.comment ? ` — ${d.comment}` : ''}`;
  if (a.startsWith('CREATE_')) return `${ENTITY_LABELS[r.entity] || titleCase(r.entity)} créé(e)${r.entity_id ? ` #${r.entity_id}` : ''}`;
  if (a.startsWith('UPDATE_')) return `${ENTITY_LABELS[r.entity] || titleCase(r.entity)} modifié(e)${r.entity_id ? ` #${r.entity_id}` : ''}`;
  if (a.startsWith('DELETE_')) return `${ENTITY_LABELS[r.entity] || titleCase(r.entity)} supprimé(e)${r.entity_id ? ` #${r.entity_id}` : ''}`;
  if (a.startsWith('UPLOAD_')) return `${ENTITY_LABELS[r.entity] || titleCase(r.entity)} importé(e)${r.entity_id ? ` #${r.entity_id}` : ''}`;
  const extra = d.title || d.name || d.reference || d.email || d.reason || d.comment || '';
  return `${titleCase(r.action)}${extra ? ` — ${extra}` : ''}`;
}

function Kpi({ icon: Icon, label, value, tone = 'text-ink' }) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-canvas grid place-items-center text-emerald-700"><Icon size={18} /></div>
      <div><div className={`text-2xl font-extrabold leading-none ${tone}`}>{value ?? 0}</div><div className="text-[11px] text-muted mt-1 font-semibold">{label}</div></div>
    </Card>
  );
}

export default function Audit() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [stats, setStats] = useState({});
  const [filtersMeta, setFiltersMeta] = useState({ actions: [], entities: [], users: [] });
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [userId, setUserId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);

  const load = (p = page, ps = pageSize) => {
    setLoading(true); setError('');
    api.get('/audit', { params: { q, action, entity, user_id: userId, date_from: dateFrom, date_to: dateTo, page: p, page_size: ps } })
      .then(r => {
        const d = Array.isArray(r.data) ? { items: r.data, total: r.data.length, stats: {}, filters: {} } : r.data;
        setRows(d.items || []); setTotal(d.total || 0); setStats(d.stats || {}); setFiltersMeta(d.filters || { actions: [], entities: [], users: [] });
        setPage(d.page || p); setPageSize(d.page_size || ps);
      })
      .catch(e => setError(e?.response?.data?.error || e.message || 'Erreur de chargement'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(1, pageSize); }, [action, entity, userId, dateFrom, dateTo, pageSize]);
  useDataRefresh(load, []);
  useEffect(() => { const t = setTimeout(() => load(1, pageSize), 350); return () => clearTimeout(t); }, [q]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);

  function reset() { setQ(''); setAction(''); setEntity(''); setUserId(''); setDateFrom(''); setDateTo(''); setPage(1); }
  const pages = useMemo(() => {
    const arr = []; const start = Math.max(1, page - 2); const end = Math.min(totalPages, start + 4);
    for (let i = start; i <= end; i++) arr.push(i); return arr;
  }, [page, totalPages]);

  return (
    <>
      <PageHeader title="Journal d'activité" subtitle="Suivi complet de toutes les actions effectuées dans le système" />
      <ErrorBox error={error} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-5">
        <Kpi icon={ScrollText} label="événement(s)" value={stats.total ?? total} />
        <Kpi icon={CalendarClock} label="Actions aujourd'hui" value={stats.today ?? 0} />
        <Kpi icon={LogIn} label="Connexions" value={stats.logins ?? 0} tone="text-emerald-700" />
        <Kpi icon={ShieldX} label="Échecs connexion" value={stats.login_failures ?? 0} tone={(stats.login_failures||0) ? 'text-red-600' : 'text-ink'} />
        <Kpi icon={CheckCircle2} label="Validations" value={stats.validations ?? 0} />
        <Kpi icon={Globe} label="IPs uniques" value={stats.unique_ips ?? 0} />
      </div>

      <Card className="p-4 mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 border border-line rounded-lg px-3 py-2 flex-1 min-w-[240px] bg-white">
            <Search size={15} className="text-muted" />
            <input className="outline-none text-[12.5px] w-full" placeholder="Rechercher par description, utilisateur, IP..." value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <label className="text-[12px] text-muted font-semibold flex items-center gap-2">Afficher
            <select className="input !py-1.5 !w-20" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>{PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}</select>
          </label>
          <select className="input !py-2 !w-auto min-w-[160px]" value={action} onChange={e => setAction(e.target.value)}>
            <option value="">Toutes les actions</option>
            {(filtersMeta.actions || []).map(a => <option key={a} value={a}>{actionMeta(a).label} — {a}</option>)}
          </select>
          <select className="input !py-2 !w-auto min-w-[150px]" value={entity} onChange={e => setEntity(e.target.value)}>
            <option value="">Toutes les entités</option>
            {(filtersMeta.entities || []).map(en => <option key={en} value={en}>{ENTITY_LABELS[en] || titleCase(en)}</option>)}
          </select>
          <select className="input !py-2 !w-auto min-w-[170px]" value={userId} onChange={e => setUserId(e.target.value)}>
            <option value="">Tous les utilisateurs</option>
            {(filtersMeta.users || []).map(u => <option key={u.id} value={u.id}>{u.name}{u.role ? ` (${u.role})` : ''}</option>)}
          </select>
          <input type="date" className="input !py-2 !w-auto" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <input type="date" className="input !py-2 !w-auto" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          <button className="btn-ghost !py-2" onClick={reset}><RefreshCcw size={14} /> Réinitialiser</button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {loading && rows.length === 0 ? <div className="py-10 text-center text-muted text-[12px]">Chargement…</div>
          : rows.length === 0 ? <Empty text="Aucun événement dans le journal" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[980px]">
            <thead><tr>
              <th className="th">Date & Heure</th><th className="th">Utilisateur</th><th className="th">Action</th>
              <th className="th">Description</th><th className="th">Entité</th><th className="th">Adresse IP</th><th className="th">Détails</th>
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const meta = actionMeta(r.action);
                return (
                  <tr key={r.id} className="hover:bg-canvas/60 align-top">
                    <td className="td whitespace-nowrap">
                      <div className="font-semibold text-[12px]">{fmtDate(r.created_at)}</div>
                      <div className="text-[11px] text-muted">{fmtTime(r.created_at)}</div>
                    </td>
                    <td className="td">
                      <div className="font-bold text-[12.5px]">{r.user_name || 'Système'}</div>
                      {r.user_role && <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">{r.user_role}</span>}
                    </td>
                    <td className="td"><span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10.5px] font-bold border ${meta.cls}`}>{meta.label}</span></td>
                    <td className="td text-[12px] max-w-[360px]">{describe(r)}</td>
                    <td className="td text-[12px]">
                      <div className="font-semibold">{ENTITY_LABELS[r.entity] || titleCase(r.entity) || '—'}</div>
                      {r.entity_id ? <div className="text-[11px] text-muted">#{r.entity_id}</div> : null}
                    </td>
                    <td className="td text-[12px] font-mono text-muted">{r.ip || '—'}</td>
                    <td className="td"><button className="btn-ghost !py-1 !px-2 !text-[11px]" onClick={() => setDetail(r)}><Eye size={13} /> Voir</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
        {total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-line bg-canvas/40 text-[12px] text-muted">
            <div>Affichage de {from} à {to} sur {total} événement(s)</div>
            <div className="flex items-center gap-1">
              <button className="btn-ghost !py-1 !px-2" disabled={page <= 1} onClick={() => load(page - 1, pageSize)}>‹</button>
              {pages[0] > 1 && <span className="px-1">…</span>}
              {pages.map(p => <button key={p} className={p === page ? 'btn-primary !py-1 !px-2.5 !text-[11px]' : 'btn-ghost !py-1 !px-2.5 !text-[11px]'} onClick={() => load(p, pageSize)}>{p}</button>)}
              {pages[pages.length - 1] < totalPages && <span className="px-1">…</span>}
              <button className="btn-ghost !py-1 !px-2" disabled={page >= totalPages} onClick={() => load(page + 1, pageSize)}>›</button>
            </div>
          </div>
        )}
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Détails de l'événement">
        {detail && (
          <div className="space-y-3 text-[12.5px]">
            <div><b>Action :</b> {detail.action}</div>
            <div><b>Description :</b> {describe(detail)}</div>
            <div><b>Utilisateur :</b> {detail.user_name || 'Système'} {detail.user_role ? `(${detail.user_role})` : ''}</div>
            <div><b>Entité :</b> {ENTITY_LABELS[detail.entity] || detail.entity || '—'} {detail.entity_id ? `#${detail.entity_id}` : ''}</div>
            <div><b>Adresse IP :</b> {detail.ip || '—'}</div>
            <div><b>Date :</b> {new Date(detail.created_at).toLocaleString('fr-FR')}</div>
            <div>
              <div className="font-bold mb-1">Données</div>
              <pre className="bg-canvas border border-line rounded-lg p-3 text-[11px] overflow-auto max-h-64 whitespace-pre-wrap">{JSON.stringify(detail.details || {}, null, 2)}</pre>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
