import { useEffect, useState } from 'react';
import { Users, Plus, UserCheck, CalendarRange } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PageHeader, Card, CardHead, Modal, Field, ErrorBox, Empty } from '../components/ui';

const BASES = ['/v1/delegations', '/operations/delegations', '/delegations'];
const ROLES = ['admin', 'IT', 'MG', 'RMG', 'CDG', 'DD', 'DG'];
const EMPTY = { from_user_id: '', to_user_id: '', role_code: 'CDG', start_at: '', end_at: '', approved_by: '' };

async function listFrom(paths) {
  let lastError;
  for (const base of paths) {
    try {
      const r = await api.get(base);
      return Array.isArray(r.data) ? r.data : (r.data?.items || r.data?.data || []);
    } catch (error) { lastError = error; }
  }
  throw lastError;
}

async function createWith(paths, payload) {
  let lastError;
  for (const base of paths) {
    try { return await api.post(base, payload); }
    catch (error) { lastError = error; }
  }
  throw lastError;
}

const dateFR = value => value ? new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function Delegations() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError('');
    listFrom(BASES).then(setRows).catch(() => setRows([]));
    api.get('/users').then(r => setUsers(r.data || [])).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const userName = id => users.find(u => String(u.id) === String(id))?.name || `Utilisateur #${id || '—'}`;

  async function create(e) {
    e.preventDefault(); setError(''); setNotice(''); setBusy(true);
    try {
      await createWith(BASES, { ...form, start_at: form.start_at || null, end_at: form.end_at || null });
      setNotice('Délégation enregistrée.'); setOpen(false); setForm(EMPTY); load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  const active = rows.filter(r => !r.end_at || new Date(r.end_at) >= new Date());

  return (
    <>
      <PageHeader title="Délégations" subtitle="Habilitations temporaires avec date de début / fin et approbation" actions={
        can('manage_users') && <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Nouvelle délégation</button>
      } />
      <ErrorBox error={error} />
      {notice && <div className="mb-4 rounded-lg bg-emerald-50 text-emerald-700 text-[12px] font-semibold px-4 py-3">{notice}</div>}

      <div className="grid md:grid-cols-3 gap-4 mb-5">
        <Card className="p-4"><div className="flex items-center gap-2 text-[11px] font-bold text-muted"><Users size={14} className="text-emerald-600" /> Délégations</div><div className="text-2xl font-extrabold mt-1">{rows.length}</div></Card>
        <Card className="p-4"><div className="flex items-center gap-2 text-[11px] font-bold text-muted"><UserCheck size={14} className="text-emerald-600" /> En cours</div><div className="text-2xl font-extrabold mt-1">{active.length}</div></Card>
        <Card className="p-4"><div className="flex items-center gap-2 text-[11px] font-bold text-muted"><CalendarRange size={14} className="text-amber-600" /> Rôles concernés</div><div className="text-2xl font-extrabold mt-1">{new Set(rows.map(r => r.role_code || r.role)).size}</div></Card>
      </div>

      <Card className="overflow-hidden">
        <CardHead title="Registre des délégations" subtitle="Le contrôle des droits reste appliqué côté API, délégation comprise" />
        <div className="px-5 pb-5">
          {rows.length === 0 ? <Empty text="Aucune délégation disponible. Le point d’accès /api/v1/delegations ou /api/operations/delegations n’est peut-être pas encore exposé." /> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[860px]">
              <thead><tr><th className="th">De</th><th className="th">Vers</th><th className="th">Rôle délégué</th><th className="th">Du</th><th className="th">Au</th><th className="th">Approuvé par</th></tr></thead>
              <tbody>{rows.map(row => (
                <tr key={row.id} className="hover:bg-canvas/60">
                  <td className="td font-bold text-[12px]">{userName(row.from_user_id || row.from_id)}</td>
                  <td className="td text-[12px] font-semibold">{userName(row.to_user_id || row.to_id)}</td>
                  <td className="td"><span className="badge-ok !text-[10px]">{row.role_code || row.role || '—'}</span></td>
                  <td className="td text-[11.5px] text-muted">{dateFR(row.start_at || row.start_date)}</td>
                  <td className="td text-[11.5px] text-muted">{dateFR(row.end_at || row.end_date)}</td>
                  <td className="td text-[11.5px] text-muted">{userName(row.approved_by || row.approved_by_id)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Nouvelle délégation" wide>
        <form onSubmit={create} className="grid md:grid-cols-2 gap-4">
          <Field label="De (utilisateur)"><select className="input" value={form.from_user_id} onChange={e => setForm(f => ({ ...f, from_user_id: e.target.value }))} required><option value="">Choisir…</option>{users.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}</select></Field>
          <Field label="Vers (utilisateur)"><select className="input" value={form.to_user_id} onChange={e => setForm(f => ({ ...f, to_user_id: e.target.value }))} required><option value="">Choisir…</option>{users.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}</select></Field>
          <Field label="Rôle délégué"><select className="input" value={form.role_code} onChange={e => setForm(f => ({ ...f, role_code: e.target.value }))}>{ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select></Field>
          <Field label="Approuvé par"><select className="input" value={form.approved_by} onChange={e => setForm(f => ({ ...f, approved_by: e.target.value }))}><option value="">Non renseigné</option>{users.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}</select></Field>
          <Field label="Début"><input type="date" className="input" value={form.start_at} onChange={e => setForm(f => ({ ...f, start_at: e.target.value }))} required /></Field>
          <Field label="Fin"><input type="date" className="input" value={form.end_at} onChange={e => setForm(f => ({ ...f, end_at: e.target.value }))} required /></Field>
          <div className="md:col-span-2 flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Annuler</button><button className="btn-primary" disabled={busy}>Créer la délégation</button></div>
        </form>
      </Modal>
    </>
  );
}
