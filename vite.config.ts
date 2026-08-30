import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Static hosts that serve `404.html` for unknown paths (GitHub Pages) need a
 * copy of the shell so deep links into the hand-rolled router resolve.
 */
function spa404(): Plugin {
  return {
    name: 'music-ratings-spa-404',
    apply: 'build',
    closeBundle() {
      const index = resolve('dist/index.html');
      if (existsSync(index)) copyFileSync(index, resolve('dist/404.html'));
    },
  };
}

export default defineConfig(({ mode }) => {
  const base = process.env.VITE_BASE_PATH ?? '/';
  return {
    base,
    plugins: [
      svelte(),
      spa404(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'offline-plate.svg'],
        manifest: {
          id: base,
          name: 'Ledger — private music ratings',
          short_name: 'Ledger',
          description:
            'A private reference edition of your own taste. Rate and rank your music locally, explain every score, keep the data yours.',
          start_url: base,
          scope: base,
          theme_color: '#e8e5dc',
          background_color: '#e8e5dc',
          display: 'standalone',
          orientation: 'any',
          categories: ['music', 'productivity', 'utilities'],
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            {
              src: 'pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
            { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          ],
          shortcuts: [
            { name: 'Rating queue', url: `${base}queue` },
            { name: 'Comparison', url: `${base}duel` },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          navigateFallback: `${base}index.html`,
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              // Artwork is remote, large, and replaceable: cache a bounded set.
              urlPattern: /^https:\/\/i\.scdn\.co\/image\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'artwork',
                expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
    define: {
      __APP_MODE__: JSON.stringify(mode),
    },
    build: {
      target: 'es2022',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('@azure/msal-browser')) return 'msal';
            return undefined;
          },
        },
      },
    },
    server: { host: '127.0.0.1', port: 5173 },
    preview: { host: '127.0.0.1', port: 4173 },
  };
});
