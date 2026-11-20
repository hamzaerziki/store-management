import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Bell, Monitor, LogOut, Check, CalendarDays, Mail, Fingerprint, Building2, Plus } from 'lucide-react';
import api, { getToken } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, CardHead, PageHeader, Field, ErrorBox } from '../components/ui';

const DEFAULT_PREFS = { emailAlerts: true, validationReminders: true, compact: false };
const BLANK_PASSWORD = { current: '', next: '', confirm: '' };

function prefsKey(id) {
  return `safari_prefs_${id || 'guest'}`;
}

function readPrefs(id) {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(prefsKey(id)) || '{}') }; }
  catch { return { ...DEFAULT_PREFS }; }
}

function initials(name = '') {
  return name.split(' ').filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'U';
}

function sessionExpiry() {
  const token = getToken();
  if (!token) return '—';
  try {
    const raw = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(raw + '='.repeat((4 - (raw.length % 4)) % 4)));
    return new Date(payload.exp * 1000).toLocaleString('fr-FR');
  } catch { return '—'; }
}

function Toggle({ checked, onChange, label, desc }) {
  return (
    <button type="button" onClick={onChange} className="w-full flex items-center justify-between gap-4 py-3 text-left border-b border-line/70 last:border-0">
      <div className="min-w-0">
        <div className="text-[12.5px] font-bold">{label}</div>
        <div className="text-[11px] text-muted mt-0.5">{desc}</div>
      </div>
      <span className={`relative w-10 h-6 rounded-full transition shrink-0 ${checked ? 'bg-emerald-600' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition ${checked ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  );
}

export default function Settings() {
  const { user, logout, can } = useAuth();
  const [profile, setProfile] = useState(user || {});
  const [prefs, setPrefs] = useState(() => readPrefs(user?.id));
  const [password, setPassword] = useState(BLANK_PASSWORD);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [suppliers, setSuppliers] = useState([]);
  const [enterpriseName, setEnterpriseName] = useState('');

  useEffect(() => {
    api.get('/auth/me').then(r => setProfile(r.data)).catch(() => {});
    setPrefs(readPrefs(user?.id));
    if (can('manage_catalog')) api.get('/suppliers').then(r => setSuppliers(r.data)).catch(() => {});
  }, [user?.id]);

  function flash(message) {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2200);
  }

  function toggle(key) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    localStorage.setItem(prefsKey(user?.id), JSON.stringify(next));
    flash('Préférence enregistrée');
  }

  async function addEnterprise(e) {
    e.preventDefault(); setError('');
    try {
      const { data } = await api.post('/suppliers', { name: enterpriseName, kind: 'Entreprise' });
      setSuppliers(current => [...current, data].sort((a, b) => a.name.localeCompare(b.name)));
      setEnterpriseName('');
      flash('Entreprise créée — disponible lors de l’ajout d’un devis');
    } catch (err) { setError(err); }
  }

  async function changePassword(e) {
    e.preventDefault();
    setError('');
    if (password.next !== password.confirm) { setError('Les mots de passe ne correspondent pas'); return; }
    try {
      await api.post('/auth/change-password', { current: password.current, next: password.next });
      setPassword(BLANK_PASSWORD);
      flash('Mot de passe modifié');
    } catch (err) { setError(err); }
  }

  return (
    <>
      <PageHeader title="Paramètres & profil" subtitle="Votre compte, vos accès et vos préférences" actions={notice ? <span className="badge-ok"><Check size={13} className="mr-1" />{notice}</span> : null} />
      <ErrorBox error={error} />
      <div className="grid lg:grid-cols-[320px_1fr] gap-5">
        <Card className="p-6 h-fit">
          <div className="flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-gold-400 to-gold-500 text-forest-900 grid place-items-center text-[22px] font-extrabold shadow-lg">{initials(profile.name)}</div>
            <h2 className="font-extrabold text-lg mt-4">{profile.name || 'Utilisateur'}</h2>
            <div className="text-[12px] text-muted mt-1">{profile.email}</div>
          </div>
          <button onClick={() => { logout(); window.location.href = '/login'; }} className="btn-ghost w-full mt-6"><LogOut size={15} /> Se déconnecter</button>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHead title="Informations du compte" subtitle="Données enregistrées sur votre profil" right={<Fingerprint size={16} className="text-muted" />} />
            <div className="px-5 pb-5 grid sm:grid-cols-2 gap-4">
              <div className="p-3 rounded-xl bg-canvas"><div className="text-[10.5px] uppercase tracking-wide text-muted font-bold">Nom complet</div><div className="text-[13px] font-bold mt-1">{profile.name || '—'}</div></div>
              <div className="p-3 rounded-xl bg-canvas"><div className="text-[10.5px] uppercase tracking-wide text-muted font-bold">E-mail</div><div className="text-[13px] font-bold mt-1 flex items-center gap-2"><Mail size={14} className="text-muted" />{profile.email || '—'}</div></div>
              <div className="p-3 rounded-xl bg-canvas"><div className="text-[10.5px] uppercase tracking-wide text-muted font-bold">Statut</div><div className="text-[13px] font-bold mt-1">{profile.active === false ? 'Inactif' : 'Actif'}</div></div>
              <div className="p-3 rounded-xl bg-canvas"><div className="text-[10.5px] uppercase tracking-wide text-muted font-bold">Membre depuis</div><div className="text-[13px] font-bold mt-1 flex items-center gap-2"><CalendarDays size={14} className="text-muted" />{profile.created_at ? new Date(profile.created_at).toLocaleDateString('fr-FR') : '—'}</div></div>
            </div>
          </Card>

          {can('manage_catalog') && (
            <Card>
              <CardHead title="Entreprises" subtitle="Créées une seule fois, puis sélectionnées lors de l’ajout d’un devis" right={<Building2 size={16} className="text-muted" />} />
              <div className="px-5 pb-5">
                <form onSubmit={addEnterprise} className="flex gap-2 mb-4">
                  <input className="input !py-2 !text-[12px]" placeholder="Nom de l’entreprise" value={enterpriseName} onChange={e => setEnterpriseName(e.target.value)} required />
                  <button className="btn-primary shrink-0"><Plus size={14} /> Ajouter</button>
                </form>
                {suppliers.length === 0 ? (
                  <div className="py-5 text-center text-[12px] text-muted border border-dashed border-line rounded-xl">Aucune entreprise enregistrée</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {suppliers.map(s => <span key={s.id} className="badge-muted !text-[11px]">{s.name}</span>)}
                  </div>
                )}
              </div>
            </Card>
          )}

          {can('manage_users') && (
            <Card>
            <CardHead title="Administration V2.1" subtitle="Référentiels, notifications et habilitations" right={<Bell size={16} className="text-muted" />} />
            <div className="px-5 pb-5 flex flex-wrap gap-2">
              <Link to="/tax-rates" className="chip">Taux de TVA</Link>
              <Link to="/notification-admin" className="chip">Règles & modèles de notification</Link>
              <Link to="/notifications" className="chip">Centre de notifications</Link>
              <Link to="/delegations" className="chip">Délégations</Link>
            </div>
          </Card>
          )}

          <Card>
            <CardHead title="Sécurité" subtitle="Modifier votre mot de passe" right={<Lock size={16} className="text-muted" />} />
            <form onSubmit={changePassword} className="px-5 pb-5 grid sm:grid-cols-3 gap-4 items-end">
              <Field label="Mot de passe actuel"><input type="password" className="input" value={password.current} onChange={e => setPassword({ ...password, current: e.target.value })} required /></Field>
              <Field label="Nouveau mot de passe"><input type="password" className="input" value={password.next} onChange={e => setPassword({ ...password, next: e.target.value })} minLength="6" required /></Field>
              <Field label="Confirmer"><input type="password" className="input" value={password.confirm} onChange={e => setPassword({ ...password, confirm: e.target.value })} minLength="6" required /></Field>
              <div className="sm:col-span-3 flex justify-end"><button className="btn-primary"><Lock size={15} /> Mettre à jour</button></div>
            </form>
          </Card>

          <div className="grid md:grid-cols-2 gap-5">
            <Card>
              <CardHead title="Préférences" subtitle="Disponibles pour tous les profils · enregistrées sur cet appareil" right={<Bell size={16} className="text-muted" />} />
              <div className="px-5 pb-3">
                <Toggle checked={prefs.emailAlerts} onChange={() => toggle('emailAlerts')} label="Notifications" desc="Afficher les alertes dans l'application" />
                <Toggle checked={prefs.validationReminders} onChange={() => toggle('validationReminders')} label="Rappels de validation" desc="Signaler les dossiers en attente de décision" />
                <Toggle checked={prefs.compact} onChange={() => toggle('compact')} label="Affichage compact" desc="Réduire les espacements des tableaux" />
              </div>
            </Card>

            <Card>
              <CardHead title="Session" subtitle="Informations de connexion" right={<Monitor size={16} className="text-muted" />} />
              <div className="px-5 pb-5 space-y-3">
                <div className="flex items-center justify-between py-2 border-b border-line/70"><span className="text-[12px] text-muted">Statut</span><span className="badge-ok">● Active</span></div>
                <div className="flex items-center justify-between py-2 border-b border-line/70"><span className="text-[12px] text-muted">Expiration du jeton</span><b className="text-[12px]">{sessionExpiry()}</b></div>
                <div className="flex items-center justify-between py-2"><span className="text-[12px] text-muted">Espace</span><b className="text-[12px]">{localStorage.getItem('safari_token') ? 'Local' : 'Session'}</b></div>
                <button onClick={() => { logout(); window.location.href = '/login'; }} className="btn-ghost w-full"><LogOut size={15} /> Terminer la session</button>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
