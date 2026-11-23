import {
  type HostMessage,
  PLAYTEST_PROTOCOL,
  PlaytestHost,
  type PlaytestSource,
  readFrameMessage,
} from '@freequest/editor-core';
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
  /** Run the project's enabled plugins (the user agreed to). */
  readonly plugins: boolean;
  readonly onClose: () => void;
}

/** The sandboxed frame's page (playtest-frame-plugin.ts). */
const FRAME_URL = `${import.meta.env.BASE_URL}playtest/index.html`;

/**
 * Runs the game over the editor, on a snapshot of the unsaved document.
 * The game runs in a sandboxed iframe (an opaque origin: no access to the
 * editor, its files or Tauri), so plugins can run in playtests; it asks for
 * the project's files by message (`PlaytestHost`). Saves made while
 * playtesting live in memory and vanish when it closes.
 */
export function Playtest({ gameName, source, start, plugins, onClose }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const host = new PlaytestHost(source);
    let sentStart = false;
    const send = (target: Window, message: HostMessage) => {
      const value = message.type === 'reply' && message.ok ? message.value : null;
      const bytes =
        value && typeof value === 'object' && 'bytes' in value && value.bytes instanceof ArrayBuffer
          ? [value.bytes]
          : [];
      // The frame's origin is opaque ("null"), so "*" is the only target that reaches it.
      target.postMessage(message, '*', bytes);
    };
    const onMessage = (event: MessageEvent) => {
      const target = frame.current?.contentWindow;
      if (!target || event.source !== target) return;
      const message = readFrameMessage(event.data);
      if (!message) return;
      switch (message.type) {
        case 'ready':
          if (sentStart) return;
          sentStart = true;
          send(target, {
            protocol: PLAYTEST_PROTOCOL,
            type: 'start',
            options: { start: start && { map: start.map, x: start.x, y: start.y }, plugins },
          });
          frame.current?.focus();
          return;
        case 'request':
          void host.answer(message).then((reply) => send(target, reply));
          return;
        case 'failed':
          setError(message.message);
          return;
        case 'stop':
          close.current();
          return;
        case 'started':
          return;
      }
    };
    // Cmd/Ctrl+. stops (Escape belongs to the game: it opens the menu). The frame
    // forwards the same keys while it has the keyboard.
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === '.') {
        event.preventDefault();
        close.current();
      }
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('keydown', onKey);
    };
  }, [source, start, plugins]);

  return (
    <div className="playtest" role="dialog" aria-label="Playtest">
      <header>
        <strong>Playtest</strong>
        <span className="muted">
          {gameName} ·{' '}
          {start ? `from ${start.label} (${start.x}, ${start.y})` : 'from the title screen'} ·
          unsaved changes included · saves are discarded
          {plugins ? '' : ' · plugins off'}
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
        <iframe
          ref={frame}
          className="playtest-game"
          title="Playtest"
          src={FRAME_URL}
          // Scripts only: an opaque origin, no same-origin access, no popups,
          // forms, top navigation or modals.
          sandbox="allow-scripts"
          // Sound, and gamepads (a frame from another origin sees none without it).
          allow="autoplay; gamepad"
          referrerPolicy="no-referrer"
        />
      )}
    </div>
  );
}
