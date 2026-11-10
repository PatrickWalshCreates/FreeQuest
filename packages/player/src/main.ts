// The release player: loads the game from ./game/ next to this page and
// runs it full-window. No debug tools; problems are explained to players.
import { type ProjectSource, httpSource, startGame } from '@freequest/runtime';
import { isTauri } from '@tauri-apps/api/core';
import { isFullscreenKey, startProblem } from './messages.js';

const parent = document.getElementById('game');
const loading = document.getElementById('loading');
if (!parent || !loading) throw new Error('player page is missing its elements');

function showProblem(error: unknown): void {
  const problem = startProblem(error, location.protocol);
  const set = (id: string, text: string) => {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
  };
  set('problem-title', problem.title);
  set('problem-text', problem.text);
  set('problem-details', problem.details);
  document.title = problem.title;
  document.getElementById('problem')?.classList.add('shown');
  loading?.classList.add('done');
  console.error(error);
}

/** The game folder, with the page title set as soon as the manifest arrives. */
function gameSource(): ProjectSource {
  const source = httpSource(new URL('game/', location.href));
  return {
    async readJson(path) {
      const data = await source.readJson(path);
      const name = (data as { name?: unknown }).name;
      if (path === 'project.json' && typeof name === 'string') document.title = name;
      return data;
    },
    assetUrl: (path) => source.assetUrl(path),
  };
}

/** Inside the desktop player app (apps/player-desktop) rather than a browser. */
const desktop = isTauri();

window.addEventListener('keydown', (event) => {
  if (!isFullscreenKey(event)) return;
  event.preventDefault();
  if (desktop) void import('./desktop.js').then((d) => d.toggleDesktopFullscreen());
  else if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => undefined);
});

if (!desktop && location.protocol === 'file:') {
  showProblem(new Error('opened from file://'));
} else {
  try {
    if (desktop) await (await import('./desktop.js')).startDesktop(parent);
    else await startGame({ parent, project: gameSource() });
    loading.classList.add('done');
    parent.focus();
  } catch (error) {
    showProblem(error);
  }
}
