import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';
import webTsconfig from './tsconfig.json';

export default defineConfig({
  plugins: [solidPlugin(), tailwindcss()],
  esbuild: {
    // Shared domain files use the web compiler settings, without requiring Expo.
    tsconfigRaw: JSON.stringify(webTsconfig),
  },
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api/daily-briefs': {
        target: 'https://trade.erlin.org',
        changeOrigin: true,
      },
      '/api/economic-calendar': {
        target: 'https://trade.erlin.org',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        // Only content-addressed assets enter this immutable cache directory.
        // The API-wallet session worker keeps its stable, revalidated URL above.
        entryFileNames: 'assets/static/[name]-[hash].js',
        chunkFileNames: 'assets/static/[name]-[hash].js',
        assetFileNames: 'assets/static/[name]-[hash][extname]',
        manualChunks: {
          'lightweight-charts': ['lightweight-charts'],
        },
      },
    },
    minify: 'esbuild',
  },
});
