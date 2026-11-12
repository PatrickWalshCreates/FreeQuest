// The desktop apps' content security policies must let the game load what
// their file layers hand it: the editor's playtest gets assets as blob: URLs
// (TauriFs) and fetches sounds from them; the desktop player reads its game
// through the asset protocol. A missing source silently mutes the game (the
// audio player skips files it can't load), as happened once in the editor.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');

function csp(app: string): Map<string, string[]> {
  const conf = JSON.parse(
    readFileSync(join(ROOT, 'apps', app, 'src-tauri', 'tauri.conf.json'), 'utf8'),
  ) as { app: { security: { csp: string } } };
  return new Map(
    conf.app.security.csp
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name = '', ...sources]) => [name, sources]),
  );
}

describe('desktop content security policies', () => {
  it('lets the editor fetch and show blob: assets (playtest sounds and images)', () => {
    const editor = csp('editor');
    for (const directive of ['connect-src', 'img-src', 'media-src']) {
      expect(editor.get(directive), directive).toContain('blob:');
    }
  });

  it('lets the desktop player fetch and show its game through the asset protocol', () => {
    const player = csp('player-desktop');
    for (const directive of ['connect-src', 'img-src', 'media-src']) {
      expect(player.get(directive), directive).toEqual(
        expect.arrayContaining(['asset:', 'http://asset.localhost']),
      );
    }
  });
});
