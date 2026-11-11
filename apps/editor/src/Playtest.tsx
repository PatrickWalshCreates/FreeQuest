import type { PlaytestSource } from '@freequest/editor-core';
import { type Game, MemoryStorage, startGame } from '@freequest/runtime';
import { useEffect, useRef, useState } from 'react';
import { MOD } from './keys.js';

export interface PlaytestStart {
  readonly map: string;
  readonly x: number;
  readonly y: number;
  /** Shown in the title bar, e.g. the map's name. */
  readonly label: string;
}

interface Props {
  readonly gameName: string;
  readonly source: PlaytestSource;
  /** Start here instead of at the title screen. */
  readonly start: PlaytestStart | null;
  readonly onClose: () => void;
}

/**
 * Runs the game over the editor, on a snapshot of the unsaved document.
 * Saves made while playtesting live in memory and vanish when it closes,
 * so they never mix with real save files.
 */
export function Playtest({ gameName, source, start, onClose }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    shell.current?.focus();
    let alive = true;
    let game: Game | null = null;
    startGame({
      parent,
      project: source,
      debug: true,
      saveStorage: new MemoryStorage(),
      ...(start ? { start: { map: start.map, x: start.x, y: start.y }, skipTitle: true } : {}),
    }).then(
      (started) => {
        if (alive) game = started;
        else started.destroy();
      },
      (e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      },
    );
    // Cmd/Ctrl+. stops (Escape belongs to the game: it opens the menu).
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === '.') {
        event.preventDefault();
        close.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      alive = false;
      window.removeEventListener('keydown', onKey);
      game?.destroy();
    };
  }, [source, start]);

  return (
    <div className="playtest" ref={shell} tabIndex={-1} role="dialog" aria-label="Playtest">
      <header>
        <strong>Playtest</strong>
        <span className="muted">
          {gameName} ·{' '}
          {start ? `from ${start.label} (${start.x}, ${start.y})` : 'from the title screen'} ·
          unsaved changes included · saves are discarded
        </span>
        <span className="spacer" />
        <span className="muted keys">Arrows move · Enter talks · Esc menu · F9 debug</span>
        <button className="primary" onClick={onClose} title={`Stop playtesting (${MOD}.)`}>
          Stop
        </button>
      </header>
      {error ? (
        <div className="playtest-error">
          <h2>The game couldn’t start</h2>
          <pre className="error">{error}</pre>
          <p className="muted">Fix the problems listed in the editor, then try again.</p>
        </div>
      ) : (
        <div className="playtest-game" ref={host} />
      )}
    </div>
  );
}
