import { fileURLToPath } from 'node:url';
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  // Serve samples/ as static files, so the demo lives at /demo-project/.
  publicDir: fileURLToPath(new URL('../../samples', import.meta.url)),
  resolve: {
    // Resolve @freequest/* packages to their TypeScript sources: no prebuild needed.
    conditions: ['@freequest/source', ...defaultClientConditions],
  },
  server: { port: 5173 },
});
