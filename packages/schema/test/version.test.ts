// FreeQuest has one version: the root package.json's. Every other copy
// (packages, Tauri configs, Cargo files, the generated constant) must match;
// `pnpm version:set` keeps them in step.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GENERATED_VERSION_FILE,
  VERSION_PATTERN,
  sourceVersion,
  versionedFiles,
} from '../../../scripts/version-files.js';
import { FREEQUEST_VERSION } from '../src/index.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');

describe('FreeQuest version', () => {
  it('is a plain version number', () => {
    expect(sourceVersion(ROOT)).toMatch(VERSION_PATTERN);
    expect(VERSION_PATTERN.test('0.2.0-beta.1')).toBe(true);
    expect(VERSION_PATTERN.test('v0.2')).toBe(false);
  });

  it('is the same everywhere (run `pnpm version:set` after changing it)', () => {
    const version = sourceVersion(ROOT);
    const files = versionedFiles(ROOT);
    expect(files.map((f) => f.path)).toContain(GENERATED_VERSION_FILE);
    expect(files.length).toBeGreaterThan(12);
    for (const file of files) {
      expect(file.read(readFileSync(join(ROOT, file.path), 'utf8')), file.path).toBe(version);
    }
    expect(FREEQUEST_VERSION).toBe(version);
  });

  it('writes a version into each kind of file without touching anything else', () => {
    const files = versionedFiles(ROOT);
    for (const file of files) {
      const text = readFileSync(join(ROOT, file.path), 'utf8');
      const written = file.write(text, '9.8.7');
      expect(file.read(written), file.path).toBe('9.8.7');
      if (file.path !== GENERATED_VERSION_FILE) {
        expect(file.write(written, sourceVersion(ROOT)), file.path).toBe(text);
      }
    }
  });
});
