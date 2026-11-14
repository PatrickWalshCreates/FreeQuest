// MZ stores an event's commands as a flat list with an indent per command:
// a block's commands sit one level deeper and end with an end marker (code
// 0), and the parts of a block (a choice's options, an else, a battle's
// outcomes) are marker commands at the block's own level. FreeQuest's
// commands are a tree, so the list is read back into one here. Only the
// structure is decided here; what each command means is converted elsewhere.
import { asArray, asInt, asRecord } from './json.js';

/** One MZ command: its code and parameters. */
export interface MzCommand {
  readonly code: number;
  readonly params: readonly unknown[];
}

export type MzNode =
  /** A plain command, with the continuation lines that belong to it (text lines, script lines…). */
  | { readonly kind: 'plain'; readonly command: MzCommand; readonly lines: readonly MzCommand[] }
  /** A command with nested lists: choices (one per option), if/else, loop, battle outcomes. */
  | {
      readonly kind: 'block';
      readonly command: MzCommand;
      readonly branches: readonly {
        readonly marker: MzCommand | null;
        readonly body: readonly MzNode[];
      }[];
    };

/** Lines that continue the command before them. */
const CONTINUATIONS: Readonly<Record<number, number>> = {
  101: 401, // text
  105: 405, // scrolling text
  108: 408, // comment
  205: 505, // move route (its steps are in the route itself)
  302: 605, // shop goods
  355: 655, // script
  357: 657, // plugin command
};

/** Markers that start a branch of the block before them, and the one that ends it. */
const BRANCHES: Readonly<
  Record<number, { readonly starts: readonly number[]; readonly end: number }>
> = {
  102: { starts: [402, 403], end: 404 }, // choice: when…, when cancel, end
  111: { starts: [411], end: 412 }, // if: else, end
  301: { starts: [601, 602, 603], end: 604 }, // battle: win, escape, lose, end
};

/** Read an MZ command list (`list` of a page or common event) into a tree. */
export function commandTree(list: unknown): MzNode[] {
  const commands: (MzCommand & { indent: number })[] = asArray(list).map((raw) => {
    const c = asRecord(raw);
    return { code: asInt(c['code']), indent: asInt(c['indent']), params: asArray(c['parameters']) };
  });
  let i = 0;

  const block = (indent: number): MzNode[] => {
    const nodes: MzNode[] = [];
    while (i < commands.length) {
      const c = commands[i];
      if (!c || c.indent < indent) break;
      if (c.indent > indent) {
        i++; // stray deeper command (damaged list): skip it
        continue;
      }
      if (c.code === 0) {
        i++;
        break;
      }
      // A marker belonging to an enclosing block ends this list.
      if (isMarker(c.code)) break;
      i++;
      const continuation = CONTINUATIONS[c.code];
      if (continuation !== undefined) {
        const lines: MzCommand[] = [];
        while (commands[i]?.code === continuation && commands[i]?.indent === indent) {
          const line = commands[i];
          if (line) lines.push(line);
          i++;
        }
        nodes.push({ kind: 'plain', command: c, lines });
        continue;
      }
      const branches = BRANCHES[c.code];
      if (c.code === 112) {
        nodes.push({
          kind: 'block',
          command: c,
          branches: [{ marker: null, body: block(indent + 1) }],
        });
        if (commands[i]?.code === 413 && commands[i]?.indent === indent) i++;
        continue;
      }
      if (branches) {
        const parts: { marker: MzCommand | null; body: MzNode[] }[] = [];
        // An if's first branch has no marker; choices and battles start with one.
        if (c.code === 111) parts.push({ marker: null, body: block(indent + 1) });
        while (i < commands.length) {
          const next = commands[i];
          if (!next || next.indent !== indent) break;
          if (next.code === branches.end) {
            i++;
            break;
          }
          if (!branches.starts.includes(next.code)) break;
          i++;
          parts.push({ marker: next, body: block(indent + 1) });
        }
        nodes.push({ kind: 'block', command: c, branches: parts });
        continue;
      }
      nodes.push({ kind: 'plain', command: c, lines: [] });
    }
    return nodes;
  };

  const nodes: MzNode[] = [];
  while (i < commands.length) {
    const before = i;
    nodes.push(...block(commands[i]?.indent ?? 0));
    if (i === before) i++; // a marker with no block: skip it
  }
  return nodes;
}

const MARKERS = new Set([402, 403, 404, 411, 412, 413, 601, 602, 603, 604]);
const isMarker = (code: number) => MARKERS.has(code);
