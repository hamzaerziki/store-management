import { useEffect, useState } from 'react';
import { useDataRefresh } from '../hooks/useDataRefresh';
import { Plus, Search, FileText, Trash2, Eye, ExternalLink } from 'lucide-react';
import api, { getToken } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, PageHeader, Modal, Field, ErrorBox, Tabs, money, Empty, ConfirmDialog } from '../components/ui';
import useSessionState from '../hooks/useSessionState';

const API_ORIGIN = (import.meta.env.VITE_API_URL || 'http://localhost:4000/api').replace(/\/api$/, '');

const isPdf = file => !!file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''));
const isPdfUrl = url => /\.pdf$/i.test(String(url || '').split('?')[0]);

export default function Quotes({ embedded = false, fixedStoreId = null }) {
  const { can } = useAuth();
  const [quotes, setQuotes] = useState([]);
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [stores, setStores] = useState([]);
  const [search, setSearch] = useSessionState('safari_quotes_search', '');
  const [enterpriseFilter, setEnterpriseFilter] = useSessionState('safari_quotes_enterprise', '');
  const [view, setView] = useSessionState('safari_quotes_view', 'all');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [viewer, setViewer] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [form, setForm] = useState({ store_id: fixedStoreId ? String(fixedStoreId) : '', item_id: '', supplier_id: '', amount_ht: '', vat_mode: '20', vat_rate: '20', amount_tva: '', amount_ttc: '', payment_terms: '30 jours', warranty_months: 12, reliability_score: 3, notes: '' });
  const [file, setFile] = useState(null);
  const scopeStoreId = fixedStoreId ? String(fixedStoreId) : '';
  const withStore = path => scopeStoreId ? `${path}${path.includes('?') ? '&' : '?'}store_id=${scopeStoreId}` : path;

  const load = () => api.get(withStore('/quotes')).then(r => setQuotes(r.data)).catch(setError);
  useEffect(() => {
    load();
    api.get(withStore('/items')).then(r => setItems(r.data)).catch(() => {});
    api.get('/suppliers').then(r => setSuppliers(r.data)).catch(() => {});
    api.get('/stores').then(r => setStores(r.data)).catch(() => {});
  }, [scopeStoreId]);
  useDataRefresh(load, []);

  const fileUrl = async quote => { const r = await api(`/quotes/${quote.id}/file-token`); return `${API_ORIGIN}/api/quotes/${quote.id}/file?ft=${encodeURIComponent(r.token)}`; };

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
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));
    if (file) fd.append('file', file);
    try {
      const { data } = await api.post('/quotes', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const extracted = data.extraction || {};
      const classification = data.classification || {};
      const found = Object.values(extracted).some(value => value !== null && value !== undefined && value !== '');
      setNotice(found
        ? `Devis enregistré · ${classification.is_service ? 'prestation' : 'article'} ${classification.category_name || 'Catégorie non détectée'} (${Math.round((classification.confidence || 0) * 100)}%)${data.auto_created_item ? ' · ligne créée automatiquement' : ''} · TTC ${money(extracted.amount_ttc)}, garantie ${extracted.warranty_months || 0} mois.`
        : 'Devis enregistré.');
      setOpen(false); setFile(null); load();
    } catch (e) { setError(e); }
  }

  async function remove(id) {
    try { await api.delete(`/quotes/${id}`); load(); } catch (e) { setError(e); }
  }

  const shown = quotes.filter(q =>
    (!scopeStoreId || String(q.store_id) === scopeStoreId)
    && (view === 'all' || (view === 'demands' ? !!q.demand_id : !q.demand_id))
    && (!search || `${q.supplier_name} ${q.item_name} ${q.store_name} ${q.demand_title || ''}`.toLowerCase().includes(search.toLowerCase()))
    && (!enterpriseFilter || q.supplier_name === enterpriseFilter)
  );

  return (
    <>
      {!embedded && <PageHeader title="Devis" subtitle="Tous les devis téléversés par les équipes IT et MG" actions={
        can('upload_quotes') && <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Téléverser un devis</button>
      } />}
      {embedded && can('upload_quotes') && <div className="mb-4 flex justify-end"><button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Téléverser un devis</button></div>}
      <ErrorBox error={error} />
      {notice && <Card className="p-3 mb-4 text-[12px] font-semibold text-emerald-700 bg-emerald-50/70">{notice}</Card>}
      <Card className="mb-5 overflow-hidden">
        <Tabs className="px-4 pt-2 bg-canvas/60" value={view} onChange={setView} tabs={[
          { id: 'all', label: 'Tous les devis', count: quotes.length },
          { id: 'demands', label: 'Demandes', count: quotes.filter(q => q.demand_id).length },
          { id: 'direct', label: 'Dépôts directs', count: quotes.filter(q => !q.demand_id).length },
        ]} />
      </Card>
      <Card className="p-4 mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 border border-line rounded-lg px-3 py-2 max-w-md flex-1 min-w-[220px]"><Search size={15} className="text-muted" /><input className="outline-none text-[12.5px] w-full" placeholder="Rechercher une entreprise, un article…" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <select className="input !py-2 !text-[12px] w-56" value={enterpriseFilter} onChange={e => setEnterpriseFilter(e.target.value)}>
            <option value="">Toutes les entreprises</option>
            {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {shown.length === 0 ? <Empty text="Aucun devis disponible" /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">Entreprise</th><th className="th">Article / Magasin</th><th className="th">Catégorie IA</th><th className="th">Montant TTC</th><th className="th">Fichier</th><th className="th"></th></tr></thead>
              <tbody>
                {shown.map(q => (
                  <tr key={q.id} className="hover:bg-canvas/60">
                    <td className="td font-bold">
                      {q.supplier_name}
                      {q.extracted_data?.amount_ttc && <span className="badge-ok ml-1 !text-[9px]">Extrait</span>}
                    </td>
                    <td className="td"><div className="text-[12px] font-semibold">{q.item_name}{q.classification?.is_service && <span className="badge-ok ml-1 !text-[9px]">Prestation</span>}</div><div className="text-[10.5px] text-muted">{q.store_name}{q.uploaded_by_name ? ` · Déposé par ${q.uploaded_by_name}` : ''}</div>
                      {q.demand_id && <div className="mt-1 rounded-lg border border-emerald-200 bg-emerald-50/60 px-2 py-1 text-[10.5px]">
                        <b>Demande #{q.demand_id}</b> · {q.demand_title}
                        <span className="badge-warn ml-1 !text-[9px]">{q.demand_status}</span>
                        {q.demand_action && <div className="text-emerald-700 font-semibold">Action : {q.demand_action}</div>}
                      </div>}
                    </td>
                    <td className="td text-muted text-[11px]" title={q.classification ? `Confiance ${Math.round(q.classification.confidence * 100)}% · ${(q.classification.keywords || []).join(', ')}` : ''}>{q.classification?.category_name || '—'}</td>
                    <td className="td font-extrabold text-emerald-600">{money(q.amount_ttc)}</td>
                    <td className="td">
                      {q.file_url
                        ? <button onClick={() => setViewer(q)} className="inline-flex items-center gap-1 text-[11.5px] font-bold text-emerald-600 hover:underline"><Eye size={13} /> Voir</button>
                        : <span className="text-[11px] text-muted">—</span>}
                    </td>
                      <td className="td">{can('upload_quotes') && <button onClick={() => setConfirmDelete(q)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500" aria-label="Supprimer ce devis"><Trash2 size={15} /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={!!viewer} onClose={() => setViewer(null)} title={`Devis — ${viewer?.supplier_name || ''}`} wide>
        {viewer && (
          <>
            {isPdfUrl(viewer.file_url) ? (
              <div className="h-[65vh] rounded-xl overflow-hidden border border-line bg-canvas">
                <iframe title="Aperçu du devis" src={viewerUrl} className="w-full h-full border-0" />
              </div>
            ) : (
              <div className="p-8 text-center text-[12.5px] text-muted">Ce fichier n’est pas un PDF. Ouvrez-le dans un nouvel onglet pour le consulter.</div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
              <a href={viewerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-bold text-emerald-600"><ExternalLink size={14} /> Ouvrir dans un nouvel onglet</a>
              <span className="text-[11px] text-muted">Catégorie IA : {viewer.classification?.is_service ? 'Prestation · ' : ''}{viewer.classification?.category_name || '—'} · confiance {Math.round((viewer.classification?.confidence || 0) * 100)}%</span>
              {viewer.extracted_data?.amount_ttc && <span className="text-[11px] text-muted">Extrait : TTC {money(viewer.extracted_data.amount_ttc)} · Garantie {viewer.extracted_data.warranty_months || 0} mois</span>}
            </div>
          </>
        )}
      </Modal>

      <Modal open={open} onClose={() => setOpen(false)} title="Téléverser un devis" wide>
        <form onSubmit={create} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {!fixedStoreId && <Field label="Magasin (classification auto)"><select className="input" value={form.store_id} onChange={e => setForm({ ...form, store_id: e.target.value })} required={isPdf(file) && !form.item_id}><option value="">Choisir…</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name} — {s.city}</option>)}</select></Field>}
            <Field label="Article"><select className="input" value={form.item_id} onChange={e => setForm({ ...form, item_id: e.target.value, store_id: scopeStoreId || String(items.find(i => Number(i.id) === Number(e.target.value))?.store_id || form.store_id) })} required={!isPdf(file)}><option value="">Classification automatique</option>{items.filter(i => !scopeStoreId || String(i.store_id) === scopeStoreId).map(i => <option key={i.id} value={i.id}>{i.name} — {i.store_name}</option>)}</select></Field>
            <Field label="Entreprise"><select className="input" value={form.supplier_id} onChange={e => setForm({ ...form, supplier_id: e.target.value })} required={!isPdf(file)}><option value="">Choisir…</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Montant HT (MAD)"><input type="number" step="0.01" className="input" value={form.amount_ht} onChange={e => recalcTtc({ amount_ht: e.target.value })} required={!isPdf(file)} /></Field>
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
          <div className="grid grid-cols-1 gap-4">
            <Field label="Garantie (mois)"><input type="number" className="input" value={form.warranty_months} onChange={e => setForm({ ...form, warranty_months: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Conditions de paiement"><input className="input" value={form.payment_terms} onChange={e => setForm({ ...form, payment_terms: e.target.value })} /></Field>
            <Field label="Fiabilité (1-5)"><input type="number" min="1" max="5" className="input" value={form.reliability_score} onChange={e => setForm({ ...form, reliability_score: e.target.value })} /></Field>
          </div>
          <Field label="Notes"><textarea rows="2" className="input" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
          <div className="rounded-xl border border-line bg-canvas p-3">
            <Field label="Fichier du devis (PDF conseillé)">
              <input type="file" className="input w-full" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls" onChange={e => setFile(e.target.files?.[0] || null)} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Annuler</button><button className="btn-primary"><FileText size={15} /> Enregistrer le devis</button></div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => { const id = confirmDelete?.id; setConfirmDelete(null); if (id !== undefined) remove(id); }}
        title="Supprimer ce devis ?"
        message={`Le devis « ${confirmDelete?.supplier_name || ''} » sera supprimé. Cette action est irréversible et ne doit pas concerner un devis déjà validé ou approuvé.`}
        confirmLabel="Supprimer définitivement"
      />
    </>
  );
}
