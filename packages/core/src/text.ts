// Text codes, expanded: a message's `{…}` codes (schema's `parseTextCodes`)
// become runs of plain text, each with a colour or none, and icons. Values
// are read when the message is shown, so "{v:coins}" is the current count.
import { parseTextCodes } from '@freequest/schema';
import { type EventContext, type GameState, requireParty, toEventContext } from './game-state.js';

/** A piece of a message: text in one colour (null = the window's colour), or an icon. */
export type TextRun =
  | { readonly kind: 'text'; readonly text: string; readonly color: string | null }
  | { readonly kind: 'icon'; readonly icon: number };

/**
 * Expand a text's codes against the game. Codes with problems show nothing
 * (the editor and the checks report them). Neighbouring runs of the same
 * colour are merged.
 */
export function expandText(source: string, context: EventContext | GameState): TextRun[] {
  const ctx = toEventContext(context);
  const runs: TextRun[] = [];
  const colors: string[] = [];
  const color = () => colors.at(-1) ?? null;
  const add = (text: string) => {
    if (!text) return;
    const last = runs.at(-1);
    if (last?.kind === 'text' && last.color === color()) {
      runs[runs.length - 1] = { ...last, text: last.text + text };
    } else runs.push({ kind: 'text', text, color: color() });
  };
  const party = () => requireParty(ctx, 'a text code');
  for (const token of parseTextCodes(source).tokens) {
    if (token.kind === 'text') {
      add(token.text);
      continue;
    }
    const arg = token.arg ?? '';
    switch (token.name) {
      case 'v':
        add(String(ctx.state.getVariable(arg)));
        break;
      case 'actor':
        // A member's current name, else the database's.
        add(party().member(arg)?.name ?? party().db.actors.find(arg)?.name ?? arg);
        break;
      case 'member':
        add(party().members[Number(arg) - 1]?.name ?? '');
        break;
      case 'gold':
        add(String(party().gold));
        break;
      case 'currency':
        add(party().db.system.currency);
        break;
      case 'item':
        add(party().db.items.find(arg)?.name ?? arg);
        break;
      case 'equipment':
        add(party().db.equipment.find(arg)?.name ?? arg);
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

/** The runs' text without colours or icons (for speakers, choices, logs and tests). */
export function plainText(runs: readonly TextRun[]): string {
  return runs.map((r) => (r.kind === 'text' ? r.text : '')).join('');
}

/** Expand a text straight to plain text. */
export function expandPlainText(source: string, context: EventContext | GameState): string {
  return plainText(expandText(source, context));
}
