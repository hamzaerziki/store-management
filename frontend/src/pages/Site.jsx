import { useEffect, useState } from 'react';
import { Plus, Upload, Folder, FolderOpen, FileImage, FileVideo, FileText, Download, Trash2, ArrowLeft, Eye, X } from 'lucide-react';
import api, { getToken } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, CardHead, PageHeader, Modal, Field, ErrorBox, Empty, ConfirmDialog, dateFR } from '../components/ui';

const API_ORIGIN = (import.meta.env.VITE_API_URL || 'http://localhost:4000/api').replace(/\/api$/, '');
const FOLDER_TYPES = ['Photos', 'Vidéos', 'Plans 3D', 'Documents', 'Autres'];

function formatBytes(value = 0) {
  if (!value) return '0 Ko';
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} Mo`;
  return `${(value / 1024).toFixed(0)} Ko`;
}

function FileViewerModal({ open, onClose, file, viewUrl, downloadUrl }) {
  if (!open || !file) return null;
  const mime = String(file.mime_type || '').toLowerCase();
  const name = String(file.original_name || file.name || '').toLowerCase();
  const isImage = mime.startsWith('image/');
  const isVideo = mime.startsWith('video/');
  const isPdf = mime === 'application/pdf' || name.endsWith('.pdf');
  const is3D = /\.(glb|gltf|obj|fbx|stl|3ds|dae|ifc|dwg|dxf|skp|step|stp|ply)$/i.test(name);
  return (
    <Modal open={open} onClose={onClose} title={file.original_name || file.name || 'Document'} full>
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-slate-100 grid place-items-center">
          {isPdf ? (
            <iframe src={viewUrl} title={file.original_name} className="h-full w-full bg-white" />
          ) : isImage ? (
            <img src={viewUrl} alt={file.original_name} className="max-h-full max-w-full object-contain bg-white" />
          ) : isVideo ? (
            <video src={viewUrl} controls autoPlay className="max-h-full max-w-full bg-black" />
          ) : (
            <div className="text-center p-8">
              <FileText size={42} className="text-muted mx-auto mb-3" />
              <div className="text-[13px] font-bold text-ink mb-1">{file.original_name || 'Fichier'}</div>
              <div className="text-[11.5px] text-muted mb-4">{is3D ? 'Aperçu 3D non disponible dans le navigateur — téléchargez le fichier pour l’ouvrir.' : 'Aperçu indisponible pour ce type de fichier — vous pouvez le télécharger.'}</div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 pt-3">
          {downloadUrl && <a href={downloadUrl} className="btn-primary" download><Download size={14} /> Télécharger</a>}
          {viewUrl && <a href={viewUrl} target="_blank" rel="noreferrer" className="btn-ghost"><Eye size={14} /> Ouvrir dans un onglet</a>}
          <button type="button" className="btn-ghost" onClick={onClose}><X size={14} /> Fermer</button>
        </div>
      </div>
    </Modal>
  );
}

export default function Site({ embedded = false, fixedStoreId = null }) {
  const { can, user } = useAuth();
  const [storeId, setStoreId] = useState(fixedStoreId ? String(fixedStoreId) : '');
  const [stores, setStores] = useState([]);
  const [folders, setFolders] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [activeFolder, setActiveFolder] = useState(null);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderType, setFolderType] = useState('Documents');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [viewerFile, setViewerFile] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const canUpload = can('upload_quotes');
  const scopeStoreId = fixedStoreId ? String(fixedStoreId) : storeId;
  const storeName = stores.find(s => String(s.id) === String(scopeStoreId))?.name || 'Magasin';

  const load = () => {
    if (!scopeStoreId) { setFolders([]); setDocuments([]); return; }
    Promise.all([
      api.get(`/documents/folders?store_id=${scopeStoreId}`),
      api.get(`/documents?store_id=${scopeStoreId}`),
    ]).then(([folderResponse, documentResponse]) => {
      setFolders(folderResponse.data || []);
      setDocuments(documentResponse.data || []);
    }).catch(setError);
  };

  useEffect(() => { api.get('/stores').then(r => setStores(r.data)).catch(() => {}); }, []);
  useEffect(() => { setActiveFolder(null); load(); }, [scopeStoreId]);

  const visibleFiles = documents.filter(document => activeFolder
    ? document.folder === activeFolder
    : !document.folder || document.folder === 'Autres');
  const viewUrl = document => `${API_ORIGIN}/api/documents/${document.id}/view?token=${encodeURIComponent(getToken() || '')}`;
  const downloadUrl = document => `${API_ORIGIN}/api/documents/${document.id}/download?token=${encodeURIComponent(getToken() || '')}`;

  async function createFolder(e) {
    e.preventDefault(); setError(''); setNotice(''); setBusy(true);
    const name = (folderName.trim() || folderType).trim();
    try {
      await api.post('/documents/folders', { store_id: scopeStoreId, name });
      setNotice(`Dossier « ${name} » créé`);
      setActiveFolder(name); setFolderName(''); setFolderType('Documents'); setFolderOpen(false);
      load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  async function uploadFiles(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length || !scopeStoreId) return;
    setError(''); setNotice(''); setBusy(true);
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('store_id', scopeStoreId);
        fd.append('folder', activeFolder || 'Autres');
        fd.append('file', file);
        await api.post('/documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      setNotice(`${files.length} fichier(s) importé(s) dans « ${activeFolder || 'Autres'} »`);
      e.target.value = '';
      load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  async function deleteFile(document) {
    setError(''); setBusy(true);
    try { await api.delete(`/documents/${document.id}`); setNotice('Fichier supprimé'); if (viewerFile?.id === document.id) setViewerFile(null); load(); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  async function deleteFolder() {
    if (!deleteTarget?.id) return;
    setError(''); setBusy(true);
    try {
      await api.delete(`/documents/folders/${deleteTarget.id}`);
      if (activeFolder === deleteTarget.name) setActiveFolder(null);
      setNotice('Dossier supprimé'); setDeleteTarget(null); load();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  function FileTile({ document }) {
    const mime = String(document.mime_type || '');
    const isImage = mime.startsWith('image/');
    const isVideo = mime.startsWith('video/');
    return (
      <div className="rounded-xl border border-line bg-white overflow-hidden hover:shadow-md transition">
        <button type="button" onClick={() => setViewerFile(document)} className="block w-full h-28 bg-canvas/70 grid place-items-center overflow-hidden">
          {isImage ? <img src={viewUrl(document)} alt={document.original_name} className="w-full h-full object-cover" />
            : isVideo ? <video src={viewUrl(document)} className="w-full h-full object-cover" muted preload="metadata" />
            : <FileText size={34} className="text-muted" />}
        </button>
        <div className="p-3">
          <div className="text-[11.5px] font-bold truncate" title={document.original_name}>{document.original_name}</div>
          <div className="text-[10px] text-muted mt-1">{formatBytes(document.size_bytes)} • {document.uploader_name || 'Système'} • {dateFR(document.created_at)}</div>
          <div className="flex justify-between items-center mt-2 gap-2">
            <button type="button" className="text-emerald-700 text-[11px] font-bold inline-flex items-center gap-1" onClick={() => setViewerFile(document)}><Eye size={13} /> Voir</button>
            <div className="flex items-center gap-2">
              <a href={downloadUrl(document)} className="text-slate-600 text-[11px] font-bold inline-flex items-center gap-1" download><Download size={13} /></a>
              {(() => { const isOwner = Number(document.uploaded_by) === Number(user?.id) || Number(document.created_by) === Number(user?.id); const canDel = isOwner || can('manage_users'); return canDel ? <button className="text-red-600 text-[11px] font-bold inline-flex items-center gap-1" onClick={() => deleteFile(document)}><Trash2 size={13} /></button> : null; })()}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {!embedded && <PageHeader title="Explorateur de fichiers" subtitle="Dossiers, photos, vidéos, plans 3D et documents du magasin" actions={
        <select className="input !py-2 !text-[12px] w-64" value={storeId} onChange={e => setStoreId(e.target.value)}>
          <option value="">Tous les magasins</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      } />}
      <ErrorBox error={error} />
      {notice && <div className="mb-4 rounded-lg bg-emerald-50 text-emerald-700 text-[12px] font-semibold px-4 py-3">{notice}</div>}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-line bg-canvas/60">
          <div className="flex items-center gap-2 text-[12px]">
            <Folder size={15} className="text-emerald-600" />
            <span className="text-muted">{storeName}</span>
            <span className="text-muted">/</span>
            <b>{activeFolder || 'Racine'}</b>
          </div>
          {canUpload && scopeStoreId && (
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost !py-1.5" onClick={() => setFolderOpen(true)}><Plus size={15} /> Nouveau dossier</button>
              <label className="btn-primary !py-1.5 cursor-pointer">
                <Upload size={15} /> Importer (photos, vidéos, plans 3D, fichiers)
                <input type="file" multiple className="hidden" onChange={uploadFiles} disabled={busy} accept="image/*,video/*,.pdf,.glb,.gltf,.obj,.fbx,.stl,.3ds,.dae,.ifc,.dwg,.dxf,.skp,.step,.stp,.ply,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.7z" />
              </label>
            </div>
          )}
        </div>

        <div className="p-5">
          {!scopeStoreId ? <Empty text="Sélectionnez un magasin pour ouvrir son explorateur" /> : (
            <>
              {activeFolder ? (
                <>
                  <button className="text-[11.5px] font-bold text-emerald-700 inline-flex items-center gap-1 mb-4" onClick={() => setActiveFolder(null)}><ArrowLeft size={14} /> Tous les dossiers</button>
                  <CardHead title={activeFolder} subtitle={`${visibleFiles.length} fichier(s)`} right={<FileImage size={16} className="text-emerald-600" />} />
                  {visibleFiles.length === 0 ? <Empty text="Aucun fichier dans ce dossier — importez des photos, vidéos ou plans 3D" /> : (
                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">{visibleFiles.map(document => <FileTile key={document.id} document={document} />)}</div>
                  )}
                </>
              ) : (
                <>
                  <CardHead title="Dossiers" subtitle={`${folders.length} dossier(s)`} right={<FolderOpen size={16} className="text-emerald-600" />} />
                  {folders.length === 0 ? <Empty text="Aucun dossier — créez-en un pour commencer" /> : (
                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                      {folders.map(folder => (
                        <div key={folder.id || folder.name} className="rounded-xl border border-line bg-white p-4 hover:shadow-md transition">
                          <button className="w-full text-left" onClick={() => setActiveFolder(folder.name)}>
                            <Folder size={26} className="text-gold-500" />
                            <div className="font-bold text-[12.5px] mt-2 truncate">{folder.name}</div>
                            <div className="text-[10.5px] text-muted mt-1">{folder.count || 0} fichier(s)</div>
                          </button>
                          {(can('manage_users') || canUpload) && folder.id && (
                            <button className="text-red-600 text-[10.5px] font-bold mt-2 inline-flex items-center gap-1" onClick={() => setDeleteTarget(folder)}><Trash2 size={12} /> Supprimer le dossier</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <CardHead title="Fichiers à la racine" subtitle="Photos, vidéos, plans 3D et documents non classés" />
                  {visibleFiles.length === 0 ? <Empty text="Aucun fichier à la racine" /> : (
                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">{visibleFiles.map(document => <FileTile key={document.id} document={document} />)}</div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </Card>

      <Modal open={folderOpen} onClose={() => setFolderOpen(false)} title="Nouveau dossier">
        <form onSubmit={createFolder} className="space-y-4">
          <Field label="Type / nom rapide">
            <select className="input" value={folderType} onChange={e => { setFolderType(e.target.value); if (!folderName) setFolderName(e.target.value === 'Documents' ? '' : e.target.value); }}>
              {FOLDER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Nom du dossier"><input className="input" value={folderName} onChange={e => setFolderName(e.target.value)} placeholder="Ex. Photos chantier, Plans 3D, Vidéos…" /></Field>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setFolderOpen(false)}>Annuler</button>
            <button className="btn-primary" disabled={busy}>Créer le dossier</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={deleteFolder}
        title={`Supprimer le dossier « ${deleteTarget?.name || ''} » ?`}
        message="Le dossier doit être vide. Les fichiers qu’il contient ne sont pas supprimés automatiquement."
        confirmLabel="Supprimer le dossier"
        busy={busy}
      />

      <FileViewerModal
        open={!!viewerFile}
        onClose={() => setViewerFile(null)}
        file={viewerFile}
        viewUrl={viewerFile ? viewUrl(viewerFile) : ''}
        downloadUrl={viewerFile ? downloadUrl(viewerFile) : ''}
      />
    </>
  );
}
