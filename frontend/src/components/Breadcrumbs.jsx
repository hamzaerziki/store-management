import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import api from '../api/client';

const SEGMENT_LABELS = {
  stores: 'Magasins',
  quotes: 'Devis',
  comparisons: 'Comparatifs',
  operations: 'Opérations',
  demands: 'Demandes',
  workflows: 'Cycles de vie',
  portfolio: 'Portefeuille',
  inbox: 'Corbeille validations',
  suppliers: 'Prestataires',
  budgets: 'Budget',
  categories: 'Catégories',
  engagements: 'Engagements',
  invoices: 'Factures & paiements',
  planning: 'Planning Gantt',
  risks: 'Risques & changements',
  site: 'Chantier & réception',
  reporting: 'Reporting',
  governance: 'Gouvernance',
  users: 'Utilisateurs',
  audit: "Journal d'activité",
  roles: 'Rôles & responsabilités',
  settings: 'Paramètres',
  delegations: 'Délégations',
  notifications: 'Centre de notifications',
  'notification-admin': 'Administration notifications',
  'tax-rates': 'Taux de TVA',
};

export default function Breadcrumbs({ fallbackLabel }) {
  const location = useLocation();
  const [stores, setStores] = useState([]);

  useEffect(() => {
    api.get('/stores').then(r => setStores(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);

  const segments = location.pathname.split('/').filter(Boolean);
  const crumbs = [{ label: 'Accueil', to: '/' }];
  let accumulated = '';

  segments.forEach((segment, index) => {
    accumulated += `/${segment}`;
    const parent = segments[index - 1];
    const isDynamicId = /^\d+$/.test(segment);

    if (parent === 'stores' && isDynamicId) {
      const store = stores.find(s => String(s.id) === segment);
      crumbs.push({ label: store?.name || store?.code || `Magasin #${segment}`, to: accumulated });
    } else if (parent === 'comparisons' && isDynamicId) {
      crumbs.push({ label: `Comparatif #${segment}`, to: accumulated });
    } else if (isDynamicId && index === segments.length - 1 && fallbackLabel) {
      crumbs.push({ label: fallbackLabel, to: accumulated });
    } else {
      crumbs.push({ label: SEGMENT_LABELS[segment] || segment.replaceAll('-', ' '), to: accumulated });
    }
  });

  return (
    <nav aria-label="Fil d’Ariane" className="min-w-0 flex items-center gap-1 text-[12px] text-muted">
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        return (
          <span key={`${crumb.to}-${index}`} className="flex min-w-0 items-center gap-1">
            {index > 0 && <ChevronRight size={13} className="shrink-0 text-slate-300" />}
            {index === 0 && <Home size={13} className="shrink-0" />}
            {last ? (
              <b className="truncate text-ink font-bold" aria-current="page">{crumb.label}</b>
            ) : (
              <Link to={crumb.to} className="truncate hover:text-emerald-600">{crumb.label}</Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
