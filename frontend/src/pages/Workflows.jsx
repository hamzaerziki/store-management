import { useState } from 'react';
import { GitBranch, History } from 'lucide-react';
import { Card, CardHead, PageHeader, Tabs, WorkflowStrip } from '../components/ui';
import { WORKFLOW_LIST } from '../data/workflows';

export default function Workflows() {
  const [selected, setSelected] = useState(WORKFLOW_LIST[0]?.id || 'demande');
  const current = WORKFLOW_LIST.find(w => w.id === selected) || WORKFLOW_LIST[0];

  return (
    <>
      <PageHeader title="Cycles de vie" subtitle="Machines à états appliquées au projet, au budget, aux devis et aux opérations" actions={<GitBranch size={20} className="text-emerald-600" />} />
      <Card className="overflow-hidden">
        <Tabs tabs={WORKFLOW_LIST.map(w => ({ id: w.id, label: w.label }))} value={selected} onChange={setSelected} className="px-4 pt-2" />
        <div className="tab-panel px-5 pb-5">
          <CardHead title={current.label} subtitle={current.note} right={<span className="badge-muted !text-[10px]">{current.states.length} états</span>} />
          <WorkflowStrip states={current.states} terminal={current.terminal} />
          <div className="mt-5 overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">Depuis</th><th className="th">Vers</th><th className="th">Rôle autorisé</th></tr></thead>
              <tbody>
                {current.transitions.map((transition, index) => (
                  <tr key={index} className="hover:bg-canvas/60">
                    <td className="td text-[11.5px]">{transition.from === '*' ? 'Tout état' : (current.states.find(s => s.id === transition.from)?.label || transition.from)}</td>
                    <td className="td text-[11.5px] font-bold">{current.states.find(s => s.id === transition.to)?.label || transition.to}</td>
                    <td className="td text-[11.5px] text-muted">{transition.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-5 flex items-start gap-2 rounded-xl bg-emerald-50/60 border border-emerald-200 p-3 text-[11.5px] text-emerald-900">
            <History size={15} className="shrink-0 mt-0.5" />
            <span>Chaque transition est horodatée, attribuée à son auteur et conservée même après approbation ou rejet : les décisions ne disparaissent pas.</span>
          </div>
        </div>
      </Card>
    </>
  );
}
