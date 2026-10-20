import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Vite dev server configuration for MemorAid.
//
// The React SPA is served by Vite in development and talks to the Flask REST
// API. Requests to /api are proxied to the backend so the browser sees a single
// origin in development, which keeps cookies/headers simple and avoids CORS
// surprises during local work. In production the built assets in dist/ are
// served as static files by Flask (see backend/app.py).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
