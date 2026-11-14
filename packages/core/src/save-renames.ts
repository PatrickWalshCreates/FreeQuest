// Saves made before an id was renamed in the editor: the manifest's rename
// record (`renames`, old → new per kind) translates the ids a save stores,
// so it still loads. An id that exists now is kept as it is (something new
// may have taken an old name since), so translating twice is harmless.
import type { Manifest, SaveFile, SaveRenameKind } from '@freequest/schema';
import type { DatabaseIndex } from './database.js';

/** A save with its ids brought up to date with the project's renames. */
export function translateSave(save: SaveFile, manifest: Manifest, db: DatabaseIndex): SaveFile {
  const renames = manifest.renames;
  if (!renames) return save;
  const exists: Record<SaveRenameKind, (id: string) => boolean> = {
    map: (id) => manifest.maps.some((m) => m.id === id),
    switch: (id) => manifest.switches.some((s) => s.id === id),
    variable: (id) => manifest.variables.some((v) => v.id === id),
    actor: (id) => db.actors.has(id),
    item: (id) => db.items.has(id),
    equipment: (id) => db.equipment.has(id),
    skill: (id) => db.skills.has(id),
    state: (id) => db.states.has(id),
    equipmentSlot: (id) => db.system.equipmentSlots.some((s) => s.id === id),
    // Events live on maps that may not be loaded: trust the record.
    event: () => false,
  };
  const to = (kind: SaveRenameKind, id: string): string => {
    const table = renames[kind];
    const next = table?.[id];
    return next !== undefined && !exists[kind](id) ? next : id;
  };
  const keys = <V>(kind: SaveRenameKind, record: Readonly<Record<string, V>>): Record<string, V> =>
    Object.fromEntries(Object.entries(record).map(([k, v]) => [to(kind, k), v]));

  // Flags: map → event → flag ids. An event rename was recorded with its map's id at the time,
  // which may be the save's (older) map id or the current one.
  const flags: Record<string, Record<string, string[]>> = {};
  for (const [map, events] of Object.entries(save.flags)) {
    const newMap = to('map', map);
    for (const [event, ids] of Object.entries(events)) {
      const renamed = renames.event?.[`${map}/${event}`] ?? renames.event?.[`${newMap}/${event}`];
      const newEvent = renamed ? renamed.slice(renamed.indexOf('/') + 1) : event;
      (flags[newMap] ??= {})[newEvent] = ids;
    }
  }

  return {
    ...save,
    map: to('map', save.map),
    switches: keys('switch', save.switches),
    variables: keys('variable', save.variables),
    flags,
    party: {
      ...save.party,
      members: save.party.members.map((m) => ({
        ...m,
        id: to('actor', m.id),
        equipment: Object.fromEntries(
          Object.entries(m.equipment).map(([slot, id]) => [
            to('equipmentSlot', slot),
            to('equipment', id),
          ]),
        ),
        extraSkills: m.extraSkills.map((id) => to('skill', id)),
        states: m.states.map((s) => ({ ...s, id: to('state', s.id) })),
      })),
      items: keys('item', save.party.items),
      equipment: keys('equipment', save.party.equipment),
    },
  };
}
