import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Store, BarChart3, Users, Settings as SettingsIcon, ScrollText,
  Bell, ShieldCheck, Search, LogOut, Menu, X, ArrowRight,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import Breadcrumbs from './Breadcrumbs';

const mainNav = [
  { to: '/', label: 'Tableau de bord', icon: LayoutDashboard, end: true },
  { to: '/stores', label: 'Magasins', icon: Store },
  { to: '/reporting', label: 'Reporting', icon: BarChart3, perm: 'export_reports' },
  { to: '/settings', label: 'Paramètres', icon: SettingsIcon },
];
const adminNav = [
  { to: '/users', label: 'Utilisateurs', icon: Users, perm: 'manage_users' },
  { to: '/audit', label: 'Journal d\'activité', icon: ScrollText, perm: 'view_audit_page' },
];

const STORE_TABS = [
  { id: 'resume', label: 'Synthèse' },
  { id: 'devis', label: 'Demandes' },
  { id: 'budget', label: 'Budget', permission: 'view_budget' },
  { id: 'factures', label: 'Factures' },
  { id: 'planning', label: 'Planning' },
  { id: 'risques', label: 'Risques' },
  { id: 'reception', label: 'Documents' },
  { id: 'historique', label: 'Historique', adminOnly: true },
];

const EVENT_LABELS = {
  demande_soumise: 'Demande soumise', submitted: 'Demande soumise',
  validation_cdg: 'Validation CDG', validation_dd: 'Validation DD', validation_dg: 'Validation finale DG',
  validation_finale_dg: 'Validation finale DG', approved: 'Approuvé',
  rejet: 'Rejet / correction', rejected: 'Rejet / correction', correction: 'Correction demandée',
  revision_budget: 'Révision budget', budget_revision: 'Révision budget',
  annulation: 'Annulation', cancelled: 'Annulation',
  depassement: 'Dépassement', retard: 'Retard critique', overdue: 'Retard critique',
  date_ouverture: 'Date d’ouverture', opening_date: 'Date d’ouverture',
};

const normalize = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function notificationTarget(row) {
  const type = normalize(row.object_type || row.aggregate_type || row.event_type || row.event_key || '');
  const id = row.object_id || row.aggregate_id;
  if (['store', 'project', 'magasin'].some(key => type.includes(key)) && id) return `/stores/${id}`;
  if (type.includes('comparison') || type.includes('comparatif')) return id ? `/comparisons/${id}` : '/comparisons';
  if (type.includes('quote') || type.includes('devis')) return '/quotes';
  if (type.includes('demand') || type.includes('validation')) return '/demands';
  if (type.includes('budget')) {
    if (['store', 'project', 'magasin'].some(key => type.includes(key)) && id) return `/stores/${id}?tab=budget`;
    return '/stores';
  }
  if (type.includes('invoice') || type.includes('facture') || type.includes('payment')) return '/invoices';
  if (type.includes('risk') || type.includes('risque')) return '/risks';
  if (type.includes('opening') || type.includes('reception')) return '/site';
  return '/notifications';
}

export default function Layout() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState([]);
  const [showNotifs, setShowNotifs] = useState(false);

  useEffect(() => { api.get('/notifications').then(r => setNotifs(r.data)).catch(() => {}); }, [location.pathname]);

  const isStoreDetail = /^\/stores\/\d+$/.test(location.pathname);
  const storeTabs = STORE_TABS.filter(tab => (!tab.adminOnly || user?.role === 'admin') && (!tab.permission || can(tab.permission)));
  const requestedStoreTab = new URLSearchParams(location.search).get('tab') || 'resume';
  const activeStoreTab = storeTabs.some(tab => tab.id === requestedStoreTab) ? requestedStoreTab : 'resume';

  function selectStoreTab(tabId) {
    const params = new URLSearchParams(location.search);
    params.set('tab', tabId);
    navigate(`${location.pathname}?${params.toString()}`);
  }

  const initials = (user?.name || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const current = [...mainNav, ...adminNav].find(n => n.to === location.pathname)?.label || 'Magasins';
  const unreadCount = notifs.filter(n => !n.read && !n.read_at).length;

  async function markRead(id, target) {
    await api.patch(`/notifications/${id}/read`).catch(() => {});
    setNotifs(ns => ns.map(n => String(n.id) === String(id) ? { ...n, read: true, read_at: new Date().toISOString() } : n));
    if (target) { setShowNotifs(false); navigate(target); }
  }

  const navList = (items) => items.filter(i => !i.perm || can(i.perm)).map(n => (
    <NavLink
      key={n.to} to={n.to} end={n.end}
      onClick={() => setOpen(false)}
      className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition ${
        isActive ? 'bg-gold-500/15 text-gold-400' : 'text-emerald-50/70 hover:bg-white/5 hover:text-white'}`}
    >
      <n.icon size={18} strokeWidth={2} />{n.label}
    </NavLink>
  ));

  return (
    <div className="flex min-h-screen bg-canvas">
      {open && <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={`fixed lg:sticky top-0 h-screen w-[248px] z-40 bg-gradient-to-br from-forest-800 to-forest-900 text-white flex flex-col p-5 transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-3 px-2 pb-7 shrink-0">
          <div className="w-11 h-11 rounded-xl bg-white/95 p-1 shadow-lg border border-white/10">
            <img src="/logo-1707950070.jpg" alt="Safari" className="w-full h-full object-contain rounded-lg" />
          </div>
          <div><div className="font-extrabold tracking-wide leading-none">SAFARI</div><div className="text-[9px] uppercase tracking-[.18em] text-emerald-200/60 mt-1">Import · Export</div></div>
          <button className="ml-auto lg:hidden" onClick={() => setOpen(false)}><X size={18} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 sidebar-scroll">
          <div className="text-[10px] uppercase tracking-[.14em] text-emerald-200/40 font-bold px-3 mb-2">Espace de travail</div>
          <nav className="flex flex-col gap-1">{navList(mainNav)}</nav>

          <nav className="flex flex-col gap-1 mt-6">{navList(adminNav)}</nav>
        </div>

        <div className="shrink-0 border-t border-white/10 pt-4 mt-4">
          <div className="flex items-center gap-3 px-1">
            <div className="w-9 h-9 rounded-full bg-gold-500 text-forest-900 grid place-items-center text-[11px] font-extrabold">{initials}</div>
            <div className="min-w-0 flex-1"><div className="text-[12.5px] font-bold truncate">{user?.name}</div><div className="text-[10.5px] text-emerald-200/60">{user?.role} · {user?.role === 'admin' ? 'Administrateur' : 'Comité'}</div></div>
            <button onClick={async () => { await logout(); navigate('/login'); }} title="Déconnexion" className="p-1.5 rounded-lg hover:bg-white/10"><LogOut size={17} /></button>
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <header className="h-[70px] bg-white border-b border-line flex items-center gap-4 px-5 sm:px-7 sticky top-0 z-20">
          <button className="lg:hidden p-2 rounded-lg hover:bg-canvas" onClick={() => setOpen(true)}><Menu size={20} /></button>
          <div className="min-w-0 max-w-[440px] hidden sm:block"><Breadcrumbs fallbackLabel={current} /></div>
          <div className="ml-auto hidden md:flex items-center gap-2 bg-canvas border border-line rounded-xl px-3 py-2 w-56">
            <Search size={15} className="text-muted" /><input placeholder="Rechercher…" className="bg-transparent outline-none text-[12.5px] w-full" />
          </div>
          <div className="relative">
            <button onClick={() => setShowNotifs(s => !s)} aria-label={`Notifications${unreadCount ? `, ${unreadCount} non lues` : ''}`} className="relative w-10 h-10 rounded-xl border border-line grid place-items-center hover:bg-canvas">
              <Bell size={18} />
              {unreadCount > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 border-2 border-white text-white text-[9px] font-extrabold grid place-items-center">{unreadCount > 9 ? '9+' : unreadCount}</span>}
            </button>
            {showNotifs && (
              <div className="absolute right-0 top-12 w-[360px] max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-line z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-line font-extrabold text-sm flex items-center justify-between">
                  Notifications <span className="text-[10px] font-bold text-red-600">{unreadCount} non lue{unreadCount > 1 ? 's' : ''}</span>
                </div>
                <div className="max-h-80 overflow-auto">
                  {notifs.length === 0 && <div className="p-5 text-center text-muted text-[12px]">Aucune notification</div>}
                  {notifs.map(n => {
                    const isUnread = !n.read && !n.read_at;
                    const eventType = n.event_type || n.event_key || n.type || n.key || 'Événement';
                    return (
                      <button key={n.id} onClick={() => markRead(n.id, notificationTarget(n))} className={`w-full text-left px-4 py-3 border-b border-line/70 hover:bg-canvas ${isUnread ? 'bg-emerald-600/5' : ''}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="badge-ok !text-[9px]">{EVENT_LABELS[eventType] || String(eventType).replaceAll('_', ' ')}</span>
                          {isUnread && <span className="w-2 h-2 rounded-full bg-emerald-600 shrink-0" />}
                        </div>
                        <div className={`text-[12px] mt-1.5 ${isUnread ? 'font-bold' : 'font-semibold text-slate-600'}`}>{n.message || n.title || 'Notification'}</div>
                        {n.object_type && <div className="text-[10px] text-emerald-700 mt-0.5">Dossier : {n.object_type} #{n.object_id || n.aggregate_id || ''}</div>}
                        <div className="text-[10px] text-muted mt-1">{n.created_at || n.occurred_at ? new Date(n.created_at || n.occurred_at).toLocaleString('fr-FR') : '—'}</div>
                      </button>
                    );
                  })}
                </div>
                <button onClick={() => { setShowNotifs(false); navigate('/notifications'); }} className="w-full px-4 py-3 text-[12px] font-extrabold text-emerald-700 hover:bg-canvas flex items-center justify-center gap-1.5 border-t border-line">
                  Tout le centre <ArrowRight size={14} />
                </button>
              </div>
            )}
          </div>
          <div className="w-9 h-9 rounded-full bg-gold-500 text-forest-900 grid place-items-center text-[11px] font-extrabold">{initials}</div>
          <div className="hidden sm:flex items-center gap-1 text-[11.5px] font-bold text-muted"><ShieldCheck size={14} className="text-emerald-600" />{user?.role}</div>
        </header>

        {isStoreDetail && (
          <div className="bg-canvas/70 border-b border-line px-5 sm:px-7 pt-2">
            <div className="tabs" role="tablist">
              {storeTabs.map(tab => (
                <button key={tab.id} type="button" role="tab" aria-selected={activeStoreTab === tab.id}
                  className={`store-tab ${activeStoreTab === tab.id ? 'store-tab-active' : ''}`}
                  onClick={() => selectStoreTab(tab.id)}>
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <main className="p-5 sm:p-7 max-w-[1500px] mx-auto"><Outlet /></main>
      </div>
    </div>
  );
}
