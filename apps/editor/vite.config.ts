import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';
import { devFsPlugin } from './dev-fs-plugin.js';
import { releasePlayerPlugin } from './release-player-plugin.js';
import { templatesPlugin } from './templates-plugin.js';

export default defineConfig({
  plugins: [
    react(),
    devFsPlugin({
      samples: fileURLToPath(new URL('../../samples', import.meta.url)),
      // Browser-mode exports land here (git-ignored).
      projects: fileURLToPath(new URL('../../projects', import.meta.url)),
      exports: fileURLToPath(new URL('../../exports', import.meta.url)),
      // The built desktop players (read to export Windows and Linux games in browser mode).
      players: fileURLToPath(new URL('../player-desktop/dist', import.meta.url)),
    }),
    releasePlayerPlugin(fileURLToPath(new URL('../../packages/player/dist', import.meta.url))),
    templatesPlugin([
      { id: 'starter', dir: fileURLToPath(new URL('../../templates/starter', import.meta.url)) },
      {
        id: 'demo',
        dir: fileURLToPath(new URL('../../samples/demo-project', import.meta.url)),
        name: 'Demo',
        description:
          'The full FreeQuest demo: two maps, a quest, battles and a party member to learn from.',
      },
    ]),
  ],
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
