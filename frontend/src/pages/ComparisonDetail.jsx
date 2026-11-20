import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, XCircle, Trophy, ShieldCheck, Clock } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, CardHead, PageHeader, StatusBadge, DecisionModal, DecisionProof, Tabs, ErrorBox, money, Empty } from '../components/ui';

export default function ComparisonDetail() {
  const { id } = useParams();
  const { user, can } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState({ decisions: [], transitions: [] });
  const [historyTab, setHistoryTab] = useState('decisions');

  const load = () => {
    api.get(`/comparisons/${id}`).then(r => setData(r.data)).catch(setError);
    api.get(`/comparisons/${id}/history`).then(r => setHistory(r.data)).catch(() => {});
  };
  useEffect(() => { load(); }, [id]);

  async function submitDecision(decision, comment = '') {
    setError(''); setBusy(true);
    try { await api.post(`/comparisons/${id}/validate`, { decision, comment }); setModal(null); load(); }
    catch (e) { setError(e); }
    finally { setBusy(false); }
  }

  if (!data) return <div className="text-muted text-sm p-6">{error || 'Chargement…'}</div>;

  const minPrice = Math.min(...data.quotes.map(q => Number(q.amount_ttc) || 0));
  const score = q => q.score ?? (
    (Number(q.amount_ttc) === minPrice ? 40 : minPrice > 0 ? 40 * minPrice / Number(q.amount_ttc) : 40) +
    (q.reliability_score || 3) * 8 +
    Math.max(0, 12 - (q.delivery_days || 30) / 5) +
    Math.min(10, (q.warranty_months || 0) / 6)
  );
  const best = data.selected_quote_id;
  const stageRole = data.current_stage;
  const canValidate = !!data.can_validate;

  return (
    <>
      <Link to="/comparisons" className="inline-flex items-center gap-1.5 text-[12px] font-bold text-muted hover:text-emerald-600 mb-4"><ArrowLeft size={14} /> Comparatifs</Link>
      <PageHeader title={data.item_name} subtitle={`${data.store_name} · Créé par ${data.created_by_name || '—'} le ${new Date(data.created_at).toLocaleDateString('fr-FR')}`}
        actions={<><StatusBadge status={data.status} />{canValidate && <button className="btn-primary" onClick={() => submitDecision('approved')}><CheckCircle2 size={16} /> Valider</button>}{canValidate && <button className="btn-ghost !text-red-600" onClick={() => setModal('rejected')}><XCircle size={16} /> Rejeter</button>}</>} />
      <ErrorBox error={error} />

      <div className="grid md:grid-cols-3 gap-4 mb-5">
        <Card className="p-5"><div className="text-[11px] text-muted font-semibold">Offres comparées</div><div className="text-2xl font-extrabold mt-1">{data.quotes.length}</div></Card>
        <Card className="p-5"><div className="text-[11px] text-muted font-semibold">Montant retenu</div><div className="text-2xl font-extrabold mt-1 text-emerald-600">{money(data.amount_ttc)}</div></Card>
        <Card className="p-5"><div className="text-[11px] text-muted font-semibold">Chaîne d'approbation</div><div className="text-lg font-extrabold mt-1">CDG → DD → DG</div><div className="text-[11px] text-muted">Étape actuelle : {stageRole || (data.status === 'validated' ? 'Terminée' : '—')}</div></Card>
      </div>

      {data.justification && <Card className="p-5 mb-5"><div className="text-[11px] font-bold text-muted uppercase mb-1">Justification</div><p className="text-[13px]">{data.justification}</p></Card>}

      <Card className="overflow-hidden mb-5">
        <CardHead title="Comparatif des offres" subtitle="Prix, délai, garantie et fiabilité" />
        {data.quotes.length === 0 ? <Empty /> : <div className="overflow-x-auto"><table className="w-full">
          <thead><tr><th className="th">Rang</th><th className="th">Entreprise</th><th className="th">HT</th><th className="th">TTC</th><th className="th">Délai</th><th className="th">Garantie</th><th className="th">Fiabilité</th><th className="th">Score</th><th className="th">Sélection</th></tr></thead>
          <tbody>
            {data.quotes.map(q => (
              <tr key={q.id} className={q.id === best ? 'bg-emerald-600/5' : 'hover:bg-canvas/60'}>
                <td className="td font-extrabold">{q.rank || '—'}</td>
                <td className="td font-bold">{q.supplier_name} {q.is_cheapest && <span className="badge-ok ml-1 !text-[9px]"><Trophy size={10} /> Meilleur prix</span>}{q.rank === 1 && <span className="badge-ok ml-1 !text-[9px]">Meilleur score</span>}</td>
                <td className="td">{money(q.amount_ht)}</td>
                <td className="td font-extrabold">{money(q.amount_ttc)}</td>
                <td className="td">{q.delivery_days} j</td>
                <td className="td">{q.warranty_months} mois</td>
                <td className="td">{'★'.repeat(q.reliability_score || 3)}</td>
                <td className="td font-bold text-emerald-600">{score(q).toFixed(1)}</td>
                <td className="td">{q.id === best ? <span className="badge-ok"><CheckCircle2 size={12} /> Retenu</span> : <span className="text-muted text-[11px]">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>}
      </Card>

      <Card className="overflow-hidden">
        <Tabs className="px-4 pt-2 bg-canvas/60" value={historyTab} onChange={setHistoryTab} tabs={[
          { id: 'decisions', label: 'Décisions', count: data.validations.length },
          { id: 'transitions', label: 'Transitions', count: history.transitions.length },
        ]} />
        <div className="tab-panel px-5 pb-5">
          <CardHead title="Preuves conservées" subtitle="Auteur, date, décision et motif restent visibles après validation ou rejet" />
          <DecisionProof rows={historyTab === 'decisions'
            ? data.validations.map(v => ({ role: v.validator_role, decision: v.decision, reason: v.comment, date: v.decided_at || v.created_at, actor: v.validator_name }))
            : history.transitions} />
          {stageRole && <div className="mt-4 flex items-center gap-2 text-[12px] text-amber-600 font-semibold"><Clock size={15} /> En attente de l'approbation {stageRole}{stageRole === 'DG' ? ' (décision finale)' : ''}</div>}
        </div>
      </Card>

      <DecisionModal open={modal === 'rejected'} onClose={() => setModal(null)} title={data.item_name} busy={busy} onConfirm={reason => submitDecision('rejected', reason)} />
    </>
  );
}
