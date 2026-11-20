import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ShieldCheck, Users, ScrollText, Settings as SettingsIcon, Database, LockKeyhole, Unlock } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, CardHead, PageHeader, Modal, Field, Tabs, DecisionModal, DecisionProof, ErrorBox, Empty, money, dateFR } from '../components/ui';

const EMPTY_ASSIGNMENT = { user_id: '', store_id: '', lot_label: '', role: '', active: 'true' };
const ENTITIES = ['project', 'budget', 'purchase_order', 'invoice', 'demand', 'comparison', 'change_request', 'reception', 'store'];

export default function Governance() {
  const { user, can } = useAuth();
  const [tab, setTab] = useState('assignments');
  const [storeFilter, setStoreFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [references, setReferences] = useState({ stores: [], users: [], suppliers: [], lots: [], brands: [] });
  const [assignments, setAssignments] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [assignForm, setAssignForm] = useState(EMPTY_ASSIGNMENT);
  const [reopenTarget, setReopenTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const isDirector = ['admin', 'DG'].includes(user?.role);
  const loadReferences = () => api.get('/governance/references').then(r => setReferences(r.data)).catch(setError);
  const loadAssignments = () => api.get('/governance/assignments').then(r => setAssignments(r.data)).catch(setError);
  const loadDecisions = () => {
    const params = [];
    if (storeFilter) params.push(`store_id=${storeFilter}`);
    if (entityFilter) params.push(`entity=${encodeURIComponent(entityFilter)}`);
    api.get(`/governance/decisions${params.length ? `?${params.join('&')}` : ''}`).then(r => setDecisions(r.data)).catch(setError);
  };

  useEffect(() => { loadReferences(); loadAssignments(); }, []);
  useEffect(() => { loadDecisions(); }, [storeFilter, entityFilter]);

  async function createAssignment(e) {
    e.preventDefault(); setError(''); setNotice('');
    const payload = {
      user_id: Number(assignForm.user_id),
      store_id: Number(assignForm.store_id),
      lot_label: assignForm.lot_label || null,
      role: assignForm.role || null,
      active: assignForm.active === true || assignForm.active === 'true',
    };
    try {
      await api.post('/governance/assignments', payload);
      setAssignmentOpen(false); setAssignForm(EMPTY_ASSIGNMENT); setNotice('Affectation enregistrée');
      loadAssignments();
    } catch (err) { setError(err); }
  }

  async function reopen(reason) {
    if (!reopenTarget) return;
    setError(''); setNotice(''); setBusy(true);
    try {
      await api.post(`/governance/stores/${reopenTarget.id}/reopen`, { reason });
      setNotice(`Magasin ${reopenTarget.name} réouvert · motif conservé`);
      setReopenTarget(null);
      loadReferences();
      loadDecisions();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Administration governance" subtitle="E15 — affectations, preuves de décision et référentiels" actions={
        <>
          {can('view_roles_page') && <Link className="btn-ghost" to="/roles"><ShieldCheck size={15} /> Rôles</Link>}
          {can('manage_users') && <Link className="btn-ghost" to="/users"><Users size={15} /> Utilisateurs</Link>}
          {can('view_audit_page') && <Link className="btn-ghost" to="/audit"><ScrollText size={15} /> Audit</Link>}
          <Link className="btn-ghost" to="/settings"><SettingsIcon size={15} /> Paramètres</Link>
        </>
      } />
      <ErrorBox error={error} />
      {notice && <div className="mb-4 rounded-lg bg-emerald-50 text-emerald-700 text-[12px] font-semibold px-4 py-3">{notice}</div>}

      <Card className="overflow-hidden">
        <Tabs className="px-4 pt-2 bg-canvas/60" value={tab} onChange={setTab} tabs={[
          { id: 'assignments', label: 'Affectations', icon: Users, count: assignments.length },
          { id: 'decisions', label: 'Décisions', icon: ScrollText, count: decisions.length },
          { id: 'references', label: 'Référentiels', icon: Database },
        ]} />
        <div className="px-5 pb-5 pt-5">
          {tab === 'assignments' && (
            <>
              <CardHead title="Affectations par magasin" subtitle="Une affectation limite les créations aux magasins ou zones attribuées" right={isDirector && <button className="btn-primary !py-1.5" onClick={() => { setAssignForm({ ...EMPTY_ASSIGNMENT, store_id: storeFilter || '' }); setAssignmentOpen(true); }}><Plus size={15} /> Affecter</button>} />
              {assignments.length === 0 ? <Empty text="Aucune affectation enregistrée" /> : (
                <div className="overflow-x-auto"><table className="w-full">
                  <thead><tr><th className="th">Utilisateur</th><th className="th">Magasin</th><th className="th">Zone</th><th className="th">Rôle</th><th className="th">Statut</th><th className="th">Créée le</th></tr></thead>
                  <tbody>
                    {assignments.map(row => (
                      <tr key={row.id} className="hover:bg-canvas/60">
                        <td className="td"><div className="text-[12.5px] font-bold">{row.user_name || '—'}</div><div className="text-[10.5px] text-muted">{row.email}</div></td>
                        <td className="td text-[11.5px]">{row.store_name || '—'}</td>
                        <td className="td text-[11.5px]">{row.lot_name || '—'}</td>
                        <td className="td text-[11.5px]">{row.role || 'Rôle initial'}</td>
                        <td className="td"><span className={row.active ? 'badge-ok !text-[10px]' : 'badge-muted !text-[10px]'}>{row.active ? 'Active' : 'Inactive'}</span></td>
                        <td className="td text-[11px] text-muted">{dateFR(row.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </>
          )}

          {tab === 'decisions' && (
            <>
              <CardHead title="Journal des décisions" subtitle="Chaque transition conserve auteur, rôle, motif et empreinte" />
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <select className="input !py-2 !text-[12px] w-64" value={storeFilter} onChange={e => setStoreFilter(e.target.value)}>
                  <option value="">Tous les magasins</option>
                  {references.stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select className="input !py-2 !text-[12px] w-64" value={entityFilter} onChange={e => setEntityFilter(e.target.value)}>
                  <option value="">Toutes les entités</option>
                  {ENTITIES.map(entity => <option key={entity} value={entity}>{entity.replaceAll('_', ' ')}</option>)}
                </select>
              </div>
              <Card className="p-4 mb-5 bg-canvas/40">
                <div className="text-[11px] font-extrabold uppercase tracking-wide text-muted mb-3">Preuves de décision · {decisions.length} ligne{decisions.length > 1 ? 's' : ''}</div>
                <DecisionProof rows={decisions} />
              </Card>
              {decisions.length === 0 ? <Empty text="Aucune décision pour ces filtres" /> : (
                <div className="overflow-x-auto"><table className="w-full">
                  <thead><tr><th className="th">Date</th><th className="th">Entité</th><th className="th">Transition</th><th className="th">Auteur</th><th className="th">Motif</th><th className="th">Empreinte</th></tr></thead>
                  <tbody>
                    {decisions.map(row => (
                      <tr key={row.id} className="hover:bg-canvas/60">
                        <td className="td text-[11px] text-muted whitespace-nowrap">{new Date(row.created_at).toLocaleString('fr-FR')}</td>
                        <td className="td text-[11.5px] font-bold">{row.entity.replaceAll('_', ' ')} #{row.entity_id}</td>
                        <td className="td text-[11px]"><span className="badge-muted !text-[10px]">{row.from_state || '—'} → {row.to_state}</span></td>
                        <td className="td text-[11.5px]">{row.actor_name || 'Utilisateur'}{row.actor_role ? <div className="text-[10.5px] text-muted">{row.actor_role}</div> : null}</td>
                        <td className="td text-[11px] text-muted max-w-xs">{row.reason || '—'}</td>
                        <td className="td text-[10px] text-muted font-mono max-w-[140px] truncate" title={row.document_hash || ''}>{row.document_hash ? row.document_hash.slice(0, 12) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </>
          )}

          {tab === 'references' && (
            <div className="space-y-5">
              <Card>
                <CardHead title="Magasins" subtitle="Projets verrouillés en lecture seule · réouverture tracée" right={<LockKeyhole size={16} className="text-muted" />} />
                <div className="px-5 pb-5 overflow-x-auto"><table className="w-full">
                  <thead><tr><th className="th">Magasin</th><th className="th">Code / Ville</th><th className="th">Année</th><th className="th">Date initiale</th><th className="th">Date révisée</th><th className="th">État</th><th className="th">Accès</th><th className="th">Action</th></tr></thead>
                  <tbody>
                    {references.stores.map(s => (
                      <tr key={s.id} className="hover:bg-canvas/60">
                        <td className="td font-bold text-[12px]">{s.name}</td>
                        <td className="td text-[11px] text-muted">{s.code || '—'} · {s.city || '—'}</td>
                        <td className="td text-[11.5px]">{s.project_year || '—'}</td>
                        <td className="td text-[11px] text-muted">{dateFR(s.initial_open_date)}</td>
                        <td className="td text-[11px] text-muted">{dateFR(s.revised_open_date)}</td>
                        <td className="td text-[11px]">{String(s.project_state || '').replaceAll('_', ' ')}</td>
                        <td className="td"><span className={s.locked_read_only ? 'badge-bad !text-[10px]' : 'badge-ok !text-[10px]'}>{s.locked_read_only ? 'Verrouillé' : 'Ouvert'}</span>{s.reopen_reason && <div className="text-[10px] text-muted mt-1">{s.reopen_reason}</div>}</td>
                        <td className="td">{s.locked_read_only && isDirector ? <button className="btn-ghost !py-1 !px-2 !text-[11px]" onClick={() => setReopenTarget(s)}><Unlock size={13} /> Réouvrir</button> : <span className="text-muted text-[11px]">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </Card>

              <div className="grid lg:grid-cols-2 gap-5">
                <Card>
                  <CardHead title="Utilisateurs" subtitle={`${references.users.length} comptes`} right={<Users size={16} className="text-muted" />} />
                  <div className="px-5 pb-5 max-h-80 overflow-auto"><table className="w-full">
                    <thead><tr><th className="th">Nom</th><th className="th">E-mail</th><th className="th">Rôle</th><th className="th">Statut</th></tr></thead>
                    <tbody>{references.users.map(u => <tr key={u.id} className="hover:bg-canvas/60"><td className="td text-[12px] font-bold">{u.name}</td><td className="td text-[11px] text-muted">{u.email}</td><td className="td text-[11px]">{u.role}</td><td className="td"><span className={u.active ? 'badge-ok !text-[10px]' : 'badge-muted !text-[10px]'}>{u.active ? 'Actif' : 'Inactif'}</span></td></tr>)}</tbody>
                  </table></div>
                </Card>
                <Card>
                  <CardHead title="Zones / chantiers" subtitle={`${references.lots.length} zones libres`} right={<Database size={16} className="text-muted" />} />
                  <div className="px-5 pb-5 max-h-80 overflow-auto"><table className="w-full">
                    <thead><tr><th className="th">Zone</th><th className="th">Magasin</th><th className="th">Responsable</th><th className="th">Budget</th></tr></thead>
                    <tbody>{references.lots.map(l => <tr key={l.id} className="hover:bg-canvas/60"><td className="td text-[12px] font-bold">{l.name}</td><td className="td text-[11px]">{l.store_name}</td><td className="td text-[11px]">{l.owner_role || '—'}</td><td className="td text-[11px]">{money(l.budget)}</td></tr>)}</tbody>
                  </table></div>
                </Card>
                <Card>
                  <CardHead title="Fournisseurs" subtitle={`${references.suppliers.length} entreprises`} right={<Database size={16} className="text-muted" />} />
                  <div className="px-5 pb-5 max-h-80 overflow-auto"><table className="w-full">
                    <thead><tr><th className="th">Nom</th><th className="th">ICE / RC</th><th className="th">Spécialités</th><th className="th">Note</th></tr></thead>
                    <tbody>{references.suppliers.map(s => <tr key={s.id} className="hover:bg-canvas/60"><td className="td text-[12px] font-bold">{s.name}</td><td className="td text-[11px] text-muted">{s.ice || '—'} / {s.rc || '—'}</td><td className="td text-[11px] text-muted">{s.specialties || '—'}</td><td className="td text-[11px]">{s.rating ?? '—'}</td></tr>)}</tbody>
                  </table></div>
                </Card>
                <Card>
                  <CardHead title="Marques" subtitle={`${references.brands.length} marques`} right={<Database size={16} className="text-muted" />} />
                  <div className="px-5 pb-5 flex flex-wrap gap-2">{references.brands.map(b => <span key={b.id} className="badge-muted !text-[11px]">{b.name}{b.code ? ` · ${b.code}` : ''}</span>)}</div>
                </Card>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Modal open={assignmentOpen} onClose={() => setAssignmentOpen(false)} title="Affecter un utilisateur" wide>
        <form onSubmit={createAssignment} className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Utilisateur"><select className="input" value={assignForm.user_id} onChange={e => setAssignForm(f => ({ ...f, user_id: e.target.value }))} required><option value="">Choisir…</option>{references.users.map(u => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}</select></Field>
            <Field label="Magasin"><select className="input" value={assignForm.store_id} onChange={e => setAssignForm(f => ({ ...f, store_id: e.target.value }))} required><option value="">Choisir…</option>{references.stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Zone / chantier (libre)"><input className="input" value={assignForm.lot_label} onChange={e => setAssignForm(f => ({ ...f, lot_label: e.target.value }))} placeholder="Ex. Vitrine, étage 1…" /></Field>
            <Field label="Rôle d’affectation"><select className="input" value={assignForm.role} onChange={e => setAssignForm(f => ({ ...f, role: e.target.value }))}><option value="">Rôle initial de l’utilisateur</option>{['IT', 'MG', 'RMG', 'CDG', 'CG', 'DD', 'DG'].map(r => <option key={r} value={r}>{r}</option>)}
</select></Field>
          </div>
          <Field label="Statut"><select className="input" value={assignForm.active} onChange={e => setAssignForm(f => ({ ...f, active: e.target.value }))}><option value="true">Active</option><option value="false">Inactive</option></select></Field>
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={() => setAssignmentOpen(false)}>Annuler</button><button className="btn-primary">Enregistrer l’affectation</button></div>
        </form>
      </Modal>

      <DecisionModal open={!!reopenTarget} onClose={() => setReopenTarget(null)} title={`réouverture — ${reopenTarget?.name || ''}`} busy={busy} onConfirm={reopen} />
    </>
  );
}
