import { useEffect, useRef, useState } from 'react';
import { useDataRefresh } from '../hooks/useDataRefresh';
import { Link } from 'react-router-dom';
import { Plus, MapPin, CalendarDays, ImagePlus, Pencil, Trash2, ZoomIn, ZoomOut, MoveLeft, MoveRight, MoveUp, MoveDown, RotateCcw } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PageHeader, StatusBadge, ProgressBar, Modal, Field, ErrorBox, ConfirmDialog, money, dateFR } from '../components/ui';

const API_ORIGIN = (import.meta.env.VITE_API_URL || 'http://localhost:4000/api').replace(/\/api$/, '');
const BRAND_EXTENSIONS = ['svg', 'png', 'jpg', 'jpeg', 'webp'];
const STORE_IMAGES = { 'maje mmall': '/maje%20mmall.jpg' };
const BRANDS = [
  { test: n => n.includes('sandro') && n.includes('capital'), file: 'sandro-capital-mall', label: 'Sandro' },
  { test: n => n.includes('sandro'), file: 'sandro-mall', label: 'Sandro' },
  { test: n => n.includes('maje'), file: 'maje-mall', label: 'Maje' },
  { test: n => n.includes('lacoste'), file: 'lacoste-capital-mall', label: 'Lacoste' },
  { test: n => n.includes('boss'), file: 'boss-capital-mall', label: 'Boss' },
  { test: n => n.includes('gant'), file: 'gant-capital-mall', label: 'Gant' },
];

function normalize(name = '') {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function findBrand(name) { const normalized = normalize(name); return BRANDS.find(b => b.test(normalized)); }
function storeImageUrl(store) {
  if (store?.image_url) {
    if (/^https?:\/\//.test(store.image_url)) return store.image_url;
    if (store.image_url.startsWith('/')) return `${API_ORIGIN}${store.image_url}`;
  }
  return STORE_IMAGES[normalize(store?.name)] || null;
}
function BrandLogo({ name }) {
  const brand = findBrand(name);
  const [extensionIndex, setExtensionIndex] = useState(0);
  if (!brand) return <div className="w-12 h-12 rounded-xl bg-canvas border border-line grid place-items-center text-[13px] font-extrabold text-muted">{normalize(name).slice(0, 2).toUpperCase()}</div>;
  if (extensionIndex >= BRAND_EXTENSIONS.length) return <div className="w-12 h-12 rounded-xl bg-canvas border border-line grid place-items-center text-[13px] font-extrabold text-ink">{brand.label.slice(0, 2).toUpperCase()}</div>;
  return <img key={extensionIndex} src={`/brands/${brand.file}.${BRAND_EXTENSIONS[extensionIndex]}`} alt={brand.label} className="w-12 h-12 rounded-xl bg-white border border-line p-1.5 object-contain" onError={() => setExtensionIndex(i => i + 1)} />;
}

const EMPTY_FORM = { name: '', city: '', opening_date: '', budget: '', image: null };

export default function Stores() {
  const { can, user } = useAuth();
  const [stores, setStores] = useState([]);
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(false);
  const [editStore, setEditStore] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editForm, setEditForm] = useState({ name: '', city: '', opening_date: '', budget: '', date_change_reason: '', budget_reason: '', image: null });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState('');
  const [editPreview, setEditPreview] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [editZoom, setEditZoom] = useState(1);
  const [editPan, setEditPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [editDragging, setEditDragging] = useState(false);
  const dragOrigin = useRef(null);
  const editDragOrigin = useRef(null);

  const load = () => api.get('/stores').then(r => setStores(r.data)).catch(setError);
  useEffect(() => { load(); }, []);
  useDataRefresh(load, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => () => { if (editPreview && editPreview.startsWith('blob:')) URL.revokeObjectURL(editPreview); }, [editPreview]);

  const shown = stores.filter(s => filter === 'all' || s.computed_status === filter);
  const filters = [['all', 'Tous'], ['on_track', 'En bonne voie'], ['at_risk', 'À risque'], ['en_retard', 'En retard'], ['ready', 'Prêts'], ['ouvert', 'Ouvert']];
  const counts = Object.fromEntries(filters.map(([k]) => [k, k === 'all' ? stores.length : stores.filter(s => s.computed_status === k).length]));

  const resetImage = () => { setZoom(1); setPan({ x: 0, y: 0 }); dragOrigin.current = null; setDragging(false); };
  const resetEditImage = () => { setEditZoom(1); setEditPan({ x: 0, y: 0 }); editDragOrigin.current = null; setEditDragging(false); };
  function closeModal() { setOpen(false); setForm(EMPTY_FORM); setPreview(''); setError(''); resetImage(); }
  function chooseImage(e) { const file = e.target.files?.[0] || null; setForm(p => ({ ...p, image: file })); setPreview(file ? URL.createObjectURL(file) : ''); resetImage(); }
  function openEdit(store) {
    setError('');
    setEditStore(store);
    setEditForm({
      name: store.name || '', city: store.city || '',
      opening_date: String(store.opening_date || '').slice(0, 10),
      budget: store.budget ?? '', date_change_reason: '', budget_reason: '', image: null,
    });
    setEditPreview(storeImageUrl(store) || '');
    setEditZoom(Number(store.image_zoom || 1));
    setEditPan({ x: Number(store.image_pos_x || 0), y: Number(store.image_pos_y || 0) });
    setEditDragging(false); editDragOrigin.current = null;
  }
  function closeEdit() { setEditStore(null); setEditPreview(''); setError(''); resetEditImage(); }
  function chooseEditImage(e) {
    const file = e.target.files?.[0] || null;
    setEditForm(p => ({ ...p, image: file }));
    setEditPreview(file ? URL.createObjectURL(file) : storeImageUrl(editStore) || '');
    setEditZoom(1); setEditPan({ x: 0, y: 0 }); setEditDragging(false); editDragOrigin.current = null;
  }

  const moveImage = (x, y) => setPan(c => ({ x: c.x + x, y: c.y + y }));
  const moveEditImage = (x, y) => setEditPan(c => ({ x: c.x + x, y: c.y + y }));
  const changeZoom = d => setZoom(c => Math.min(2.5, Math.max(1, Math.round((c + d) * 100) / 100)));
  const changeEditZoom = d => setEditZoom(c => Math.min(2.5, Math.max(1, Math.round((c + d) * 100) / 100)));
  const startDrag = e => { dragOrigin.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }; setDragging(true); e.currentTarget.setPointerCapture(e.pointerId); };
  const dragImage = e => { if (!dragOrigin.current) return; setPan({ x: e.clientX - dragOrigin.current.x, y: e.clientY - dragOrigin.current.y }); };
  const endDrag = e => { dragOrigin.current = null; setDragging(false); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); };
  const startEditDrag = e => { editDragOrigin.current = { x: e.clientX - editPan.x, y: e.clientY - editPan.y }; setEditDragging(true); e.currentTarget.setPointerCapture(e.pointerId); };
  const dragEditImage = e => { if (!editDragOrigin.current) return; setEditPan({ x: e.clientX - editDragOrigin.current.x, y: e.clientY - editDragOrigin.current.y }); };
  const endEditDrag = e => { editDragOrigin.current = null; setEditDragging(false); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); };

  async function create(e) {
    e.preventDefault(); setError('');
    try {
      const payload = new FormData();
      ['name', 'city', 'opening_date', 'budget'].forEach(key => { if (form[key] !== '' && form[key] != null) payload.append(key, form[key]); });
      if (form.image) payload.append('image', form.image);
      await api.post('/stores', payload, { headers: { 'Content-Type': 'multipart/form-data' } });
      closeModal(); load();
    } catch (e) { setError(e); }
  }

  async function saveEdit(e) {
    e.preventDefault(); setError('');
    if (!editStore) return;
    try {
      const budgetChanged = String(editForm.budget ?? '') !== String(editStore.budget ?? '');
      await api.put(`/stores/${editStore.id}`, {
        name: editForm.name, city: editForm.city,
        opening_date: editForm.opening_date,
        forecast_open_date: editForm.opening_date,
        revised_open_date: editForm.opening_date,
        date_change_reason: editForm.date_change_reason || 'Mise à jour magasin',
      });
      if (budgetChanged && editForm.budget !== '') {
        await api.put(`/stores/${editStore.id}/budget`, { budget: Number(editForm.budget), reason: editForm.budget_reason || 'Mise à jour budgétaire' });
      }
      const transformChanged = Number(editZoom) !== Number(editStore.image_zoom || 1) || Number(editPan.x) !== Number(editStore.image_pos_x || 0) || Number(editPan.y) !== Number(editStore.image_pos_y || 0);
      if (editForm.image) {
        const payload = new FormData();
        payload.append('image', editForm.image);
        payload.append('image_zoom', String(editZoom));
        payload.append('image_pos_x', String(editPan.x));
        payload.append('image_pos_y', String(editPan.y));
        await api.put(`/stores/${editStore.id}/image`, payload, { headers: { 'Content-Type': 'multipart/form-data' } });
      } else if (transformChanged && (editPreview || editStore.image_url)) {
        await api.put(`/stores/${editStore.id}/image`, { image_zoom: editZoom, image_pos_x: editPan.x, image_pos_y: editPan.y });
      }
      const withProgress = await api.get(`/stores/${editStore.id}`);
      setStores(current => current.map(store => store.id === editStore.id ? withProgress.data : store));
      closeEdit();
    } catch (e) { setError(e); }
  }

  async function removeStoreImage() {
    if (!editStore) return;
    try {
      await api.put(`/stores/${editStore.id}/image`, { image_url: '' });
      const withProgress = await api.get(`/stores/${editStore.id}`);
      setStores(current => current.map(store => store.id === editStore.id ? withProgress.data : store));
      setEditPreview(''); setEditForm(p => ({ ...p, image: null }));
    } catch (e) { setError(e); }
  }

  async function deleteStore() {
    if (!deleteTarget) return;
    setBusy(true); setError('');
    try {
      await api.delete(`/stores/${deleteTarget.id}`);
      setStores(current => current.filter(store => store.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  }

  const PhotoEditor = ({ previewUrl, file, zoomVal, panVal, draggingVal, onChoose, onZoom, onMove, onStart, onDrag, onEnd, onReset, label }) => (
    <div className="rounded-2xl border border-dashed border-line bg-canvas/70 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-[11px] font-bold uppercase tracking-wide text-muted">{label || 'Photo du magasin'}</div>
        {previewUrl && <span className="chip !px-2 !py-1 !text-[9.5px]">{Math.round(zoomVal * 100)} %</span>}
      </div>
      <div className={`relative h-64 overflow-hidden rounded-2xl border border-line bg-white ${previewUrl ? 'touch-none select-none' : 'grid place-items-center'} ${draggingVal ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={previewUrl ? onStart : undefined} onPointerMove={previewUrl ? onDrag : undefined} onPointerUp={previewUrl ? onEnd : undefined} onPointerCancel={previewUrl ? onEnd : undefined}>
        {previewUrl ? (
          <>
        <img src={previewUrl} alt="Aperçu du magasin" draggable={false} className="h-full w-full object-cover" style={{ transform: `translate(${panVal.x}px, ${panVal.y}px) scale(${zoomVal})`, transformOrigin: "center" }} />
            <div className="absolute right-2 top-2 flex flex-wrap justify-end gap-1 max-w-[180px]" onPointerDown={e => e.stopPropagation()}>
              <button type="button" className="btn-ghost !p-2 !rounded-xl" title="Zoom avant" onClick={() => onZoom(0.2)}><ZoomIn size={14} /></button>
          <button type="button" className="btn-ghost !p-2 !rounded-xl" title="Zoom arrière" onClick={() => onZoom(-0.2)}><ZoomOut size={14} /></button>
              <button type="button" className="btn-ghost !p-2 !rounded-xl" title="Gauche" onClick={() => onMove(-24, 0)}><MoveLeft size={14} /></button>
              <button type="button" className="btn-ghost !p-2 !rounded-xl" title="Droite" onClick={() => onMove(24, 0)}><MoveRight size={14} /></button>
              <button type="button" className="btn-ghost !p-2 !rounded-xl" title="Haut" onClick={() => onMove(0, -24)}><MoveUp size={14} /></button>
              <button type="button" className="btn-ghost !p-2 !rounded-xl" title="Bas" onClick={() => onMove(0, 24)}><MoveDown size={14} /></button>
          <button type="button" className="btn-ghost !p-2 !rounded-xl" title="Réinitialiser" onClick={onReset}><RotateCcw size={14} /></button>
            </div>
                <div className="pointer-events-none absolute bottom-2 left-2 rounded-lg bg-white/85 px-2 py-1 text-[9.5px] font-semibold text-muted">Glissez pour cadrer / déplacer</div>
          </>
        ) : (
          <div className="text-center px-4"><ImagePlus size={26} className="mx-auto text-muted" /><div className="text-[11.5px] font-semibold text-muted mt-2">Aucune image</div></div>
        )}
      </div>
      <label className="btn-ghost mt-4 w-full cursor-pointer justify-center"><ImagePlus size={15} /> Choisir une image<input type="file" accept="image/*" className="hidden" onChange={onChoose} /></label>
      {file && <div className="mt-2 text-[10.5px] text-muted truncate" title={file.name}>{file.name}</div>}
    </div>
  );

  return (
    <>
      <PageHeader title="Magasins" subtitle="Tous les points de vente en cours d'ouverture" actions={
        can('manage_stores') && <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Nouveau magasin</button>
      } />
      <div className="flex flex-wrap gap-2 mb-5">
        {filters.map(([k, l]) => <button key={k} onClick={() => setFilter(k)} className={`chip ${filter === k ? 'chip-active' : ''}`}>{l} <span className="opacity-60">({counts[k]})</span></button>)}
      </div>
      <ErrorBox error={error} />
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {shown.map(s => {
          const image = storeImageUrl(s);
          return (
            <div key={s.id} className="card p-5 hover:-translate-y-0.5 hover:shadow-lg transition relative">
              <Link to={`/stores/${s.id}`} className="block">
                {image && (
                  <div className="w-full h-32 overflow-hidden rounded-xl mb-4 bg-canvas">
                    <img src={image} alt={s.name} className="w-full h-full object-cover" style={{ transform: `translate(${Number(s.image_pos_x || 0)}px, ${Number(s.image_pos_y || 0)}px) scale(${Number(s.image_zoom || 1)})`, transformOrigin: 'center center' }} />
                  </div>
                )}
                <div className="flex items-start justify-between"><BrandLogo key={s.id} name={s.name} /><StatusBadge status={s.computed_status} /></div>
                <h3 className="font-extrabold text-[14px] mt-4">{s.name}</h3>
                <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted mt-1">{findBrand(s.name)?.label || s.brand || 'Safari'}</div>
                <div className="flex items-center gap-3 text-[11.5px] text-muted mt-2">
                  <span className="flex items-center gap-1"><MapPin size={12} />{s.city}</span>
                  <span className="flex items-center gap-1"><CalendarDays size={12} />{dateFR(s.opening_date)}</span>
                </div>
                <div className="flex justify-between text-[11px] mt-5 mb-1.5"><span className="text-muted">Progression</span><b>{s.progress}%</b></div>
                <ProgressBar value={s.progress} tone={(s.computed_status === 'late' || s.computed_status === 'en_retard') ? 'red' : s.computed_status === 'at_risk' ? 'gold' : 'green'} />
                <div className="mt-2 text-[10.5px] text-muted truncate" title={s.status_reason}>{s.status_reason}</div>
                <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-line text-[11px]">
                  <div><div className="text-muted">Articles</div><div className="font-bold">{s.items_count}</div></div>
                  <div><div className="text-muted">Budget</div><div className="font-bold">{money(s.budget)}</div></div>
                </div>
              </Link>
              {(can('manage_stores') || user?.role === 'admin') && (
                <div className={`absolute flex gap-1.5 ${image ? 'right-4 top-4' : 'right-4 top-4'}`}>
                  {can('manage_stores') && (
                    <button type="button" className="btn-ghost !p-2 !rounded-xl bg-white/90 shadow-sm" title="Modifier le magasin" aria-label={`Modifier ${s.name}`} onClick={() => openEdit(s)}>
                      <Pencil size={14} />
                    </button>
                  )}
                  {user?.role === 'admin' && (
                    <button type="button" className="btn-ghost !p-2 !rounded-xl bg-white/90 shadow-sm text-red-600 hover:bg-red-50" title="Supprimer le magasin" aria-label={`Supprimer ${s.name}`} onClick={() => setDeleteTarget(s)}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Modal open={open} onClose={closeModal} title="Nouveau magasin" wide>
        <form onSubmit={create} className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
          <div className="space-y-4">
            <Field label="Nom du magasin"><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="Safari Tanger Centre" /></Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Ville"><input className="input" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} required /></Field>
              <Field label="Date d'ouverture"><input type="date" className="input" value={form.opening_date} onChange={e => setForm({ ...form, opening_date: e.target.value })} required /></Field>
            </div>
          <Field label="Budget prévisionnel (MAD)"><input type="number" min="0" className="input" value={form.budget} onChange={e => setForm({ ...form, budget: e.target.value })} required /></Field>
          </div>
          <PhotoEditor previewUrl={preview} file={form.image} zoomVal={zoom} panVal={pan} draggingVal={dragging} onChoose={chooseImage} onZoom={changeZoom} onMove={moveImage} onStart={startDrag} onDrag={dragImage} onEnd={endDrag} onReset={resetImage} />
          <div className="md:col-span-2 flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={closeModal}>Annuler</button><button className="btn-primary">Créer le magasin</button></div>
        </form>
      </Modal>

      <Modal open={!!editStore} onClose={closeEdit} title={`Modifier ? ${editStore?.name || ''}`} wide>
        <form onSubmit={saveEdit} className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
          <div className="space-y-4">
            <Field label="Nom du magasin"><input className="input" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} required /></Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Ville"><input className="input" value={editForm.city} onChange={e => setEditForm({ ...editForm, city: e.target.value })} required /></Field>
          <Field label="Date d'ouverture (souhaitée)"><input type="date" className="input" value={editForm.opening_date} onChange={e => setEditForm({ ...editForm, opening_date: e.target.value })} required /></Field>
            </div>
          <Field label="Budget prévisionnel (MAD)"><input type="number" min="0" className="input" value={editForm.budget} onChange={e => setEditForm({ ...editForm, budget: e.target.value })} disabled={!can('edit_budget')} /></Field>
            <Field label="Motif (date / modifications)"><input className="input" value={editForm.date_change_reason} onChange={e => setEditForm({ ...editForm, date_change_reason: e.target.value })} placeholder="Ex. nouveau calendrier validé" /></Field>
          {can('edit_budget') && <Field label="Motif révision budget"><input className="input" value={editForm.budget_reason} onChange={e => setEditForm({ ...editForm, budget_reason: e.target.value })} placeholder="Raison de la modification budgétaire" /></Field>}
            <div className="rounded-xl bg-canvas px-3 py-2 text-[11px] text-muted">Date initiale (immuable) : {dateFR(editStore?.initial_open_date || editStore?.opening_date)}</div>
          </div>
          <div>
            <PhotoEditor previewUrl={editPreview} file={editForm.image} zoomVal={editZoom} panVal={editPan} draggingVal={editDragging} onChoose={chooseEditImage} onZoom={changeEditZoom} onMove={moveEditImage} onStart={startEditDrag} onDrag={dragEditImage} onEnd={endEditDrag} onReset={resetEditImage} label="Photo (cadre / zoom / déplacement)" />
            {editPreview && <button type="button" className="btn-ghost mt-2 w-full justify-center" onClick={removeStoreImage}><Trash2 size={14} /> Retirer la photo</button>}
          </div>
          <ErrorBox error={error} />
          <div className="md:col-span-2 flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={closeEdit}>Annuler</button><button className="btn-primary">Enregistrer les modifications</button></div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={deleteStore}
        title="Supprimer le magasin"
        message={`Le magasin « ${deleteTarget?.name || ''} » et toutes ses données associées (demandes, documents, planning, etc.) seront supprimées définitivement. Cette action est irréversible.`}
        confirmLabel="Supprimer définitivement"
        danger
        busy={busy}
      />
    </>
  );
}
