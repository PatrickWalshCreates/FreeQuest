import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';
import { devFsPlugin } from './dev-fs-plugin.js';

export default defineConfig({
  plugins: [react(), devFsPlugin(fileURLToPath(new URL('../../samples', import.meta.url)))],
  resolve: {
    // Resolve @freequest/* packages to their TypeScript sources: no prebuild needed.
    conditions: ['@freequest/source', ...defaultClientConditions],
  },
  // Tauri runs this dev server and expects a fixed port.
  clearScreen: false,
  server: { port: 5174, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  // A desktop app loads from disk, so one large bundle (PixiJS + React) is fine.
  build: { target: 'es2023', chunkSizeWarningLimit: 2000 },
});
