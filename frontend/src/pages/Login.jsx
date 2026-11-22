import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  Mail, Lock, Eye, EyeOff, ArrowRight, ShieldCheck, Laptop, Package,
  Calculator, Crown, AlertCircle, Check, Sparkles, Building2, LockKeyhole, Store, Route,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';



const roleColors = {
  violet: 'text-violet-700 bg-violet-500/10 border-violet-200',
  blue: 'text-blue-700 bg-blue-500/10 border-blue-200',
  amber: 'text-amber-700 bg-amber-500/10 border-amber-200',
  emerald: 'text-emerald-700 bg-emerald-500/10 border-emerald-200',
  gold: 'text-[#8A6420] bg-[#D8A441]/10 border-[#D8A441]/30',
};

const journey = [
  { step: '01', title: 'Demande', desc: 'Création & devis', x: 8, y: 72 },
  { step: '02', title: 'Validation', desc: 'CDG · DD · DG', x: 34, y: 48 },
  { step: '03', title: 'Exécution', desc: 'Commande & suivi', x: 62, y: 58 },
  { step: '04', title: 'Ouverture', desc: 'Magasin prêt', x: 88, y: 28 },
];

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
    } finally { setBusy(false); }
  }

  
  return (
    <div className="min-h-screen flex bg-[#eef6f3]">
      {/* LEFT - CREATIVE PATH PANEL */}
      <div className="hidden lg:flex relative w-[52%] flex-col overflow-hidden bg-[#072f27] text-white p-12 xl:p-14">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_15%,rgba(216,164,65,0.22),transparent_42%),radial-gradient(ellipse_at_80%_80%,rgba(14,122,95,0.45),transparent_45%),linear-gradient(160deg,#0d5a47_0%,#083a30_45%,#051f1a_100%)]" />
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.15) 1px, transparent 1px)', backgroundSize: '44px 44px' }} />
        <div className="absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-[#D8A441]/10 blur-3xl" />
        <div className="absolute right-0 bottom-0 h-96 w-96 rounded-full bg-[#0E7A5F]/20 blur-3xl" />

        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-white/95 p-1.5 shadow-lg shadow-black/10 border border-white/20">
              <img src="/logo-1707950070.jpg" alt="Safari" className="w-full h-full object-contain rounded-xl" />
            </div>
            <div>
              <div className="font-extrabold text-xl tracking-wide leading-none">SAFARI</div>
              <div className="text-[10px] uppercase tracking-[.22em] text-emerald-100/65 mt-1.5">Store Management</div>
            </div>
          </div>
          <div className="hidden xl:inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/8 border border-white/12 text-[#F3D48B] text-[11px] font-bold backdrop-blur-sm">
            <Route size={13} /> Parcours d&apos;ouverture
          </div>
        </div>

        <div className="relative flex-1 flex flex-col justify-center py-10">
          <div className="inline-flex w-fit items-center gap-2 px-3 py-1.5 rounded-full bg-[#D8A441]/15 border border-[#D8A441]/25 text-[#F3D48B] text-[11px] font-bold mb-6">
            <Sparkles size={13} /> Du besoin à l&apos;ouverture
          </div>
          <h1 className="text-[42px] xl:text-[52px] leading-[1.06] font-extrabold tracking-tight max-w-xl">
            Chaque projet suit
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-[#F3D48B] via-[#D8A441] to-[#F3D48B]">son chemin.</span>
          </h1>
          <p className="text-emerald-50/72 mt-5 text-[15px] leading-relaxed max-w-lg">
            Une plateforme unique pour orchestrer les demandes, validations, budgets et planning — quel que soit le nombre de magasins.
          </p>

          {/* Journey path */}
          <div className="mt-10 relative rounded-[28px] border border-white/10 bg-white/[0.04] backdrop-blur-sm p-6 xl:p-7 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent" />
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              <defs>
                <linearGradient id="pathGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#D8A441" stopOpacity="0.25" />
                  <stop offset="50%" stopColor="#F3D48B" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#D8A441" stopOpacity="0.95" />
                </linearGradient>
                <filter id="glow"><feGaussianBlur stdDeviation="1.2" result="coloredBlur"/><feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
              </defs>
              <path d="M 8 72 C 20 72, 22 48, 34 48 C 46 48, 50 58, 62 58 C 74 58, 76 28, 88 28" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M 8 72 C 20 72, 22 48, 34 48 C 46 48, 50 58, 62 58 C 74 58, 76 28, 88 28" fill="none" stroke="url(#pathGrad)" strokeWidth="1.2" strokeLinecap="round" filter="url(#glow)" strokeDasharray="2 2" />
            </svg>
            <div className="relative grid grid-cols-4 gap-2 min-h-[170px]">
              {journey.map((j, i) => (
                <div key={j.step} className="relative flex flex-col items-center text-center" style={{ paddingTop: `${i === 0 ? 52 : i === 1 ? 18 : i === 2 ? 34 : 0}px` }}>
                  <div className={`relative z-10 w-11 h-11 rounded-2xl grid place-items-center font-extrabold text-[12px] shadow-lg ${i === 3 ? 'bg-gradient-to-br from-[#F1C96B] to-[#D8A441] text-[#0b4b3d] shadow-[#D8A441]/30' : 'bg-[#0b4b3d]/80 border border-[#D8A441]/35 text-[#F3D48B] backdrop-blur'}`}>
                    {j.step}
                    {i < 3 && <span className="absolute -right-1 -top-1 w-2.5 h-2.5 rounded-full bg-[#6fe0bf] border-2 border-[#083a30]" />}
                  </div>
                  <div className="mt-3 text-[12px] font-extrabold text-white">{j.title}</div>
                  <div className="text-[10px] text-emerald-100/55 mt-0.5 leading-tight">{j.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-7 flex flex-wrap gap-2">
            {['Demandes & devis', 'Validation multi-niveaux', 'Budget & planning', 'Traçabilité complète'].map(t => (
              <span key={t} className="px-3 py-1.5 rounded-full bg-white/6 border border-white/10 text-[11px] font-semibold text-emerald-50/75">{t}</span>
            ))}
          </div>
        </div>

        <div className="relative text-[11px] text-emerald-100/40">© 2026 Safari Import Export — Plateforme interne de gestion</div>
      </div>

      {/* RIGHT FORM */}
      <div className="flex-1 flex items-center justify-center px-5 py-10 sm:px-10 relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(14,122,95,0.08),transparent_45%)]" />
        <div className="relative w-full max-w-[460px]">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <img src="/logo-1707950070.jpg" alt="Safari" className="w-11 h-11 rounded-xl object-contain bg-white border border-[#dcebe5] p-1 shadow-sm" />
            <div><div className="font-extrabold tracking-wide text-[#1E2229]">SAFARI</div><div className="text-[10px] text-muted">Store Management</div></div>
          </div>

          <div className="mb-7">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#0E7A5F]/10 text-[#0E7A5F] text-[11px] font-bold mb-3">
              <LockKeyhole size={13} /> Connexion sécurisée
            </div>
            <h2 className="text-[32px] font-extrabold tracking-tight text-[#1E2229]">Bienvenue</h2>
            <p className="text-[#727A88] text-[13.5px] mt-1.5">Connectez-vous pour accéder à votre espace de pilotage.</p>
          </div>

          <div className="bg-white/95 backdrop-blur border border-[#dcebe5] rounded-[28px] shadow-[0_20px_60px_rgba(14,122,95,0.10)] p-7 sm:p-8">
            {error && (
              <div className="mb-5 flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-red-50 border border-red-100 text-red-700 text-[12px] font-semibold">
                <AlertCircle size={16} className="shrink-0 mt-0.5" /><span>{error}</span>
              </div>
            )}

            <form onSubmit={submit} className="space-y-4">
              <label className="block">
                <span className="block text-[11px] font-extrabold uppercase tracking-wider text-[#727A88] mb-1.5">Adresse e-mail</span>
                <div className="relative">
                  <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8B93A1]" />
                  <input type="email" autoComplete="username" className="w-full rounded-xl border border-[#dcebe5] bg-white px-10 py-3 text-[13.5px] text-[#1E2229] outline-none transition focus:border-[#0E7A5F] focus:ring-4 focus:ring-[#0E7A5F]/10" value={email} onChange={e => setEmail(e.target.value)} placeholder="vous@safari.ma" />
                </div>
              </label>

              <label className="block">
                <span className="block text-[11px] font-extrabold uppercase tracking-wider text-[#727A88] mb-1.5">Mot de passe</span>
                <div className="relative">
                  <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8B93A1]" />
                  <input type={show ? 'text' : 'password'} autoComplete="current-password" className="w-full rounded-xl border border-[#dcebe5] bg-white px-10 pr-11 py-3 text-[13.5px] text-[#1E2229] outline-none transition focus:border-[#0E7A5F] focus:ring-4 focus:ring-[#0E7A5F]/10" value={password} onChange={e => setPassword(e.target.value)} placeholder="????????" />
                  <button type="button" onClick={() => setShow(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[#8B93A1] hover:text-[#1E2229]" title={show ? 'Masquer' : 'Afficher'}>
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>

              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-[12px] font-semibold text-[#727A88]">
                  <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="w-4 h-4 accent-[#0E7A5F]" />
                  Se souvenir de moi
                </label>
                <button type="button" onClick={() => setError("Contactez l'administrateur pour réinitialiser votre mot de passe.")} className="text-[12px] font-bold text-[#0E7A5F] hover:underline">
                  Mot de passe oublié ?
                </button>
              </div>

              <button className="w-full mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-[#0E7A5F] px-4 py-3 text-[13.5px] font-extrabold text-white shadow-lg shadow-[#0E7A5F]/20 transition hover:bg-[#0b6851] disabled:opacity-60" disabled={busy}>
                {busy ? 'Connexion en cours...' : <><span>Se connecter</span><ArrowRight size={16} /></>}
              </button>
            </form>

                  <div className="mt-3 flex items-center justify-center gap-1.5 text-[10.5px] text-[#0E7A5F] font-semibold">
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-[#727A88]">
            <ShieldCheck size={13} className="text-[#0E7A5F]" /> Accès contrôlé par rôle · Données sécurisées
          </div>
        </div>
      </div>
    </div>
  );
}