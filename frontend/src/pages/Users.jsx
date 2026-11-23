import { useEffect, useState } from 'react';
import { Plus, UserCog, Power, KeyRound } from 'lucide-react';
import api from '../api/client';
import { Card, PageHeader, Modal, Field, ErrorBox, dateFR } from '../components/ui';

const ROLES = ['admin', 'IT', 'MG', 'RMG', 'CDG', 'DD', 'DG'];
const DEPT_ROLES = ['IT', 'MG', 'RMG'];
const deptForRole = role => DEPT_ROLES.includes(role) ? (role === 'RMG' ? 'MG' : role) : '';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'IT', department: 'IT' });
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', role: 'IT', department: 'IT', active: true });
  const [resetUser, setResetUser] = useState(null);
  const [resetPassword, setResetPassword] = useState('');

  const load = () => api.get('/users').then(r => setUsers(r.data)).catch(setError);
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault(); setError('');
    try {
      const payload = { name: form.name, email: form.email, password: form.password, role: form.role };
      if (DEPT_ROLES.includes(form.role)) payload.department = form.department || deptForRole(form.role);
      await api.post('/auth/register', payload);
      setOpen(false); setForm({ name: '', email: '', password: '', role: 'IT', department: 'IT' }); load();
    }
    catch (e) { setError(e); }
  }

  function openEdit(u) {
    setEditUser(u);
    setEditForm({ name: u.name || '', role: u.role || 'IT', department: u.department || deptForRole(u.role), active: !!u.active });
  }

  async function saveEdit(e) {
    e.preventDefault(); setError('');
    try {
      const payload = { name: editForm.name, role: editForm.role, active: editForm.active };
      payload.department = DEPT_ROLES.includes(editForm.role) ? (editForm.department || deptForRole(editForm.role)) : null;
      await api.put(`/users/${editUser.id}`, payload);
      setEditUser(null); load();
    } catch (e) { setError(e); }
  }

  async function toggle(u) {
    try { await api.put(`/users/${u.id}`, { active: !u.active }); load(); } catch (e) { setError(e); }
  }

  async function reset(e) {
    e.preventDefault(); setError('');
    try {
      await api.post(`/users/${resetUser.id}/reset-password`, { password: resetPassword });
      setResetUser(null); setResetPassword('');
    } catch (e) { setError(e); }
  }

  return (
    <>
      <PageHeader title="Utilisateurs" subtitle="Comptes et rôles du comité de validation" actions={<button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Nouvel utilisateur</button>} />
      <ErrorBox error={error} />
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {users.map(u => (
          <Card key={u.id} className="p-5">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-full bg-gold-500 text-forest-900 grid place-items-center font-extrabold text-[13px] shrink-0">{u.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</div>
              <div className="min-w-0 flex-1">
                <div className="font-extrabold text-[13px] truncate">{u.name}</div>
                <div className="text-[11px] text-muted truncate">{u.email}</div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="badge-muted">{u.role}</span>
                {u.department && <span className="badge-ok !text-[10px]">{u.department}</span>}
              </div>
            </div>
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-line text-[11px]">
              <span className={u.active ? 'text-emerald-600 font-bold' : 'text-red-600 font-bold'}>{u.active ? '✓ Actif' : '✗ Inactif'}</span>
              <span className="text-muted">Depuis {dateFR(u.created_at)}</span>
            </div>
            <div className="mt-2 rounded-xl bg-canvas/50 border border-line px-3 py-2 text-[10.5px] text-muted">
              <div><b className="text-ink">Dernière IP :</b> <span className="font-mono">{u.last_login_ip || '—'}</span></div>
              <div><b className="text-ink">Dernière connexion :</b> {u.last_login_at ? new Date(u.last_login_at).toLocaleString('fr-FR') : '—'}</div>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <button onClick={() => openEdit(u)} className="btn-ghost flex-1 !py-2 !text-[11px]"><UserCog size={13} /> Modifier</button>
              <button onClick={() => toggle(u)} className="btn-ghost flex-1 !py-2 !text-[11px]"><Power size={13} /> {u.active ? 'Désactiver' : 'Activer'}</button>
              <button onClick={() => { setResetUser(u); setResetPassword(''); }} className="btn-ghost w-full !py-2 !text-[11px]"><KeyRound size={13} /> Réinitialiser le mot de passe</button>
            </div>
          </Card>
        ))}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Nouvel utilisateur">
        <form onSubmit={create} className="space-y-4">
          <Field label="Nom complet"><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></Field>
          <Field label="E-mail"><input type="email" className="input" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required /></Field>
          <Field label="Mot de passe"><input type="password" className="input" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required /></Field>
          <Field label="Rôle">
            <select className="input" value={form.role} onChange={e => { const role = e.target.value; setForm({ ...form, role, department: deptForRole(role) }); }}>
              {ROLES.map(r => <option key={r}>{r}</option>)}
            </select>
          </Field>
          {DEPT_ROLES.includes(form.role) && (
            <Field label="Département">
              <select className="input" value={form.department || deptForRole(form.role)} onChange={e => setForm({ ...form, department: e.target.value })} required>
                <option value="IT">IT</option>
                <option value="MG">MG</option>
              </select>
            </Field>
          )}
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Annuler</button><button className="btn-primary"><UserCog size={15} /> Créer</button></div>
        </form>
      </Modal>

      <Modal open={!!editUser} onClose={() => setEditUser(null)} title={`Modifier — ${editUser?.name || ''}`}>
        <form onSubmit={saveEdit} className="space-y-4">
          <Field label="Nom complet"><input className="input" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} required /></Field>
          <div className="rounded-xl bg-canvas/70 border border-line p-3 text-[11.5px] text-muted">{editUser?.email}</div>
          <Field label="Rôle">
            <select className="input" value={editForm.role} onChange={e => { const role = e.target.value; setEditForm({ ...editForm, role, department: deptForRole(role) }); }}>
              {ROLES.map(r => <option key={r}>{r}</option>)}
            </select>
          </Field>
          {DEPT_ROLES.includes(editForm.role) && (
            <Field label="Département">
              <select className="input" value={editForm.department || deptForRole(editForm.role)} onChange={e => setEditForm({ ...editForm, department: e.target.value })} required>
                <option value="IT">IT</option>
                <option value="MG">MG</option>
              </select>
            </Field>
          )}
          <label className="flex items-center gap-2 text-[12px] font-bold"><input type="checkbox" checked={editForm.active} onChange={e => setEditForm({ ...editForm, active: e.target.checked })} /> Compte actif</label>
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={() => setEditUser(null)}>Annuler</button><button className="btn-primary"><UserCog size={15} /> Enregistrer</button></div>
        </form>
      </Modal>

      <Modal open={!!resetUser} onClose={() => setResetUser(null)} title={`Réinitialiser le mot de passe — ${resetUser?.name || ''}`}>
        <form onSubmit={reset} className="space-y-4">
          <div className="rounded-xl bg-canvas/70 border border-line p-3 text-[11.5px] text-muted">{resetUser?.email}</div>
          <Field label="Nouveau mot de passe">
            <input type="password" minLength={6} className="input" value={resetPassword} onChange={e => setResetPassword(e.target.value)} required autoFocus />
          </Field>
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={() => setResetUser(null)}>Annuler</button><button className="btn-primary"><KeyRound size={15} /> Définir le mot de passe</button></div>
        </form>
      </Modal>
    </>
  );
}
