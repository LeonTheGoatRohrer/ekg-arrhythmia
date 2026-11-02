import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// Relative base so the built UI works from any sub-path (FastAPI serves web/dist at "/").
// The /api proxy is shared by `vite` (dev) and `vite preview` (preview.proxy defaults to server.proxy).
export default defineConfig({
  base: './',
  plugins: [tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
});
