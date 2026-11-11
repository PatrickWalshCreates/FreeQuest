// `pnpm build:site`: the FreeQuest website, as static files in site-dist/
// (published with GitHub Pages by .github/workflows/pages.yml). It has a
// landing page with the downloads, the guides from docs/ as HTML, and the
// demo game exported for the web under play/, playable on the page. Every
// link is relative, so it works at any address. Needs the release player
// built (`pnpm build`).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { NodeFs } from '../packages/cli/src/node-fs.js';
import {
  type Block,
  type Inline,
  exportWeb,
  openProject,
  parseMarkdown,
  planExport,
  plainText,
} from '../packages/editor-core/src/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'site-dist');
const REPO = 'https://github.com/PatrickWalshCreates/FreeQuest';
const version = (
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }
).version;

/** The guides, and where they end up on the site. */
const GUIDES = [
  { file: 'getting-started.md', page: 'guide/getting-started.html', title: 'Getting started' },
  { file: 'exporting.md', page: 'guide/exporting.html', title: 'Exporting and sharing a game' },
];

/** The editor downloads: the release workflow names its files like this. */
const DOWNLOADS = [
  {
    system: 'Mac',
    detail: 'Apple silicon (M1 and later)',
    file: `FreeQuest-Editor-${version}-macOS-AppleSilicon.dmg`,
  },
  {
    system: 'Mac',
    detail: 'Intel (older Macs)',
    file: `FreeQuest-Editor-${version}-macOS-Intel.dmg`,
  },
  {
    system: 'Windows',
    detail: 'Windows 10 and 11',
    file: `FreeQuest-Editor-${version}-Windows-setup.exe`,
  },
  {
    system: 'Linux',
    detail: 'AppImage, most distributions',
    file: `FreeQuest-Editor-${version}-Linux-x86_64.AppImage`,
  },
  {
    system: 'Linux',
    detail: '.deb for Debian and Ubuntu',
    file: `FreeQuest-Editor-${version}-Linux-amd64.deb`,
  },
];

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A link in a guide: other guides become their pages, repo files their GitHub pages. */
function href(link: string, fromPage: string): string {
  if (/^(https?:|mailto:|#)/.test(link)) return link;
  const [file, hash] = link.split('#');
  const guide = GUIDES.find((g) => file && file.endsWith(g.file));
  const anchor = hash ? `#${hash}` : '';
  if (guide) return `${relative(fromPage, guide.page)}${anchor}`;
  return `${REPO}/blob/main/${(file ?? '').replace(/^\.\.\//, '')}${anchor}`;
}

/** A path from one site page to another (both relative to the site root). */
function relative(from: string, to: string): string {
  const depth = from.split('/').length - 1;
  return `${'../'.repeat(depth)}${to}`;
}

function inline(nodes: readonly Inline[], page: string): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case 'text':
          return escape(n.text);
        case 'code':
          // The guides write download names with "<version>": the site knows it.
          return `<code>${escape(n.text.replaceAll('<version>', version))}</code>`;
        case 'strong':
          return `<strong>${inline(n.children, page)}</strong>`;
        case 'em':
          return `<em>${inline(n.children, page)}</em>`;
        case 'link': {
          const url = href(n.href, page);
          const external = /^https?:/.test(url) ? ' rel="noopener"' : '';
          return `<a href="${escape(url)}"${external}>${inline(n.children, page)}</a>`;
        }
      }
    })
    .join('');
}

function block(b: Block, page: string): string {
  switch (b.type) {
    case 'heading': {
      const level = Math.min(b.level, 6);
      return `<h${level} id="${b.id}">${inline(b.content, page)}</h${level}>`;
    }
    case 'paragraph':
      return `<p>${inline(b.content, page)}</p>`;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      return `<${tag}>${b.items.map((i) => `<li>${inline(i, page)}</li>`).join('')}</${tag}>`;
    }
    case 'code':
      return `<pre><code>${escape(b.text)}</code></pre>`;
    case 'table':
      return [
        '<div class="table"><table><thead><tr>',
        ...b.header.map((c) => `<th>${inline(c, page)}</th>`),
        '</tr></thead><tbody>',
        ...b.rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c, page)}</td>`).join('')}</tr>`),
        '</tbody></table></div>',
      ].join('');
    case 'quote':
      return `<blockquote>${b.blocks.map((x) => block(x, page)).join('')}</blockquote>`;
  }
}

/** A whole page around some content. */
function layout(page: string, title: string, body: string, description: string): string {
  const to = (p: string) => relative(page, p);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<link rel="icon" href="${to('art/icon.png')}">
<link rel="stylesheet" href="${to('site.css')}">
</head>
<body>
<header class="top">
  <a class="brand" href="${to('index.html')}"><img src="${to('art/icon.png')}" alt="" width="28" height="28"> FreeQuest</a>
  <nav>
    <a href="${to('index.html#download')}">Download</a>
    <a href="${to('guide/getting-started.html')}">Guide</a>
    <a href="${to('index.html#demo')}">Play the demo</a>
    <a href="${REPO}" rel="noopener">GitHub</a>
  </nav>
</header>
${body}
<footer>
  <p>FreeQuest ${escape(version)} · free and open source under the
  <a href="${REPO}/blob/main/LICENSE" rel="noopener">MIT License</a> ·
  <a href="${REPO}" rel="noopener">source code</a> ·
  <a href="${REPO}/blob/main/CHANGELOG.md" rel="noopener">what's new</a></p>
  <p class="muted">An independent project, not affiliated with any other RPG maker. All art,
  music and sound are original.</p>
</footer>
</body>
</html>
`;
}

function guidePage(guide: (typeof GUIDES)[number]): string {
  const blocks = parseMarkdown(readFileSync(join(ROOT, 'docs', guide.file), 'utf8'));
  const sections = blocks.filter(
    (b): b is Extract<Block, { type: 'heading' }> => b.type === 'heading' && b.level === 2,
  );
  const others = GUIDES.map(
    (g) =>
      `<a href="${relative(guide.page, g.page)}"${g === guide ? ' aria-current="page"' : ''}>${escape(g.title)}</a>`,
  ).join('');
  const toc = sections
    .map((s) => `<li><a href="#${s.id}">${escape(plainText(s.content))}</a></li>`)
    .join('');
  const body = `<main class="guide-layout">
  <nav class="guide-nav">${others}<ul>${toc}</ul></nav>
  <article class="guide">${blocks.map((b) => block(b, guide.page)).join('\n')}</article>
</main>`;
  return layout(guide.page, `${guide.title} · FreeQuest`, body, `FreeQuest: ${guide.title}.`);
}

const FEATURES: [string, string][] = [
  [
    'Maps',
    'Paint tile maps in layers with a pencil, rectangles and fill, and see where the player can walk.',
  ],
  [
    'Events and NPCs',
    'Signs, doors, people who talk, wander, chase or follow a route, and events that run on their own.',
  ],
  [
    'Battles',
    'Turn-based fights with skills, items, states and enemies that pick their moves by the situation.',
  ],
  [
    'Your own art and sound',
    'Import images and sounds, cut tilesets and character sheets, pick icons, set music per map.',
  ],
  [
    'Play as you go',
    'Press Play at any moment, unsaved changes included, or start from any spot on the map.',
  ],
  [
    'Share it anywhere',
    'Export for the web (itch.io or any host), Windows, macOS and Linux, checked before it ships.',
  ],
];

function landing(): string {
  const downloads = DOWNLOADS.map(
    (d) => `<a class="download" href="${REPO}/releases/latest/download/${d.file}">
      <strong>${d.system}</strong><span>${escape(d.detail)}</span></a>`,
  ).join('');
  const features = FEATURES.map(
    ([title, text]) => `<div class="feature"><h3>${escape(title)}</h3><p>${escape(text)}</p></div>`,
  ).join('');
  const body = `<main>
<section class="hero">
  <div class="hero-text">
    <h1>Make classic 2D role-playing games.</h1>
    <p class="lead">FreeQuest is a free, open-source editor and engine. Paint maps, write events,
    design battles, and share your game on the web, Windows, macOS and Linux.</p>
    <p class="actions"><a class="button primary" href="#download">Download FreeQuest</a>
    <a class="button" href="#demo">Play the demo</a></p>
  </div>
  <div class="hero-art" aria-hidden="true"><span class="hero-sprite"></span><span class="hero-sprite mage"></span></div>
</section>

<section id="demo" class="demo">
  <h2>Play the demo</h2>
  <p>Made in FreeQuest and exported for the web. Click the game, then use the arrow keys to walk,
  Enter to talk and Escape for the menu.</p>
  <div class="game-frame"><iframe src="play/index.html" title="The FreeQuest demo game" loading="lazy" allow="fullscreen; autoplay"></iframe></div>
</section>

<section class="features">${features}</section>

<section id="download" class="downloads">
  <h2>Download the editor</h2>
  <p>FreeQuest ${escape(version)}. Free for anything, including selling your games.</p>
  <div class="download-grid">${downloads}</div>
  <p class="muted">The apps aren't signed by a registered developer yet, so your computer asks once
  before opening them: <a href="guide/getting-started.html#1-get-the-editor">here's what to click</a>.
  Older versions and the source are on the <a href="${REPO}/releases" rel="noopener">releases page</a>.</p>
</section>

<section class="next">
  <h2>Your first game in half an hour</h2>
  <p>The <a href="guide/getting-started.html">Getting started guide</a> walks from a new project to
  a game you can share: a map, someone to talk to, a door, your own art and a fight. Then
  <a href="guide/exporting.html">exporting</a> explains getting it to players.</p>
</section>
</main>`;
  return layout(
    'index.html',
    'FreeQuest: make classic 2D role-playing games',
    body,
    'FreeQuest is a free, open-source editor and engine for classic 2D role-playing games, with exports for the web, Windows, macOS and Linux.',
  );
}

async function exportDemo(): Promise<void> {
  const playerDir = join(ROOT, 'packages', 'player', 'dist');
  if (!existsSync(join(playerDir, 'files.json'))) {
    throw new Error('The release player is not built: run "pnpm build" first.');
  }
  const { files } = JSON.parse(readFileSync(join(playerDir, 'files.json'), 'utf8')) as {
    files: string[];
  };
  const source = new NodeFs(join(ROOT, 'samples', 'demo-project'));
  const project = await openProject(source);
  const plan = await planExport(project, source);
  if (plan.errors.length > 0) throw new Error(`The demo has problems: ${plan.errors[0]?.message}`);
  mkdirSync(join(OUT, 'play'), { recursive: true });
  await exportWeb({
    project,
    plan,
    source,
    target: new NodeFs(join(OUT, 'play')),
    player: {
      files,
      read: async (path) => new Uint8Array(readFileSync(join(playerDir, ...path.split('/')))),
    },
    freequestVersion: version,
  });
}

function write(path: string, text: string): void {
  const full = join(OUT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(join(ROOT, 'scripts', 'site', 'site.css'), join(OUT, 'site.css'));
// The demo's own art decorates the site.
mkdirSync(join(OUT, 'art'), { recursive: true });
for (const [from, to] of [
  ['samples/demo-project/assets/characters/hero.png', 'hero.png'],
  ['samples/demo-project/assets/characters/mage.png', 'mage.png'],
  ['apps/editor/src-tauri/icons/128x128.png', 'icon.png'],
] as const) {
  cpSync(join(ROOT, from), join(OUT, 'art', to));
}
// The grass tile (tile 0) on its own, for the hero's background.
const tiles = PNG.sync.read(
  readFileSync(join(ROOT, 'samples/demo-project/assets/tilesets/overworld.png')),
);
const grass = new PNG({ width: 32, height: 32 });
PNG.bitblt(tiles, grass, 0, 0, 32, 32, 0, 0);
writeFileSync(join(OUT, 'art', 'grass.png'), PNG.sync.write(grass));
write('index.html', landing());
for (const guide of GUIDES) write(guide.page, guidePage(guide));
// GitHub Pages: serve files as they are (no Jekyll).
write('.nojekyll', '');
await exportDemo();
console.log(`Built the site in ${OUT}`);
