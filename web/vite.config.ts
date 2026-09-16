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
        manualChunks: {
          'lightweight-charts': ['lightweight-charts'],
        },
      },
    },
    minify: 'esbuild',
  },
});
