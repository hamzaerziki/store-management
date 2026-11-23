import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, X } from 'lucide-react';
import api from '../api/client';

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="text-[13px] text-muted mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = '' }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function CardHead({ title, subtitle, right }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
      <div>
        <h2 className="text-sm font-extrabold">{title}</h2>
        {subtitle && <p className="text-[11.5px] text-muted mt-0.5">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, className = '' }) {
  return (
    <div className={`tabs ${className}`} role="tablist">
      {tabs.map(tab => (
        <button key={tab.id} type="button" role="tab" aria-selected={value === tab.id}
          className={`tab ${value === tab.id ? 'tab-active' : ''}`} onClick={() => onChange(tab.id)}>
          {tab.icon && <tab.icon size={14} />}
          <span>{tab.label}</span>
          {tab.count !== undefined && <span className="tab-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

const statusMap = {
  on_track: ['ok', 'En bonne voie'], at_risk: ['warn', 'À risque'], late: ['bad', 'En retard'], en_retard: ['bad', 'En retard'],
  ready: ['ok', 'Prêt'], ouvert: ['ok', 'Ouvert'], planning: ['muted', 'Planifié'],
  to_quote: ['muted', 'À deviser'], quotes_received: ['warn', 'Devis reçus'],
  compared: ['warn', 'Comparé'], validated: ['ok', 'Validé CDG/DD'], approved: ['ok', 'Approuvé DG'],
  ordered: ['ok', 'Commandé'], delivered: ['ok', 'Livré'], installed: ['ok', 'Installé'],
  draft: ['muted', 'Brouillon'], pending_cdg: ['warn', 'Attente CDG'],
  pending_dd: ['warn', 'Attente DD'], pending_dg: ['warn', 'Attente DG'],
  validated_cmp: ['ok', 'Validé'], rejected: ['bad', 'Rejeté'],
};

export const STATUS_LABELS_FR = {
  on_track: 'En bonne voie', at_risk: 'À risque', late: 'En retard', en_retard: 'En retard', ready: 'Prêt', ouvert: 'Ouvert', planning: 'Planifié',
  to_quote: 'À deviser', quotes_received: 'Devis reçus', compared: 'Comparé',
  validated: 'Validé (CDG/DD)', approved: 'Approuvé (DG)', ordered: 'Commandé',
  delivered: 'Livré', installed: 'Installé', draft: 'Brouillon',
  pending_cdg: 'Attente CDG', pending_dd: 'Attente DD', pending_dg: 'Attente DG', validated_cmp: 'Validé', rejected: 'Rejeté',
};

export function StatusBadge({ status }) {
  const [tone, label] = statusMap[status] || ['muted', status];
  return <span className={`badge-${tone}`}><i className="w-1.5 h-1.5 rounded-full bg-current" />{label}</span>;
}

export const EXECUTION_LABELS_FR = {
  accepte_dg: 'Validé (0%)',
  en_cours: 'En cours (50%)',
  livre: 'Livré (100%)',
  installe: 'Installé (100%)',
};
export const EXECUTION_EDIT_OPTIONS = ['accepte_dg', 'en_cours', 'livre'];

export const EXECUTION_PROGRESS = { accepte_dg: 0, en_cours: 50, livre: 100, installe: 100 };

export function demandProgress(demand) {
  const status = String(demand?.status || '');
  if (status === 'rejected') return { progress: 0, bucket: 'rejected', rejected: true };
  if (status !== 'approved') return { progress: 0, bucket: 'zero', rejected: false };
  const progress = EXECUTION_PROGRESS[demand?.execution_status] ?? 0;
  const bucket = progress >= 100 ? 'hundred' : progress >= 50 ? 'fifty' : 'zero';
  return { progress, bucket, rejected: false };
}

export function demandEventDate(demand) {
  const status = String(demand?.status || '');
  const value = status === 'rejected'
    ? demand?.updated_at || demand?.submitted_at || demand?.created_at
    : status === 'approved'
      ? demand?.execution_updated_at || demand?.updated_at || demand?.submitted_at || demand?.created_at
      : demand?.submitted_at || demand?.updated_at || demand?.created_at;
  return new Date(value || 0);
}

export function summarizeDemandProgress(demands = []) {
  const totals = { total: 0, approved: 0, rejected: 0, zero: 0, fifty: 0, hundred: 0, amount: 0, scored: 0, progress_sum: 0, average: 0 };
  demands.forEach(demand => {
    const info = demandProgress(demand);
    totals.total += 1;
    totals[info.bucket] += 1;
    if (String(demand?.status || '') === 'approved') totals.approved += 1;
    totals.amount += Number(demand?.amount || 0);
    if (!info.rejected) {
      totals.scored += 1;
      totals.progress_sum += info.progress;
    }
  });
  totals.average = totals.scored ? Math.round(totals.progress_sum / totals.scored) : 0;
  delete totals.scored;
  delete totals.progress_sum;
  return totals;
}

export function buildDemandTrend(demands = [], months = 7) {
  const dated = demands
    .map(demand => ({ demand, eventDate: demandEventDate(demand) }))
    .filter(row => !Number.isNaN(row.eventDate.getTime()));
  if (!dated.length) return [];
  const monthKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const keys = [...new Set(dated.map(row => monthKey(row.eventDate)))].sort().slice(-months);
  const formatter = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit' });
  return keys.map(key => {
    const [year, month] = key.split('-').map(Number);
    const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
    const included = dated.filter(row => row.eventDate <= monthEnd).map(row => row.demand);
    const stats = summarizeDemandProgress(included);
    return {
      month: formatter.format(new Date(year, month - 1, 1)).replace('.', ''),
      demands: stats.total,
      approved: stats.approved,
      zero: stats.zero,
      fifty: stats.fifty,
      hundred: stats.hundred,
      rejected: stats.rejected,
      progress: stats.average,
    };
  });
}

export function ExecutionStatusSelect({ demand, disabled = false, canEdit, onChange }) {
  const [value, setValue] = useState(demand?.execution_status || 'accepte_dg');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setValue(demand?.execution_status || 'accepte_dg'); }, [demand?.id, demand?.execution_status]);

  if (!demand || demand.status !== 'approved') {
    if (demand?.status === 'rejected') return <span className="text-[10px] font-semibold text-red-600">Rejetée</span>;
    if (demand?.status === 'draft') return <span className="text-[10px] text-muted">Brouillon</span>;
    return <span className="text-[10px] text-muted">Après validation DG</span>;
  }

  const editable = canEdit !== undefined ? !!canEdit : !disabled;

  async function save(next) {
    const previous = value;
    setValue(next); setError(''); setBusy(true);
    try {
      const r = await api.patch(`/demands/${demand.id}/execution-status`, { execution_status: next });
      onChange?.(r.data);
    } catch (e) {
      setValue(previous); setError(e?.message || 'Mise à jour impossible');
    } finally { setBusy(false); }
  }

  return (
    <div className="min-w-[172px]">
      <div className="relative">
        <select
          className="w-full appearance-none cursor-pointer rounded-xl border border-[#d9e7e1] bg-white/95 px-3 py-2 pr-8 text-[10.5px] font-bold text-[#1E2229] shadow-sm outline-none transition hover:border-[#0E7A5F] hover:bg-white hover:shadow focus:border-[#0E7A5F] focus:ring-2 focus:ring-[#0E7A5F]/15 disabled:cursor-not-allowed disabled:bg-[#f6faf8] disabled:opacity-80"
          value={value}
          disabled={!editable || busy}
          onChange={e => save(e.target.value)}
          title={error || (editable ? 'Modifier le suivi d’exécution' : EXECUTION_LABELS_FR[value] || 'Suivi d’exécution')}
        >
          {!EXECUTION_EDIT_OPTIONS.includes(value) && <option value={value} disabled>{EXECUTION_LABELS_FR[value] || value}</option>}
          {EXECUTION_EDIT_OPTIONS.map(key => <option key={key} value={key}>{EXECUTION_LABELS_FR[key]}</option>)}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#0E7A5F]" />
      </div>
      {error && <div className="mt-1 text-[9px] text-red-600">{error}</div>}
    </div>
  );
}

const stamp = value => value ? new Date(value).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const decisionLabel = value => value === 'approved' || value === 'validated' ? 'Approuvé'
  : value === 'rejected' ? 'Rejeté'
    : value === 'corrige' ? 'Correction demandée'
      : value ? String(value).replaceAll('_', ' ') : 'Transité';

export function DecisionProof({ rows = [], compact = false }) {
  const items = rows.map(row => ({
    role: row.role || row.validator_role || row.actor_role || '—',
    actor: row.actor || row.actor_name || row.validator_name || '',
    decision: row.decision || row.to_state,
    reason: row.comment || row.reason || '',
    date: row.date || row.created_at,
  }));
  if (!items.length) return <span className="text-[10.5px] text-muted">Aucune décision enregistrée</span>;
  if (compact) {
    return (
      <div className="flex flex-wrap gap-1">
        {items.map((item, index) => (
          <span key={index} title={`${item.actor} · ${stamp(item.date)}${item.reason ? ` · ${item.reason}` : ''}`}
            className={`badge !text-[9.5px] ${item.decision === 'rejected' || item.decision === 'corrige' ? 'badge-bad' : 'badge-ok'}`}>
            {item.role} · {decisionLabel(item.decision)}{item.actor ? ` · ${item.actor}` : ''}
          </span>
        ))}
      </div>
    );
  }
  return (
    <ol className="space-y-2">
      {items.map((item, index) => (
        <li key={index} className="relative pl-6 border-l border-line pb-2 last:border-transparent">
          <span className={`absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full ${item.decision === 'rejected' || item.decision === 'corrige' ? 'bg-red-500' : 'bg-emerald-500'}`} />
          <div className="text-[11.5px] font-bold">{item.role} · {decisionLabel(item.decision)}</div>
          <div className="text-[10.5px] text-muted">{item.actor || 'Utilisateur'} · {stamp(item.date)}</div>
          {item.reason && <div className="text-[10.5px] text-slate-600 mt-1 rounded-lg bg-canvas px-2 py-1">{item.reason}</div>}
        </li>
      ))}
    </ol>
  );
}

export function WorkflowStrip({ states = [], current, terminal = [] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {states.map((state, index) => {
        const active = current === state.id;
        const isTerminal = terminal.includes(state.id);
        return (
          <span key={state.id} className="flex items-center gap-1.5">
            {index > 0 && <span className="text-muted text-[11px]">→</span>}
            <span className={`px-2.5 py-1.5 rounded-lg text-[10.5px] font-bold border ${active ? 'bg-emerald-600 text-white border-emerald-600' : isTerminal ? 'bg-red-500/10 text-red-600 border-red-500/20' : 'bg-canvas text-muted border-line'}`}>
              {state.label || state}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function ProgressBar({ value, tone = 'green', height = 'h-2', className = '' }) {
  const colors = { green: 'bg-emerald-600', gold: 'bg-gold-500', red: 'bg-red-500' };
  return (
    <div className={`${height} ${className} w-full bg-slate-100 rounded-full overflow-hidden`}>
      <div className={`${colors[tone]} h-full rounded-full transition-all duration-1000`} style={{ width: `${Math.min(value || 0, 100)}%` }} />
    </div>
  );
}

export function KpiCard({ label, value, sub, icon: Icon, tone = 'emerald', progress }) {
  const tones = {
    emerald: { bar: 'bg-emerald-500', icon: 'bg-emerald-500/10 text-emerald-600', tone: 'green' },
    blue: { bar: 'bg-blue-500', icon: 'bg-blue-500/10 text-blue-600', tone: 'green' },
    amber: { bar: 'bg-amber-500', icon: 'bg-amber-500/10 text-amber-600', tone: 'gold' },
    gold: { bar: 'bg-gold-500', icon: 'bg-gold-500/10 text-gold-500', tone: 'gold' },
    red: { bar: 'bg-red-500', icon: 'bg-red-500/10 text-red-600', tone: 'red' },
    violet: { bar: 'bg-violet-500', icon: 'bg-violet-500/10 text-violet-600', tone: 'green' },
  };
  const t = tones[tone] || tones.emerald;
  const pct = typeof progress === 'number' ? Math.max(0, Math.min(100, progress)) : null;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-white shadow-card p-4">
      <div className={`absolute inset-x-0 top-0 h-1 ${t.bar}`} />
      <div className="flex items-start justify-between">
        <div className={`w-9 h-9 rounded-xl grid place-items-center ${t.icon}`}><Icon size={17} /></div>
        {pct !== null && <span className="text-[10px] font-extrabold text-muted">{Math.round(pct)}%</span>}
      </div>
      <div className="mt-3 text-[10px] font-extrabold uppercase tracking-widest text-muted">{label}</div>
      <div className="text-[24px] font-extrabold tracking-tight leading-tight mt-0.5">{value}</div>
      <div className="text-[11px] text-muted mt-1 truncate">{sub}</div>
      {pct !== null && <ProgressBar value={pct} tone={t.tone} height="h-1.5" className="mt-3" />}
    </div>
  );
}

export function StatCard({ label, value, sub, icon: Icon, tint = 'emerald' }) {
  const tints = {
    emerald: 'bg-emerald-600/10 text-emerald-600',
    blue: 'bg-blue-500/10 text-blue-600',
    red: 'bg-red-500/10 text-red-600',
    gold: 'bg-gold-500/10 text-gold-500',
  };
  return (
    <Card className="p-5 relative overflow-hidden">
      <div className="flex items-start justify-between">
        <span className="text-[11.5px] font-semibold text-muted">{label}</span>
        <div className={`w-9 h-9 rounded-xl grid place-items-center ${tints[tint]}`}><Icon size={17} /></div>
      </div>
      <div className="text-[27px] font-extrabold tracking-tight mt-2.5">{value}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </Card>
  );
}

export function Modal({ open, onClose, title, children, wide, full, xlarge }) {
  const dialogRef = useRef(null);
  const previousFocus = useRef(null);
  const closeRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    previousFocus.current = document.activeElement;
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current?.();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const timer = window.setTimeout(() => dialogRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(timer);
      const target = previousFocus.current;
      if (target && typeof target.focus === 'function' && document.contains(target)) target.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={() => closeRef.current?.()}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={`modal-panel flex flex-col bg-white rounded-2xl shadow-2xl w-full ${full ? 'h-[94vh] max-w-[96vw]' : `${xlarge ? 'max-w-6xl h-[92vh]' : wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[92vh]`} overflow-hidden`}
        onMouseDown={e => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-line bg-white px-6 py-4">
          <h3 id={titleId} className="font-extrabold text-base">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Fermer la fenêtre" className="modal-close p-1.5 rounded-lg hover:bg-canvas"><X size={18} /></button>
        </div>
        <div className={`${full ? 'p-4' : 'p-6'} min-h-0 flex-1 overflow-auto`}>{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title = 'Confirmer cette action', message, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = true, busy = false }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <div className="flex gap-3">
          <div className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${danger ? 'bg-red-500/10 text-red-600' : 'bg-emerald-500/10 text-emerald-600'}`}>
            <AlertTriangle size={17} />
          </div>
          <p className="text-[12.5px] text-slate-700 leading-relaxed">{message}</p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>{cancelLabel}</button>
          <button type="button" className={`btn-primary ${danger ? '!bg-red-600 hover:!bg-red-700' : ''}`} disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}

export function DecisionModal({ open, onClose, title, onConfirm, busy }) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={`Rejeter — ${title || 'dossier'}`}>
      <form onSubmit={e => { e.preventDefault(); onConfirm(reason); }} className="space-y-4">
        <p className="text-[12px] text-muted">Le rejet et son auteur sont conservés dans l’historique. Le motif est facultatif.</p>
        <Field label="Motif du rejet (facultatif)"><textarea className="input min-h-[100px]" value={reason} onChange={e => setReason(e.target.value)} placeholder="Indiquez pourquoi ce dossier est rejeté…" autoFocus /></Field>
        <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={onClose}>Annuler</button><button className="btn-primary" disabled={busy}>Confirmer le rejet</button></div>
      </form>
    </Modal>
  );
}

export function Field({ label, children, className = '' }) {
  return <label className={`block ${className}`}><span className="label">{label}</span>{children}</label>;
}

export function Empty({ text = 'Aucune donnée disponible' }) {
  return <div className="text-center py-12 text-muted text-[13px]">{text}</div>;
}

export function ErrorBox({ error }) {
  return error ? <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-[12.5px] font-semibold">{error}</div> : null;
}

export const money = n => new Intl.NumberFormat('fr-MA', { maximumFractionDigits: 0 }).format(n || 0) + ' MAD';
export const dateFR = d => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
