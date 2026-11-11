// Bundles project templates with the editor (for "New project"): served at
// /project-templates/ by the dev server and copied into the editor's build,
// so the desktop app can create projects offline.
//   /project-templates/index.json        → [{ id, name, description, files }]
//   /project-templates/<id>/<path>       → a template file
import { existsSync, readFileSync } from 'node:fs';
import { cp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

export const TEMPLATES_PATH = 'project-templates';

export interface TemplateFolder {
  readonly id: string;
  readonly dir: string;
  /** Used when the folder has no template.json (e.g. the demo, which stays a plain project). */
  readonly name?: string;
  readonly description?: string;
}

async function filesOf(dir: string): Promise<string[]> {
  return (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort();
}

async function index(templates: readonly TemplateFolder[]) {
  return Promise.all(
    templates.map(async (t) => {
      const infoPath = join(t.dir, 'template.json');
      const info = existsSync(infoPath)
        ? (JSON.parse(readFileSync(infoPath, 'utf8')) as { name?: string; description?: string })
        : {};
      return {
        id: t.id,
        name: info.name ?? t.name ?? t.id,
        description: info.description ?? t.description ?? '',
        files: await filesOf(t.dir),
      };
    }),
  );
}

export function templatesPlugin(templates: readonly TemplateFolder[]): Plugin {
  const folders = templates.map((t) => ({ ...t, dir: resolve(t.dir) }));
  let outDir = '';
  return {
    name: 'freequest-project-templates',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use(`/${TEMPLATES_PATH}`, (request, response) => {
        void (async () => {
          const path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname);
          if (path === '/index.json') {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(await index(folders)));
            return;
          }
          const [, id = '', ...rest] = path.split('/');
          const folder = folders.find((f) => f.id === id);
          const full = folder ? resolve(folder.dir, ...rest) : '';
          if (!folder || !full.startsWith(folder.dir + sep) || !existsSync(full)) {
            response.statusCode = 404;
            response.end('not found');
            return;
          }
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
      for (const folder of folders) {
        await cp(folder.dir, join(outDir, TEMPLATES_PATH, folder.id), { recursive: true });
      }
      await writeFile(
        join(outDir, TEMPLATES_PATH, 'index.json'),
        JSON.stringify(await index(folders)),
      );
    },
  };
}
