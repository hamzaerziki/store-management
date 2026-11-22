import { useEffect, useState } from 'react';
import { Check, X, FileText, ExternalLink } from 'lucide-react';
import api, { getToken } from '../api/client';
import { Modal, DecisionProof, ExecutionStatusSelect, EXECUTION_LABELS_FR, money, dateFR } from './ui';

const API_ORIGIN = (import.meta.env.VITE_API_URL || 'http://localhost:4000/api').replace(/\/api$/, '');
const LABELS = {
  draft: 'Brouillon', pending_cdg: 'Attente CDG', pending_dd: 'Attente DD',
  pending_dg: 'Attente DG', approved: 'Approuvée', rejected: 'Rejetée',
};

const quoteFileUrl = async quote => { const r = await api(`/quotes/${quote.id}/file-token`); return `${API_ORIGIN}/api/quotes/${quote.id}/file?ft=${encodeURIComponent(r.token)}`; };

function Info({ label, value }) {
  return (
    <div className="rounded-xl border border-line bg-canvas/50 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className="text-[12px] font-bold text-ink mt-0.5">{value || '—'}</div>
    </div>
  );
}

export function PdfViewerModal({ open, onClose, title, src }) {
  return (
    <Modal open={open} onClose={onClose} title={title} full>
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-slate-100">
          {src ? (
            <iframe src={src} title={title} className="h-full w-full" />
          ) : (
            <div className="grid h-full place-items-center text-[12px] text-muted">Aucun PDF disponible</div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 pt-3">
          {src && <a href={src} target="_blank" rel="noreferrer" className="btn-ghost"><ExternalLink size={14} /> Ouvrir dans un onglet</a>}
          <button type="button" className="btn-primary" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </Modal>
  );
}

export function DemandDetailsModal({ open, onClose, demand, busy = false, onApprove, onReject, canTrackExecution = false, canEditExecution = false, currentUserId, onExecutionChange }) {
  const [pdf, setPdf] = useState(null);
  useEffect(() => { setPdf(null); }, [demand?.id]);

  if (!demand) return null;
  const quotes = demand.quotes || [];
  const decisions = demand.decisions || [];

  return (
    <>
      <Modal open={open} onClose={onClose} title={`Demande — ${demand.title || ''}`} wide>
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Info label="Magasin" value={demand.store_name || demand.lot_name} />
            <Info label="Demandeur" value={`${demand.created_by_name || demand.owner_role || "—"}${demand.created_by_department ? ` (${demand.created_by_department})` : ""}`} />
            <Info label="Type" value={demand.kind === 'mission' ? 'Mission' : 'Article'} />
            <Info label="Statut" value={LABELS[demand.status] || demand.status} />
            <Info label="Prix HT demandé" value={`${money(demand.amount)} MAD`} />
            <Info label="Échéance" value={dateFR(demand.deadline)} />
            <Info label="Zone / chantier" value={demand.lot_name} />
            <Info label="Article lié" value={demand.item_name} />
            <Info label="Suivi exécution" value={demand.status === "approved" ? (EXECUTION_LABELS_FR[demand.execution_status] || "Validé (0%)") : demand.status === "rejected" ? "Rejetée" : demand.status === "draft" ? "Brouillon" : "Après validation DG"} />
          </div>

          {(demand.description || demand.notes) && (
            <div className="rounded-xl border border-line bg-white px-3 py-2 text-[12px] text-slate-600">
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">Précisions</div>
              {demand.description || demand.notes}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-[12.5px] font-extrabold text-ink">Devis joints à cette demande</h3>
              <span className="text-[10.5px] text-muted">{quotes.length} devis</span>
            </div>
            {quotes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[11.5px] text-muted">Aucun devis joint</div>
            ) : (
              <div className="space-y-2">
                {quotes.map(quote => (
                  <div key={quote.id} className="rounded-xl border border-line bg-white px-3 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-[12.5px] font-extrabold text-ink">{quote.supplier_name || 'Prestataire'}</div>
                        <div className="text-[10.5px] text-muted">Version {quote.version || 1} · {quote.currency || 'MAD'}{quote.validity_date ? ` · validité ${dateFR(quote.validity_date)}` : ''}</div>
                      </div>
                      <div className="flex flex-wrap gap-2 text-right">
                        <div><div className="text-[9.5px] uppercase text-muted">Prix HT</div><div className="text-[12px] font-extrabold text-ink">{money(quote.amount_ht)}</div></div>
                        <div><div className="text-[9.5px] uppercase text-muted">TVA</div><div className="text-[12px] font-bold text-slate-600">{money(quote.amount_tva)}</div></div>
                        <div><div className="text-[9.5px] uppercase text-muted">TTC</div><div className="text-[12px] font-bold text-slate-600">{money(quote.amount_ttc)}</div></div>
                      </div>
                    </div>
                    <div className="mt-3 flex justify-end">
                      {quote.file_url ? (
                        <button type="button" className="btn-ghost !py-1.5 !text-[11px]" onClick={async () => { try { setPdf({ title: quote.supplier_name || 'Devis', url: await quoteFileUrl(quote) }); } catch(e){ toast.error(e.message); } }}>
                          <FileText size={14} /> Voir le PDF
                        </button>
                      ) : <span className="text-[10.5px] text-muted">Aucun PDF joint</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-line bg-white px-3 py-3">
            <div className="text-[12px] font-extrabold text-ink mb-2">Décisions CDG → DD → DG</div>
            <DecisionProof rows={decisions} />
            <div className="mt-3 border-t border-line pt-3">
              <div className="mb-2 text-[11px] font-bold text-muted">Exécution après approbation</div>
              <ExecutionStatusSelect demand={demand} canEdit={canEditExecution || (currentUserId != null && Number(demand.created_by) === Number(currentUserId))} onChange={onExecutionChange} />
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={onClose}>Fermer</button>
            {demand.can_validate && <>
              <button type="button" className="btn-ghost !text-red-600" disabled={busy} onClick={onReject}><X size={14} /> Rejeter</button>
              <button type="button" className="btn-primary" disabled={busy} onClick={onApprove}><Check size={14} /> Approuver</button>
            </>}
          </div>
        </div>
      </Modal>
      <PdfViewerModal open={!!pdf} onClose={() => setPdf(null)} title={pdf?.title || 'Devis'} src={pdf?.url} />
    </>
  );
}

export default DemandDetailsModal;
