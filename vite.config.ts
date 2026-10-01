import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cloudflare Workers sert l'app à la racine ("/"), GitHub Pages sous "/distance/".
// Le mode "pages" permet de garder le déploiement GitHub Pages fonctionnel.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'pages' ? '/distance/' : '/',
}));
