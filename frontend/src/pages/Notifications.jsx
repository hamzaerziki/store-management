import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, RefreshCw, ExternalLink, Inbox } from 'lucide-react';
import api from '../api/client';
import { PageHeader, Card, CardHead, Tabs, ErrorBox, Empty } from '../components/ui';

const EVENT_LABELS = {
  demande_soumise: 'Demande soumise', submitted: 'Demande soumise',
  validation_cdg: 'Validation CDG', validation_dd: 'Validation DD', validation_dg: 'Validation finale DG',
  validation_finale_dg: 'Validation finale DG', approved: 'Approuvé',
  rejet: 'Rejet ou correction', rejected: 'Rejet ou correction', correction: 'Correction demandée',
  revision_budget: 'Révision de budget', budget_revision: 'Révision de budget',
  annulation: 'Annulation', cancelled: 'Annulation',
  depassement: 'Dépassement ou retard', retard: 'Retard critique', overdue: 'Retard critique',
  date_ouverture: 'Modification date d’ouverture', opening_date: 'Modification date d’ouverture',
};

const normalize = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function deepLink(row) {
  const type = normalize(row.object_type || row.aggregate_type || row.event_type || row.event_key || '');
  const id = row.object_id || row.aggregate_id;
  if (['store', 'project', 'magasin'].some(key => type.includes(key)) && id) return `/stores/${id}`;
  if (type.includes('comparison') || type.includes('comparatif')) return id ? `/comparisons/${id}` : '/comparisons';
  if (type.includes('quote') || type.includes('devis')) return '/quotes';
  if (type.includes('demand') || type.includes('validation')) return '/demands';
  if (type.includes('budget')) {
    if (['store', 'project', 'magasin'].some(key => type.includes(key)) && id) return `/stores/${id}?tab=budget`;
    return '/stores';
  }

  if (type.includes('invoice') || type.includes('facture') || type.includes('payment')) return '/invoices';
  if (type.includes('risk') || type.includes('risque')) return '/risks';
  if (type.includes('opening') || type.includes('reception')) return '/site';
  return '/notifications';
}

async function fetchNotifications() {
  try { return await api.get('/v1/notifications'); }
  catch { return api.get('/notifications'); }
}

async function markReadRemote(id) {
  try { await api.patch(`/v1/notifications/${id}/read`); }
  catch { await api.patch(`/notifications/${id}/read`); }
}

export default function Notifications() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState('all');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = () => {
    setError('');
    fetchNotifications().then(r => setRows(Array.isArray(r.data) ? r.data : (r.data?.items || []))).catch(e => setError(e));
  };

  useEffect(() => { load(); }, []);

  const unread = rows.filter(row => !row.read && !row.read_at).length;

  const shown = useMemo(() => rows.filter(row => {
    if (tab === 'unread') return !row.read && !row.read_at;
    if (tab === 'read') return !!row.read || !!row.read_at;
    return true;
  }), [rows, tab]);

  async function markRead(row, goToLink = false) {
    const alreadyRead = row.read || row.read_at;
    if (!alreadyRead) {
      try {
        await markReadRemote(row.id);
        setRows(current => current.map(n => String(n.id) === String(row.id) ? { ...n, read: true, read_at: new Date().toISOString() } : n));
      } catch (err) { setError(err); }
    }
    if (goToLink) navigate(deepLink(row));
  }

  async function markAll() {
    const pending = rows.filter(row => !row.read && !row.read_at);
    if (!pending.length) return;
    try {
      await Promise.all(pending.map(row => markReadRemote(row.id)));
      setRows(current => current.map(n => ({ ...n, read: true })));
      setNotice(`${pending.length} notification(s) marquée(s) comme lue(s).`);
    } catch (err) { setError(err); }
  }

  return (
    <>
      <PageHeader title="Centre de notifications" subtitle="Historique des événements, accès direct au dossier concerné" actions={
        <>
          <button className="btn-ghost" onClick={load}><RefreshCw size={15} /> Actualiser</button>
          <button className="btn-primary" onClick={markAll} disabled={!unread}><CheckCheck size={15} /> Tout marquer comme lu</button>
        </>
      } />
      <ErrorBox error={error} />
      {notice && <div className="mb-4 rounded-lg bg-emerald-50 text-emerald-700 text-[12px] font-semibold px-4 py-3">{notice}</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-5">
        <Card className="p-4"><div className="flex items-center gap-2 text-[11px] font-bold text-muted"><Bell size={14} className="text-emerald-600" /> Notifications</div><div className="text-2xl font-extrabold mt-1">{rows.length}</div></Card>
        <Card className="p-4"><div className="flex items-center gap-2 text-[11px] font-bold text-muted"><Inbox size={14} className="text-red-600" /> Non lues</div><div className="text-2xl font-extrabold mt-1 text-red-600">{unread}</div></Card>
        <Card className="p-4"><div className="flex items-center gap-2 text-[11px] font-bold text-muted"><CheckCheck size={14} className="text-emerald-600" /> Lues</div><div className="text-2xl font-extrabold mt-1">{rows.length - unread}</div></Card>
      </div>

      <Card className="overflow-hidden">
        <Tabs className="px-4 pt-2 bg-canvas/60" value={tab} onChange={setTab} tabs={[
          { id: 'all', label: 'Toutes', count: rows.length },
          { id: 'unread', label: 'Non lues', count: unread },
          { id: 'read', label: 'Lues', count: rows.length - unread },
        ]} />
        <div className="px-5 pb-5 pt-5">
          {shown.length === 0 ? <Empty text={tab === 'unread' ? 'Aucune notification non lue.' : 'Aucune notification pour le moment.'} /> : (
            <div className="divide-y divide-line/70 border border-line rounded-xl overflow-hidden">
              {shown.map(row => {
                const isUnread = !row.read && !row.read_at;
                const eventType = row.event_type || row.event_key || row.type || row.key || 'Événement';
                const target = deepLink(row);
                return (
                  <div key={row.id} className={`flex flex-wrap items-start gap-3 px-4 py-3 ${isUnread ? 'bg-emerald-600/5' : ''}`}>
                    <button type="button" onClick={() => markRead(row)} className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${isUnread ? 'bg-emerald-600' : 'bg-slate-200'}`} aria-label={isUnread ? 'Marquer comme lue' : 'Déjà lue'} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="badge-ok !text-[10px]">{EVENT_LABELS[eventType] || String(eventType).replaceAll('_', ' ')}</span>
                        {row.object_type && <span className="text-[10.5px] text-muted">{row.object_type} #{row.object_id || row.aggregate_id || ''}</span>}
                      </div>
                      <div className={`text-[12.5px] mt-1.5 ${isUnread ? 'font-bold text-ink' : 'text-slate-600'}`}>{row.message || row.title || row.body || 'Notification'}</div>
                      <div className="text-[10.5px] text-muted mt-1">{row.created_at || row.occurred_at ? new Date(row.created_at || row.occurred_at).toLocaleString('fr-FR') : '—'}{row.actor_name ? ` · ${row.actor_name}` : ''}</div>
                    </div>
                    <button type="button" onClick={() => markRead(row, true)} className="btn-ghost !py-1.5 !px-2 !text-[11px]"><ExternalLink size={13} /> Ouvrir le dossier</button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-4 text-[11px] text-muted"><Link to="/notification-admin" className="font-bold text-emerald-600 hover:underline">Configurer les règles et modèles de notification →</Link></div>
        </div>
      </Card>
    </>
  );
}
