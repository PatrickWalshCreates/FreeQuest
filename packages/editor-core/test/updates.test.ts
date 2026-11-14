import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  UPDATE_MANIFEST_URL,
  changelogSection,
  compareVersions,
  shouldOfferUpdate,
  updateManifest,
} from '../src/updates.js';

describe('compareVersions', () => {
  it('orders versions by number, not text', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('0.3.0', '0.3.0')).toBe(0);
    expect(compareVersions('v1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareVersions('0.3', '0.3.0')).toBe(0);
  });

  it('puts a test build before its release', () => {
    expect(compareVersions('0.4.0-test.1', '0.4.0')).toBeLessThan(0);
    expect(compareVersions('0.4.0-test.1', '0.3.0')).toBeGreaterThan(0);
    expect(compareVersions('0.4.0-test.2', '0.4.0-test.1')).toBeGreaterThan(0);
  });
});

describe('shouldOfferUpdate', () => {
  it('offers newer versions the user hasn’t skipped', () => {
    expect(shouldOfferUpdate('0.3.0', '0.4.0', null)).toBe(true);
    expect(shouldOfferUpdate('0.3.0', '0.4.0', '0.4.0')).toBe(false);
    expect(shouldOfferUpdate('0.3.0', '0.4.1', '0.4.0')).toBe(true);
    expect(shouldOfferUpdate('0.3.0', '0.3.0', null)).toBe(false);
    expect(shouldOfferUpdate('0.4.0', '0.3.0', null)).toBe(false);
  });
});

describe('changelogSection', () => {
  it('finds one release’s notes in CHANGELOG.md', () => {
    const changelog = readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8');
    const notes = changelogSection(changelog, '0.2.0');
    expect(notes).toMatch(/^Events for real games/);
    expect(notes).not.toContain('## 0.1.0');
    expect(changelogSection(changelog, '0.1.0')).not.toBeNull();
    expect(changelogSection(changelog, '9.9.9')).toBeNull();
  });

  it('doesn’t take 0.2.0 for 0.2.0-test or 0.2.01', () => {
    const text = '## 0.2.01\n\nwrong\n\n## 0.2.0 (date)\n\nright\n';
    expect(changelogSection(text, '0.2.0')).toBe('right');
  });
});

describe('updateManifest', () => {
  it('names each system’s file in the release and its signature, leaving out unsigned ones', () => {
    const manifest = updateManifest({
      version: '0.3.0',
      notes: 'New things',
      date: new Date('2026-12-01T10:00:00Z'),
      downloadBase: 'https://github.com/o/r/releases/download/v0.3.0/',
      signatures: { 'darwin-aarch64': 'sig-mac\n', 'windows-x86_64': 'sig-win' },
    });
    expect(manifest).toEqual({
      version: '0.3.0',
      notes: 'New things',
      pub_date: '2026-12-01T10:00:00.000Z',
      platforms: {
        'darwin-aarch64': {
          signature: 'sig-mac',
          url: 'https://github.com/o/r/releases/download/v0.3.0/FreeQuest-Editor-0.3.0-macOS-AppleSilicon.app.tar.gz',
        },
        'windows-x86_64': {
          signature: 'sig-win',
          url: 'https://github.com/o/r/releases/download/v0.3.0/FreeQuest-Editor-0.3.0-Windows-setup.exe',
        },
      },
    });
  });
});

describe('the desktop editor’s updater', () => {
  it('reads the manifest this file names, checked with our public key', () => {
    const config = JSON.parse(
      readFileSync(
        new URL('../../../apps/editor/src-tauri/tauri.conf.json', import.meta.url),
        'utf8',
      ),
    ) as { plugins: { updater: { endpoints: string[]; pubkey: string } } };
    expect(config.plugins.updater.endpoints).toEqual([UPDATE_MANIFEST_URL]);
    // A minisign public key, base64 of its two-line text form.
    expect(atob(config.plugins.updater.pubkey)).toMatch(/^untrusted comment: minisign public key/);
  });
});
