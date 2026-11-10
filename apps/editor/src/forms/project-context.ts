// What the project offers to forms: the dropdown choices for fields that
// refer to maps, switches, items…, and display names for command rows.
import type { NameLookup, OpenedProject } from '@freequest/editor-core';
import type { FormContext, RefOption } from './SchemaField.js';

interface Named {
  readonly id: string;
  readonly name?: string;
}

const options = (list: readonly Named[]): RefOption[] =>
  list.map((x) => ({
    value: x.id,
    label: x.name && x.name !== x.id ? `${x.name} (${x.id})` : x.id,
  }));

/** Field labels that read better than the generated ones. */
const LABELS: Record<string, string> = {
  id: 'Item',
  op: 'Operation',
  x: 'X',
  y: 'Y',
  path: 'File',
  onWin: 'If won',
  onEscape: 'If escaped',
  onLose: 'If lost',
  else: 'Else',
  canLose: 'Can lose (the event continues)',
  cancel: 'Cancel picks option (0 = first)',
};

export interface ProjectLists {
  /** Audio files in the project, for music and sound fields. */
  readonly audio: readonly string[];
}

export function projectFormContext(project: OpenedProject, lists: ProjectLists): FormContext {
  const m = project.manifest.data;
  const db = (kind: 'actors' | 'items' | 'equipment' | 'troops'): Named[] =>
    (project.database[kind]?.data?.entries as Named[] | undefined) ?? [];
  const maps = [...project.maps].map(([id, f]) => ({ id, name: f.data?.name ?? id }));
  const characters = [...project.characters].map(([id, f]) => ({ id, name: f.data?.name ?? id }));
  const audio = lists.audio.map((p) => ({ value: p, label: p.replace(/^assets\//, '') }));

  const refs: FormContext['refs'] = (field, parent) => {
    switch (field) {
      case 'map':
        return options(maps);
      case 'switch':
        return options(m.switches);
      case 'variable':
        return options(m.variables);
      case 'troop':
        return options(db('troops'));
      case 'actor':
        return options(db('actors'));
      case 'character':
        return options(characters);
      case 'id':
        return options(parent?.['kind'] === 'equipment' ? db('equipment') : db('items'));
      case 'path':
        return audio;
      default:
        return null;
    }
  };
  return {
    refs,
    multiline: (field) => field === 'text',
    label: (field) => LABELS[field],
    pick: (field) => {
      const first = refs(field, null)?.[0];
      return first ? first.value : undefined;
    },
  };
}

/** Names for command descriptions, falling back to ids for anything missing. */
export function projectNames(project: OpenedProject): NameLookup {
  const m = project.manifest.data;
  const find = (list: readonly Named[] | undefined, id: string) =>
    list?.find((x) => x.id === id)?.name ?? id;
  const entries = (kind: 'actors' | 'items' | 'equipment' | 'troops') =>
    project.database[kind]?.data?.entries as Named[] | undefined;
  return {
    map: (id) => project.maps.get(id)?.data?.name ?? id,
    switchName: (id) => find(m.switches, id),
    variable: (id) => find(m.variables, id),
    actor: (id) => find(entries('actors'), id),
    item: (kind, id) => find(entries(kind === 'equipment' ? 'equipment' : 'items'), id),
    troop: (id) => find(entries('troops'), id),
  };
}
