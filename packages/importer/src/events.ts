// MZ event commands, page conditions and pages as FreeQuest's. Everything
// FreeQuest has is converted; anything else stays where it was as a comment
// saying what it was, and each command list reports what it left behind in
// one line. A branch on something FreeQuest can't test keeps both branches,
// tested on a switch that's never on (so the "else" side runs, as if the
// test failed) and named so the author finds it.
import {
  type Command,
  type CommandOf,
  type CompareOp,
  type Condition,
  type Direction,
  type EventLayer,
  type EventMovement,
  type EventPage,
  type Easing,
  type EventTrigger,
  type GameValue,
  type IfCondition,
  type InputAction,
  type MapEvent,
  type MoveStep,
  type RouteDirection,
  type ShopGood,
  type TroopEntry,
  type TroopEvent,
  type TurnDirection,
  type VariableOp,
  idFromName,
  mapCommands,
} from '@freequest/schema';
import { MZ_BALLOON_NAMES } from './animations.js';
import type { AudioFolder, AudioImporter } from './audio.js';
import { type MzNode, commandTree } from './command-tree.js';
import type { GraphicsImporter } from './graphics.js';
import type { NumberedIds } from './ids.js';
import { asArray, asInt, asRecord, asString, isRecord, type JsonRecord } from './json.js';
import type { MzDatabase, MzList } from './mz-lists.js';
import type { ImportReport, ReportTopic } from './report.js';
import { convertText } from './text.js';
import type { TileDrawer } from './tilesets.js';

export interface EventsContext {
  readonly report: ImportReport;
  readonly graphics: GraphicsImporter;
  readonly audio: AudioImporter;
  readonly db: MzDatabase;
  readonly switches: NumberedIds;
  readonly variables: NumberedIds;
  /** An imported map's id, or null. */
  readonly map: (n: number) => string | null;
  /** A map's size, to keep transfers inside it. */
  readonly mapSize: (id: string) => { width: number; height: number } | null;
  /** A common event's id, or null. */
  readonly common: (n: number) => string | null;
  readonly textColor: (n: number) => string;
  /** MZ animation `n`'s id (marking it used), or null. */
  readonly animation: (n: number) => string | null;
  /** The switch that stands in for tests FreeQuest can't make (declared on first use). */
  readonly redoSwitch: () => string;
}

/** Where a command list is: on a map (with its events and tiles) or a common event. */
export interface ListScope {
  readonly where: string;
  /** An event on this map by MZ number (null in common events, or no such event). */
  readonly event: (n: number) => string | null;
  /** Draws this map's tiles (for events shown as a tile). */
  readonly drawer: TileDrawer | null;
}

/** What a command list left out, gathered to report once. */
class Leftovers {
  readonly commands = new Map<string, number>();
  readonly text = new Map<string, number>();
  readonly routeSteps = new Map<string, number>();
  readonly notes = new Set<string>();
  redo = 0;

  command(name: string): void {
    this.commands.set(name, (this.commands.get(name) ?? 0) + 1);
  }

  static count(map: Map<string, number>, name: string): void {
    map.set(name, (map.get(name) ?? 0) + 1);
  }

  static topics(map: ReadonlyMap<string, number>, prefix = ''): ReportTopic[] {
    return [...map].map(([name, count]) => ({ name: `${prefix}${name}`, count }));
  }

  reportTo(report: ImportReport, where: string): void {
    if (this.commands.size > 0) {
      const list = [...this.commands]
        .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
        .join(', ');
      report.missing(
        where,
        `Commands FreeQuest doesn't have, kept as comments: ${list}.`,
        Leftovers.topics(this.commands),
      );
    }
    if (this.redo > 0) {
      report.changed(
        where,
        `${this.redo} ${this.redo === 1 ? 'branch tests' : 'branches test'} something FreeQuest can't; ${this.redo === 1 ? 'it now tests' : 'they now test'} the switch “Imported: condition to redo”, which is never on.`,
        [{ name: 'Branches on something FreeQuest can’t test', count: this.redo }],
      );
    }
    if (this.text.size > 0) {
      report.changed(
        where,
        `Text codes left out: ${[...this.text.keys()].join(', ')}.`,
        Leftovers.topics(this.text, 'Message code: '),
      );
    }
    if (this.routeSteps.size > 0) {
      report.changed(
        where,
        `Move route steps FreeQuest doesn't have were left out: ${[...this.routeSteps.keys()].join(', ')}.`,
        Leftovers.topics(this.routeSteps, 'Move route step: '),
      );
    }
    for (const note of this.notes) report.changed(where, note);
  }
}

const DIRECTIONS: Readonly<Record<number, Direction>> = {
  2: 'down',
  4: 'left',
  6: 'right',
  8: 'up',
};
const EASINGS: readonly Easing[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out'];

const SCROLL_DIRECTIONS: Readonly<Record<number, 'up' | 'down' | 'left' | 'right'>> = {
  2: 'down',
  4: 'left',
  6: 'right',
  8: 'up',
};

/** MZ's button names and the input actions they are. */
const BUTTONS: Readonly<Record<string, InputAction>> = {
  ok: 'confirm',
  cancel: 'cancel',
  escape: 'menu',
  menu: 'menu',
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
};

/** MZ's actor parameters for Control variables, in its order. */
const ACTOR_STATS: readonly Extract<GameValue, { type: 'actorStat' }>['stat'][] = [
  'level',
  'exp',
  'hp',
  'mp',
  'maxHp',
  'maxMp',
  'attack',
  'defense',
  'magicAttack',
  'magicDefense',
  'agility',
  'luck',
];

const GAME_DATA_NAMES: Readonly<Record<number, string>> = {
  4: 'an enemy',
  5: 'a character',
  6: 'a party member',
  7: 'other',
  8: 'the last action',
};

const COMPARE: readonly CompareOp[] = ['==', '>=', '<=', '>', '<', '!='];
const VARIABLE_OPS: readonly VariableOp[] = ['set', 'add', 'sub', 'mul', 'div', 'mod'];

/** MZ move speeds 1–6 as tiles per second (4, MZ's normal, is the player's 4). */
export const moveSpeed = (n: number) => Math.min(16, 2 ** (Math.max(1, Math.min(6, n)) - 2));
/** MZ move frequencies 1–5 as seconds to stand between steps. */
const PAUSES: Readonly<Record<number, number>> = { 1: 2, 2: 1, 3: 0.5, 4: 0.25, 5: 0 };

/** Readable names of MZ commands FreeQuest doesn't have (our own wording). */
const COMMAND_NAMES: Readonly<Record<number, string>> = {
  117: 'Common event',
  122: 'Control variables (script or game data)',
  125: 'Change gold',
  126: 'Change items',
  127: 'Change weapons',
  128: 'Change armors',
  201: 'Transfer player',
  205: 'Set movement route',
  301: 'Battle',
  302: 'Shop',
  314: 'Recover all',
  315: 'Change EXP',
  103: 'Input number',
  104: 'Select item',
  105: 'Scrolling text',
  118: 'Label',
  119: 'Jump to label',
  124: 'Timer',
  132: 'Change battle music',
  133: 'Change victory music',
  134: 'Save access',
  135: 'Menu access',
  136: 'Encounters on/off',
  137: 'Formation access',
  138: 'Window colour',
  139: 'Change defeat music',
  140: 'Vehicle music',
  202: 'Vehicle location',
  203: 'Set event location',
  204: 'Scroll map',
  206: 'Get on/off vehicle',
  211: 'Transparency',
  212: 'Show animation',
  213: 'Show balloon',
  216: 'Followers on/off',
  217: 'Gather followers',
  231: 'Show picture',
  232: 'Move picture',
  233: 'Rotate picture',
  234: 'Tint picture',
  235: 'Erase picture',
  236: 'Weather',
  243: 'Save music',
  244: 'Resume music',
  245: 'Background sound',
  246: 'Fade out background sound',
  251: 'Stop sounds',
  261: 'Play movie',
  281: 'Map name display',
  282: 'Change tileset',
  283: 'Change battle background',
  284: 'Change parallax',
  285: 'Get location info',
  303: 'Name input',
  311: 'Change HP',
  312: 'Change MP',
  313: 'Change state',
  316: 'Change level',
  317: 'Change parameter',
  318: 'Change skill',
  319: 'Change equipment',
  320: 'Change name',
  321: 'Change class',
  322: 'Change actor images',
  323: 'Change vehicle image',
  324: 'Change nickname',
  325: 'Change profile',
  326: 'Change TP',
  331: 'Change enemy HP',
  332: 'Change enemy MP',
  333: 'Change enemy state',
  334: 'Enemy recover all',
  335: 'Enemy appear',
  336: 'Enemy transform',
  337: 'Show battle animation',
  339: 'Force action',
  340: 'Abort battle',
  342: 'Change enemy TP',
  351: 'Open menu',
  352: 'Open save screen',
  353: 'Game over',
  354: 'Return to title',
  355: 'Script',
  356: 'Plugin command',
  357: 'Plugin command',
};

/** Converts command lists, keeping what each left out for one report line. */
class Converter {
  readonly left = new Leftovers();

  constructor(
    private readonly ctx: EventsContext,
    private readonly scope: ListScope,
  ) {}

  async list(nodes: readonly MzNode[]): Promise<Command[]> {
    const out: Command[] = [];
    for (const node of nodes) out.push(...(await this.node(node)));
    return out;
  }

  /** A comment standing for MZ command `code` (and noted as left out). */
  #unsupported(code: number, detail = ''): Command {
    const name = COMMAND_NAMES[code] ?? `Command ${code}`;
    this.left.command(name);
    return {
      type: 'comment',
      text: `From MZ, not imported: ${name}${detail ? `: ${detail}` : ''}`,
    };
  }

  #text(source: string): string {
    const converted = convertText(source, {
      variable: (n) => this.ctx.variables.id(n),
      actor: (n) => this.ctx.db.actors.id(n),
      color: (n) => this.ctx.textColor(n),
    });
    for (const d of converted.dropped) Leftovers.count(this.left.text, d);
    return converted.text;
  }

  async node(node: MzNode): Promise<Command[]> {
    const { code, params: p } = node.command;
    const int = (i: number, fallback = 0) => asInt(p[i], fallback);
    if (node.kind === 'block') return this.#block(node);
    const lines = node.lines.map((l) => asString(l.params[0]));

    switch (code) {
      case 101: {
        const face = await this.ctx.graphics.face(asString(p[0]), int(1), this.scope.where);
        const speaker = this.#text(asString(p[4]).trim());
        return [
          {
            type: 'message',
            ...(speaker ? { speaker } : {}),
            ...(face ? { face } : {}),
            text: this.#text(lines.join('\n')),
          },
        ];
      }
      case 108:
        return [{ type: 'comment', text: [asString(p[0]), ...lines].join('\n') }];
      case 113:
        return [{ type: 'break' }];
      case 115:
        return [{ type: 'exitEvent' }];
      case 117: {
        const common = this.ctx.common(int(0));
        return common
          ? [{ type: 'callCommon', common }]
          : [this.#unsupported(117, `missing common event ${int(0)}`)];
      }
      case 121: {
        const out: Command[] = [];
        for (let n = int(0); n <= int(1) && out.length < 1000; n++) {
          if (n > 0)
            out.push({ type: 'setSwitch', switch: this.ctx.switches.id(n), value: int(2) === 0 });
        }
        return out;
      }
      case 122:
        return this.#variables(p);
      case 123:
        return [{ type: 'setFlag', flag: asString(p[0], 'A').toLowerCase(), value: int(1) === 0 }];
      case 125: {
        const amount = this.#amount(int(0), int(1), int(2));
        return amount === null
          ? [this.#unsupported(125, 'by a variable, decreasing')]
          : [{ type: 'changeGold', amount }];
      }
      case 126:
      case 127:
      case 128: {
        const list =
          code === 126
            ? this.ctx.db.items
            : code === 127
              ? this.ctx.db.weapons
              : this.ctx.db.armors;
        const id = list.id(int(0));
        const amount = this.#amount(int(1), int(2), int(3));
        if (!id || amount === null)
          return [this.#unsupported(code, id ? 'by a variable, decreasing' : 'a missing entry')];
        return [{ type: 'changeItems', kind: code === 126 ? 'item' : 'equipment', id, amount }];
      }
      case 129: {
        const actor = this.ctx.db.actors.id(int(0));
        return actor
          ? [{ type: 'changeParty', action: int(1) === 0 ? 'add' : 'remove', actor }]
          : [];
      }
      case 201:
        return [this.#transfer(p)];
      case 205:
        return this.#moveRoute(p);
      case 214:
        return [{ type: 'hideEvent', hidden: true }];
      case 211:
        // Transparency: 0 makes the player see-through (hidden), 1 shows them.
        return [{ type: 'hidePlayer', hidden: int(0) === 0 }];
      case 320:
      case 322: {
        const actor = this.ctx.db.actors.id(int(0));
        if (!actor) return [this.#unsupported(code, `missing actor ${int(0)}`)];
        if (code === 320) {
          const name = asString(p[1]).trim();
          return name ? [{ type: 'changeActor', actor, name }] : [];
        }
        // Actor images: the map character (faces and battlers aren't per actor in FreeQuest).
        const character = await this.ctx.graphics.character(
          asString(p[1]),
          int(2),
          this.scope.where,
        );
        if (!character) return [this.#unsupported(code, 'a character picture that isn’t there')];
        return [{ type: 'changeActor', actor, character }];
      }
      case 221:
      case 222:
        return [{ type: 'fadeScreen', to: code === 221 ? 'out' : 'in', seconds: 0.4, wait: true }];
      case 223: {
        const tone = asArray(p[0]).map((v) => asInt(v));
        return [
          { type: 'tintScreen', ...tint(tone), seconds: frames(int(1)), wait: p[2] === true },
        ];
      }
      case 224: {
        const [r, g, b] = asArray(p[0]).map((v) => clampByte(asInt(v)));
        return [
          {
            type: 'flashScreen',
            color: hexColor(r ?? 255, g ?? 255, b ?? 255),
            seconds: frames(int(1)),
            wait: p[2] === true,
          },
        ];
      }
      case 225:
        return [
          {
            type: 'shakeScreen',
            power: Math.max(1, Math.min(20, int(0, 5) * 2)),
            seconds: frames(int(2)),
            wait: p[3] === true,
          },
        ];
      case 230: {
        const seconds = frames(int(0));
        return seconds > 0 ? [{ type: 'wait', seconds }] : [];
      }
      case 241:
      case 242: {
        if (code === 242) return [{ type: 'playMusic', path: null }];
        const path = await this.#sound('bgm', p[0]);
        return [{ type: 'playMusic', path }];
      }
      case 249:
      case 250: {
        const path = await this.#sound(code === 249 ? 'me' : 'se', p[0]);
        return path ? [{ type: 'playSound', path }] : [];
      }
      case 302:
        return [this.#shop(p, node.lines)];
      case 314: {
        if (int(0) !== 0) return [this.#unsupported(314, 'actor from a variable')];
        const actor = int(1) > 0 ? this.ctx.db.actors.id(int(1)) : null;
        return [{ type: 'recoverAll', ...(actor ? { actor } : {}) }];
      }
      case 315: {
        if (int(0) !== 0 || int(2) !== 0) return [this.#unsupported(315, 'not a plain gain')];
        const actor = int(1) > 0 ? this.ctx.db.actors.id(int(1)) : null;
        const amount = int(3) === 0 ? int(4) : { variable: this.ctx.variables.id(int(4)) };
        return [{ type: 'gainExp', ...(actor ? { actor } : {}), amount }];
      }
      case 203:
        return [this.#placeEvent(p)];
      case 204: {
        const direction = SCROLL_DIRECTIONS[int(0)];
        if (!direction) return [];
        return [
          {
            type: 'scrollMap',
            direction,
            tiles: Math.max(0, Math.min(100, int(1))),
            speed: Math.max(0.5, moveSpeed(int(2, 4))),
            // MZ waits for a scroll only when asked (older projects have no flag: they waited).
            wait: p[3] === undefined ? true : p[3] === true,
          },
        ];
      }
      case 231:
      case 232:
        return this.#picture(code, p);
      case 212:
      case 213: {
        const target = this.#character(int(0));
        if (!target) return [this.#unsupported(code, `on missing event ${int(0)}`)];
        const wait = p[2] === true;
        if (code === 212) {
          const animation = this.ctx.animation(int(1));
          return animation
            ? [{ type: 'showAnimation', target, animation, wait }]
            : [this.#unsupported(212, `missing animation ${int(1)}`)];
        }
        if (int(1) < 1 || int(1) > MZ_BALLOON_NAMES.length) {
          return [this.#unsupported(213, `balloon ${int(1)}`)];
        }
        return (await this.ctx.graphics.balloons(this.scope.where))
          ? [{ type: 'showBalloon', target, balloon: int(1) - 1, wait }]
          : [this.#unsupported(213, 'without a balloon image')];
      }
      case 235:
        return [{ type: 'erasePicture', number: Math.max(1, Math.min(100, int(0))) }];
      case 352:
        return [{ type: 'openSave' }];
      case 353:
        return [{ type: 'gameOver' }];
      case 354:
        return [{ type: 'returnToTitle' }];
      case 134:
      case 135:
        return [
          { type: 'setAccess', what: code === 134 ? 'saving' : 'menu', allowed: int(0) === 1 },
        ];
      case 132:
      case 133: {
        const name = asString(asRecord(p[0])['name']).trim();
        if (!name) return [this.#unsupported(code, 'silence')];
        const path = await this.#sound(code === 132 ? 'bgm' : 'me', p[0]);
        return path
          ? [{ type: 'changeBattleMusic', which: code === 132 ? 'battle' : 'victory', path }]
          : [];
      }
      case 245: {
        const path = await this.#sound('bgs', p[0]);
        return path ? [{ type: 'playBackgroundSound', path }] : [];
      }
      case 246:
        return [{ type: 'playBackgroundSound', path: null }];
      case 311:
      case 312:
      case 313:
        return this.#actorChange(code, p);
      case 355:
        return [this.#unsupported(355, [asString(p[0]), ...lines].join('\n'))];
      default:
        return [this.#unsupported(code)];
    }
  }

  async #block(node: Extract<MzNode, { kind: 'block' }>): Promise<Command[]> {
    const { code, params: p } = node.command;
    const branch = async (i: number) => this.list(node.branches[i]?.body ?? []);
    if (code === 112) return [{ type: 'loop', commands: await branch(0) }];
    if (code === 111) {
      const then = await branch(0);
      const otherwise = node.branches.length > 1 ? await branch(1) : null;
      const condition = this.#condition(p);
      return [
        { type: 'if', conditions: [condition], then, ...(otherwise ? { else: otherwise } : {}) },
      ];
    }
    if (code === 102) {
      const labels = asArray(p[0]).map((l) => this.#text(asString(l)).trim() || '…');
      const options: CommandOf<'choice'>['options'] = labels.map((label) => ({
        label,
        commands: [],
      }));
      for (const b of node.branches) {
        if (!b.marker) continue;
        const body = await this.list(b.body);
        if (b.marker.code === 402) {
          const option = options[asInt(b.marker.params[0])];
          if (option) option.commands = body;
        } else if (body.length > 0) {
          this.left.notes.add(
            'A choice ran its own commands when cancelled; now it can’t be cancelled.',
          );
        }
      }
      if (options.length === 0) return [];
      const cancel = asInt(p[1], -1);
      return [
        { type: 'choice', options, ...(cancel >= 0 && cancel < options.length ? { cancel } : {}) },
      ];
    }
    // 301: battle
    const troop = asInt(p[0]) === 0 ? this.ctx.db.troops.id(asInt(p[1])) : null;
    if (!troop)
      return [
        this.#unsupported(
          301,
          asInt(p[0]) === 0 ? 'a missing troop' : 'a troop from a variable or the map',
        ),
      ];
    const outcomes: Partial<Record<'onWin' | 'onEscape' | 'onLose', Command[]>> = {};
    for (const b of node.branches) {
      const key = b.marker?.code === 601 ? 'onWin' : b.marker?.code === 602 ? 'onEscape' : 'onLose';
      outcomes[key] = await this.list(b.body);
    }
    return [
      { type: 'battle', troop, canEscape: p[2] === true, canLose: p[3] === true, ...outcomes },
    ];
  }

  /** An MZ branch test as a FreeQuest condition (or the never-on switch). */
  #condition(p: readonly unknown[]): IfCondition {
    const int = (i: number) => asInt(p[i]);
    switch (int(0)) {
      case 0:
        return { type: 'switch', switch: this.ctx.switches.id(int(1)), value: int(2) === 0 };
      case 1:
        if (int(2) === 0) {
          return {
            type: 'variable',
            variable: this.ctx.variables.id(int(1)),
            op: COMPARE[int(4)] ?? '==',
            value: int(3),
          };
        }
        break;
      case 2:
        return { type: 'flag', flag: asString(p[1], 'A').toLowerCase(), value: int(2) === 0 };
      case 4: {
        const actor = this.ctx.db.actors.id(int(1));
        if (!actor) break;
        if (int(2) === 0) return { type: 'inParty', actor };
        if (int(2) === 1) return { type: 'actorName', actor, name: asString(p[3]) };
        const state = int(2) === 6 ? this.ctx.db.states.id(int(3)) : null;
        if (state) return { type: 'actorState', actor, state, value: true };
        break;
      }
      case 6: {
        const target = this.#character(int(1));
        const direction = DIRECTIONS[int(2)];
        if (target && direction) return { type: 'facing', target, direction };
        break;
      }
      case 11: {
        const action = BUTTONS[asString(p[1])];
        if (action) return { type: 'held', action };
        break;
      }
      case 7:
        return {
          type: 'gold',
          op: (['>=', '<=', '<'] as const)[int(2)] ?? '>=',
          value: Math.max(0, int(1)),
        };
      case 8: {
        const id = this.ctx.db.items.id(int(1));
        if (id) return { type: 'hasItem', kind: 'item', id };
        break;
      }
      case 9:
      case 10: {
        const id = (int(0) === 9 ? this.ctx.db.weapons : this.ctx.db.armors).id(int(1));
        if (id)
          return {
            type: 'hasItem',
            kind: 'equipment',
            id,
            ...(p[2] === true ? { includeEquipped: true } : {}),
          };
        break;
      }
    }
    this.left.redo++;
    return { type: 'switch', switch: this.ctx.redoSwitch(), value: true };
  }

  #variables(p: readonly unknown[]): Command[] {
    const int = (i: number) => asInt(p[i]);
    const op = VARIABLE_OPS[int(2)] ?? 'set';
    let value: CommandOf<'setVariable'>['value'];
    if (int(3) === 0) value = int(4);
    else if (int(3) === 1) value = { variable: this.ctx.variables.id(int(4)) };
    else if (int(3) === 2) value = { random: { min: int(4), max: int(5) } };
    else if (int(3) === 3) {
      const game = this.#gameValue(int(4), int(5), int(6));
      if (!game)
        return [this.#unsupported(122, `game data (${GAME_DATA_NAMES[int(4)] ?? 'other'})`)];
      value = { game };
    } else return [this.#unsupported(122, 'a script')];
    const out: Command[] = [];
    for (let n = int(0); n <= int(1) && out.length < 1000; n++) {
      if (n > 0) out.push({ type: 'setVariable', variable: this.ctx.variables.id(n), op, value });
    }
    return out;
  }

  /** MZ's game data for Control variables, where FreeQuest has it. */
  #gameValue(type: number, a: number, b: number): GameValue | null {
    switch (type) {
      case 0:
      case 1:
      case 2: {
        const id = (
          type === 0 ? this.ctx.db.items : type === 1 ? this.ctx.db.weapons : this.ctx.db.armors
        ).id(a);
        return id ? { type: 'itemCount', kind: type === 0 ? 'item' : 'equipment', id } : null;
      }
      case 3: {
        const actor = this.ctx.db.actors.id(a);
        const stat = ACTOR_STATS[b];
        return actor && stat ? { type: 'actorStat', actor, stat } : null;
      }
      case 5: {
        const target = this.#character(a);
        const axis = b === 0 ? 'x' : b === 1 ? 'y' : null;
        return target && axis ? { type: 'position', target, axis } : null;
      }
      case 7:
        return (
          (
            {
              1: { type: 'partySize' },
              2: { type: 'gold' },
              3: { type: 'steps' },
              4: { type: 'playTime' },
            } as const
          )[a] ?? null
        );
    }
    return null;
  }

  /** Show picture (231) or Move picture (232): its look, and a move's time and easing. */
  async #picture(code: 231 | 232, p: readonly unknown[]): Promise<Command[]> {
    const int = (i: number) => asInt(p[i]);
    const number = int(0);
    if (number < 1 || number > 100) return [this.#unsupported(code, `picture number ${number}`)];
    const byVariables = int(3) === 1;
    const position = (i: number) =>
      byVariables ? { variable: this.ctx.variables.id(int(i)) } : int(i);
    const look = {
      origin: int(2) === 1 ? ('center' as const) : ('top-left' as const),
      x: position(4),
      y: position(5),
      scaleX: Math.max(0, Math.min(2000, int(6))),
      scaleY: Math.max(0, Math.min(2000, int(7))),
      opacity: Math.round((Math.max(0, Math.min(255, int(8))) / 255) * 1000) / 1000,
    };
    if (int(9) !== 0) {
      this.left.notes.add('A picture used a blend mode (add, multiply…); it’s drawn normally.');
    }
    if (code === 232) {
      return [
        {
          type: 'movePicture',
          number,
          ...look,
          seconds: Math.min(60, frames(int(10))),
          easing: EASINGS[int(12)] ?? 'linear',
          wait: p[11] === true,
        },
      ];
    }
    // A picture shown with no image leaves its slot empty: MZ's way of erasing it.
    if (asString(p[1]) === '') return [{ type: 'erasePicture', number }];
    const image = await this.ctx.graphics.picture(asString(p[1]), this.scope.where);
    if (!image)
      return [this.#unsupported(231, `a picture that isn’t there (${asString(p[1]) || 'none'})`)];
    return [{ type: 'showPicture', number, image, ...look }];
  }

  /** MZ's character number: -1 the player, 0 this event, else an event on this map. */
  #character(n: number): string | null {
    if (n < 0) return 'player';
    if (n === 0) return 'this';
    return this.scope.event(n);
  }

  #placeEvent(p: readonly unknown[]): Command {
    const int = (i: number) => asInt(p[i]);
    const event = int(0) === 0 ? null : this.scope.event(int(0));
    if (int(0) !== 0 && !event) return this.#unsupported(203, `for missing event ${int(0)}`);
    const direction = DIRECTIONS[int(4)];
    const where =
      int(1) === 0
        ? { x: Math.max(0, int(2)), y: Math.max(0, int(3)) }
        : int(1) === 1
          ? {
              x: { variable: this.ctx.variables.id(int(2)) },
              y: { variable: this.ctx.variables.id(int(3)) },
            }
          : null;
    if (!where) return this.#unsupported(203, 'swapping with another event');
    return {
      type: 'placeEvent',
      ...(event ? { event } : {}),
      ...where,
      ...(direction ? { direction } : {}),
    };
  }

  /** Change HP (311), MP (312) or a state (313) for one actor or the whole party. */
  #actorChange(code: 311 | 312 | 313, p: readonly unknown[]): Command[] {
    const int = (i: number) => asInt(p[i]);
    if (int(0) !== 0) return [this.#unsupported(code, 'actor from a variable')];
    const actor = int(1) > 0 ? this.ctx.db.actors.id(int(1)) : null;
    if (int(1) > 0 && !actor) return [this.#unsupported(code, `missing actor ${int(1)}`)];
    const who = actor ? { actor } : {};
    if (code === 313) {
      const state = this.ctx.db.states.id(int(3));
      if (!state) return [this.#unsupported(code, `missing state ${int(3)}`)];
      return [{ type: 'changeState', ...who, action: int(2) === 0 ? 'add' : 'remove', state }];
    }
    const amount = this.#amount(int(2), int(3), int(4));
    if (amount === null) return [this.#unsupported(code, 'by a variable, decreasing')];
    return code === 311
      ? [{ type: 'changeHp', ...who, amount, canKnockOut: p[5] === true }]
      : [{ type: 'changeMp', ...who, amount }];
  }

  /** Gold or item amounts: increase (0) or decrease (1), by a number (0) or a variable (1). */
  #amount(
    operation: number,
    operandType: number,
    operand: number,
  ): CommandOf<'changeGold'>['amount'] | null {
    if (operandType === 0) return operation === 0 ? operand : -operand;
    if (operation !== 0) return null;
    return { variable: this.ctx.variables.id(operand) };
  }

  #transfer(p: readonly unknown[]): Command {
    if (asInt(p[0]) !== 0) return this.#unsupported(201, 'a place from variables');
    const map = this.ctx.map(asInt(p[1]));
    const size = map ? this.ctx.mapSize(map) : null;
    if (!map || !size)
      return this.#unsupported(201, `to map ${asInt(p[1])}, which wasn't imported`);
    const direction = DIRECTIONS[asInt(p[4])];
    return {
      type: 'transfer',
      map,
      x: Math.max(0, Math.min(size.width - 1, asInt(p[2]))),
      y: Math.max(0, Math.min(size.height - 1, asInt(p[3]))),
      ...(direction ? { direction } : {}),
    };
  }

  async #moveRoute(p: readonly unknown[]): Promise<Command[]> {
    const who = asInt(p[0]);
    const target = who < 0 ? 'player' : who === 0 ? 'this' : this.scope.event(who);
    if (!target) return [this.#unsupported(205, `for missing event ${who}`)];
    const route = asRecord(p[1]);
    const steps = await this.routeSteps(route['list']);
    if (steps.length === 0) return [];
    const repeat = route['repeat'] === true;
    return [
      {
        type: 'moveRoute',
        target,
        steps,
        repeat,
        skipBlocked: route['skippable'] === true,
        wait: !repeat && route['wait'] === true,
      },
    ];
  }

  /** MZ move route commands as route steps; ones FreeQuest lacks are noted. */
  async routeSteps(list: unknown): Promise<MoveStep[]> {
    const steps: MoveStep[] = [];
    const MOVES: Readonly<Record<number, RouteDirection>> = {
      1: 'down',
      2: 'left',
      3: 'right',
      4: 'up',
      9: 'random',
      10: 'toward-player',
      11: 'away-from-player',
      12: 'forward',
      5: 'down-left',
      6: 'down-right',
      7: 'up-left',
      8: 'up-right',
      13: 'backward',
    };
    const TURNS: Readonly<Record<number, TurnDirection>> = {
      16: 'down',
      17: 'left',
      18: 'right',
      19: 'up',
      20: 'clockwise',
      21: 'counterclockwise',
      22: 'around',
      23: 'random',
      24: 'random',
      25: 'toward-player',
      26: 'away-from-player',
    };
    for (const raw of asArray(list)) {
      const c = asRecord(raw);
      const code = asInt(c['code']);
      const params = asArray(c['parameters']);
      const move = MOVES[code];
      const turn = TURNS[code];
      if (code === 0) continue;
      if (move) steps.push({ type: 'move', direction: move });
      else if (turn) steps.push({ type: 'turn', direction: turn });
      else if (code === 15) {
        const seconds = frames(asInt(params[0]));
        if (seconds > 0) steps.push({ type: 'wait', seconds: Math.min(60, seconds) });
      } else if (code === 29) steps.push({ type: 'speed', speed: moveSpeed(asInt(params[0], 4)) });
      else if (code === 14) {
        const clamp8 = (n: number) => Math.max(-8, Math.min(8, n));
        steps.push({ type: 'jump', x: clamp8(asInt(params[0])), y: clamp8(asInt(params[1])) });
      } else if (code === 27 || code === 28) {
        const n = asInt(params[0]);
        if (n > 0)
          steps.push({ type: 'switch', switch: this.ctx.switches.id(n), value: code === 27 });
      } else if (ON_OFF_STEPS[code]) {
        const [type, on] = ON_OFF_STEPS[code];
        steps.push({ type, on });
      } else if (code === 41) {
        const character = await this.ctx.graphics.character(
          asString(params[0]),
          asInt(params[1]),
          this.scope.where,
        );
        // MZ hides a character by giving it no image, and shows it by giving one back.
        if (character) steps.push({ type: 'character', character }, { type: 'hidden', on: false });
        else if (asString(params[0]) === '') steps.push({ type: 'hidden', on: true });
      } else if (code === 44) {
        const path = await this.#sound('se', params[0]);
        if (path) steps.push({ type: 'sound', path });
      } else Leftovers.count(this.left.routeSteps, ROUTE_NAMES[code] ?? `route command ${code}`);
    }
    return steps;
  }

  #shop(p: readonly unknown[], lines: readonly { params: readonly unknown[] }[]): Command {
    const goods: ShopGood[] = [];
    for (const g of [p, ...lines.map((l) => l.params)]) {
      const kind = asInt(g[0]);
      const list =
        kind === 0 ? this.ctx.db.items : kind === 1 ? this.ctx.db.weapons : this.ctx.db.armors;
      const id = list.id(asInt(g[1]));
      if (!id) continue;
      const price = asInt(g[2]) === 1 ? Math.max(0, asInt(g[3])) : null;
      goods.push({
        kind: kind === 0 ? 'item' : 'equipment',
        id,
        ...(price !== null ? { price } : {}),
      });
    }
    if (goods.length === 0) return this.#unsupported(302, 'with no goods that exist');
    return { type: 'shop', goods, canSell: p[4] !== true };
  }

  async #sound(folder: AudioFolder, raw: unknown): Promise<string | null> {
    const name = asString(asRecord(raw)['name']).trim();
    return this.ctx.audio.sound(folder, name, this.scope.where);
  }
}

/** MZ's on/off route commands and the steps they become. */
const ON_OFF_STEPS: Readonly<
  Record<
    number,
    readonly ['walkAnimation' | 'stepAnimation' | 'fixFacing' | 'through' | 'hidden', boolean]
  >
> = {
  31: ['walkAnimation', true],
  32: ['walkAnimation', false],
  33: ['stepAnimation', true],
  34: ['stepAnimation', false],
  35: ['fixFacing', true],
  36: ['fixFacing', false],
  37: ['through', true],
  38: ['through', false],
  39: ['hidden', true],
  40: ['hidden', false],
};

const ROUTE_NAMES: Readonly<Record<number, string>> = {
  5: 'diagonal moves',
  6: 'diagonal moves',
  7: 'diagonal moves',
  8: 'diagonal moves',
  13: 'step backward',
  14: 'jump',
  20: 'turn 90°',
  21: 'turn 90°',
  23: 'turn 90° at random',
  27: 'switch on/off',
  28: 'switch on/off',
  30: 'frequency',
  31: 'walking animation',
  32: 'walking animation',
  33: 'stepping animation',
  34: 'stepping animation',
  35: 'direction fix',
  36: 'direction fix',
  37: 'through',
  38: 'through',
  39: 'transparency',
  40: 'transparency',
  41: 'change image',
  42: 'opacity',
  43: 'blend mode',
  44: 'play sound',
  45: 'script',
};

const frames = (n: number) => Math.round((Math.max(0, n) / 60) * 100) / 100;
const clampByte = (n: number) => Math.max(0, Math.min(255, n));
const hexColor = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => clampByte(Math.round(v)).toString(16).padStart(2, '0')).join('')}`;

/**
 * MZ tints add a tone (−255…255 per channel, plus grey) to the screen;
 * FreeQuest blends a colour over it. The colour leans the tone's way, the
 * strength grows with its size.
 */
export function tint(tone: readonly number[]): { color: string; strength: number } {
  const [r = 0, g = 0, b = 0, gray = 0] = tone;
  const size = Math.max(Math.abs(r), Math.abs(g), Math.abs(b));
  const strength = Math.round(Math.min(1, size / 255 + Math.max(0, gray) / 510) * 100) / 100;
  return { color: hexColor(127.5 + r / 2, 127.5 + g / 2, 127.5 + b / 2), strength };
}

// --- Pages, map events and common events -------------------------------------

/** One command list, with what it left out reported once at `scope.where`. */
export async function convertList(
  list: unknown,
  ctx: EventsContext,
  scope: ListScope,
): Promise<Command[]> {
  const converter = new Converter(ctx, scope);
  const commands = await converter.list(commandTree(list));
  converter.left.reportTo(ctx.report, scope.where);
  return commands;
}

const TRIGGERS: readonly EventTrigger[] = ['action', 'touch', 'touch', 'autorun', 'parallel'];
const LAYERS: readonly EventLayer[] = ['below', 'same', 'above'];

async function convertPage(
  page: JsonRecord,
  ctx: EventsContext,
  scope: ListScope,
): Promise<EventPage> {
  const c = asRecord(page['conditions']);
  const conditions: Condition[] = [];
  for (const key of ['switch1', 'switch2'] as const) {
    if (c[`${key}Valid`] === true) {
      conditions.push({
        type: 'switch',
        switch: ctx.switches.id(asInt(c[`${key}Id`])),
        value: true,
      });
    }
  }
  if (c['variableValid'] === true) {
    conditions.push({
      type: 'variable',
      variable: ctx.variables.id(asInt(c['variableId'])),
      op: '>=',
      value: asInt(c['variableValue']),
    });
  }
  if (c['selfSwitchValid'] === true) {
    conditions.push({
      type: 'flag',
      flag: asString(c['selfSwitchCh'], 'A').toLowerCase(),
      value: true,
    });
  }
  if (c['itemValid'] === true) {
    const id = ctx.db.items.id(asInt(c['itemId']));
    if (id) conditions.push({ type: 'hasItem', kind: 'item', id });
  }
  if (c['actorValid'] === true) {
    const actor = ctx.db.actors.id(asInt(c['actorId']));
    if (actor) conditions.push({ type: 'inParty', actor });
  }

  const image = asRecord(page['image']);
  const direction = DIRECTIONS[asInt(image['direction'], 2)] ?? 'down';
  const tile = asInt(image['tileId']);
  const name = asString(image['characterName']);
  let character: string | null = null;
  if (tile > 0 && scope.drawer) character = await ctx.graphics.tileCharacter(scope.drawer, tile);
  else if (name)
    character = await ctx.graphics.character(name, asInt(image['characterIndex']), scope.where);

  const moveType = asInt(page['moveType']);
  const speed = moveSpeed(asInt(page['moveSpeed'], 3));
  const pause = PAUSES[asInt(page['moveFrequency'], 3)] ?? 0.5;
  let movement: EventMovement | null = null;
  if (moveType === 1 || moveType === 2)
    movement = { type: moveType === 1 ? 'random' : 'approach', speed, pause };
  const converter = new Converter(ctx, scope);
  if (moveType === 3) {
    const route = asRecord(page['moveRoute']);
    const steps = await converter.routeSteps(route['list']);
    if (steps.length > 0) movement = { type: 'route', speed, pause, steps };
    if (route['repeat'] === false)
      converter.left.notes.add('Its own route walked once; FreeQuest page routes repeat.');
  }
  const commands = await converter.list(commandTree(page['list']));
  converter.left.reportTo(ctx.report, scope.where);

  return {
    conditions,
    ...(character
      ? {
          graphic: {
            character,
            direction,
            ...(page['directionFix'] === true ? { fixed: true } : {}),
            ...(page['stepAnime'] === true ? { stepping: true } : {}),
          },
        }
      : {}),
    trigger: TRIGGERS[asInt(page['trigger'])] ?? 'action',
    layer: LAYERS[asInt(page['priorityType'], 1)] ?? 'same',
    ...(page['through'] === true ? { through: true } : {}),
    ...(movement ? { movement } : {}),
    commands,
  };
}

export interface MapEventsInput {
  readonly raw: JsonRecord;
  readonly mapWhere: string;
  readonly drawer: TileDrawer | null;
  readonly width: number;
  readonly height: number;
}

/** Every event of an MZ map. Ids come from names, unique on the map. */
export async function convertMapEvents(
  input: MapEventsInput,
  ctx: EventsContext,
): Promise<MapEvent[]> {
  const raws = asArray(input.raw['events']).filter(isRecord);
  const ids = new Map<number, string>();
  const taken = new Set<string>(['player', 'this']);
  for (const e of raws) {
    const n = asInt(e['id']);
    const base = idFromEventName(asString(e['name']), n);
    let id = base;
    for (let k = 2; taken.has(id); k++) id = `${base}-${k}`;
    taken.add(id);
    ids.set(n, id);
  }
  const events: MapEvent[] = [];
  for (const e of raws) {
    const n = asInt(e['id']);
    const id = ids.get(n);
    if (!id) continue;
    const name = asString(e['name']).trim() || `Event ${n}`;
    const scope: ListScope = {
      where: `${input.mapWhere} › ${name}`,
      event: (m) => ids.get(m) ?? null,
      drawer: input.drawer,
    };
    const pages: EventPage[] = [];
    for (const page of asArray(e['pages']).filter(isRecord))
      pages.push(await convertPage(page, ctx, scope));
    if (pages.length === 0) continue;
    events.push({
      id,
      name,
      x: Math.max(0, Math.min(input.width - 1, asInt(e['x']))),
      y: Math.max(0, Math.min(input.height - 1, asInt(e['y']))),
      pages,
    });
  }
  return events;
}

function idFromEventName(name: string, n: number): string {
  const slug = idFromName(name, '');
  return slug && slug !== 'player' && slug !== 'this' ? slug : `event-${n}`;
}

const COMMON_TRIGGERS = ['call', 'autorun', 'parallel'] as const;

/** MZ's common events (named or with commands). */
export async function convertCommonEvents(
  raw: unknown,
  ids: NumberedIds,
  ctx: EventsContext,
): Promise<
  {
    id: string;
    name: string;
    trigger: 'call' | 'autorun' | 'parallel';
    switch?: string;
    commands: Command[];
  }[]
> {
  const out = [];
  for (const [n, entry] of asArray(raw).entries()) {
    if (n === 0 || !isRecord(entry)) continue;
    const name = asString(entry['name']).trim();
    if (!name && asArray(entry['list']).length <= 1) continue;
    const where = `Common events › ${name || `Common event ${n}`}`;
    const trigger = COMMON_TRIGGERS[asInt(entry['trigger'])] ?? 'call';
    const commands = await convertList(entry['list'], ctx, {
      where,
      event: () => null,
      drawer: null,
    });
    out.push({
      id: ids.id(n),
      name: name || `Common event ${n}`,
      trigger,
      ...(trigger !== 'call' ? { switch: ctx.switches.id(asInt(entry['switchId'], 1)) } : {}),
      commands,
    });
  }
  return out;
}

/** Commands that can't run in a battle event (FreeQuest's checks refuse them there). */
const NOT_IN_BATTLE = new Set<Command['type']>([
  'transfer',
  'battle',
  'shop',
  'openSave',
  'returnToTitle',
  'gameOver',
  'moveRoute',
  'placeEvent',
  'scrollMap',
]);

/**
 * Troops' battle events: each MZ troop page with commands becomes a battle
 * event (conditions, span, commands). MZ counts turns from 0 before the first
 * one; FreeQuest's turn 1 is that one, so turn A becomes from A + 1.
 */
export async function convertTroopEvents(
  troops: MzList,
  imported: readonly TroopEntry[],
  ctx: EventsContext,
): Promise<TroopEntry[]> {
  const out: TroopEntry[] = [];
  for (const troop of imported) {
    const source = [...troops].find((t) => t.id === troop.id);
    if (!source) {
      out.push(troop);
      continue;
    }
    // Enemy positions among the members that came across.
    const kept: number[] = [];
    asArray(source.entry['members']).forEach((raw, i) => {
      if (ctx.db.enemies.id(asInt(asRecord(raw)['enemyId']))) kept.push(i);
    });
    const events: TroopEvent[] = [];
    const pages = asArray(source.entry['pages']).map(asRecord);
    for (const [p, page] of pages.entries()) {
      if (asArray(page['list']).length <= 1) continue;
      const where = `Troops › ${source.name} › Battle event ${p + 1}`;
      const c = asRecord(page['conditions']);
      const conditions: TroopEvent['conditions'] = {};
      if (c['turnValid'] === true) {
        conditions.turn = {
          from: Math.max(0, asInt(c['turnA'])) + 1,
          every: Math.max(0, asInt(c['turnB'])),
        };
      }
      if (c['turnEnding'] === true) conditions.turnEnd = true;
      if (c['enemyValid'] === true) {
        const enemy = kept.indexOf(asInt(c['enemyIndex']));
        if (enemy >= 0) {
          conditions.enemyHp = {
            enemy,
            below: Math.max(0, Math.min(100, asInt(c['enemyHp'], 50))),
          };
        }
      }
      if (c['actorValid'] === true) {
        const actor = ctx.db.actors.id(asInt(c['actorId']));
        if (actor) {
          conditions.actorHp = {
            actor,
            below: Math.max(0, Math.min(100, asInt(c['actorHp'], 50))),
          };
        }
      }
      if (c['switchValid'] === true) conditions.switch = ctx.switches.id(asInt(c['switchId'], 1));
      // A page with no conditions never runs, in MZ as in FreeQuest: kept as it is.
      const commands = await convertList(page['list'], ctx, {
        where,
        event: () => null,
        drawer: null,
      });
      let refused = 0;
      const allowed = mapCommands(commands, (command) => {
        if (!NOT_IN_BATTLE.has(command.type)) return command;
        refused++;
        return {
          type: 'comment',
          text: `From MZ, not imported: ${command.type} (can't run in a battle)`,
        };
      });
      if (refused > 0) {
        ctx.report.changed(
          where,
          `${refused} ${refused === 1 ? 'command needs' : 'commands need'} the map (a transfer, a route…), which a battle event can't use; kept as comments.`,
          [{ name: 'Map commands in battle events', count: refused }],
        );
      }
      events.push({
        conditions,
        span: (['battle', 'turn', 'moment'] as const)[asInt(page['span'])] ?? 'battle',
        commands: allowed,
      });
    }
    out.push(events.length > 0 ? { ...troop, events } : troop);
  }
  return out;
}
