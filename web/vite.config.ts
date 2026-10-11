import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
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
