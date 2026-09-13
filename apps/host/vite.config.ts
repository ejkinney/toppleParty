import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * The host is the TV display. It is a plain SPA served under /host in
 * production so one Node process can hand out both pages.
 */
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@topple/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: { port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    // Rapier's wasm is the single biggest chunk; splitting it keeps the
    // first paint (lobby + QR code) fast while physics streams in behind it.
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          rapier: ['@dimforge/rapier3d-compat'],
        },
      },
    },
  },
});
