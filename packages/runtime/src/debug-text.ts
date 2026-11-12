// Text for the developer debug panel. Free of DOM and PixiJS so it can be
// tested in Node; `debug-panel.ts` puts it on screen.
import type { World } from '@freequest/core';
import type { Manifest } from '@freequest/schema';

/** A multi-line snapshot of the game state for developers. */
export function describeGame(world: World, manifest: Manifest): string {
  const { player, party, db, state } = world;
  const lines: string[] = [];
  const currency = db.system.currency;

  lines.push(
    `Map ${world.map.id} (${player.x}, ${player.y}) facing ${player.direction} · ${party.steps} steps`,
  );
  const running = world.interpreter;
  if (running) {
    const common = world.interpreterCommonEvent;
    const source = world.interpreterEvent?.id ?? (common ? `common event ${common}` : 'script');
    lines.push(
      `Event: ${source} — ${running.pending ? `waiting on ${running.pending.type}` : 'running'}`,
    );
  }
  const parallel = [
    ...world.parallelEvents.map((e) => e.id),
    ...world.parallelCommonEvents.map((id) => `common event ${id}`),
  ];
  if (parallel.length > 0) lines.push(`Parallel: ${parallel.join(', ')}`);
  lines.push('', `Gold: ${party.gold} ${currency}`, 'Party:');
  if (party.members.length === 0) lines.push('  (empty)');
  for (const m of party.members) {
    const states = m.states.map((s) => s.id).join(', ');
    lines.push(
      `  ${m.name.padEnd(8)} Lv ${String(m.level).padStart(2)}  HP ${m.hp}/${m.maxHp}  MP ${m.mp}/${m.maxMp}` +
        (states ? `  [${states}]` : ''),
    );
  }

  const inventory = (kind: 'item' | 'equipment', label: string) => {
    const lookup = kind === 'item' ? db.items : db.equipment;
    const entries = party.list(kind).map((e) => `${lookup.get(e.id).name} ×${e.count}`);
    lines.push(`${label}: ${entries.length > 0 ? entries.join(', ') : '—'}`);
  };
  lines.push('');
  inventory('item', 'Items');
  inventory('equipment', 'Equipment');

  lines.push('', 'Switches:');
  for (const s of manifest.switches) {
    lines.push(`  ${state.getSwitch(s.id) ? '●' : '○'} ${s.id}`);
  }
  lines.push('Variables:');
  for (const v of manifest.variables) lines.push(`  ${v.id} = ${state.getVariable(v.id)}`);
  // Flags that are on for this map's events (flags elsewhere wait in the save data).
  const flags = state.toData().flags[world.map.id] ?? {};
  const flagLines = Object.entries(flags).map(([event, ids]) => `  ${event}: ${ids.join(', ')}`);
  lines.push('Event flags on this map:', ...(flagLines.length > 0 ? flagLines : ['  —']));
  return lines.join('\n');
}
