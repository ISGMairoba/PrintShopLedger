import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The app version a device reports to the developer console: the release's commit and build day.
const appVersion = `${(process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 7)} ${new Date().toISOString().slice(0, 10)}`;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'PrintShopLedger',
        short_name: 'PrintShopLedger',
        description: 'Business jobs and individual job payments',
        theme_color: '#124b40',
        background_color: '#f4f6f3',
        display: 'standalone',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,woff2}'], navigateFallback: '/index.html' },
    }),
  ],
});
