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
    const source = world.interpreterEvent?.id ?? 'script';
    lines.push(
      `Event: ${source} — ${running.pending ? `waiting on ${running.pending.type}` : 'running'}`,
    );
  }
  const parallel = world.parallelEvents.map((e) => e.id);
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
  return lines.join('\n');
}
