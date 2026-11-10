// What players are told when a game can't start. Free of DOM so it can be
// tested; main.ts shows it.

export interface StartProblem {
  readonly title: string;
  readonly text: string;
  /** The technical message, for a "Details" fold (useful in bug reports). */
  readonly details: string;
}

/** Explain why the game didn't start, in words for players rather than developers. */
export function startProblem(error: unknown, protocol: string): StartProblem {
  const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (protocol === 'file:') {
    return {
      title: 'This game needs to be opened from a website',
      text:
        'Browsers don’t let a page opened straight from your disk load the game’s files. ' +
        'Upload the whole folder to a web host (itch.io works), or play the desktop version.',
      details,
    };
  }
  if (/HTTP 404|Failed to fetch|NetworkError|Load failed/i.test(details)) {
    return {
      title: 'Some of the game’s files are missing',
      text:
        'The game couldn’t load all of its files. If you uploaded it yourself, make sure the ' +
        'whole folder was uploaded, including the “game” folder next to index.html.',
      details,
    };
  }
  return {
    title: 'This game couldn’t start',
    text: 'Something in the game’s data stopped it from starting. The details below can help its author fix it.',
    details,
  };
}

/** Keys that toggle fullscreen: F11, and Alt+Enter (common in desktop games). */
export function isFullscreenKey(event: {
  readonly key: string;
  readonly altKey: boolean;
}): boolean {
  return event.key === 'F11' || (event.altKey && event.key === 'Enter');
}
