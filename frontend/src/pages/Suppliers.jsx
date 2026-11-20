import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Pencil, Building2, Star, Phone, Mail } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PageHeader, Card, CardHead, Field, Modal, ErrorBox, Empty } from '../components/ui';

const KINDS = ['Fournisseur', 'Prestataire', 'Entreprise', 'Artisan'];

const FIELDS = [
  { key: 'name', label: 'Raison sociale', required: true, placeholder: 'Nom de la société' },
  { key: 'kind', label: 'Type', select: true },
  { key: 'ice', label: 'ICE', placeholder: 'Identifiant commun de l’entreprise' },
  { key: 'rc', label: 'RC', placeholder: 'Registre de commerce' },
  { key: 'if_number', label: 'IF', placeholder: 'Identifiant fiscal' },
  { key: 'phone', label: 'Téléphone', placeholder: '06 xx xx xx xx' },
  { key: 'email', label: 'E-mail', type: 'email', placeholder: 'contact@entreprise.ma' },
  { key: 'address', label: 'Adresse', wide: true, placeholder: 'Adresse complète' },
  { key: 'specialties', label: 'Spécialités', wide: true, placeholder: 'Ex. Mobilier, électricité, climatisation…' },
  { key: 'contract_reference', label: 'Référence contrat', placeholder: 'Contrat / convention' },
  { key: 'rating', label: 'Note (/5)', type: 'number', step: '0.5', min: '0', max: '5' },
  { key: 'evaluation', label: 'Évaluation', wide: true, textarea: true, placeholder: 'Appréciation qualitative du prestataire…' },
  { key: 'notes', label: 'Notes internes', wide: true, textarea: true, placeholder: 'Commentaires, conditions particulières…' },
];

const EMPTY_FORM = {
  name: '', ice: '', rc: '', if_number: '', phone: '', email: '', address: '',
  specialties: '', contract_reference: '', rating: '', evaluation: '', notes: '', kind: '',
};

const text = value => Array.isArray(value) ? value.join(', ') : String(value ?? '');
const norm = value => text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export default function Suppliers() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

  const editable = can('manage_catalog') || can('manage_operations') || can('manage_stores');

  const load = () => api.get('/suppliers').then(r => setRows(Array.isArray(r.data) ? r.data : [])).catch(setError);
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const query = norm(search);
    return rows.filter(row => !query || norm([
      row.name, row.ice, row.rc, row.if_number, row.email, row.phone,
      row.specialties, row.contract_reference, row.kind,
    ].map(norm).join(' ')).includes(query));
  }, [rows, search]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(row) {
    setEditing(row);
    setForm({ ...EMPTY_FORM, ...row, specialties: text(row.specialties), rating: row.rating ?? '' });
    setOpen(true);
  }

  async function save(event) {
    event.preventDefault();
    setError('');
    const payload = { ...form, rating: form.rating === '' ? 0 : Number(form.rating) };
    try {
      if (editing?.id) await api.put(`/suppliers/${editing.id}`, payload);
      else await api.post('/suppliers', payload);
      setOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      load();
    } catch (e) { setError(e); }
  }

  function stars(rating) {
    const value = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
    return <span className="text-gold-500 text-[13px] tracking-tight">{'★'.repeat(value)}<span className="text-slate-200">{'★'.repeat(5 - value)}</span></span>;
  }

  return (
    <>
      <PageHeader title="Prestataires" subtitle="Fournisseurs, entreprises et prestataires intervenant sur les ouvertures" actions={
        editable && <button className="btn-primary" onClick={openCreate}><Plus size={16} /> Nouveau prestataire</button>
      } />
      <ErrorBox error={error} />

      <Card className="mb-5">
        <CardHead title="Annuaire des prestataires" subtitle={`${filtered.length} fiche(s) · ${rows.length} au total`} right={<Building2 size={16} className="text-emerald-600" />} />
        <div className="px-5 pb-4">
          <div className="relative max-w-md">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input !pl-9" placeholder="Rechercher par nom, ICE, RC, spécialité…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? <Empty text={rows.length === 0 ? 'Aucun prestataire enregistré pour le moment' : 'Aucun prestataire ne correspond à la recherche'} /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[1050px]">
            <thead><tr>
              <th className="th">Raison sociale</th>
              <th className="th">Identifiants</th>
              <th className="th">Contact</th>
              <th className="th">Spécialités</th>
              <th className="th">Contrat</th>
              <th className="th">Évaluation</th>
              {editable && <th className="th"></th>}
            </tr></thead>
            <tbody>
              {filtered.map(row => (
                <tr key={row.id} className="hover:bg-canvas/60">
                  <td className="td">
                    <div className="font-extrabold text-[12.5px]">{row.name}</div>
                    <div className="text-[10px] text-muted uppercase tracking-wide">{row.kind || 'Prestataire'}</div>
                  </td>
                  <td className="td text-[11px] text-muted">
                    <div>ICE : {row.ice || '—'}</div>
                    <div>RC : {row.rc || '—'} · IF : {row.if_number || '—'}</div>
                  </td>
                  <td className="td text-[11px]">
                    <div className="flex items-center gap-1"><Phone size={11} className="text-muted" /> {row.phone || '—'}</div>
                    <div className="flex items-center gap-1 text-muted mt-1"><Mail size={11} /> {row.email || '—'}</div>
                    <div className="text-[10px] text-muted mt-1 truncate max-w-[180px]" title={text(row.address)}>{row.address || ''}</div>
                  </td>
                  <td className="td text-[11px] text-muted max-w-[220px]">{text(row.specialties) || '—'}</td>
                  <td className="td text-[11px] font-semibold">{row.contract_reference || '—'}</td>
                  <td className="td">
                    <div>{stars(row.rating)} <span className="text-[10.5px] text-muted">{row.rating || 0}/5</span></div>
                    <div className="text-[10px] text-muted mt-1 max-w-[200px] truncate" title={text(row.evaluation)}>{text(row.evaluation) || text(row.notes) || '—'}</div>
                  </td>
                  {editable && <td className="td text-right">
                    <button className="btn-ghost !py-1 !px-2 !text-[11px]" onClick={() => openEdit(row)}><Pencil size={13} /> Modifier</button>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `Modifier — ${editing.name}` : 'Nouveau prestataire'} wide>
        <form onSubmit={save} className="grid md:grid-cols-2 gap-4">
          {FIELDS.map(field => (
            <Field key={field.key} label={field.label} className={field.wide ? 'md:col-span-2' : ''}>
              {field.select ? (
                <select className="input" value={form[field.key] || ''} onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}>
                  <option value="">Choisir…</option>
                  {KINDS.map(kind => <option key={kind} value={kind}>{kind}</option>)}
                </select>
              ) : field.textarea ? (
                <textarea className="input min-h-[80px]" rows="3" value={form[field.key] || ''} placeholder={field.placeholder} onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))} />
              ) : (
                <input className="input" type={field.type || 'text'} step={field.step} min={field.min} max={field.max}
                  value={form[field.key] ?? ''} placeholder={field.placeholder} required={field.required}
                  onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))} />
              )}
            </Field>
          ))}
          <div className="md:col-span-2 flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Annuler</button>
            <button className="btn-primary">{editing ? 'Enregistrer' : 'Créer le prestataire'}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
