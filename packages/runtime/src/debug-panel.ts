import type { World } from '@freequest/core';
import type { Manifest } from '@freequest/schema';
import { describeGame } from './debug-text.js';

const REFRESH_MS = 200;

/**
 * Developer overlay with the game state (party, inventory, switches,
 * variables). An HTML overlay, so it stays crisp at any scale. Toggle with F9.
 */
export function createDebugPanel(
  parent: HTMLElement,
  /** Read on every refresh, so the panel follows a new game's world. */
  getWorld: () => World,
  manifest: Manifest,
  toggleKey = 'F9',
): () => void {
  const panel = document.createElement('pre');
  Object.assign(panel.style, {
    position: 'absolute',
    top: '8px',
    left: '8px',
    margin: '0',
    padding: '8px 10px',
    maxHeight: 'calc(100% - 16px)',
    overflow: 'auto',
    font: '12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
    color: '#e8f0e0',
    background: 'rgba(10, 14, 20, 0.85)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '6px',
    pointerEvents: 'none',
    zIndex: '10',
    display: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  panel.setAttribute('aria-label', 'Debug panel');
  parent.appendChild(panel);

  let timer: ReturnType<typeof setInterval> | undefined;
  const refresh = () => {
    panel.textContent = `${describeGame(getWorld(), manifest)}\n\n${toggleKey}: hide`;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== toggleKey) return;
    e.preventDefault();
    const show = panel.style.display === 'none';
    panel.style.display = show ? 'block' : 'none';
    clearInterval(timer);
    if (show) {
      refresh();
      timer = setInterval(refresh, REFRESH_MS);
    }
  };
  window.addEventListener('keydown', onKey);

  return () => {
    clearInterval(timer);
    window.removeEventListener('keydown', onKey);
    panel.remove();
  };
}
