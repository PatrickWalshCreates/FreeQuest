// What a message will look like, for the editor: its `{…}` codes filled in
// with names from the project and stand-ins for values only the game knows
// (a variable shows as "[Coins]", gold as the starting gold).
import { parseTextCodes } from '@freequest/schema';
import type { OpenedProject } from './open-project.js';

/** Same shape as the game's runs (core's TextRun), so a preview draws like the game. */
export type PreviewRun =
  | { readonly kind: 'text'; readonly text: string; readonly color: string | null }
  | { readonly kind: 'icon'; readonly icon: number };

type Named = { readonly id: string; readonly name: string };

export function previewText(source: string, project: OpenedProject): PreviewRun[] {
  const manifest = project.manifest.data;
  const entries = (kind: 'actors' | 'items' | 'equipment') =>
    (project.database[kind]?.data?.entries as readonly Named[] | undefined) ?? [];
  const nameOf = (kind: 'actors' | 'items' | 'equipment', id: string) =>
    entries(kind).find((e) => e.id === id)?.name ?? id;
  const runs: PreviewRun[] = [];
  const colors: string[] = [];
  const add = (text: string) => {
    if (!text) return;
    const color = colors.at(-1) ?? null;
    const last = runs.at(-1);
    if (last?.kind === 'text' && last.color === color) {
      runs[runs.length - 1] = { ...last, text: last.text + text };
    } else runs.push({ kind: 'text', text, color });
  };
  for (const token of parseTextCodes(source).tokens) {
    if (token.kind === 'text') {
      add(token.text);
      continue;
    }
    const arg = token.arg ?? '';
    switch (token.name) {
      case 'v':
        add(`[${manifest.variables.find((v) => v.id === arg)?.name || arg}]`);
        break;
      case 'actor':
        add(nameOf('actors', arg));
        break;
      case 'member': {
        // The starting party, as the game would show it at the start.
        const id = manifest.start.party[Number(arg) - 1];
        add(id ? nameOf('actors', id) : `[member ${arg}]`);
        break;
      }
      case 'gold':
        add(String(manifest.start.gold));
        break;
      case 'currency':
        add(project.database.system?.data?.currency ?? 'G');
        break;
      case 'item':
        add(nameOf('items', arg));
        break;
      case 'equipment':
        add(nameOf('equipment', arg));
        break;
      case 'color':
        colors.push(arg);
        break;
      case '/color':
        colors.pop();
        break;
      case 'icon':
        runs.push({ kind: 'icon', icon: Number(arg) });
        break;
    }
  }
  return runs;
}

/**
 * Problems with a text's codes: their syntax, and ids the project doesn't
 * have (variables, actors, items, equipment). Empty when all is well.
 */
export function textProblems(source: string, project: OpenedProject): string[] {
  const parsed = parseTextCodes(source);
  const problems = [...parsed.problems];
  const manifest = project.manifest.data;
  const has = (kind: 'actors' | 'items' | 'equipment', id: string) =>
    ((project.database[kind]?.data?.entries as readonly Named[] | undefined) ?? []).some(
      (e) => e.id === id,
    );
  for (const token of parsed.tokens) {
    if (token.kind !== 'code' || token.arg === null) continue;
    const arg = token.arg;
    if (token.name === 'v' && !manifest.variables.some((v) => v.id === arg)) {
      problems.push(`{v:${arg}}: there's no variable "${arg}"`);
    } else if (token.name === 'actor' && !has('actors', arg)) {
      problems.push(`{actor:${arg}}: there's no actor "${arg}"`);
    } else if (token.name === 'item' && !has('items', arg)) {
      problems.push(`{item:${arg}}: there's no item "${arg}"`);
    } else if (token.name === 'equipment' && !has('equipment', arg)) {
      problems.push(`{equipment:${arg}}: there's no equipment "${arg}"`);
    }
  }
  return problems;
}
