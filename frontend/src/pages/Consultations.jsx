import { useEffect, useMemo, useState } from 'react';
import { Plus, ClipboardList, Link2, CalendarClock } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PageHeader, Card, CardHead, Modal, Field, ErrorBox, Empty } from '../components/ui';

const BASES = ['/v1/consultations', '/consultations', '/operations/consultations'];
const STATUSES = ['draft', 'open', 'closed', 'awarded', 'cancelled'];
const STATUS_LABELS = { draft: 'Brouillon', open: 'Ouverte', closed: 'Clôturée', awarded: 'Attribution', cancelled: 'Annulée' };
const EMPTY = { title: '', store_id: '', lot_label: '', deadline: '', status: 'open' };

async function listFrom(paths) {
  let lastError;
  for (const base of paths) {
    try {
      const r = await api.get(base);
      return Array.isArray(r.data) ? r.data : (r.data?.items || r.data?.data || []);
    } catch (error) { lastError = error; }
  }
  throw lastError;
}

async function createWith(paths, payload) {
  let lastError;
  for (const base of paths) {
    try { return await api.post(base, payload); }
    catch (error) { lastError = error; }
  }
  throw lastError;
}

const dateFR = value => value ? new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function Consultations({ embedded = false, fixedStoreId = null }) {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [stores, setStores] = useState([]);
  const [lots, setLots] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY, store_id: fixedStoreId ? String(fixedStoreId) : '' });
  const [busy, setBusy] = useState(false);
  const scopeStoreId = fixedStoreId ? String(fixedStoreId) : '';

  const load = () => {
    setError('');
    listFrom(BASES).then(setRows).catch(() => setRows([]));
    api.get('/stores').then(r => setStores(r.data || [])).catch(() => {});
    api.get('/operations/lots').then(r => setLots(r.data || [])).catch(() => {});
    api.get('/quotes').then(r => setQuotes(r.data || [])).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const quotesByConsultation = useMemo(() => quotes.reduce((acc, quote) => {
    const key = String(quote.consultation_id ?? '');
    if (key && key !== 'undefined') acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {}), [quotes]);
  const shownRows = rows.filter(row => !scopeStoreId || String(row.store_id || row.project_id) === scopeStoreId);

  const storeName = id => stores.find(s => String(s.id) === String(id))?.name || `Projet #${id || '—'}`;
  const lotName = id => lots.find(l => String(l.id) === String(id))?.name || '';

  async function create(e) {
    e.preventDefault(); setError(''); setNotice(''); setBusy(true);
    try {
      await createWith(BASES, { ...form, store_id: scopeStoreId || form.store_id || null, lot_label: form.lot_label || null, deadline: form.deadline || null });
      setNotice('Consultation créée.'); setOpen(false); setForm({ ...EMPTY, store_id: scopeStoreId || '' }); load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  return (
    <>
      {!embedded && <PageHeader title="Consultations" subtitle="Appels d’offres liés à un projet / lot et aux devis reçus" actions={
        can('manage_demands') && <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Nouvelle consultation</button>
      } />}
      {embedded && can('manage_demands') && <div className="mb-4 flex justify-end"><button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Nouvelle consultation</button></div>}
      <ErrorBox error={error} />
      {notice && <div className="mb-4 rounded-lg bg-emerald-50 text-emerald-700 text-[12px] font-semibold px-4 py-3">{notice}</div>}

      <div className="grid md:grid-cols-3 gap-4 mb-5">
        <Card className="p-4"><div className="flex items-center gap-2 text-[11px] font-bold text-muted"><ClipboardList size={14} className="text-emerald-600" /> Consultations</div><div className="text-2xl font-extrabold mt-1">{shownRows.length}</div></Card>
        <Card className="p-4"><div className="flex items-center gap-2 text-[11px] font-bold text-muted"><Link2 size={14} className="text-emerald-600" /> Devis liés</div><div className="text-2xl font-extrabold mt-1">{Object.values(quotesByConsultation).reduce((a, b) => a + b, 0)}</div></Card>
        <Card className="p-4"><div className="flex items-center gap-2 text-[11px] font-bold text-muted"><CalendarClock size={14} className="text-amber-600" /> Échéances à venir</div><div className="text-2xl font-extrabold mt-1">{shownRows.filter(r => r.deadline && new Date(r.deadline) >= new Date()).length}</div></Card>
      </div>

      <Card className="overflow-hidden">
        <CardHead title="Liste des consultations" subtitle="Les devis rattachés restent consultables depuis la page Devis" />
        <div className="px-5 pb-5">
          {shownRows.length === 0 ? <Empty text="Aucune consultation disponible. Cette fonctionnalité sera alimentée lorsque l’API dédiée sera exposée." /> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[820px]">
              <thead><tr><th className="th">Titre</th><th className="th">Projet</th><th className="th">Zone</th><th className="th">Échéance</th><th className="th">Devis liés</th><th className="th">Statut</th></tr></thead>
                <tbody>{shownRows.map(row => {
                const count = quotesByConsultation[String(row.id)] || 0;
                return (
                  <tr key={row.id} className="hover:bg-canvas/60">
                    <td className="td font-bold text-[12px]">{row.title || `Consultation #${row.id}`}</td>
                    <td className="td text-[11.5px]">{storeName(row.store_id || row.project_id)}</td>
                    <td className="td text-[11.5px] text-muted">{lotName(row.lot_id || row.package_id)}</td>
                    <td className="td text-[11.5px] text-muted">{dateFR(row.deadline)}</td>
                    <td className="td"><span className="badge-ok !text-[10px]">{count} devis</span></td>
                    <td className="td"><span className="badge-muted !text-[10px]">{STATUS_LABELS[row.status] || row.status || '—'}</span></td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
        </div>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Nouvelle consultation" wide>
        <form onSubmit={create} className="grid md:grid-cols-2 gap-4">
          <Field label="Titre" className="md:col-span-2"><input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Consultation mobilier accueil" required /></Field>
          {!fixedStoreId && <Field label="Projet"><select className="input" value={form.store_id} onChange={e => setForm(f => ({ ...f, store_id: e.target.value }))}><option value="">Choisir un projet…</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
          <Field label="Zone / chantier (libre)"><input className="input" value={form.lot_label} onChange={e => setForm(f => ({ ...f, lot_label: e.target.value }))} placeholder="Ex. Mobilier, signalétique…" /></Field>
          <Field label="Date limite"><input type="date" className="input" value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} /></Field>
          <Field label="Statut"><select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>{STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></Field>
          <div className="md:col-span-2 flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Annuler</button><button className="btn-primary" disabled={busy}>Créer la consultation</button></div>
        </form>
      </Modal>
    </>
  );
}
