import { useEffect, useState } from 'react';
import { BellRing, Lock, Pencil, RefreshCw, Send, ShieldCheck, AlertCircle, Clock3 } from 'lucide-react';
import api from '../api/client';
import { PageHeader, Card, CardHead, Modal, Field, ErrorBox, Empty, Tabs } from '../components/ui';

const TABS = [
  { id: 'events', label: 'Événements', icon: BellRing },
  { id: 'rules', label: 'Règles', icon: ShieldCheck },
  { id: 'templates', label: 'Modèles', icon: Send },
  { id: 'delivery', label: 'Journal d’envoi', icon: RefreshCw },
];

const CHANNELS = ['internal', 'email', 'push'];
const CRITICAL_KEYS = ['validation', 'rejet', 'correction', 'annulation', 'soumission', 'final'];
const normalize = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const isCritical = row => row?.critical === true || row?.is_critical === true || row?.locked === true
  || CRITICAL_KEYS.some(key => normalize(row?.event_key || row?.key || '').includes(key));

async function listFrom(paths) {
  let lastError;
  for (const path of paths) {
    try {
      const r = await api.get(path);
      return Array.isArray(r.data) ? r.data : (r.data?.items || r.data?.data || []);
    } catch (error) { lastError = error; }
  }
  throw lastError;
}

async function saveTo(paths, payload) {
  let lastError;
  for (const path of paths) {
    try { return await api.put(path, payload); }
    catch (error) { lastError = error; }
  }
  throw lastError;
}

const emptyRule = { event_key: '', recipient_roles: '', channel: 'internal', enabled: true, reminder_delay: '', escalation_delay: '', schedule: '' };
const emptyTemplate = { event_key: '', channel: 'email', locale: 'fr', subject_template: '', body_template: '', enabled: true };

export default function NotificationAdmin() {
  const [tab, setTab] = useState('rules');
  const [events, setEvents] = useState([]);
  const [rules, setRules] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyRule);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError('');
    listFrom(['/v1/notification-rules', '/notification-rules']).then(setRules).catch(() => setRules([]));
    listFrom(['/v1/notification-templates', '/notification-templates']).then(setTemplates).catch(() => setTemplates([]));
    listFrom(['/v1/notification-events', '/notification-events']).then(setEvents).catch(() => setEvents([]));
    listFrom(['/v1/notification-recipients', '/notification-recipients', '/notifications/recipients']).then(setRecipients).catch(() => setRecipients([]));
  };

  useEffect(() => { load(); }, []);

  function openRule(row) {
    setForm(row ? {
      event_key: row.event_key || '', recipient_roles: Array.isArray(row.recipient_roles) ? row.recipient_roles.join(', ') : row.recipient_roles || '',
      channel: row.channel || 'internal', enabled: row.enabled !== false,
      reminder_delay: row.reminder_delay ?? '', escalation_delay: row.escalation_delay ?? '', schedule: row.schedule || '',
    } : { ...emptyRule });
    setModal({ kind: 'rule', id: row?.id });
  }

  function openTemplate(row) {
    setForm(row ? {
      event_key: row.event_key || '', channel: row.channel || 'email', locale: row.locale || 'fr',
      subject_template: row.subject_template || '', body_template: row.body_template || '', enabled: row.enabled !== false,
    } : { ...emptyTemplate });
    setModal({ kind: 'template', id: row?.id });
  }

  async function save(e) {
    e.preventDefault(); setError(''); setBusy(true);
    const payload = modal.kind === 'rule'
      ? { ...form, recipient_roles: String(form.recipient_roles).split(',').map(v => v.trim()).filter(Boolean), reminder_delay: form.reminder_delay === '' ? null : Number(form.reminder_delay), escalation_delay: form.escalation_delay === '' ? null : Number(form.escalation_delay) }
      : { ...form };
    try {
      await saveTo(modal.kind === 'rule' ? ['/v1/notification-rules', '/notification-rules'] : ['/v1/notification-templates', '/notification-templates'], payload);
      setNotice(modal.kind === 'rule' ? 'Règle de notification enregistrée.' : 'Modèle de notification enregistré.');
      setModal(null); load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  async function toggleChannel(row, channel) {
    setError('');
    try {
      await saveTo(['/v1/notification-rules', '/notification-rules'], { ...row, enabled: row.enabled === false, channel });
      setNotice('Canal mis à jour.'); load();
    } catch (err) { setError(err); }
  }

  const failed = recipients.filter(r => r.status === 'failed' || r.last_error || Number(r.retry_count) > 0);
  const failedCount = failed.length;

  return (
    <>
      <PageHeader title="Administration des notifications" subtitle="Événements, règles d’abonnement, modèles et journal d’envoi" actions={
        <button className="btn-ghost" onClick={load}><RefreshCw size={15} /> Actualiser</button>
      } />
      <ErrorBox error={error} />
      {notice && <div className="mb-4 rounded-lg bg-emerald-50 text-emerald-700 text-[12px] font-semibold px-4 py-3">{notice}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <Card className="p-4"><div className="text-[11px] font-bold text-muted">Événements</div><div className="text-2xl font-extrabold mt-1">{events.length}</div></Card>
        <Card className="p-4"><div className="text-[11px] font-bold text-muted">Règles actives</div><div className="text-2xl font-extrabold mt-1">{rules.filter(r => r.enabled !== false).length}</div></Card>
        <Card className="p-4"><div className="text-[11px] font-bold text-muted">Modèles</div><div className="text-2xl font-extrabold mt-1">{templates.length}</div></Card>
        <Card className="p-4"><div className="text-[11px] font-bold text-muted">Envois en échec</div><div className={`text-2xl font-extrabold mt-1 ${failedCount ? 'text-red-600' : 'text-emerald-600'}`}>{failedCount}</div></Card>
      </div>

      <Card className="overflow-hidden">
        <Tabs className="px-4 pt-2 bg-canvas/60" value={tab} onChange={setTab} tabs={TABS.map(t => ({ ...t, label: t.label, count: t.id === 'events' ? events.length : t.id === 'rules' ? rules.length : t.id === 'templates' ? templates.length : recipients.length }))} />
        <div className="px-5 pb-5 pt-5">
          {tab === 'events' && (events.length === 0 ? <Empty text="Aucun événement de notification enregistré pour le moment." /> : (
            <div className="overflow-x-auto"><table className="w-full">
              <thead><tr><th className="th">Événement</th><th className="th">Objet</th><th className="th">Acteur</th><th className="th">Date</th></tr></thead>
              <tbody>{events.map(row => (
                <tr key={row.id} className="hover:bg-canvas/60">
                  <td className="td font-bold text-[12px]">{row.event_key || row.event_type || row.key || '—'}</td>
                  <td className="td text-[11.5px] text-muted">{row.aggregate_type || row.object_type || '—'} #{row.aggregate_id || row.object_id || ''}</td>
                  <td className="td text-[11.5px] text-muted">{row.actor_name || row.actor_id || '—'}</td>
                  <td className="td text-[11.5px] text-muted">{row.occurred_at ? new Date(row.occurred_at).toLocaleString('fr-FR') : '—'}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ))}

          {tab === 'rules' && (rules.length === 0 ? <Empty text="Aucune règle d’abonnement disponible. L’API /api/v1/notification-rules n’est peut-être pas encore exposée." /> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[900px]">
              <thead><tr><th className="th">Événement</th><th className="th">Destinataires</th><th className="th">Canal</th><th className="th">Relance / escalade</th><th className="th">Horaires</th><th className="th">Statut</th><th className="th">Action</th></tr></thead>
              <tbody>{rules.map(row => {
                const locked = isCritical(row);
                return (
                  <tr key={row.id} className="hover:bg-canvas/60">
                    <td className="td font-bold text-[12px]">{row.event_key || row.key || '—'}{locked && <span className="badge-bad !text-[9px] ml-1"><Lock size={10} /> Critique</span>}</td>
                    <td className="td text-[11.5px] text-muted">{Array.isArray(row.recipient_roles) ? row.recipient_roles.join(', ') : row.recipient_roles || '—'}</td>
                    <td className="td"><select className="input !py-1 !text-[11px] w-28" value={row.channel || 'internal'} disabled={locked} onChange={e => toggleChannel(row, e.target.value)}>{CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}</select></td>
                    <td className="td text-[11px] text-muted">{row.reminder_delay ?? '—'} min / {row.escalation_delay ?? '—'} min</td>
                    <td className="td text-[11px] text-muted">{row.schedule || 'Tout le temps'}</td>
                    <td className="td"><span className={row.enabled !== false ? 'badge-ok !text-[10px]' : 'badge-muted !text-[10px]'}>{row.enabled !== false ? 'Active' : 'Désactivée'}</span></td>
                    <td className="td"><button className="btn-ghost !py-1 !px-2 !text-[11px]" disabled={locked} onClick={() => openRule(row)}>{locked ? <Lock size={13} /> : <Pencil size={13} />} {locked ? 'Verrouillée' : 'Modifier'}</button></td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          ))}

          {tab === 'templates' && (templates.length === 0 ? <Empty text="Aucun modèle de message disponible." /> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[800px]">
              <thead><tr><th className="th">Événement</th><th className="th">Canal</th><th className="th">Langue</th><th className="th">Objet</th><th className="th">Statut</th><th className="th">Action</th></tr></thead>
              <tbody>{templates.map(row => (
                <tr key={row.id} className="hover:bg-canvas/60">
                  <td className="td font-bold text-[12px]">{row.event_key || row.key || '—'}</td>
                  <td className="td text-[11.5px]">{row.channel || '—'}</td>
                  <td className="td text-[11.5px]">{row.locale || '—'}</td>
                  <td className="td text-[11.5px] text-muted max-w-[280px] truncate">{row.subject_template || '—'}</td>
                  <td className="td"><span className={row.enabled !== false ? 'badge-ok !text-[10px]' : 'badge-muted !text-[10px]'}>{row.enabled !== false ? 'Actif' : 'Inactif'}</span></td>
                  <td className="td"><button className="btn-ghost !py-1 !px-2 !text-[11px]" onClick={() => openTemplate(row)}><Pencil size={13} /> Modifier</button></td>
                </tr>
              ))}</tbody>
            </table></div>
          ))}

          {tab === 'delivery' && (recipients.length === 0 ? <Empty text="Aucun destinataire / journal d’envoi remonté par l’API." /> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[900px]">
              <thead><tr><th className="th">Événement</th><th className="th">Destinataire</th><th className="th">Canal</th><th className="th">Statut</th><th className="th">Tentatives</th><th className="th">Dernière erreur</th><th className="th">Date</th></tr></thead>
              <tbody>{recipients.map(row => (
                <tr key={row.id} className="hover:bg-canvas/60">
                  <td className="td font-bold text-[11.5px]">{row.event_key || row.event_type || row.event_id || '—'}</td>
                  <td className="td text-[11.5px] text-muted">{row.user_name || row.user_id || '—'}</td>
                  <td className="td text-[11.5px]">{row.channel || '—'}</td>
                  <td className="td"><span className={row.status === 'sent' || row.status === 'read' ? 'badge-ok !text-[10px]' : 'badge-bad !text-[10px]'}>{row.status || '—'}</span></td>
                  <td className="td text-[11.5px] font-bold">{Number(row.retry_count) || 0}</td>
                  <td className="td text-[11px] text-red-600 max-w-[260px] truncate" title={row.last_error || ''}>{row.last_error || '—'}</td>
                  <td className="td text-[11px] text-muted">{row.sent_at ? new Date(row.sent_at).toLocaleString('fr-FR') : '—'}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ))}
          {tab === 'delivery' && failed.length > 0 && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50/60 p-3 text-[11.5px] text-red-800 flex items-start gap-2">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>{failed.length} envoi(s) en échec — le moteur réessaie sans dupliquer l’événement. Vérifiez le champ « dernière erreur ».</span>
            </div>
          )}
        </div>
      </Card>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.kind === 'rule' ? 'Règle de notification' : 'Modèle de notification'} wide>
        <form onSubmit={save} className="space-y-4">
          {modal?.kind === 'rule' ? (
            <>
              <div className="grid md:grid-cols-2 gap-4">
                <Field label="Clé d’événement"><input className="input" value={form.event_key} onChange={e => setForm(f => ({ ...f, event_key: e.target.value }))} placeholder="validation_cdg" required /></Field>
                <Field label="Rôles destinataires (séparés par des virgules)"><input className="input" value={form.recipient_roles} onChange={e => setForm(f => ({ ...f, recipient_roles: e.target.value }))} placeholder="DD, Demandeur" /></Field>
                <Field label="Canal"><select className="input" value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}>{CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}</select></Field>
                <Field label="Horaires d’envoi"><input className="input" value={form.schedule} onChange={e => setForm(f => ({ ...f, schedule: e.target.value }))} placeholder="Lun–Ven 08:00–18:00" /></Field>
                <Field label="Relance (minutes)"><input type="number" min="0" className="input" value={form.reminder_delay} onChange={e => setForm(f => ({ ...f, reminder_delay: e.target.value }))} /></Field>
                <Field label="Escalade (minutes)"><input type="number" min="0" className="input" value={form.escalation_delay} onChange={e => setForm(f => ({ ...f, escalation_delay: e.target.value }))} /></Field>
              </div>
              <label className="flex items-center gap-2 text-[12px] font-bold"><input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} /> Règle activée</label>
            </>
          ) : (
            <>
              <div className="grid md:grid-cols-2 gap-4">
                <Field label="Clé d’événement"><input className="input" value={form.event_key} onChange={e => setForm(f => ({ ...f, event_key: e.target.value }))} required /></Field>
                <Field label="Canal"><select className="input" value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}>{CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}</select></Field>
                <Field label="Langue"><input className="input" value={form.locale} onChange={e => setForm(f => ({ ...f, locale: e.target.value }))} /></Field>
                <Field label="Statut"><select className="input" value={form.enabled ? 'on' : 'off'} onChange={e => setForm(f => ({ ...f, enabled: e.target.value === 'on' }))}><option value="on">Actif</option><option value="off">Inactif</option></select></Field>
              </div>
              <Field label="Objet"><input className="input" value={form.subject_template} onChange={e => setForm(f => ({ ...f, subject_template: e.target.value }))} placeholder="{{reference}} — {{store}}" /></Field>
              <Field label="Corps du message"><textarea className="input min-h-[120px]" value={form.body_template} onChange={e => setForm(f => ({ ...f, body_template: e.target.value }))} /></Field>
            </>
          )}
          <div className="flex items-center gap-1.5 text-[10.5px] text-muted"><Clock3 size={12} /> Les règles critiques de validation ne peuvent pas être désactivées par les utilisateurs.</div>
          <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setModal(null)}>Annuler</button><button className="btn-primary" disabled={busy}>Enregistrer</button></div>
        </form>
      </Modal>
    </>
  );
}
