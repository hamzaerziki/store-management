import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  Mail, Lock, Eye, EyeOff, ArrowRight, ShieldCheck, Laptop, Package,
  Calculator, Crown, AlertCircle, Check, Sparkles, Building2, LockKeyhole,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const demos = import.meta.env.DEV ? [
  { role: 'admin', email: 'admin@safari.ma', pass: 'admin123', label: 'Admin', icon: ShieldCheck, color: 'violet' },
  { role: 'IT', email: 'it@safari.ma', pass: 'it123', label: 'IT', icon: Laptop, color: 'blue' },
  { role: 'MG', email: 'mg@safari.ma', pass: 'mg123', label: 'MG', icon: Package, color: 'amber' },
  { role: 'CDG', email: 'cg@safari.ma', pass: 'cg123', label: 'CDG', icon: Calculator, color: 'emerald' },
  { role: 'DD', email: 'dd@safari.ma', pass: 'dd123', label: 'DD', icon: Building2, color: 'blue' },
  { role: 'DG', email: 'dg@safari.ma', pass: 'dg123', label: 'DG', icon: Crown, color: 'gold' },
] : [];

const roleColors = {
  violet: 'text-violet-600 bg-violet-500/10 border-violet-200',
  blue: 'text-blue-600 bg-blue-500/10 border-blue-200',
  amber: 'text-amber-600 bg-amber-500/10 border-amber-200',
  emerald: 'text-emerald-600 bg-emerald-500/10 border-emerald-200',
  gold: 'text-gold-500 bg-gold-500/10 border-gold-200',
};

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || '/';

  const [email, setEmail] = useState(() => localStorage.getItem('safari_last_email') || (import.meta.env.DEV ? 'admin@safari.ma' : ''));
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (email) localStorage.setItem('safari_last_email', email); }, [email]);

  if (user) return <Navigate to={from} replace />;

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!/^\S+@\S+\.\S+$/.test(email)) { setError('Veuillez saisir une adresse e-mail valide.'); return; }
    if (!password) { setError('Veuillez saisir votre mot de passe.'); return; }
    setBusy(true);
    try {
      await login(email.trim(), password, remember);
      navigate(from, { replace: true });
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Identifiants incorrects. Réessayez.');
    } finally {
      setBusy(false);
    }
  }

  function useDemo(d) {
    setEmail(d.email);
    setPassword(d.pass);
    setError('');
  }

  return (
    <div className="min-h-screen flex bg-canvas">
      {/* LEFT BRAND PANEL */}
      <div className="hidden lg:flex relative w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-forest-700 via-forest-900 to-[#061814] text-white p-14">
        <div className="absolute inset-0 opacity-[0.07]" style={{
          backgroundImage: 'radial-gradient(circle at 20% 30%, #e8bc63 0, transparent 45%), radial-gradient(circle at 80% 75%, #2dc79a 0, transparent 40%)',
        }} />
        <svg className="absolute -right-20 top-10 opacity-[0.06]" width="420" height="420" viewBox="0 0 420 420" fill="none" stroke="white">
          <circle cx="210" cy="210" r="180" /><circle cx="210" cy="210" r="140" /><circle cx="210" cy="210" r="100" />
          <path d="M210 30v360M30 210h360" />
        </svg>

        <div className="relative flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-gold-400 to-gold-500 grid place-items-center shadow-lg shadow-gold-500/20">
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-forest-900" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 2c3 3.5 4.5 7 4.5 10a4.5 4.5 0 0 1-9 0C7.5 9 9 5.5 12 2Z" /><path d="M12 22v-6M8 18l4-2 4 2" />
            </svg>
          </div>
          <div>
            <div className="font-extrabold text-lg tracking-wide leading-none">SAFARI</div>
            <div className="text-[9px] uppercase tracking-[.22em] text-emerald-200/60 mt-1.5">Import · Export</div>
          </div>
        </div>

        <div className="relative max-w-lg">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gold-500/10 border border-gold-500/20 text-gold-400 text-[11px] font-bold mb-6">
            <Sparkles size={13} /> Espace de travail 2026
          </div>
          <h1 className="text-[42px] leading-[1.12] font-extrabold tracking-tight">
            Chaque ouverture,<br /><span className="text-gold-400">sous contrôle.</span>
          </h1>
          <p className="text-emerald-50/60 mt-5 text-[15px] leading-relaxed max-w-md">
            Centralisez les devis, comparez les offres, validez les achats et suivez l'avancement de vos magasins en temps réel.
          </p>

          <div className="mt-9 space-y-3">
            {[
              { icon: Building2, text: '7 magasins suivis en temps réel' },
              { icon: ShieldCheck, text: 'Validation CDG → DD → DG avec piste d\'audit complète' },
              { icon: LockKeyhole, text: 'Accès sécurisé selon votre rôle' },
            ].map(f => (
              <div key={f.text} className="flex items-center gap-3 text-[13px] text-emerald-50/80">
                <div className="w-7 h-7 rounded-lg bg-white/10 grid place-items-center text-gold-400"><f.icon size={14} /></div>
                {f.text}
              </div>
            ))}
          </div>

          <div className="flex gap-10 mt-11 pt-8 border-t border-white/10">
            {[['07', 'Magasins'], ['05', 'Rôles'], ['100%', 'Traçabilité']].map(([v, l]) => (
              <div key={l}><div className="text-3xl font-extrabold text-gold-400">{v}</div><div className="text-[10px] uppercase tracking-wider text-emerald-200/50 mt-1">{l}</div></div>
            ))}
          </div>
        </div>

        <div className="relative text-[11px] text-emerald-200/40">© 2026 Safari Import Export — Projet d'ouverture des magasins</div>
      </div>

      {/* RIGHT FORM PANEL */}
      <div className="flex-1 flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[430px]">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 grid place-items-center text-white font-extrabold">S</div>
            <span className="font-extrabold tracking-wide">SAFARI</span>
          </div>

          <div className="mb-7">
            <h2 className="text-[28px] font-extrabold tracking-tight text-ink">Bon retour</h2>
            <p className="text-muted text-[13px] mt-1.5">Connectez-vous pour accéder à votre espace.</p>
          </div>

          <div className="bg-white border border-line rounded-2xl shadow-card p-7 sm:p-8">
            {error && (
              <div className="mb-5 flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-red-50 border border-red-100 text-red-700 text-[12px] font-semibold">
                <AlertCircle size={16} className="shrink-0 mt-0.5" /><span>{error}</span>
              </div>
            )}

            <form onSubmit={submit} className="space-y-4">
              <label className="block">
                <span className="label">Adresse e-mail</span>
                <div className="relative">
                  <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input type="email" autoComplete="username" className="input !pl-10" value={email} onChange={e => setEmail(e.target.value)} placeholder="vous@safari.ma" />
                </div>
              </label>

              <label className="block">
                <span className="label">Mot de passe</span>
                <div className="relative">
                  <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input type={show ? 'text' : 'password'} autoComplete="current-password" className="input !pl-10 !pr-11" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
                  <button type="button" onClick={() => setShow(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-ink" title={show ? 'Masquer' : 'Afficher'}>
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>

              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-[12px] font-semibold text-muted">
                  <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="w-4 h-4 accent-emerald-600" />
                  Se souvenir de moi
                </label>
                <button type="button" onClick={() => setError('Contactez l\'administrateur pour réinitialiser votre mot de passe.')} className="text-[12px] font-bold text-emerald-600 hover:underline">
                  Mot de passe oublié ?
                </button>
              </div>

              <button className="btn-primary w-full !py-3 mt-2 !text-[13.5px]" disabled={busy}>
                {busy ? 'Connexion en cours…' : <><span>Se connecter</span><ArrowRight size={16} /></>}
              </button>
            </form>

            <div className="mt-7 pt-6 border-t border-line">
              <div className="text-[10px] uppercase tracking-wider font-extrabold text-muted mb-3 text-center">Accès rapide — comptes de démonstration</div>
              <div className="grid grid-cols-5 gap-2">
                {demos.map(d => (
                  <button key={d.role} onClick={() => useDemo(d)} title={`${d.email} / ${d.pass}`}
                    className={`flex flex-col items-center gap-1.5 py-2.5 rounded-xl border transition hover:-translate-y-0.5 ${email === d.email ? roleColors[d.color] : 'border-line bg-white hover:border-slate-300'}`}>
                    <d.icon size={16} />
                    <span className="text-[10px] font-extrabold">{d.label}</span>
                  </button>
                ))}
              </div>
              {demos.some(d => d.email === email) && (
                <div className="mt-3 flex items-center justify-center gap-1.5 text-[10.5px] text-emerald-600 font-semibold">
                  <Check size={12} /> Compte {demos.find(d => d.email === email).label} présélectionné — mot de passe rempli
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-muted">
            <ShieldCheck size={13} className="text-emerald-600" /> Connexion sécurisée · Accès contrôlé par rôle
          </div>
        </div>
      </div>
    </div>
  );
}
