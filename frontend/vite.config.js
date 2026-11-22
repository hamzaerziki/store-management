import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://backend:4000',
        changeOrigin: true,
        xfwd: true,
      },
      '/uploads': {
        target: process.env.VITE_PROXY_TARGET || 'http://backend:4000',
        changeOrigin: true,
        xfwd: true,
      },
    },
  },
});
