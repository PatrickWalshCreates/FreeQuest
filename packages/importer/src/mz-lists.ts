// MZ's numbered database lists (Actors.json, Skills.json…): arrays whose
// position is the entry's number, position 0 unused. Entries without a name
// are unused slots and are skipped; references to them are reported where
// they're found.
import type { ProjectFs } from '@freequest/editor-core';
import { NumberedIds } from './ids.js';
import { asArray, asString, isRecord, type JsonRecord } from './json.js';
import { readMzJson } from './mz-project.js';

export class MzList {
  /** Named entries by number. */
  readonly entries = new Map<number, JsonRecord>();
  readonly ids: NumberedIds;

  constructor(
    raw: unknown,
    prefix: string,
    /** Shared with another list that ends up in the same FreeQuest category. */
    taken: Set<string> = new Set(),
  ) {
    const names = [''];
    asArray(raw).forEach((entry, n) => {
      if (n === 0) return;
      const name = isRecord(entry) ? asString(entry['name']).trim() : '';
      names[n] = name;
      if (isRecord(entry) && name !== '') this.entries.set(n, entry);
    });
    for (let n = 1; n < names.length; n++) names[n] ??= '';
    this.ids = new NumberedIds(
      names.map((name, n) => (n > 0 && this.entries.has(n) ? name : '')),
      prefix,
      taken,
    );
  }

  has(n: number): boolean {
    return this.entries.has(n);
  }

  /** The id of entry `n`, or null when there is no such entry. */
  id(n: number): string | null {
    return this.entries.has(n) ? this.ids.id(n) : null;
  }

  /** Every named entry in number order, with its id and name. */
  *[Symbol.iterator](): Generator<{ n: number; id: string; name: string; entry: JsonRecord }> {
    for (const [n, entry] of [...this.entries].sort((a, b) => a[0] - b[0])) {
      yield { n, id: this.ids.id(n), name: asString(entry['name']).trim(), entry };
    }
  }
}

export interface MzDatabase {
  readonly actors: MzList;
  readonly classes: MzList;
  readonly skills: MzList;
  readonly items: MzList;
  readonly weapons: MzList;
  readonly armors: MzList;
  readonly states: MzList;
  readonly enemies: MzList;
  readonly troops: MzList;
}

const FILES = {
  actors: ['Actors', 'actor'],
  classes: ['Classes', 'class'],
  skills: ['Skills', 'skill'],
  items: ['Items', 'item'],
  states: ['States', 'state'],
  enemies: ['Enemies', 'enemy'],
  troops: ['Troops', 'troop'],
} as const;

export async function readMzDatabase(fs: ProjectFs): Promise<MzDatabase> {
  const read = (file: string) => readMzJson(fs, `data/${file}.json`);
  const lists: Partial<Record<keyof typeof FILES, MzList>> = {};
  for (const [key, [file, prefix]] of Object.entries(FILES) as [
    keyof typeof FILES,
    (typeof FILES)[keyof typeof FILES],
  ][]) {
    lists[key] = new MzList(await read(file), prefix);
  }
  // Weapons and armors are one FreeQuest category, so they share ids.
  const equipment = new Set<string>();
  const get = (key: keyof typeof FILES) => lists[key] ?? new MzList(null, key);
  return {
    actors: get('actors'),
    classes: get('classes'),
    skills: get('skills'),
    items: get('items'),
    states: get('states'),
    enemies: get('enemies'),
    troops: get('troops'),
    weapons: new MzList(await read('Weapons'), 'weapon', equipment),
    armors: new MzList(await read('Armors'), 'armor', equipment),
  };
}
