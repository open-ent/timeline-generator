import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Proxy de dev vers l'ENT local (traefik :8090)
const proxyTarget = { target: 'http://localhost:8090', changeOrigin: false };

export default defineConfig(({ mode }) => ({
  // Servi sous /timelinegenerator par entcore (cf. view/timelinegenerator-react.html -> /timelinegenerator/public/index.js)
  base: mode === 'production' ? '/timelinegenerator' : '',
  resolve: {
    dedupe: [
      'react',
      'react-dom',
      '@tanstack/react-query',
      'react-i18next',
      'i18next',
      'react-router-dom',
      '@open-ent/client',
      '@open-ent/react',
      '@open-ent/bootstrap',
    ],
  },
  build: {
    assetsDir: 'public',
    rollupOptions: {
      output: {
        // Noms DISTINCTS (`tlreact.*`) : le mod contient déjà un `public/index.js` (IHM edifice explorer)
        // qu'il ne faut PAS écraser. Ma vue référence /timelinegenerator/public/tlreact.js.
        entryFileNames: 'public/tlreact.js',
        chunkFileNames: 'public/tlreact-[name].js',
        assetFileNames: (info) =>
          info.name && info.name.endsWith('.css')
            ? 'public/tlreact.css'
            : 'public/tlreact-[name]-[hash][extname]',
      },
    },
  },
  server: {
    port: 4200,
    proxy: {
      '/timelinegenerator': proxyTarget,
      '^/(?=assets|theme|locale|i18n|skin)': proxyTarget,
      '^/(?=auth|userbook|directory|portal|session|timeline|workspace|infra|conf|applications-list)':
        proxyTarget,
    },
  },
  plugins: [react()],
}));
