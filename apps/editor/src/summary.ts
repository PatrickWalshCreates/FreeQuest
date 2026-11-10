// What the details panel says about each file. Read-only for now; the
// editors for each kind replace these summaries in later steps.
import type { ProjectFile } from '@freequest/editor-core';
import type { FileData } from '@freequest/schema';

export type Row = readonly [label: string, value: string];

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function summarize(file: ProjectFile): Row[] {
  const rows: Row[] = [['File', file.path]];
  if (file.migrated) rows.push(['Format', 'older version (saving will upgrade it)']);
  const data = file.data;
  if (!data) return rows;
  switch (file.kind) {
    case 'manifest': {
      const m = data as FileData<'manifest'>;
      rows.push(
        ['Name', m.name],
        ['Screen', `${m.screen.width} × ${m.screen.height} px`],
        ['Start', `${m.start.map} at ${m.start.x}, ${m.start.y} facing ${m.start.direction}`],
        ['Party', m.start.party.join(', ') || '(empty)'],
        ['Switches', String(m.switches.length)],
        ['Variables', String(m.variables.length)],
      );
      break;
    }
    case 'map': {
      const map = data as FileData<'map'>;
      rows.push(
        ['Name', map.name],
        ['Size', `${map.width} × ${map.height} tiles`],
        ['Tileset', map.tileset],
        ['Layers', map.layers.map((l) => l.name).join(', ')],
        ['Events', String(map.events.length)],
        ['Music', map.music ?? '(none)'],
        [
          'Encounters',
          map.encounters
            ? `every ~${map.encounters.steps} steps: ${map.encounters.troops.map((t) => t.troop).join(', ')}`
            : '(none)',
        ],
      );
      break;
    }
    case 'tileset': {
      const t = data as FileData<'tileset'>;
      rows.push(
        ['Name', t.name],
        ['Image', t.image],
        ['Tile size', `${t.tileWidth} × ${t.tileHeight} px`],
        ['Tiles', `${t.tiles.length} in ${t.columns} columns`],
      );
      break;
    }
    case 'character': {
      const c = data as FileData<'character'>;
      rows.push(
        ['Name', c.name],
        ['Image', c.image],
        ['Frame size', `${c.frameWidth} × ${c.frameHeight} px`],
        ['Frames', `${c.frames} per direction`],
      );
      break;
    }
    case 'system': {
      const s = data as FileData<'system'>;
      rows.push(
        ['Elements', s.elements.map((e) => e.name).join(', ') || '(none)'],
        ['Skill types', s.skillTypes.map((e) => e.name).join(', ') || '(none)'],
        ['Equipment slots', s.equipmentSlots.map((e) => e.name).join(', ') || '(none)'],
      );
      break;
    }
    default: {
      const entries = (data as { entries: readonly { id: string; name?: string }[] }).entries;
      rows.push(['Entries', count(entries.length, 'entry', 'entries')]);
      rows.push(['', entries.map((e) => e.name ?? e.id).join(', ')]);
    }
  }
  return rows;
}
