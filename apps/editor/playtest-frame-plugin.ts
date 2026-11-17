// The sandboxed playtest frame's page (M15 step 4), served at /playtest/.
//
// The frame has an opaque origin (`sandbox="allow-scripts"`), so every
// script it loads is a cross-origin request. Module scripts need CORS, which
// the desktop app's protocol only grants to the app's own origin, so the
// build bundles the frame as one classic script (`playtest/frame.js`, no CORS
// needed). In `vite dev` the page loads the TypeScript source as modules, and
// this plugin lets the frame (origin "null") load scripts, and nothing else.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Plugin, type ResolvedConfig, build } from 'vite';

/**
 * The desktop app's own origins (macOS and Linux, Windows). The frame's
 * scripts come from there; WebKit doesn't count them as 'self' in an opaque
 * origin, so both the app's policy and the frame's name them.
 */
export const APP_ORIGINS = ['tauri://localhost', 'http://tauri.localhost'];

/**
 * The frame's own policy, on top of the app's: no network at all (only the
 * blob URLs it makes from the editor's answers), scripts from the app
 * (`origins`) and blobs (plugin scripts), no frames, forms or workers.
 */
export const playtestFrameCsp = (origins: readonly string[]): string =>
  [
    "default-src 'none'",
    ["script-src 'self'", ...origins, 'blob:'].join(' '),
    "style-src 'unsafe-inline'",
    'img-src blob: data:',
    'media-src blob:',
    'connect-src blob:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

export function playtestFrameHtml(script: string, origins: readonly string[]): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${playtestFrameCsp(origins)}" />
    <title>Playtest</title>
    <style>
      html, body { margin: 0; height: 100%; overflow: hidden; background: #08090b; }
      #game { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; }
      #game canvas { outline: none; }
    </style>
  </head>
  <body>
    <div id="game"></div>
    ${script}
  </body>
</html>
`;
}

const ENTRY = 'src/playtest/frame.ts';

export function playtestFramePlugin(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'freequest-playtest-frame',
    configResolved(resolved) {
      config = resolved;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '').split('?')[0];
        if (path === '/playtest/' || path === '/playtest/index.html') {
          response.setHeader('Content-Type', 'text/html');
          response.setHeader('Cache-Control', 'no-store');
          // In dev the scripts come from this server (the page's own address).
          const origin = `http://${request.headers.host ?? 'localhost'}`;
          response.end(
            playtestFrameHtml(`<script type="module" src="/${ENTRY}"></script>`, [origin]),
          );
          return;
        }
        // The frame's module scripts: allowed for the opaque origin, scripts only.
        if (
          request.headers.origin === 'null' &&
          request.headers['sec-fetch-dest'] === 'script' &&
          !(path ?? '').startsWith('/__freequest')
        ) {
          response.setHeader('Access-Control-Allow-Origin', 'null');
        }
        next();
      });
    },
    async closeBundle() {
      if (config.command !== 'build') return;
      const outDir = join(config.root, config.build.outDir, 'playtest');
      await build({
        configFile: false,
        root: config.root,
        logLevel: 'warn',
        resolve: { conditions: [...config.resolve.conditions] },
        define: { 'process.env.NODE_ENV': JSON.stringify('production') },
        build: {
          target: 'es2023',
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          chunkSizeWarningLimit: 2000,
          lib: {
            entry: join(config.root, ENTRY),
            formats: ['iife'],
            name: 'FreeQuestPlaytest',
            fileName: () => 'frame.js',
          },
        },
      });
      await writeFile(
        join(outDir, 'index.html'),
        playtestFrameHtml('<script src="./frame.js"></script>', APP_ORIGINS),
      );
    },
  };
}
