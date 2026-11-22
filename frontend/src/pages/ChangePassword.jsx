import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ErrorBox } from '../components/ui';

export default function ChangePassword() {
  const { user, updateUser, logout } = useAuth();
  const nav = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault(); setError('');
    if (next.length < 8) return setError('Le nouveau mot de passe doit contenir au moins 8 caractères.');
    if (next !== confirm) return setError('La confirmation ne correspond pas.');
    setSaving(true);
    try {
      const r = await api.post('/auth/change-password', { current, next });
      if (r.data?.token) {
        const store = localStorage.getItem('safari_token') ? localStorage : sessionStorage;
        store.setItem('safari_token', r.data.token);
      }
      updateUser(r.data?.user || { ...user, must_change_password: false });
      nav('/', { replace: true });
    } catch (e) { setError(e); }
    finally { setSaving(false); }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-[#F4F7F5] p-6">
      <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-line bg-white p-6 shadow-sm">
        <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-700">Sécurité</div>
        <h1 className="mt-2 text-[24px] font-extrabold text-ink">Changer le mot de passe</h1>
        <p className="mt-1 text-[12px] text-muted">{user?.must_change_password ? 'Première connexion : vous devez définir un nouveau mot de passe avant de continuer.' : 'Mettez à jour votre mot de passe.'}</p>
        <ErrorBox error={error} />
        <div className="mt-4 space-y-3">
          <label className="block text-[11px] font-bold text-muted">Mot de passe actuel<input className="input mt-1 w-full" type="password" value={current} onChange={e=>setCurrent(e.target.value)} required /></label>
          <label className="block text-[11px] font-bold text-muted">Nouveau mot de passe<input className="input mt-1 w-full" type="password" value={next} onChange={e=>setNext(e.target.value)} required /></label>
          <label className="block text-[11px] font-bold text-muted">Confirmer<input className="input mt-1 w-full" type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} required /></label>
        </div>
        <div className="mt-5 flex gap-2">
          <button className="btn-primary flex-1" disabled={saving}>{saving ? 'Enregistrement…' : 'Mettre à jour'}</button>
          {!user?.must_change_password && <button type="button" className="btn-secondary" onClick={() => nav(-1)}>Annuler</button>}
          {user?.must_change_password && <button type="button" className="btn-secondary" onClick={logout}>Déconnexion</button>}
        </div>
      </form>
    </div>
  );
}
