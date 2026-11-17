// M15 step 4: the messages between the editor and its sandboxed playtest frame,
// and the guards around them (the frame runs plugin code, so it's untrusted).
import type { Manifest } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { isForeignRequest } from '../../../apps/editor/dev-fs-plugin.js';
import { APP_ORIGINS, playtestFrameCsp } from '../../../apps/editor/playtest-frame-plugin.js';
import {
  type FrameMessage,
  type HostMessage,
  PLAYTEST_PROTOCOL,
  PlaytestClient,
  PlaytestHost,
  ProjectDocument,
  enabledPlugins,
  mimeTypeFor,
  openProject,
  playtestSource,
  readFrameMessage,
  readHostMessage,
  readTrustedPlugins,
  trustPlugins,
  untrustedPlugins,
  writeTrustedPlugins,
  MAX_TRUSTED_PROJECTS,
  TRUSTED_PLUGINS_KEY,
} from '../src/index.js';
import { DEMO, memoryCopy } from './helpers.js';

const protocol = PLAYTEST_PROTOCOL;

/** A host and a client wired to each other, the way postMessage connects them. */
async function connected() {
  const fs = await memoryCopy(DEMO);
  await fs.writeText('plugins/rain/main.js', 'export default { setup() {} }');
  await fs.writeText('secret.txt', 'not for the game');
  const doc = new ProjectDocument(await openProject(fs));
  doc.update('data/maps/map001.json', 'map', 'Rename', (m) => ({ ...m, name: 'Unsaved' }));
  const host = new PlaytestHost(playtestSource(doc));
  const sent: FrameMessage[] = [];
  const client = new PlaytestClient((message) => {
    sent.push(message);
    const request = readFrameMessage(message);
    if (request?.type !== 'request') throw new Error('not a request');
    void host.answer(request).then((reply) => {
      // postMessage clones: the frame only ever sees a copy.
      const copy = readHostMessage(structuredClone(reply));
      if (copy) client.receive(copy);
    });
  });
  return { client, sent };
}

describe('the playtest bridge', () => {
  it('serves the snapshot’s JSON, unsaved edits included', async () => {
    const { client, sent } = await connected();
    expect(await client.readJson('data/maps/map001.json')).toMatchObject({ name: 'Unsaved' });
    expect(sent).toEqual([
      { protocol, type: 'request', id: 1, op: 'json', path: 'data/maps/map001.json' },
    ]);
  });

  it('serves assets and plugin scripts as bytes with their type', async () => {
    const { client } = await connected();
    const script = await client.readBytes('plugins/rain/main.js');
    expect(script.type).toBe('text/javascript');
    expect(new TextDecoder().decode(script.bytes)).toBe('export default { setup() {} }');
    const image = await client.readBytes('assets/pictures/meadow-map.png');
    expect(image.type).toBe('image/png');
    expect(image.bytes.byteLength).toBeGreaterThan(8);
  });

  it('refuses paths outside the project, other files and non-JSON as JSON', async () => {
    const { client } = await connected();
    await expect(client.readBytes('../outside.png')).rejects.toThrow(/invalid segment/);
    await expect(client.readBytes('/etc/passwd')).rejects.toThrow(/relative/);
    await expect(client.readBytes('secret.txt')).rejects.toThrow(/assets\/ and plugins\/ only/);
    await expect(client.readBytes('data/maps/map001.json')).rejects.toThrow(/only/);
    await expect(client.readJson('secret.txt')).rejects.toThrow(/not a JSON file/);
    await expect(client.readBytes('assets/none.png')).rejects.toThrow();
  });

  it('only reads well-formed messages from the frame, copying plain fields', () => {
    expect(readFrameMessage({ protocol, type: 'ready', extra: 1 })).toEqual({
      protocol,
      type: 'ready',
    });
    for (const bad of [
      null,
      'ready',
      { type: 'ready' },
      { protocol: 'other', type: 'ready' },
      { protocol, type: 'write', path: 'project.json' },
      { protocol, type: 'request', id: 1.5, op: 'json', path: 'a.json' },
      { protocol, type: 'request', id: 1, op: 'write', path: 'a.json' },
      { protocol, type: 'request', id: 1, op: 'json', path: 7 },
      { protocol, type: 'failed', message: { toString: () => 'x' } },
    ]) {
      expect(readFrameMessage(bad), JSON.stringify(bad)).toBeNull();
    }
    const long = readFrameMessage({ protocol, type: 'failed', message: 'x'.repeat(50_000) });
    expect(long?.type === 'failed' && long.message.length).toBe(10_000);
  });

  it('ignores replies nobody asked for, and messages that aren’t the editor’s', () => {
    const client = new PlaytestClient(() => undefined);
    const reply: HostMessage = { protocol, type: 'reply', id: 99, ok: true, value: 1 };
    expect(client.receive(reply)).toBe(false);
    expect(readHostMessage({ type: 'reply', id: 1 })).toBeNull();
  });

  it('gives blobs the types the frame needs', () => {
    expect(mimeTypeFor('plugins/a/src/main.mjs')).toBe('text/javascript');
    expect(mimeTypeFor('assets/audio/x.OGG')).toBe('audio/ogg');
    expect(mimeTypeFor('assets/x')).toBe('application/octet-stream');
  });
});

describe('the frame’s surroundings', () => {
  it('has no network but blob: URLs, and no frames, forms or workers', () => {
    const directives = new Map(
      playtestFrameCsp(APP_ORIGINS)
        .split(';')
        .map((d) => {
          const [name = '', ...sources] = d.trim().split(/\s+/);
          return [name, sources];
        }),
    );
    expect(directives.get('default-src')).toEqual(["'none'"]);
    expect(directives.get('connect-src')).toEqual(['blob:']);
    // WebKit doesn't count the app as 'self' in an opaque origin: it's named.
    expect(directives.get('script-src')).toEqual([
      "'self'",
      'tauri://localhost',
      'http://tauri.localhost',
      'blob:',
    ]);
  });

  it('is refused by the dev server’s file endpoints', () => {
    const host = 'localhost:5174';
    // The editor's own page.
    expect(isForeignRequest({ host, 'sec-fetch-site': 'same-origin' })).toBe(false);
    expect(isForeignRequest({ host, origin: 'http://localhost:5174' })).toBe(false);
    // curl, scripts, the address bar.
    expect(isForeignRequest({ host })).toBe(false);
    expect(isForeignRequest({ host, 'sec-fetch-site': 'none' })).toBe(false);
    // The sandboxed frame (origin "null", cross-site) and other sites.
    expect(isForeignRequest({ host, origin: 'null', 'sec-fetch-site': 'cross-site' })).toBe(true);
    expect(isForeignRequest({ host, origin: 'null' })).toBe(true);
    expect(isForeignRequest({ host, 'sec-fetch-site': 'same-site' })).toBe(true);
    expect(isForeignRequest({ host, origin: 'http://evil.example' })).toBe(true);
  });
});

describe('trusting plugins', () => {
  async function project(enabled: boolean[]) {
    const fs = await memoryCopy(DEMO);
    const manifest = JSON.parse(await fs.readText('project.json')) as Manifest;
    manifest.plugins = enabled.map((on, i) => ({
      id: `p${i}`,
      path: `plugins/p${i}/plugin.json`,
      enabled: on,
    }));
    for (const ref of manifest.plugins) {
      await fs.writeText(
        ref.path,
        JSON.stringify({
          formatVersion: 1,
          id: ref.id,
          name: `Plugin ${ref.id}`,
          version: '2.0.0',
          apiVersion: 1,
          entry: 'main.js',
          settings: [],
          commands: [],
        }),
      );
      await fs.writeText(ref.path.replace('plugin.json', 'main.js'), '');
    }
    await fs.writeText('project.json', JSON.stringify(manifest));
    return openProject(fs);
  }

  it('asks about turned-on plugins the user hasn’t agreed to for this project', async () => {
    const plugins = enabledPlugins(await project([true, false, true]));
    expect(plugins).toEqual([
      { id: 'p0', name: 'Plugin p0', version: '2.0.0' },
      { id: 'p2', name: 'Plugin p2', version: '2.0.0' },
    ]);
    let trusted = trustPlugins(new Map(), '/games/a', ['p0']);
    expect(untrustedPlugins(trusted, '/games/a', plugins).map((p) => p.id)).toEqual(['p2']);
    expect(untrustedPlugins(trusted, '/games/b', plugins)).toHaveLength(2);
    trusted = trustPlugins(trusted, '/games/a', ['p2']);
    expect(untrustedPlugins(trusted, '/games/a', plugins)).toEqual([]);
    expect(enabledPlugins(await project([]))).toEqual([]);
  });

  it('keeps answers in storage, ignoring damage, and forgets the oldest past the cap', () => {
    const items = new Map<string, string>();
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    };
    let trusted = readTrustedPlugins(storage);
    for (let i = 0; i <= MAX_TRUSTED_PROJECTS; i++)
      trusted = trustPlugins(trusted, `/g${i}`, ['x']);
    writeTrustedPlugins(storage, trusted);
    const read = readTrustedPlugins(storage);
    expect(read.size).toBe(MAX_TRUSTED_PROJECTS);
    expect(read.has('/g0')).toBe(false);
    expect(read.get('/g1')).toEqual(['x']);

    items.set(TRUSTED_PLUGINS_KEY, '{ broken');
    expect(readTrustedPlugins(storage).size).toBe(0);
    items.set(TRUSTED_PLUGINS_KEY, JSON.stringify([['/a', ['ok', 3]], ['', []], 'junk']));
    expect([...readTrustedPlugins(storage)]).toEqual([['/a', ['ok']]]);
  });
});
