// Dev-server file access for running the editor in a normal browser. Two
// areas, each a folder of folders: "samples" (the sample projects) and
// "exports" (where browser-mode exports go). Only active in `vite dev`.
//   GET    /__freequest/projects                       → ["demo-project", ...]
//   GET    /__freequest/<area>/fs/<folder>/<path>      → file contents
//   PUT    /__freequest/<area>/fs/<folder>/<path>      → write the request body
//   DELETE /__freequest/<area>/fs/<folder>/<path>      → delete the file
//   GET    /__freequest/<area>/list/<folder>[/<dir>]   → ["<dir>/a.png", ...] (recursive,
//                                                        relative to <folder>)
// Every path is confined to its area's folder.
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

const MIME: Record<string, string> = {
  '.json': 'application/json',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.html': 'text/html',
  '.js': 'text/javascript',
};

/**
 * Resolve `<folder>/<path...>` inside root, or null if it is not a safe
 * relative path. `minSegments` is 1 for a whole folder, 2 for a file in one.
 */
export function resolveInside(root: string, relative: string, minSegments = 2): string | null {
  const segments = relative.split('/');
  if (relative.includes('\\') || relative.includes('\0')) return null;
  if (segments.length < minSegments) return null;
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null;
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

function reply(response: ServerResponse, status: number, text = ''): void {
  response.statusCode = status;
  response.end(text);
}

export function devFsPlugin(areas: Readonly<Record<string, string>>): Plugin {
  const roots = new Map(Object.entries(areas).map(([name, dir]) => [name, resolve(dir)]));
  return {
    name: 'freequest-dev-fs',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__freequest', (request, response) => {
        void (async () => {
          const url = new URL(request.url ?? '/', 'http://localhost');
          const samples = roots.get('samples');
          if (url.pathname === '/projects' && request.method === 'GET' && samples) {
            const entries = await readdir(samples, { withFileTypes: true });
            const projects = entries
              .filter(
                (e) => e.isDirectory() && existsSync(resolve(samples, e.name, 'project.json')),
              )
              .map((e) => e.name)
              .sort();
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(projects));
            return;
          }
          const [, area = '', action = '', ...rest] = url.pathname.split('/');
          const root = roots.get(area);
          const rel = decodeURIComponent(rest.join('/'));
          if (!root) return reply(response, 404, 'no such area');

          if (action === 'list' && request.method === 'GET') {
            const dir = resolveInside(root, rel, 1);
            const folder = resolveInside(root, rel.split('/')[0] ?? '', 1);
            if (!dir || !folder) return reply(response, 400, 'bad path');
            const files = existsSync(dir)
              ? (await readdir(dir, { recursive: true, withFileTypes: true }))
                  .filter((e) => e.isFile())
                  .map((e) => relative(folder, resolve(e.parentPath, e.name)).split(sep).join('/'))
                  .sort()
              : [];
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(files));
            return;
          }
          if (action !== 'fs') return reply(response, 404, 'unknown action');
          const full = resolveInside(root, rel);
          if (!full) return reply(response, 400, 'bad path');
          if (request.method === 'GET') {
            if (!existsSync(full)) return reply(response, 404, 'not found');
            response.setHeader('Content-Type', MIME[extname(full)] ?? 'application/octet-stream');
            response.setHeader('Cache-Control', 'no-store');
            response.end(await readFile(full));
          } else if (request.method === 'DELETE') {
            await rm(full, { force: true });
            reply(response, 204);
          } else if (request.method === 'PUT') {
            await mkdir(dirname(full), { recursive: true });
            await writeFile(full, await body(request));
            reply(response, 204);
          } else reply(response, 405);
        })().catch((error: unknown) => reply(response, 500, String(error)));
      });
    },
  };
}
