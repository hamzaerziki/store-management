import { useEffect, useState } from 'react';
import { useDataRefresh } from '../hooks/useDataRefresh';
import { Send, Check, X, Clock, FileUp, Trash2, Pencil, Eye, Users, Filter } from 'lucide-react';
import api, { getToken } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, CardHead, PageHeader, Modal, Field, ErrorBox, DecisionModal, Tabs, DecisionProof, ConfirmDialog, ExecutionStatusSelect, STATUS_LABELS_FR, money, dateFR } from '../components/ui';
import { DemandDetailsModal } from '../components/DemandDetails';

const LABELS = {
  draft: 'Brouillon', pending_cdg: 'Soumis', pending_dd: 'Attente DD',
  pending_dg: 'Attente DG', approved: 'Approuvée', rejected: 'Rejetée',
};
const STAGES = ['pending_cdg', 'pending_dd', 'pending_dg', 'approved'];
const waitingLabel = row => row.status === 'pending_cdg' ? 'Soumis (attente CDG)' : (row.next_validator_role ? `En attente ${row.next_validator_role}` : 'En attente');
const API_ORIGIN = (import.meta.env.VITE_API_URL || 'http://localhost:4000/api').replace(/\/api$/, '');

export default function Demands() {
  const { can, user } = useAuth();
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ counts: {}, total: 0 });
  const [stores, setStores] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('all');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [form, setForm] = useState({ store_id: '', title: '', description: '', kind: 'article', category_id: '', deadline: '', supplier_id: '', amount_ht: '', vat_mode: '20', vat_rate: '20', amount_tva: '', amount_ttc: '', notes: '' });
  const [rejectTarget, setRejectTarget] = useState(null);
  const [detailsTarget, setDetailsTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [actionTarget, setActionTarget] = useState(null);
  const [actionForm, setActionForm] = useState({ action: '', action_note: '' });
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', description: '', amount_ht: '', vat_rate: '20', deadline: '', store_id: '', lot_label: '', kind: 'article', owner_role: '' });
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftForm, setDraftForm] = useState({ title: '', description: '', amount_ht: '', vat_rate: '20', deadline: '', store_id: '', lot_label: '', kind: 'article', owner_role: '' });
  const [busy, setBusy] = useState(false);

  const quoteFileUrl = quote => `${API_ORIGIN}/api/quotes/${quote.id}/file?token=${encodeURIComponent(getToken() || '')}`;

  const allowedCategory = c => {
    const role = user?.role;
    if (['admin', 'DD', 'DG', 'CDG', 'CG'].includes(role)) return true;
    if (role === 'IT') return ['IT', 'BOTH'].includes(c.owner_role);
    if (['MG', 'RMG'].includes(role)) return ['MG', 'BOTH'].includes(c.owner_role);
    return true;
  };
  const visibleCategories = categories.filter(c => /^\d{2} — /.test(c.name) && allowedCategory(c));
  const categoryGroups = [
    { label: 'IT', rows: visibleCategories.filter(c => c.owner_role === 'IT' || c.owner_role === 'BOTH') },
    { label: 'MG', rows: visibleCategories.filter(c => c.owner_role === 'MG' || c.owner_role === 'BOTH') },
  ].filter(group => group.rows.length);

  const load = () => {
    setError('');
    api.get('/demands', { params: supplierFilter ? { supplier_id: supplierFilter } : {} }).then(r => setRows(r.data)).catch(setError);
    api.get('/demands/summary').then(r => setSummary(r.data)).catch(() => {});
  };
  useEffect(() => {
    load();
    api.get('/stores').then(r => setStores(r.data)).catch(() => {});
    api.get('/suppliers').then(r => setSuppliers(r.data)).catch(() => {});
    api.get('/categories').then(r => setCategories(r.data)).catch(() => {});
  }, [supplierFilter]);
  useDataRefresh(load, []);

  async function validate(id, decision, comment = '') {
    setError(''); setNotice(''); setBusy(true);
    try {
      const r = await api.post(`/demands/${id}/validate`, { decision, comment });
      setNotice(`Demande ${LABELS[r.data.status] || r.data.status}`);
      setRejectTarget(null);
      load();
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }

  async function submit(id) {
    setError(''); setNotice(''); setBusy(true);
    try {
      await api.post(`/demands/${id}/submit`, {});
      setNotice('Demande envoyée à CDG');
      load();
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }

  function openEdit(demand) {
    setError('');
    setEditTarget(demand);
    setEditForm({
      title: demand.title || '',
      description: demand.description || '',
      amount_ht: String(demand.amount ?? ''),
      vat_rate: '20',
      deadline: demand.deadline ? String(demand.deadline).slice(0, 10) : '',
      store_id: String(demand.store_id || ''),
      lot_label: demand.lot_name || '',
      kind: demand.kind || 'article',
      owner_role: demand.owner_role || '',
    });
  }

  async function saveDraft(e) {
    e.preventDefault(); setError(''); setNotice(''); setBusy(true);
    try {
      await api.post('/demands', { ...draftForm, amount: draftForm.amount_ht });
      setNotice('Brouillon créé'); setDraftOpen(false);
      setDraftForm({ title: '', description: '', amount_ht: '', vat_rate: '20', deadline: '', store_id: '', lot_label: '', kind: 'article', owner_role: '' });
      load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  async function saveEdit(e) {
    e.preventDefault(); setError(''); setNotice(''); setBusy(true);
    try {
      await api.put(`/demands/${editTarget.id}`, editForm);
      setNotice('Demande modifiée'); setEditTarget(null); load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  async function deleteDemand(demand) {
    setError(''); setNotice(''); setBusy(true);
    try {
      const r = await api.delete(`/demands/${demand.id}`);
      const released = Number(r.data.amount_released || 0);
      setNotice(r.data.budget_released && released > 0
        ? `Demande supprimée — ${money(released)} restitués au budget DG`
        : 'Demande supprimée');
      setDeleteTarget(null);
      load();
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }

  async function saveAction(e) {
    e.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      await api.patch(`/demands/${actionTarget.id}/action`, actionForm);
      setNotice('Action mise à jour'); setActionTarget(null); setActionForm({ action: '', action_note: '' });
      load();
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }

  function recalcTtc(updates) {
    setForm(current => {
      const next = { ...current, ...updates };
      const ht = Number(next.amount_ht || 0);
      const rate = Number(next.vat_rate || 0);
      if (next.amount_ht !== '' && ht > 0) {
        next.amount_tva = String(Math.round(ht * rate) / 100);
        next.amount_ttc = String(Math.round(ht * (100 + rate)) / 100);
      }
      return next;
    });
  }

  async function create(e) {
    e.preventDefault(); setError(''); setNotice('');
    const fd = new FormData();
    Object.entries(form).forEach(([key, value]) => fd.append(key, value));
    if (file) fd.append('file', file);
    try {
      await api.post('/quotes/with-demand', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setOpen(false); setFile(null);
      setForm({ store_id: '', title: '', description: '', kind: 'article', category_id: '', deadline: '', supplier_id: '', amount_ht: '', vat_mode: '20', vat_rate: '20', amount_tva: '', amount_ttc: '', notes: '' });
      setNotice('Brouillon créé — soumettez la demande quand elle est prête');
      load();
    } catch (e) { setError(e); }
  }

  const canTrackExecution = ['admin', 'IT', 'MG', 'CG', 'CDG', 'DD', 'DG'].includes(user?.role);
  const canEditExecutionFor = row => Number(row?.created_by) === Number(user?.id);
  const showDept = ['admin','CDG','CG','DD','DG'].includes(user?.role);

  function updateDemandExecution(updated) {
    setRows(current => current.map(row => row.id === updated.id ? { ...row, ...updated } : row));
    setDetailsTarget(current => current?.id === updated.id ? { ...current, ...updated } : current);
    setNotice(`Suivi d’exécution mis à jour — ${STATUS_LABELS_FR[updated.status] || updated.status}`);
  }

  const filteredRows = rows.filter(row => view === 'all' ? true
    : view === 'active' ? ['pending_cdg', 'pending_dd', 'pending_dg'].includes(row.status)
      : ['approved', 'rejected'].includes(row.status));

  return (
    <>
      <PageHeader title="Demandes" subtitle="IT / MG créent · CDG → DD → DG valident · chaque étape apparaît au bon validateur" actions={
        <>
          {can('manage_demands') && can('upload_quotes') && <button className="btn-primary" title="Créer en une seule fois l’article ou la mission et le devis joint" onClick={() => setOpen(true)}><FileUp size={16} /> Nouvelle demande + devis</button>}
        </>
      } />
      <ErrorBox error={error} />
      {notice && <div className="mb-4 rounded-lg bg-emerald-50 text-emerald-700 text-[12px] font-semibold px-4 py-3">{notice}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {STAGES.map(stage => (
          <Card key={stage} className="p-4">
            <div className="text-[11px] text-muted font-semibold">{LABELS[stage]}</div>
            <div className="text-2xl font-extrabold mt-1">{summary.counts[stage] || 0}</div>
          </Card>
        ))}
      </div>

      <Card className="mb-5">
        <CardHead title="Chaîne de validation" subtitle="La demande passe à l’étape suivante uniquement après approbation" />
        <div className="px-5 pb-5 flex flex-wrap gap-2">
          {STAGES.map((stage, index) => (
            <span key={stage} className="badge-muted !text-[10px]">{index + 1}. {LABELS[stage]}</span>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <Tabs className="px-4 pt-2 bg-canvas/60" value={view} onChange={setView} tabs={[
          { id: 'active', label: 'À traiter', count: rows.filter(r => ['pending_cdg', 'pending_dd', 'pending_dg'].includes(r.status)).length },
          { id: 'history', label: 'Historique', count: rows.filter(r => ['approved', 'rejected'].includes(r.status)).length },
          { id: 'all', label: 'Toutes', count: rows.length },
        ]} />
        <div className="px-5 pb-3 flex flex-wrap items-center gap-2">
          <Users size={14} className="text-[#0E7A5F]" />
          <select className="bento-select min-w-[230px]" value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)} title="Filtrer par prestataire">
            <option value="">Tous les prestataires</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {supplierFilter && <button className="bento-btn !py-1.5 !px-2.5 !text-[10px]" onClick={() => setSupplierFilter('')}><Filter size={12} /> Effacer</button>}
        </div>
        <div className="px-5 pb-5 overflow-x-auto">
          <div className="pt-5"><CardHead title="Demandes et preuves de décision" subtitle="Brouillon : modifiable · Soumis (envoyé au CDG) : plus aucune modification possible" right={<Send size={16} className="text-emerald-600" />} /></div>
          {filteredRows.length === 0 ? <div className="py-10 text-center text-muted text-[12px]">Aucune demande dans cette vue</div> : (
            <table className="w-full">
              <thead>
                <tr><th className="th">Demande</th><th className="th">Magasin</th><th className="th">Demandeur</th><th className="th">Prix HT</th><th className="th">Statut</th><th className="th">Exécution</th><th className="th">Preuve</th><th className="th">Date</th><th className="th">Action</th></tr>
              </thead>
              <tbody>
                {filteredRows.map(row => (
                  <tr key={row.id} className="hover:bg-canvas/60">
                    <td className="td">
                      <div className="text-[12.5px] font-bold">{row.title}</div>
                      <div className="text-[10.5px] text-muted">{row.category_name ? `${row.category_name} · ` : ''}{row.kind === 'mission' ? 'Mission' : 'Article'} · {row.owner_role}{row.deadline ? ` · échéance ${dateFR(row.deadline)}` : ''}{row.description ? ` · ${row.description}` : ''}</div>
                      {(row.quotes || []).length > 0 && (
                        <div className="mt-2 space-y-1">
                          {row.quotes.map(q => (
                            <div key={q.id} className="text-[10.5px] bg-canvas/70 border border-line rounded-lg px-2 py-1.5 flex flex-wrap items-center gap-2">
                              <FileUp size={12} className="text-emerald-600" />
                              <b>{q.supplier_name || 'Prestataire'}</b>
                              <span className="text-muted">HT {money(q.amount_ht)} {q.currency || 'MAD'} · v{q.version || 1}</span>
                              {q.file_url && <a className="text-emerald-700 font-bold underline" href={quoteFileUrl(q)} target="_blank" rel="noreferrer">Fichier</a>}
                            </div>
                          ))}
                        </div>
                      )}
                      {row.action && <div className="mt-1 text-[10.5px] font-semibold text-gold-700">Action : {row.action}{row.action_note ? ` — ${row.action_note}` : ''}</div>}
                    </td>
                    <td className="td text-[11.5px]">{row.store_name}</td>
                    <td className="td text-[11.5px]"><div>{row.created_by_name || '—'}</div>{showDept && row.created_by_department && <div className="text-[10px] text-muted">{row.created_by_department}</div>}</td>
                    <td className="td text-[12px] font-bold">{money(row.amount)}</td>
                    <td className="td"><span className={row.status === 'approved' ? 'badge-ok !text-[10px]' : row.status === 'rejected' ? 'badge-bad !text-[10px]' : 'badge-warn !text-[10px]'}>{LABELS[row.status] || row.status}</span></td>
                    <td className="td"><ExecutionStatusSelect demand={row} canEdit={canEditExecutionFor(row)} onChange={updateDemandExecution} /></td>
                    <td className="td"><DecisionProof compact rows={row.decisions || []} /></td>
                    <td className="td text-[11px] text-muted">{dateFR(row.submitted_at)}</td>
                    <td className="td">
                      <div className="flex flex-wrap gap-1.5">
                        <button className="btn-ghost !py-1 !px-2 !text-[11px]" onClick={() => setDetailsTarget(row)}><Eye size={13} /> Voir</button>
                        {row.can_submit && <>
                          <button className="btn-ghost !py-1 !px-2 !text-[11px]" onClick={() => openEdit(row)}><Pencil size={13} /> Modifier</button>
                          <button className="btn-ghost !py-1 !px-2 !text-[11px] text-emerald-700" onClick={() => submit(row.id)}><Send size={13} /> Soumettre</button>
                        </>}
                        {!row.can_submit && Number(row.created_by) === Number(user?.id) && (
                          <button className="btn-ghost !py-1 !px-2 !text-[11px]" onClick={() => { setActionTarget(row); setActionForm({ action: row.action || '', action_note: row.action_note || '' }); }}>Mettre à jour l’action</button>
                        )}
                        {row.can_validate && <>
                          <button className="btn-ghost !py-1 !px-2 !text-[11px] text-emerald-700" onClick={() => validate(row.id, 'approved')}><Check size={13} /> Approuver</button>
                          <button className="btn-ghost !py-1 !px-2 !text-[11px] text-red-600" onClick={() => setRejectTarget(row)}><X size={13} /> Rejeter</button>
                        </>}
                        {!row.can_submit && !row.can_validate && ['approved', 'rejected'].includes(row.status) && (
                          <span className={`text-[11px] font-bold ${row.status === 'rejected' ? 'text-red-600' : 'text-emerald-700'}`}>{row.status === 'rejected' ? 'Rejetée — preuve conservée' : 'Approuvée — preuve conservée'}</span>
                        )}
                        {!row.can_submit && !row.can_validate && !['approved', 'rejected'].includes(row.status) && (
                          <span className="text-muted text-[11px]"><Clock size={12} className="inline mr-1" />{waitingLabel(row)}</span>
                        )}
                        {row.can_delete && (
                          <button className="btn-ghost !py-1 !px-2 !text-[11px] text-red-600" onClick={() => setDeleteTarget(row)}><Trash2 size={13} /> Supprimer</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={`Article / mission + devis — ${stores.find(s => String(s.id) === String(form.store_id))?.name || 'magasin à choisir'}`} wide>
        <form onSubmit={create} className="space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-[11.5px] text-emerald-900">L’article ou la mission est créé en brouillon avec le devis joint ; la soumission se fait manuellement ensuite.</div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-4">
              <Field label="Magasin">
                <select className="input" value={form.store_id} onChange={e => setForm(f => ({ ...f, store_id: e.target.value }))} required>
                  <option value="">Choisir…</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Type">
                <select className="input" value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}>
                  <option value="article">Article</option><option value="mission">Mission</option>
                </select>
              </Field>
              <Field label="Catégorie">
                <select className="input" value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))} required>
                  <option value="">Choisir une catégorie…</option>
                  {categoryGroups.map(group => (
                    <optgroup key={group.label} label={group.label}>
                      {group.rows.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </Field>
              <Field label="Intitulé"><input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required placeholder="Ex. Mobilier accueil" /></Field>
              <Field label="Description"><textarea className="input min-h-[75px]" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Précisions, quantités, références…" /></Field>
              <Field label="Date limite"><input type="date" className="input" value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} /></Field>
            </div>
            <div className="space-y-4">
              <input type="file" accept="application/pdf,.pdf" className="input !py-2 !text-[12px] w-full" onChange={e => setFile(e.target.files?.[0] || null)} required />
              <Field label="Entreprise">
                <select className="input" value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))} required>
                  <option value="">Choisir…</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Montant HT (MAD)"><input type="number" step="0.01" className="input" value={form.amount_ht} onChange={e => recalcTtc({ amount_ht: e.target.value })} required /></Field>
                <Field label="TVA">
                  <select className="input" value={form.vat_mode} onChange={e => recalcTtc({ vat_mode: e.target.value, vat_rate: e.target.value === 'personalise' ? form.vat_rate : e.target.value })}>
                    <option value="20">20 %</option><option value="10">10 %</option><option value="personalise">Personnalise</option>
                  </select>
                </Field>
              </div>
              {form.vat_mode === 'personalise' && (
                <Field label="TVA personnalisée (%)"><input type="number" step="0.01" min="0" max="100" className="input" value={form.vat_rate} onChange={e => recalcTtc({ vat_rate: e.target.value })} required /></Field>
              )}
              <div className="rounded-lg border border-line bg-canvas/60 px-3 py-2 text-[11.5px] text-muted">
                TVA calculée : <b className="text-ink">{money(form.amount_tva)}</b> · TTC calculé : <b className="text-ink">{money(form.amount_ttc)}</b>
              </div>
              <Field label="Notes"><textarea className="input min-h-[75px]" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Conditions, garantie, remarques…" /></Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Annuler</button><button className="btn-primary"><FileUp size={15} /> Créer l’ensemble</button></div>
        </form>
      </Modal>

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={`Modifier - ${editTarget?.title || ''}`}>
        <form onSubmit={saveEdit} className="space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-[11.5px] text-emerald-900">Modification possible uniquement en brouillon, par le cr?ateur ou l?administrateur. Apr?s soumission, la demande devient non modifiable et non supprimable.</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Magasin"><select className="input" value={editForm.store_id} onChange={e => setEditForm(f => ({ ...f, store_id: e.target.value }))} required><option value="">S?lectionner</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Type"><select className="input" value={editForm.kind} onChange={e => setEditForm(f => ({ ...f, kind: e.target.value }))}><option value="article">Article</option><option value="mission">Mission</option></select></Field>
          </div>
          <Field label="Intitul?"><input className="input" value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} required /></Field>
          <Field label="Description"><textarea className="input min-h-[75px]" value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Montant HT (MAD)"><input type="number" step="0.01" className="input" value={editForm.amount_ht} onChange={e => setEditForm(f => ({ ...f, amount_ht: e.target.value }))} required /></Field>
            <Field label="TVA"><select className="input" value={editForm.vat_rate} onChange={e => setEditForm(f => ({ ...f, vat_rate: e.target.value }))}><option value="20">20 %</option><option value="10">10 %</option><option value="0">0 %</option></select></Field>
            <Field label="Date limite"><input type="date" className="input" value={editForm.deadline} onChange={e => setEditForm(f => ({ ...f, deadline: e.target.value }))} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lot / zone"><input className="input" value={editForm.lot_label} onChange={e => setEditForm(f => ({ ...f, lot_label: e.target.value }))} /></Field>
            <Field label="D?partement"><select className="input" value={editForm.owner_role} onChange={e => setEditForm(f => ({ ...f, owner_role: e.target.value }))}><option value="">Automatique</option><option value="IT">IT</option><option value="MG">MG</option></select></Field>
          </div>
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={() => setEditTarget(null)}>Annuler</button><button className="btn-primary" disabled={busy}>Enregistrer</button></div>
        </form>
      </Modal>

      <Modal open={draftOpen} onClose={() => setDraftOpen(false)} title="Nouvelle demande (brouillon)">
        <form onSubmit={saveDraft} className="space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-[11.5px] text-emerald-900">Brouillon sans devis. Vous pourrez ajouter un devis ensuite ou soumettre sans devis.</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Magasin"><select className="input" value={draftForm.store_id} onChange={e => setDraftForm(f => ({ ...f, store_id: e.target.value }))} required><option value="">S?lectionner</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Type"><select className="input" value={draftForm.kind} onChange={e => setDraftForm(f => ({ ...f, kind: e.target.value }))}><option value="article">Article</option><option value="mission">Mission</option></select></Field>
          </div>
          <Field label="Intitul?"><input className="input" value={draftForm.title} onChange={e => setDraftForm(f => ({ ...f, title: e.target.value }))} required /></Field>
          <Field label="Description"><textarea className="input min-h-[75px]" value={draftForm.description} onChange={e => setDraftForm(f => ({ ...f, description: e.target.value }))} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Montant HT (MAD)"><input type="number" step="0.01" className="input" value={draftForm.amount_ht} onChange={e => setDraftForm(f => ({ ...f, amount_ht: e.target.value }))} /></Field>
            <Field label="TVA"><select className="input" value={draftForm.vat_rate} onChange={e => setDraftForm(f => ({ ...f, vat_rate: e.target.value }))}><option value="20">20 %</option><option value="10">10 %</option><option value="0">0 %</option></select></Field>
            <Field label="Date limite"><input type="date" className="input" value={draftForm.deadline} onChange={e => setDraftForm(f => ({ ...f, deadline: e.target.value }))} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lot / zone"><input className="input" value={draftForm.lot_label} onChange={e => setDraftForm(f => ({ ...f, lot_label: e.target.value }))} /></Field>
            <Field label="D?partement"><select className="input" value={draftForm.owner_role} onChange={e => setDraftForm(f => ({ ...f, owner_role: e.target.value }))}><option value="">Automatique</option><option value="IT">IT</option><option value="MG">MG</option></select></Field>
          </div>
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={() => setDraftOpen(false)}>Annuler</button><button className="btn-primary" disabled={busy}>Cr?er brouillon</button></div>
        </form>
      </Modal>

<DemandDetailsModal
        open={!!detailsTarget}
        onClose={() => setDetailsTarget(null)}
        demand={detailsTarget}
        busy={busy}
        canTrackExecution={canTrackExecution}
        canEditExecution={detailsTarget ? canEditExecutionFor(detailsTarget) : false}
        currentUserId={user?.id}
        onExecutionChange={updateDemandExecution}
        onApprove={() => { const target = detailsTarget; setDetailsTarget(null); if (target) validate(target.id, 'approved'); }}
        onReject={() => { const target = detailsTarget; setDetailsTarget(null); if (target) setRejectTarget(target); }}
      />

      <DecisionModal open={!!rejectTarget} onClose={() => setRejectTarget(null)} title={rejectTarget?.title} busy={busy} onConfirm={reason => validate(rejectTarget.id, 'rejected', reason)} />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { const demand = deleteTarget; if (demand) deleteDemand(demand); }}
        title="Supprimer cette demande ?"
        message={deleteTarget?.status === 'approved'
          ? `La demande « ${deleteTarget?.title || ''} » a été approuvée par DG. Sa suppression la retirera comme si elle n'avait jamais existé et restituera ${money(deleteTarget?.amount || 0)} HT au budget.`
          : `La demande « ${deleteTarget?.title || ''} » sera supprimée.`}
        confirmLabel={deleteTarget?.status === 'approved' ? 'Supprimer et restituer le budget' : 'Supprimer'}
        busy={busy}
      />
    </>
  );
}
