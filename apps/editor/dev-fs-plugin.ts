// Dev-server file access for running the editor in a normal browser.
// Serves and writes files of the sample projects under samples/:
//   GET  /__freequest/projects            → ["demo-project", ...]
//   GET  /__freequest/fs/<project>/<path> → file contents
//   PUT  /__freequest/fs/<project>/<path> → write the request body
//   DELETE /__freequest/fs/<project>/<path> → delete the file
//   GET  /__freequest/list/<project>/<dir> → ["<dir>/a.png", ...] (recursive)
// Only active in `vite dev` (never in a build), and confined to samples/.
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

const MIME: Record<string, string> = {
  '.json': 'application/json',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

/** Resolve `<project>/<path>` inside root, or null if it is not a safe relative path. */
export function resolveInside(root: string, relative: string): string | null {
  const segments = relative.split('/');
  if (relative.includes('\\') || relative.includes('\0')) return null;
  if (segments.length < 2 || segments.some((s) => s === '' || s === '.' || s === '..')) return null;
  const full = resolve(root, ...segments);
  return full.startsWith(root + sep) ? full : null;
}

function body(request: IncomingMessage): Promise<Buffer> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => done(Buffer.concat(chunks)));
    request.on('error', fail);
  });
}

export function devFsPlugin(samplesDir: string): Plugin {
  const root = resolve(samplesDir);
  return {
    name: 'freequest-dev-fs',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__freequest', (request, response) => {
        void (async () => {
          const url = new URL(request.url ?? '/', 'http://localhost');
          if (url.pathname === '/projects' && request.method === 'GET') {
            const entries = await readdir(root, { withFileTypes: true });
            const projects = entries
              .filter((e) => e.isDirectory() && existsSync(resolve(root, e.name, 'project.json')))
              .map((e) => e.name)
              .sort();
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(projects));
            return;
          }
          if (url.pathname.startsWith('/list/') && request.method === 'GET') {
            const rel = decodeURIComponent(url.pathname.slice('/list/'.length));
            const dir = resolveInside(root, rel);
            const project = resolveInside(root, `${rel.split('/')[0] ?? ''}/project.json`);
            if (!dir || !project) {
              response.statusCode = 400;
              response.end('bad path');
              return;
            }
            const base = dirname(project);
            const files = existsSync(dir)
              ? (await readdir(dir, { recursive: true, withFileTypes: true }))
                  .filter((e) => e.isFile())
                  .map((e) => relative(base, resolve(e.parentPath, e.name)).split(sep).join('/'))
                  .sort()
              : [];
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(files));
            return;
          }
          const prefix = '/fs/';
          const full = url.pathname.startsWith(prefix)
            ? resolveInside(root, decodeURIComponent(url.pathname.slice(prefix.length)))
            : null;
          if (!full) {
            response.statusCode = 400;
            response.end('bad path');
            return;
          }
          if (request.method === 'GET') {
            if (!existsSync(full)) {
              response.statusCode = 404;
              response.end('not found');
              return;
            }
            response.setHeader('Content-Type', MIME[extname(full)] ?? 'application/octet-stream');
            response.setHeader('Cache-Control', 'no-store');
            response.end(await readFile(full));
          } else if (request.method === 'DELETE') {
            await rm(full, { force: true });
            response.statusCode = 204;
            response.end();
          } else if (request.method === 'PUT') {
            await mkdir(dirname(full), { recursive: true });
            await writeFile(full, await body(request));
            response.statusCode = 204;
            response.end();
          } else {
            response.statusCode = 405;
            response.end();
          }
        })().catch((error: unknown) => {
          response.statusCode = 500;
          response.end(String(error));
        });
      });
    },
  };
}
