import { createContext, useContext, useState, useEffect } from 'react';
import api, { getToken, clearSession } from '../api/client';

const AuthContext = createContext(null);

function readUser() {
  try { return JSON.parse(localStorage.getItem('safari_user') || sessionStorage.getItem('safari_user')); }
  catch { return null; }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readUser);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    api.get('/auth/me')
      .then(me => {
        setUser(me.data);
        const store = localStorage.getItem('safari_token') ? localStorage : sessionStorage;
        store.setItem('safari_user', JSON.stringify(me.data));
      })
      .catch(() => clearSession())
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password, remember = true) {
    const { data } = await api.post('/auth/login', { email, password });
    clearSession();
    const store = remember ? localStorage : sessionStorage;
    store.setItem('safari_token', data.token);
    store.setItem('safari_user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }

  async function logout() {
    try { await api.post('/auth/logout'); } catch {}
    clearSession();
    setUser(null);
  }

  const can = permission => {
    const map = {
      admin: ['manage_users', 'manage_stores', 'edit_budget', 'manage_catalog', 'upload_quotes', 'manage_comparisons', 'update_items', 'view_quotes', 'financial_validation', 'final_validation', 'view_budget', 'view_audit', 'export_reports', 'manage_operations', 'view_demands', 'manage_demands', 'view_quotes_page', 'view_roles_page', 'view_audit_page'],
      IT: ['manage_catalog', 'upload_quotes', 'manage_comparisons', 'update_items', 'view_quotes', 'manage_operations', 'view_demands', 'manage_demands', 'view_quotes_page', 'view_roles_page'],
      MG: ['manage_catalog', 'upload_quotes', 'manage_comparisons', 'update_items', 'view_quotes', 'manage_operations', 'view_demands', 'manage_demands', 'view_quotes_page', 'view_roles_page'],
      RMG: ['view_quotes', 'financial_validation', 'dd_validation', 'view_budget', 'view_audit', 'export_reports', 'manage_operations', 'view_demands', 'manage_demands', 'upload_quotes', 'edit_budget'],
      CDG: ['view_quotes', 'financial_validation', 'cdg_validation', 'view_budget', 'view_audit', 'manage_operations', 'view_demands', 'upload_quotes'],
      CG: ['view_quotes', 'financial_validation', 'cdg_validation', 'view_budget', 'view_audit', 'manage_operations', 'view_demands', 'upload_quotes'],
      DD: ['view_quotes', 'financial_validation', 'dd_validation', 'view_budget', 'view_audit', 'export_reports', 'manage_operations', 'view_demands', 'manage_demands', 'upload_quotes', 'edit_budget', 'manage_stores'],
      DG: ['view_quotes', 'financial_validation', 'final_validation', 'view_budget', 'view_audit', 'export_reports', 'manage_operations', 'view_demands', 'edit_budget', 'upload_quotes'],
    };
    return !!(user && map[user.role]?.includes(permission));
  };

  return <AuthContext.Provider value={{ user, loading, login, logout, can }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
