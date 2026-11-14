import { MemoryFs, openProject } from '@freequest/editor-core';
import { describe, expect, it } from 'vitest';
import {
  IMPORT_REPORT_FILE,
  ImportReport,
  MzProjectError,
  NumberedIds,
  SystemTypes,
  importMzProject,
  readMzProject,
} from '../src/index.js';
import { TINY, codec, memoryCopy, starter } from './helpers.js';

describe('reading an MZ project', () => {
  it('reads the settings and the map list in the editor’s order', async () => {
    const report = new ImportReport();
    const mz = await readMzProject(await memoryCopy(TINY), report);
    expect(mz.system).toMatchObject({
      title: 'Lantern Hollow',
      currency: 'Coins',
      screen: { width: 640, height: 480 },
      tileSize: 48,
      start: { map: 1, x: 5, y: 6 },
      party: [1, 2],
    });
    expect(mz.system.elements).toEqual(['', 'Physical', 'Fire', '', 'Ice']);
    // MapInfos starts with a byte-order mark and has holes for deleted maps.
    expect(mz.maps.map((m) => [m.id, m.name, m.parent])).toEqual([
      [3, "Keeper's house", 1],
      [1, 'Hollow', 0],
    ]);
    expect(report.items).toEqual([]);
  });

  it('refuses a folder without data/System.json', async () => {
    const fs = new MemoryFs({ 'readme.txt': 'hi' });
    await expect(readMzProject(fs, new ImportReport())).rejects.toThrow(MzProjectError);
    await expect(readMzProject(fs, new ImportReport())).rejects.toThrow(/game\.rmmzproject/);
  });

  it('says so when broken JSON stops it', async () => {
    const fs = new MemoryFs({ 'data/System.json': '{ nope' });
    await expect(readMzProject(fs, new ImportReport())).rejects.toThrow(
      /System\.json isn't valid JSON/,
    );
  });

  it('notes an MV project, and fills in what’s missing or the wrong type', async () => {
    const fs = new MemoryFs({
      'Game.rpgproject': 'RPGMV 1.6.2',
      'data/System.json': JSON.stringify({ gameTitle: 7, switches: 'no', tileSize: -1 }),
    });
    const report = new ImportReport();
    const mz = await readMzProject(fs, report);
    expect(mz.system).toMatchObject({
      title: '',
      switches: [''],
      tileSize: 48,
      screen: { width: 816, height: 624 },
    });
    expect(report.items.map((i) => i.message).join('\n')).toMatch(/RPG Maker MV project/);
    expect(report.items.map((i) => i.where)).toEqual(['Project', 'Project', 'Maps']);
  });
});

describe('ids for numbered things', () => {
  it('come from names, unnamed ones from the number, and never clash', () => {
    const taken = new Set<string>();
    const switches = new NumberedIds(
      ['', 'Met the keeper', '', 'Gate open', '門', 'Gate open'],
      'switch',
      taken,
    );
    const variables = new NumberedIds(
      ['', 'Lanterns lit', '', 'Met the keeper'],
      'variable',
      taken,
    );
    expect([1, 3, 4, 5].map((n) => switches.id(n))).toEqual([
      'met-the-keeper',
      'gate-open',
      'switch-4',
      'gate-open-2',
    ]);
    expect(variables.id(3)).toBe('met-the-keeper-2');
    // Unnamed and unused: not declared. Used, or past the list: declared with a made-up name.
    expect(switches.declarations('Switch').map((d) => d.id)).toEqual([
      'met-the-keeper',
      'gate-open',
      'switch-4',
      'gate-open-2',
    ]);
    expect(switches.id(9)).toBe('switch-9');
    switches.id(2);
    expect(switches.declarations('Switch')).toContainEqual({ id: 'switch-2', name: 'Switch 2' });
    expect(switches.declarations('Switch')).toContainEqual({ id: 'switch-9', name: 'Switch 9' });
  });

  it('don’t depend on the order things are used in', () => {
    const a = new NumberedIds(['', '', 'Switch 1'], 'switch', new Set());
    const b = new NumberedIds(['', '', 'Switch 1'], 'switch', new Set());
    a.id(1);
    b.id(2);
    expect([a.id(1), a.id(2)]).toEqual([b.id(1), b.id(2)]);
  });
});

describe('system types', () => {
  it('turns MZ’s lists into system.json lists', async () => {
    const mz = await readMzProject(await memoryCopy(TINY), new ImportReport());
    const types = new SystemTypes(mz.system);
    expect(types.elements.id(4)).toBe('ice');
    const lists = types.lists();
    expect(lists.currency).toBe('Coins');
    expect(lists.elements.map((e) => e.id)).toEqual(['physical', 'fire', 'ice']);
    expect(lists.skillTypes).toEqual([
      { id: 'spells', name: 'Spells' },
      { id: 'arts', name: 'Arts' },
    ]);
    // Weapon "Shield" and armor "Shield" share one list, so they can't share an id.
    expect(lists.equipmentTypes.map((t) => t.id)).toEqual([
      'sword',
      'shield',
      'bow',
      'light-armor',
      'shield-2',
    ]);
    expect(lists.equipmentSlots.map((s) => s.id)).toEqual([
      'weapon',
      'shield',
      'head',
      'body',
      'accessory',
    ]);
  });
});

describe('importing a project', () => {
  it('makes a FreeQuest project that opens with no problems, leaving the MZ folder alone', async () => {
    const source = await memoryCopy(TINY);
    const before = new Map([...source.binaries].map(([p, b]) => [p, [...b].join()]));
    const target = new MemoryFs({}, 'imported');
    const progress: number[] = [];
    const result = await importMzProject(source, target, {
      template: await starter(),
      images: codec,
      onProgress: (done, total) => progress.push(done / total),
    });
    expect(result).toMatchObject({ name: 'Lantern Hollow', id: 'lantern-hollow' });
    expect(progress.at(-1)).toBe(1);

    const project = await openProject(target);
    expect(project.problems).toEqual([]);
    const manifest = project.manifest.data;
    expect(manifest).toMatchObject({
      name: 'Lantern Hollow',
      id: 'lantern-hollow',
      screen: { width: 640, height: 480 },
    });
    expect(manifest.switches).toEqual([
      { id: 'met-the-keeper', name: 'Met the keeper' },
      { id: 'gate-open', name: 'Gate open' },
      { id: 'switch-4', name: '門' },
      { id: 'gate-open-2', name: 'Gate open' },
    ]);
    expect(manifest.variables).toEqual([
      { id: 'lanterns-lit', name: 'Lanterns lit' },
      { id: 'met-the-keeper-2', name: 'Met the keeper' },
    ]);
    expect(await target.readText(IMPORT_REPORT_FILE)).toMatch(/^# Importing “Lantern Hollow”/);
    expect(new Map([...source.binaries].map(([p, b]) => [p, [...b].join()]))).toEqual(before);
    expect(source.files.size).toBe(0);
  });

  it('takes a name and id, and only writes into an empty folder', async () => {
    const source = await memoryCopy(TINY);
    const result = await importMzProject(source, new MemoryFs(), {
      template: await starter(),
      images: codec,
      name: 'Hollow Again',
    });
    expect(result.id).toBe('hollow-again');
    const busy = new MemoryFs({ 'notes.txt': 'mine' });
    await expect(
      importMzProject(source, busy, { template: await starter(), images: codec }),
    ).rejects.toThrow(/empty folder/);
    expect([...busy.files.keys()]).toEqual(['notes.txt']);
  });
});

describe('the report', () => {
  it('groups items and keeps names from turning into formatting', () => {
    const report = new ImportReport();
    expect(report.toMarkdown('Import')).toContain('Everything was imported.');
    report.note('Project', 'A note');
    report.missing('Map 1 (*Town*)', 'Script call left as a comment');
    expect(report.toMarkdown('Import')).toBe(
      [
        '# Import',
        '',
        '## Not imported (1)',
        '',
        '- **Map 1 (\\*Town\\*)**: Script call left as a comment',
        '',
        '## Notes (1)',
        '',
        '- **Project**: A note',
        '',
      ].join('\n'),
    );
  });
});
