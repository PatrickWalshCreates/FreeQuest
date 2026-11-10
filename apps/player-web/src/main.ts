import { startGame } from '@freequest/runtime';

const parent = document.getElementById('game');
if (!parent) throw new Error('#game element missing');

const projectUrl = new URL(`${import.meta.env.BASE_URL}demo-project/`, window.location.href);

try {
  const game = await startGame({ parent, project: projectUrl, debug: import.meta.env.DEV });
  if (import.meta.env.DEV) {
    // Handy for poking at state from the browser console.
    (window as unknown as { freequest: typeof game }).freequest = game;
  }
} catch (error) {
  const pre = document.createElement('pre');
  pre.id = 'error';
  pre.textContent = `FreeQuest failed to start:\n${error instanceof Error ? error.message : String(error)}`;
  parent.replaceChildren(pre);
  throw error;
}
