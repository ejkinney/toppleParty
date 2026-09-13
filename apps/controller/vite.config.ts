import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * The controller is what phones load. `--host` in dev binds 0.0.0.0 so a phone
 * on the same Wi-Fi can reach it; in production the Node server serves it.
 */
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@topple/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: { port: 5174, strictPort: true, host: true },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
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
