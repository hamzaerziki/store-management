import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, FileCheck2, X, Inbox as InboxIcon, Eye, FileText, GitCompareArrows, Wallet } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PageHeader, Card, CardHead, Modal, Tabs, DecisionModal, DecisionProof, ErrorBox, Empty, money, dateFR } from '../components/ui';

const TABS = [
  { id: 'pending', label: 'À traiter', icon: Clock },
  { id: 'done', label: 'Traités', icon: FileCheck2 },
  { id: 'rejected', label: 'Rejetés', icon: X },
  { id: 'all', label: 'Toutes', icon: InboxIcon },
];

const TYPE_LABELS = { demande: 'Demande', comparatif: 'Comparatif', budget: 'Budget' };
const TYPE_ICONS = { demande: FileText, comparatif: GitCompareArrows, budget: Wallet };

const DEMAND_STAGES = {
  draft: 'Brouillon', pending_cdg: 'Attente CDG', pending_dd: 'Attente DD',
  pending_dg: 'Attente DG', approved: 'Approuvée', rejected: 'Rejetée',
};

const COMPARISON_STAGES = {
  draft: 'Brouillon', pending_cdg: 'Attente CDG', pending_dd: 'Attente DD',
  pending_dg: 'Attente DG', validated: 'Validé', validated_cmp: 'Validé',
  approved: 'Approuvé', rejected: 'Rejeté',
};

const BUDGET_STAGES = {
  brouillon: 'Brouillon', soumis_cdg: 'Soumis CDG', soumis_dd: 'Soumis DD',
  soumis_dg: 'Soumis DG', approuve: 'Approuvé', corrige: 'Correction demandée',
};

const BUDGET_NEXT = {
  brouillon: 'soumis_dd', soumis_cdg: 'soumis_dd',
  soumis_dd: 'soumis_dg', soumis_dg: 'approuve',
  corrige: 'soumis_dd',
};

function bucket(status) {
  const value = String(status || '').toLowerCase();
  if (['rejected', 'corrige', 'annule', 'annulee'].includes(value)) return 'rejected';
  if (['approved', 'validated', 'validated_cmp', 'approuve'].includes(value)) return 'done';
  if (['pending_cdg', 'pending_dd', 'pending_dg', 'soumis_cdg', 'soumis_dd', 'soumis_dg'].includes(value)) return 'pending';
  return 'other';
}

function stageLabel(row) {
  if (row.type === 'budget') return BUDGET_STAGES[row.status] || row.status || '—';
  if (row.type === 'comparatif') return COMPARISON_STAGES[row.status] || row.status || '—';
  return DEMAND_STAGES[row.status] || row.status || '—';
}

export default function Inbox() {
  const { can } = useAuth();
  const [demands, setDemands] = useState([]);
  const [comparisons, setComparisons] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [tab, setTab] = useState('pending');
  const [rejectTarget, setRejectTarget] = useState(null);
  const [proofTarget, setProofTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = () => {
    api.get('/demands').then(r => setDemands(Array.isArray(r.data) ? r.data : [])).catch(setError);
    api.get('/comparisons').then(r => setComparisons(Array.isArray(r.data) ? r.data : [])).catch(setError);
    api.get('/operations/budgets').then(r => setBudgets(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const items = useMemo(() => {
    const normalized = [
      ...demands.map(row => ({
        ...row,
        type: 'demande',
        status: row.status,
        title: row.title || row.description || 'Demande',
        subtitle: [row.store_name, row.kind === 'mission' ? 'Mission' : row.kind === 'article' ? 'Article' : '', row.created_by_name].filter(Boolean).join(' · '),
        amount: row.amount ?? row.amount_ttc,
        decisions: row.decisions || [],
        date: row.submitted_at || row.created_at,
        link: '/demands',
      })),
      ...comparisons.map(row => ({
        ...row,
        type: 'comparatif',
        status: row.status,
        title: row.item_name || row.title || 'Comparatif',
        subtitle: [row.store_name, row.supplier_name].filter(Boolean).join(' · '),
        amount: row.amount_ttc ?? row.amount,
        decisions: row.decisions || [],
        date: row.created_at || row.submitted_at,
        link: `/comparisons/${row.id}`,
      })),
      ...budgets.map(row => ({
        ...row,
        type: 'budget',
        status: row.state || row.status,
        title: row.label || row.title || `Budget ${row.id}`,
        subtitle: [row.store_name, row.lot_name].filter(Boolean).join(' · '),
        amount: row.amount ?? row.amount_ttc,
        decisions: row.decisions || row.transitions || [],
        date: row.created_at || row.updated_at,
        link: '/operations',
      })),
    ];
    return normalized.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }, [demands, comparisons, budgets]);

  const counts = useMemo(() => ({
    pending: items.filter(row => bucket(row.status) === 'pending').length,
    done: items.filter(row => bucket(row.status) === 'done').length,
    rejected: items.filter(row => bucket(row.status) === 'rejected').length,
    all: items.length,
  }), [items]);

  const shown = items.filter(row => tab === 'all' ? true : bucket(row.status) === tab);

  function mayValidate(row) {
    if (typeof row.can_validate === 'boolean') return row.can_validate;
    return can('financial_validation') || can('final_validation') || can('manage_operations');
  }

  async function decide(row, decision, comment = '') {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (row.type === 'budget') {
        const to = decision === 'rejected' ? 'corrige' : BUDGET_NEXT[row.status] || 'soumis_dd';
        await api.post(`/operations/budgets/${row.id}/transition`, { to, reason: comment || 'Validation depuis la corbeille' });
        setNotice(`Budget : ${BUDGET_STAGES[to] || to}`);
      } else if (row.type === 'comparatif') {
        await api.post(`/comparisons/${row.id}/validate`, { decision, comment });
        setNotice(`Comparatif : ${decision === 'rejected' ? 'rejeté' : 'validé'}`);
      } else {
        await api.post(`/demands/${row.id}/validate`, { decision, comment });
        setNotice(`Demande : ${decision === 'rejected' ? 'rejetée' : 'approuvée'}`);
      }
      setRejectTarget(null);
      load();
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Corbeille de validations" subtitle="Demandes, comparatifs et budgets : décisions et preuves centralisées" />
      <ErrorBox error={error} />
      {notice && <div className="mb-4 rounded-lg bg-emerald-50 text-emerald-700 text-[12px] font-semibold px-4 py-3">{notice}</div>}

      <Card className="overflow-hidden">
        <Tabs value={tab} onChange={setTab} className="px-4 pt-2 bg-canvas/60" tabs={TABS.map(item => ({ ...item, count: counts[item.id] }))} />
        <div className="px-5 pb-5 pt-5">
          <CardHead title="Dossiers à décision" subtitle="Chaque approbation ou rejet est conservé avec son auteur et son motif" right={<InboxIcon size={16} className="text-emerald-600" />} />
          {shown.length === 0 ? <Empty text="Aucun dossier dans cette vue" /> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[1050px]">
              <thead><tr>
                <th className="th">Type</th>
                <th className="th">Dossier</th>
                <th className="th">Stade actuel</th>
                <th className="th">Montant</th>
                <th className="th">Preuve de décision</th>
                <th className="th">Date</th>
                <th className="th">Action</th>
              </tr></thead>
              <tbody>
                {shown.map(row => {
                  const Icon = TYPE_ICONS[row.type] || FileText;
                  const actionable = bucket(row.status) === 'pending' && mayValidate(row);
                  return (
                    <tr key={`${row.type}-${row.id}`} className="hover:bg-canvas/60">
                      <td className="td">
                        <span className="badge-muted !text-[10px] inline-flex items-center gap-1"><Icon size={11} /> {TYPE_LABELS[row.type]}</span>
                      </td>
                      <td className="td">
                        <Link to={row.link} className="font-extrabold text-[12.5px] hover:text-emerald-600">{row.title}</Link>
                        <div className="text-[10.5px] text-muted mt-0.5">{row.subtitle || '—'}</div>
                      </td>
                      <td className="td">
                        <span className={`!text-[10px] ${bucket(row.status) === 'rejected' ? 'badge-bad' : bucket(row.status) === 'done' ? 'badge-ok' : 'badge-warn'}`}>{stageLabel(row)}</span>
                      </td>
                      <td className="td font-bold text-[12px]">{money(row.amount)}</td>
                      <td className="td">
                        <DecisionProof compact rows={row.decisions} />
                        {row.decisions?.length > 0 && <button className="text-[10px] font-bold text-emerald-600 inline-flex items-center gap-1 mt-1" onClick={() => setProofTarget(row)}><Eye size={11} /> Détail</button>}
                      </td>
                      <td className="td text-[11px] text-muted">{dateFR(row.date)}</td>
                      <td className="td">
                        {actionable ? (
                          <div className="flex gap-1.5">
                            <button className="btn-ghost !py-1 !px-2 !text-[11px] text-emerald-700" disabled={busy} onClick={() => decide(row, 'approved')}><FileCheck2 size={13} /> Approuver</button>
                            <button className="btn-ghost !py-1 !px-2 !text-[11px] text-red-600" disabled={busy} onClick={() => setRejectTarget(row)}><X size={13} /> Rejeter</button>
                          </div>
                        ) : bucket(row.status) === 'pending' ? (
                          <span className="text-[10.5px] text-muted">En attente du validateur</span>
                        ) : (
                          <span className={`text-[10.5px] font-bold ${bucket(row.status) === 'rejected' ? 'text-red-600' : 'text-emerald-700'}`}>Décision enregistrée</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </div>
      </Card>

      <DecisionModal open={!!rejectTarget} onClose={() => setRejectTarget(null)} title={rejectTarget?.title} busy={busy}
        onConfirm={reason => decide(rejectTarget, 'rejected', reason)} />

      <Modal open={!!proofTarget} onClose={() => setProofTarget(null)} title={`Preuve de décision — ${proofTarget?.title || ''}`}>
        <DecisionProof rows={proofTarget?.decisions || []} />
      </Modal>
    </>
  );
}
