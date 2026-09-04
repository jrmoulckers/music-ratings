import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// Deliberately separate from vite.config.ts: no PWA / service-worker build in tests.
export default defineConfig({
  plugins: [svelte()],
  resolve: { conditions: ['browser'] },
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'https://rank.jrmoulckers.com/' } },
    setupFiles: ['src/test/setup.ts'],
    restoreMocks: true,
  },
});
