import { readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { type Plugin, defaultClientConditions, defineConfig } from 'vite';

/**
 * Writes dist/files.json: every file of the player, so exporters can copy
 * it without listing directories (the editor reads it as a bundled asset).
 */
function fileList(): Plugin {
  let outDir = '';
  return {
    name: 'freequest-player-file-list',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const files = readdirSync(outDir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && e.name !== 'files.json')
        .map((e) => relative(outDir, join(e.parentPath, e.name)).split(sep).join('/'))
        .sort();
      writeFileSync(join(outDir, 'files.json'), `${JSON.stringify({ files }, null, 2)}\n`);
    },
  };
}

export default defineConfig({
  // Relative URLs: an exported game works from any folder of any host.
  base: './',
  plugins: [fileList()],
  resolve: { conditions: ['@freequest/source', ...defaultClientConditions] },
  build: {
    target: 'es2023',
    // One bundle is fine: the whole game loads before it starts anyway.
    chunkSizeWarningLimit: 2000,
    assetsDir: 'player',
  },
});
