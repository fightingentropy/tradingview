import { defineConfig, type Plugin } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';
import webTsconfig from './tsconfig.json';

// The earnings proxy keeps no state, so dev runs the Worker's handler here
// rather than proxying production like the endpoints below.
const earningsCalendarDev = (): Plugin => ({
  name: 'earnings-calendar-dev',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/api/earnings-calendar', async (req, res) => {
      const { handleEarningsCalendarRequest } = await import('../worker/web-app.mjs');
      const response = await handleEarningsCalendarRequest(
        new Request(new URL(req.originalUrl ?? '/', 'http://localhost'), { method: req.method }),
      );
      res.statusCode = response.status;
      response.headers.forEach((value, name) => res.setHeader(name, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
  },
});

export default defineConfig(() => {
  return {
    plugins: [solidPlugin(), tailwindcss(), earningsCalendarDev()],
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
        '/api/news': {
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
  };
});
