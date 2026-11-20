import { useEffect, useState } from 'react';
import { Percent, Plus, Pencil, ShieldCheck, AlertCircle } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PageHeader, Card, CardHead, Modal, Field, ErrorBox, Empty } from '../components/ui';

const BASES = ['/v1/tax-rates', '/tax-rates'];
const EMPTY = { code: '', label: '', rate: '20', regime: 'taxable', valid_from: '', valid_to: '', active: true, author: '' };
const REGIMES = [
  { id: 'taxable', label: 'Taxable' },
  { id: 'exonere', label: 'Exonéré' },
  { id: 'hors_champ', label: 'Hors champ' },
];

async function taxRequest(method, path, payload) {
  let lastError;
  for (const base of BASES) {
    try {
      if (method === 'get') return await api.get(`${base}${path}`);
      if (method === 'post') return await api.post(`${base}${path}`, payload);
      return await api.patch(`${base}${path}`, payload);
    } catch (error) { lastError = error; }
  }
  throw lastError;
}

const normalize = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function RegimeCell({ row }) {
  const regime = normalize(row.regime);
  if (regime === 'exonere') return <span className="badge-bad !text-[10px]">Exonéré</span>;
  if (regime === 'hors_champ' || regime === 'hors champ') return <span className="badge-muted !text-[10px]">Hors champ</span>;
  if (Number(row.rate) === 0) return <span className="badge-warn !text-[10px]">0 % taxable (taux zéro)</span>;
  return <span className="badge-ok !text-[10px]">Taxable {Number(row.rate) || 0} %</span>;
}

export default function TaxRates() {
  const { user, can } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true); setError('');
    taxRequest('get', '')
      .then(r => setRows(Array.isArray(r.data) ? r.data : (r.data?.items || r.data?.data || [])))
      .catch(() => { setRows([]); setError('Le référentiel des taux de TVA n’est pas encore disponible sur l’API (/api/v1/tax-rates).'); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  function openForm(row) {
    setError(''); setNotice(''); setEditing(row || null);
    setForm(row ? {
      code: row.code || '', label: row.label || '', rate: String(row.rate ?? ''),
      regime: REGIMES.some(r => r.id === row.regime) ? row.regime : 'taxable',
      valid_from: String(row.valid_from || '').slice(0, 10),
      valid_to: String(row.valid_to || '').slice(0, 10),
      active: row.active !== false,
      author: row.author || row.created_by_name || row.created_by || '',
    } : { ...EMPTY, author: user?.name || '' });
    setOpen(true);
  }

  async function save(e) {
    e.preventDefault(); setError(''); setBusy(true);
    const payload = {
      code: form.code, label: form.label, rate: Number(form.rate) || 0, regime: form.regime,
      valid_from: form.valid_from || null, valid_to: form.valid_to || null,
      active: !!form.active, author: form.author || user?.name || null,
    };
    try {
      if (editing) { await taxRequest('patch', `/${editing.id}`, payload); setNotice('Taux de TVA mis à jour (historique préservé).'); }
      else { await taxRequest('post', '', payload); setNotice('Taux de TVA créé.'); }
      setOpen(false); load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  const sorted = [...rows].sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'fr'));

  return (
    <>
      <PageHeader title="Taux de TVA" subtitle="Référentiel historisé — un taux à 0 % taxable reste distinct d’une exonération" actions={
        can('manage_catalog') && <button className="btn-primary" onClick={() => openForm(null)}><Plus size={16} /> Nouveau taux</button>
      } />
      <ErrorBox error={error} />
      {notice && <div className="mb-4 rounded-lg bg-emerald-50 text-emerald-700 text-[12px] font-semibold px-4 py-3">{notice}</div>}

      <div className="grid md:grid-cols-3 gap-4 mb-5">
        <Card className="p-4"><div className="flex items-center gap-2 text-[11px] font-bold text-muted"><Percent size={14} className="text-emerald-600" /> Taux enregistrés</div><div className="text-2xl font-extrabold mt-1">{rows.length}</div></Card>
        <Card className="p-4"><div className="flex items-center gap-2 text-[11px] font-bold text-muted"><ShieldCheck size={14} className="text-emerald-600" /> Actifs</div><div className="text-2xl font-extrabold mt-1">{rows.filter(r => r.active !== false).length}</div></Card>
        <Card className="p-4"><div className="flex items-center gap-2 text-[11px] font-bold text-muted"><AlertCircle size={14} className="text-amber-600" /> Exonérés / hors champ</div><div className="text-2xl font-extrabold mt-1">{rows.filter(r => ['exonere', 'hors_champ'].includes(normalize(r.regime))).length}</div></Card>
      </div>

      <Card className="overflow-hidden">
        <CardHead title="Historique des taux" subtitle="Les dates d’effet et l’auteur de modification sont conservés" />
        <div className="px-5 pb-5">
          {loading ? <div className="py-10 text-center text-muted text-[12px]">Chargement du référentiel fiscal…</div>
            : sorted.length === 0 ? <Empty text="Aucun taux de TVA disponible. Créez un premier taux ou vérifiez la disponibilité de l’API." />
              : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px]">
                    <thead><tr><th className="th">Code</th><th className="th">Libellé</th><th className="th">Taux</th><th className="th">Régime</th><th className="th">Validité</th><th className="th">Statut</th><th className="th">Auteur</th><th className="th">Action</th></tr></thead>
                    <tbody>
                      {sorted.map(row => (
                        <tr key={row.id} className="hover:bg-canvas/60">
                          <td className="td font-extrabold text-[12px]">{row.code || `TAX-${row.id}`}</td>
                          <td className="td text-[12px] font-semibold">{row.label || '—'}</td>
                          <td className="td text-[12px] font-bold">{Number(row.rate) || 0} %</td>
                          <td className="td"><RegimeCell row={row} /></td>
                          <td className="td text-[11.5px] text-muted">{String(row.valid_from || '—').slice(0, 10)} → {String(row.valid_to || '—').slice(0, 10)}</td>
                          <td className="td"><span className={row.active !== false ? 'badge-ok !text-[10px]' : 'badge-muted !text-[10px]'}>{row.active !== false ? 'Actif' : 'Inactif'}</span></td>
                          <td className="td text-[11.5px] text-muted">{row.author || row.created_by_name || row.created_by || '—'}</td>
                          <td className="td">{can('manage_catalog') && <button className="btn-ghost !py-1 !px-2 !text-[11px]" onClick={() => openForm(row)}><Pencil size={13} /> Modifier</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
        </div>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? `Modifier le taux ${editing.code || ''}` : 'Nouveau taux de TVA'} wide>
        <form onSubmit={save} className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Code"><input className="input" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="TV20, TV10, EXO…" required /></Field>
            <Field label="Libellé"><input className="input" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="TVA normale 20 %" required /></Field>
            <Field label="Pourcentage (%)"><input type="number" min="0" max="100" step="0.01" className="input" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} required /></Field>
            <Field label="Régime fiscal">
              <select className="input" value={form.regime} onChange={e => setForm(f => ({ ...f, regime: e.target.value }))}>
                {REGIMES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </Field>
            <Field label="Valide du"><input type="date" className="input" value={form.valid_from} onChange={e => setForm(f => ({ ...f, valid_from: e.target.value }))} /></Field>
            <Field label="Valide jusqu’au"><input type="date" className="input" value={form.valid_to} onChange={e => setForm(f => ({ ...f, valid_to: e.target.value }))} /></Field>
            <Field label="Auteur / modification">
              <input className="input" value={form.author} onChange={e => setForm(f => ({ ...f, author: e.target.value }))} placeholder={user?.name || 'Nom de l’auteur'} />
            </Field>
            <Field label="Statut">
              <select className="input" value={form.active ? 'active' : 'inactive'} onChange={e => setForm(f => ({ ...f, active: e.target.value === 'active' }))}>
                <option value="active">Actif</option><option value="inactive">Inactif</option>
              </select>
            </Field>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-[11.5px] text-amber-900">
            {form.regime === 'exonere' ? 'Exonération : aucune TVA due, catégorie distincte du taux zéro.'
              : form.regime === 'hors_champ' ? 'Hors champ : l’opération n’est pas soumise à TVA.'
                : Number(form.rate) === 0 ? 'Taux zéro : opération taxable à 0 %, à ne pas confondre avec une exonération.'
                  : 'Les taux sont historisés : une modification n’altère pas les documents déjà validés.'}
          </div>
          <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Annuler</button><button className="btn-primary" disabled={busy}>Enregistrer</button></div>
        </form>
      </Modal>
    </>
  );
}
