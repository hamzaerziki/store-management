import { ShieldCheck, Monitor, Store, Calculator, Landmark, Building2, CheckCircle2, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Card, PageHeader } from '../components/ui';
import { ROLE_DEFINITIONS, WORKFLOW_STEPS } from '../data/roles';

const icons = { admin: ShieldCheck, IT: Monitor, MG: Store, DD: Building2, CDG: Calculator, DG: Landmark };
const tones = {
  emerald: 'bg-emerald-600/10 text-emerald-600',
  blue: 'bg-blue-500/10 text-blue-600',
  gold: 'bg-gold-500/15 text-gold-500',
  amber: 'bg-amber-500/10 text-amber-600',
  violet: 'bg-violet-500/10 text-violet-600',
};

export default function Roles() {
  const { user } = useAuth();

  return (
    <>
      <PageHeader title="Rôles & responsabilités" subtitle="Qui fait quoi, du devis PDF à l’approbation finale" />

      <Card className="p-5 mb-5">
        <div className="text-[11px] font-bold uppercase text-muted mb-3">Circuit de traitement d’un devis</div>
        <div className="flex flex-wrap items-center gap-2">
          {WORKFLOW_STEPS.map((step, index) => (
            <div key={step.label} className="flex items-center gap-2">
              <div className="rounded-xl border border-line bg-canvas px-3 py-2">
                <span className="text-[11px] font-extrabold text-emerald-600">{step.label}</span>
                <span className="text-[11.5px] text-muted ml-1.5">{step.text}</span>
              </div>
              {index < WORKFLOW_STEPS.length - 1 && <ArrowRight size={14} className="text-muted" />}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {ROLE_DEFINITIONS.map(role => {
          const Icon = icons[role.code] || ShieldCheck;
          const mine = user?.role === role.code;
          return (
            <Card key={role.code} className="p-5 flex flex-col">
              <div className="flex items-start gap-3 mb-4">
                <div className={`w-10 h-10 rounded-xl grid place-items-center ${tones[role.tone]}`}><Icon size={19} /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[14px] font-extrabold">{role.name}</h2>
                    {mine && <span className="badge-ok !text-[9px]">Votre rôle</span>}
                  </div>
                  <div className="text-[10.5px] text-muted font-bold uppercase tracking-wide mt-0.5">{role.code}</div>
                </div>
              </div>

              <p className="text-[12px] text-muted leading-relaxed mb-4">{role.mission}</p>

              <div className="space-y-2 mb-4">
                {role.duties.map(duty => (
                  <div key={duty} className="flex items-start gap-2 text-[11.5px]">
                    <CheckCircle2 size={14} className="text-emerald-600 mt-0.5 shrink-0" />
                    <span className="leading-snug">{duty}</span>
                  </div>
                ))}
              </div>

              <div className="mt-auto pt-3 border-t border-line/70 text-[10.5px] text-muted leading-relaxed">
                <b className="text-ink">Limite :</b> {role.boundary}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
