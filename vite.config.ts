import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/* Où l'application est montée. « /msc/ » parce qu'elle est publiée sous un
   chemin, derrière un serveur web qui héberge déjà d'autres sites ; « / » le
   jour où elle a un domaine à elle — MSC_BASE=/ npm run build, sans toucher au
   code. Les barres obliques des deux côtés ne sont pas décoratives : Vite les
   attend, et `import.meta.env.BASE_URL` est concaténé tel quel côté client. */
const BASE = (() => {
  const brut = process.env.MSC_BASE ?? '/msc/';
  return `/${brut.replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');
})();

export default defineConfig({
  base: BASE,
  /* The plan server holds the Anthropic key; the browser never sees it. */
  server: {
    proxy: {
      /* Le serveur Node ne connaît que « /api/… » : il ignore où il est monté.
         En production c'est le relais qui retire le préfixe ; ici c'est ce
         rewrite, pour que développement et production voient la même chose. */
      [`${BASE}api`]: {
        target: process.env.PLAN_SERVER ?? 'http://localhost:8787',
        changeOrigin: true,
        rewrite: (chemin: string) => chemin.replace(BASE, '/'),
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon-32.png', 'favicon-64.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'MySmartCoach',
        short_name: 'MySmartCoach',
        description: "Plan d'entraînement adaptatif — semi, 10 km, Hyrox, natation.",
        lang: 'fr',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F6F9F8',
        theme_color: '#02C9A0',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        /* Une PWA installée est ouverte sur une route, pas sur un fichier :
           sans ce repli, /semaine hors réseau donne une page blanche. L'API en
           est exclue — elle n'a rien à faire dans le cache du service worker,
           l'application garde sa copie elle-même, dans IndexedDB, où elle peut
           la relire et l'effacer à la déconnexion. */
        navigateFallback: `${BASE}index.html`,
        navigateFallbackDenylist: [new RegExp(`^${BASE}api/`)],
        runtimeCaching: [
          {
            // Archivo / Inter / JetBrains Mono come from the design system's CDN.
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'msc-fonts',
              expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
