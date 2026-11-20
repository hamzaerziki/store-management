import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
  timeout: 20000,
});

export function getToken() {
  return localStorage.getItem('safari_token') || sessionStorage.getItem('safari_token');
}

export function clearSession() {
  localStorage.removeItem('safari_token');
  localStorage.removeItem('safari_user');
  sessionStorage.removeItem('safari_token');
  sessionStorage.removeItem('safari_user');
}

api.interceptors.request.use(config => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401 && !err.config?.url?.includes('/auth/login')) {
      clearSession();
      window.location.href = '/login';
    }
    if (err.response?.status === 429) {
      return Promise.reject(err.response?.data?.error || 'Trop de requêtes. Veuillez réessayer dans quelques instants.');
    }
    return Promise.reject(err.response?.data?.error || err.message || 'Erreur réseau');
  }
);

export async function downloadReport(format) {
  const res = await api.get(`/reports/progress.${format}`, { responseType: 'blob' });
  const url = window.URL.createObjectURL(new Blob([res.data]));
  const a = document.createElement('a');
  a.href = url;
  a.download = `safari-progression.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export default api;
