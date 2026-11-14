// Where things are used: one index of every id (and asset path) a project's
// files refer to, with the file, the exact place in its data, and a readable
// description of where it is. "Used by" lists and delete warnings read it;
// renaming (M12 step 3) rewrites the places it records.
//
// Which fields hold which kind of id is decided by field name, the same rule
// the editor's forms use for their dropdowns (see `refKind`), so a new field
// with a familiar name is indexed for free. Keep the two in step.
import { ATTACK_ELEMENT, type DatabaseKind, SOUND_KEYS, parseTextCodes } from '@freequest/schema';
import { DATABASE_LABELS } from './database-edits.js';
import type { OpenedProject } from './open-project.js';

export type RefKind =
  | 'switch'
  | 'variable'
  | 'map'
  | 'tileset'
  | 'character'
  | 'actor'
  | 'class'
  | 'skill'
  | 'item'
  | 'equipment'
  | 'state'
  | 'enemy'
  | 'troop'
  | 'commonEvent'
  | 'element'
  | 'equipmentSlot'
  | 'equipmentType'
  | 'skillType'
  /** An event on a map: ids are "<map id>/<event id>". */
  | 'event'
  /** A file under assets/, by its project path. */
  | 'asset';

/** A step into a file's data: an object key or an array index. */
export type DataPath = readonly (string | number)[];

export interface Reference {
  readonly kind: RefKind;
  /** The id referred to (for events "<map>/<event>", for assets the path). */
  readonly id: string;
  /** The project file it's in. */
  readonly file: string;
  /** Where in that file's data the value is (the string itself, or the text holding a code). */
  readonly path: DataPath;
  /** Readable place: "Meadow › House door (page 1)", "Actors › Hero", "Project settings". */
  readonly where: string;
  /** The id sits inside a text code in this string (a message, speaker or choice label). */
  readonly inText?: true;
  /** An object key rather than a value (an actor's equipment slots). */
  readonly isKey?: true;
}

/** Fields holding asset paths (images, music, sounds). */
const ASSET_FIELDS = new Set<string>([
  'image',
  'music',
  'path',
  'titleMusic',
  'battleMusic',
  'victoryMusic',
  'gameOverMusic',
  ...SOUND_KEYS,
]);

/** Fields whose name says which kind of id they hold. */
const FIELD_KINDS: Readonly<Record<string, RefKind>> = {
  switch: 'switch',
  variable: 'variable',
  map: 'map',
  tileset: 'tileset',
  character: 'character',
  actor: 'actor',
  party: 'actor',
  class: 'class',
  skill: 'skill',
  attackSkill: 'skill',
  guardSkill: 'skill',
  state: 'state',
  enemies: 'enemy',
  troop: 'troop',
  common: 'commonEvent',
  element: 'element',
  slot: 'equipmentSlot',
  equipmentType: 'equipmentType',
  skillType: 'skillType',
};

/** The kind of id a string at `key` (in `parent`) holds, or null if it isn't one. */
function refKind(
  key: string,
  value: string,
  parent: Readonly<Record<string, unknown>>,
): RefKind | null {
  if (key === 'id') {
    // Only an id next to a `kind` points elsewhere (an item or equipment); entries' own ids don't.
    const kind = parent['kind'];
    return kind === 'item' || kind === 'equipment' ? kind : null;
  }
  if (key === 'element' && value === ATTACK_ELEMENT) return null;
  if (key === 'target' || key === 'event') return 'event';
  if (ASSET_FIELDS.has(key)) return value.startsWith('assets/') ? 'asset' : null;
  return FIELD_KINDS[key] ?? null;
}

/** Text fields that may hold codes naming ids. */
const TEXT_FIELDS = new Set(['text', 'speaker', 'label']);

/** Manifest keys that declare things (not uses of them). */
const DECLARATIONS = new Set([
  'maps',
  'tilesets',
  'characters',
  'switches',
  'variables',
  'database',
]);

const TEXT_CODE_KINDS: Readonly<Record<string, RefKind>> = {
  v: 'variable',
  actor: 'actor',
  item: 'item',
  equipment: 'equipment',
};

type Emit = (ref: Omit<Reference, 'file' | 'where'>, path: DataPath) => void;

/** Visit every reference in a piece of data. `mapId` scopes event ids (`target`, `event`). */
function walk(value: unknown, path: DataPath, mapId: string | null, emit: Emit): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, [...path, i], mapId, emit));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const obj = value as Readonly<Record<string, unknown>>;
  const isComment = obj['type'] === 'comment';
  for (const [key, child] of Object.entries(obj)) {
    const here = [...path, key];
    if (typeof child === 'string') {
      const kind = refKind(key, child, obj);
      if (kind === 'event') {
        // Move routes aim at "player" or "this" as well as at events on the map.
        if (mapId && child !== 'player' && child !== 'this')
          emit({ kind, id: `${mapId}/${child}`, path: here }, here);
      } else if (kind) emit({ kind, id: child, path: here }, here);
      else if (TEXT_FIELDS.has(key) && !isComment) {
        for (const token of parseTextCodes(child).tokens) {
          const codeKind = token.kind === 'code' ? TEXT_CODE_KINDS[token.name] : undefined;
          if (codeKind && token.kind === 'code' && token.arg) {
            emit({ kind: codeKind, id: token.arg, path: here, inText: true }, here);
          }
        }
      }
    } else if (Array.isArray(child) && (key === 'party' || key === 'enemies')) {
      const kind = FIELD_KINDS[key] ?? 'actor';
      child.forEach((id, i) => {
        if (typeof id === 'string') emit({ kind, id, path: [...here, i] }, [...here, i]);
      });
    } else if (key === 'equipment' && child && typeof child === 'object' && !Array.isArray(child)) {
      // An actor's starting equipment: slot → equipment id.
      for (const [slot, id] of Object.entries(child as Record<string, unknown>)) {
        emit({ kind: 'equipmentSlot', id: slot, path: [...here, slot], isKey: true }, [
          ...here,
          slot,
        ]);
        if (typeof id === 'string')
          emit({ kind: 'equipment', id, path: [...here, slot] }, [...here, slot]);
      }
    } else walk(child, here, mapId, emit);
  }
}

/** The readable place of a data path in a map: the event and page, or the map itself. */
function mapPlace(
  map: { name?: string; events?: readonly { name?: string }[] },
  mapId: string,
  path: DataPath,
): string {
  const name = map.name || mapId;
  if (path[0] === 'events' && typeof path[1] === 'number') {
    const event = map.events?.[path[1]]?.name ?? `event ${path[1] + 1}`;
    return path[2] === 'pages' && typeof path[3] === 'number'
      ? `${name} › ${event} (page ${path[3] + 1})`
      : `${name} › ${event}`;
  }
  return name;
}

/** Every reference in the project, in project order (manifest, maps, characters, database). */
export function projectReferences(project: OpenedProject): Reference[] {
  const refs: Reference[] = [];
  const collect = (
    file: string,
    data: unknown,
    mapId: string | null,
    where: (path: DataPath) => string,
  ) => walk(data, [], mapId, (ref, path) => refs.push({ ...ref, file, where: where(path) }));

  const manifest = project.manifest.data as unknown as Record<string, unknown>;
  const uses = Object.fromEntries(Object.entries(manifest).filter(([k]) => !DECLARATIONS.has(k)));
  collect(project.manifest.path, uses, null, () => 'Project settings');

  for (const [mapId, file] of project.maps) {
    const map = file.data;
    if (!map) continue;
    collect(file.path, map, mapId, (path) => mapPlace(map, mapId, path));
  }
  for (const [id, file] of project.tilesets) {
    if (file.data)
      collect(
        file.path,
        { image: file.data.image },
        null,
        () => `Tileset ${file.data?.name || id}`,
      );
  }
  for (const [id, file] of project.characters) {
    if (file.data)
      collect(
        file.path,
        { image: file.data.image },
        null,
        () => `Character ${file.data?.name || id}`,
      );
  }
  for (const [kind, file] of Object.entries(project.database) as [
    DatabaseKind,
    (typeof project.database)[DatabaseKind],
  ][]) {
    const data = file?.data as
      { entries?: readonly { name?: string; id?: string }[] } | null | undefined;
    if (!file || !data) continue;
    const label = DATABASE_LABELS[kind];
    collect(file.path, data, null, (path) => {
      if (path[0] === 'entries' && typeof path[1] === 'number') {
        const entry = data.entries?.[path[1]];
        return `${label} › ${entry?.name || entry?.id || path[1] + 1}`;
      }
      return label;
    });
  }
  return refs;
}

/** The references to one thing (an event: "<map>/<event>"). */
export function referencesTo(project: OpenedProject, kind: RefKind, id: string): Reference[] {
  return projectReferences(project).filter((r) => r.kind === kind && r.id === id);
}

/** Where one thing is used, each place once, in project order. */
export function usagesOf(project: OpenedProject, kind: RefKind, id: string): string[] {
  return [...new Set(referencesTo(project, kind, id).map((r) => r.where))];
}
