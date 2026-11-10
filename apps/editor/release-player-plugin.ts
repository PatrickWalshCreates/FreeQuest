// Makes the built release player (packages/player/dist) part of the editor:
// served at /player-release/ by the dev server, and copied into the
// editor's build so the desktop app can export games offline.
import { existsSync } from 'node:fs';
import { cp, readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

export const PLAYER_PATH = 'player-release';

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
};

export function releasePlayerPlugin(playerDist: string): Plugin {
  const root = resolve(playerDist);
  let outDir = '';
  return {
    name: 'freequest-release-player',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use(`/${PLAYER_PATH}`, (request, response) => {
        void (async () => {
          const path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname);
          const full = resolve(root, `.${path}`);
          if (!full.startsWith(root + sep) || !existsSync(full)) {
            response.statusCode = 404;
            response.end(
              existsSync(root)
                ? 'not found'
                : 'The release player is not built: run "pnpm --filter @freequest/player build".',
            );
            return;
          }
          response.setHeader('Content-Type', TYPES[extname(full)] ?? 'application/octet-stream');
          response.setHeader('Cache-Control', 'no-store');
          response.end(await readFile(full));
        })().catch((error: unknown) => {
          response.statusCode = 500;
          response.end(String(error));
        });
      });
    },
    async closeBundle() {
      if (!outDir) return;
      if (!existsSync(join(root, 'files.json'))) {
        throw new Error('Build @freequest/player before the editor (pnpm build does this).');
      }
      await cp(root, join(outDir, PLAYER_PATH), { recursive: true });
    },
  };
}
