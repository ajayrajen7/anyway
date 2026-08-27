/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Session runner never awaits a network call (B2) — Workbox only needs
      // to keep the app shell installable and available offline, not cache API calls.
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: 'Anyway',
        short_name: 'Anyway',
        description: 'Prescription-and-logging PWA for a fixed 6-month training programme.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
  },
});
