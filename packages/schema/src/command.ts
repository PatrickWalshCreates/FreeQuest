import Type, { type Static } from 'typebox';
import { Direction, Id, NonNegativeInt, RelativePath } from './common.js';
import { Condition } from './condition.js';
import { MoveSteps } from './route.js';

const CommandList = Type.Array(Type.Ref('Command'));

/** A colour as #rrggbb. */
export const HexColor = Type.String({
  pattern: '^#[0-9a-fA-F]{6}$',
  description: 'A colour, #rrggbb.',
});

/** Seconds an effect takes (0 = at once). */
const EffectSeconds = Type.Number({ minimum: 0, maximum: 60 });

/** Whether the event waits for an effect to finish before its next command. */
const WaitForIt = Type.Boolean({ description: 'Wait until it has finished.' });

/** Something a shop sells: an item or a piece of equipment, at its own price or another. */
export const ShopGood = Type.Object(
  {
    kind: Type.Union([Type.Literal('item'), Type.Literal('equipment')]),
    id: Id,
    /** Leave out to use the entry's own price. */
    price: Type.Optional(NonNegativeInt),
  },
  { additionalProperties: false },
);
export type ShopGood = Static<typeof ShopGood>;

export const VariableOp = Type.Union([
  Type.Literal('set'),
  Type.Literal('add'),
  Type.Literal('sub'),
  Type.Literal('mul'),
  Type.Literal('div'),
  Type.Literal('mod'),
]);
export type VariableOp = Static<typeof VariableOp>;

/** A literal integer, or the current value of another variable. */
export const Operand = Type.Union([
  Type.Integer(),
  Type.Object({ variable: Id }, { additionalProperties: false }),
]);
export type Operand = Static<typeof Operand>;

/**
 * Event commands form a tree: block commands (`if`, `choice`) contain their
 * own command lists. Every command has a `type` discriminator.
 */
export const Command = Type.Cyclic(
  {
    Command: Type.Union([
      Type.Object(
        {
          type: Type.Literal('message'),
          speaker: Type.Optional(Type.String()),
          face: Type.Optional(
            Type.Object(
              {
                image: Type.String({ minLength: 1 }),
                index: Type.Integer({ minimum: 0 }),
              },
              {
                additionalProperties: false,
                description:
                  'A face beside the text: a face sheet is one row of square faces (its height is their size), and index picks one, from 0 on the left.',
              },
            ),
          ),
          text: Type.String(),
        },
        { additionalProperties: false, description: 'Show a message box and wait for confirm.' },
      ),
      Type.Object(
        {
          type: Type.Literal('choice'),
          options: Type.Array(
            Type.Object(
              { label: Type.String({ minLength: 1 }), commands: CommandList },
              { additionalProperties: false },
            ),
            { minItems: 1 },
          ),
          cancel: Type.Optional(
            Type.Integer({
              minimum: 0,
              description: 'Option index taken when the player cancels. Omit to disallow cancel.',
            }),
          ),
        },
        { additionalProperties: false, description: 'Let the player pick one option.' },
      ),
      Type.Object(
        {
          type: Type.Literal('if'),
          conditions: Type.Array(Condition, {
            minItems: 1,
            description: 'All conditions must hold.',
          }),
          then: CommandList,
          else: Type.Optional(CommandList),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          type: Type.Literal('setSwitch'),
          switch: Id,
          value: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          type: Type.Literal('setFlag'),
          flag: Id,
          value: Type.Boolean(),
          /** Another event on this map; leave out for the event running the command. */
          event: Type.Optional(Id),
        },
        {
          additionalProperties: false,
          description: "Turn one of an event's own flags on or off (kept in saves).",
        },
      ),
      Type.Object(
        {
          type: Type.Literal('setVariable'),
          variable: Id,
          op: VariableOp,
          value: Operand,
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          type: Type.Literal('transfer'),
          map: Id,
          x: NonNegativeInt,
          y: NonNegativeInt,
          direction: Type.Optional(Direction),
        },
        { additionalProperties: false, description: 'Move the player to another map or tile.' },
      ),
      Type.Object(
        {
          type: Type.Literal('wait'),
          seconds: Type.Number({ exclusiveMinimum: 0 }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        { type: Type.Literal('changeGold'), amount: Operand },
        { additionalProperties: false, description: 'Negative amounts take gold away.' },
      ),
      Type.Object(
        {
          type: Type.Literal('changeItems'),
          kind: Type.Union([Type.Literal('item'), Type.Literal('equipment')]),
          id: Id,
          amount: Operand,
        },
        { additionalProperties: false, description: 'Negative amounts take items away.' },
      ),
      Type.Object(
        {
          type: Type.Literal('changeParty'),
          action: Type.Union([Type.Literal('add'), Type.Literal('remove')]),
          actor: Id,
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          type: Type.Literal('gainExp'),
          /** Omit for every party member. */
          actor: Type.Optional(Id),
          amount: Operand,
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          type: Type.Literal('recoverAll'),
          /** Omit for every party member. */
          actor: Type.Optional(Id),
        },
        { additionalProperties: false, description: 'Full HP/MP and clear states (e.g. an inn).' },
      ),
      Type.Object(
        {
          type: Type.Literal('battle'),
          troop: Id,
          canEscape: Type.Boolean(),
          /** When false, losing is game over. When true, the event continues with `onLose`. */
          canLose: Type.Boolean(),
          onWin: Type.Optional(CommandList),
          onEscape: Type.Optional(CommandList),
          onLose: Type.Optional(CommandList),
        },
        { additionalProperties: false, description: 'Fight a troop, then branch on the outcome.' },
      ),
      Type.Object(
        {
          type: Type.Literal('playMusic'),
          /** null stops the music. The map's own music returns on the next map change. */
          path: Type.Union([RelativePath, Type.Null()]),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        { type: Type.Literal('playSound'), path: RelativePath },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          type: Type.Literal('moveRoute'),
          /** "player", "this" (the event running the command) or an event id on this map. */
          target: Id,
          steps: MoveSteps,
          /** Walk the steps over and over (until the map changes or another route replaces it). */
          repeat: Type.Boolean(),
          /** Skip a step that's blocked instead of waiting until it's free. */
          skipBlocked: Type.Boolean(),
          /** Wait for the route to finish before the next command (not with repeat). */
          wait: Type.Boolean(),
        },
        { additionalProperties: false, description: 'Walk the player or an event along a route.' },
      ),
      Type.Object(
        {
          type: Type.Literal('shop'),
          goods: Type.Array(ShopGood, { minItems: 1 }),
          /** Let the player sell what they carry (at half price) too. */
          canSell: Type.Boolean(),
        },
        { additionalProperties: false, description: 'Open a shop to buy (and sell) goods.' },
      ),
      Type.Object(
        {
          type: Type.Literal('fadeScreen'),
          to: Type.Union([Type.Literal('out'), Type.Literal('in')]),
          seconds: EffectSeconds,
          wait: WaitForIt,
        },
        {
          additionalProperties: false,
          description:
            'Fade the screen to black (out) or back (in). It stays black until faded in.',
        },
      ),
      Type.Object(
        {
          type: Type.Literal('tintScreen'),
          color: HexColor,
          strength: Type.Number({
            minimum: 0,
            maximum: 1,
            description: '0 = no tint, 1 = all that colour.',
          }),
          seconds: EffectSeconds,
          wait: WaitForIt,
        },
        {
          additionalProperties: false,
          description: 'Tint the screen a colour (e.g. dusk), until tinted again. Kept in saves.',
        },
      ),
      Type.Object(
        {
          type: Type.Literal('flashScreen'),
          color: HexColor,
          seconds: EffectSeconds,
          wait: WaitForIt,
        },
        { additionalProperties: false, description: 'Flash the screen a colour, fading away.' },
      ),
      Type.Object(
        {
          type: Type.Literal('shakeScreen'),
          power: Type.Integer({
            minimum: 1,
            maximum: 20,
            description: 'How far it shakes, in pixels.',
          }),
          seconds: EffectSeconds,
          wait: WaitForIt,
        },
        { additionalProperties: false, description: 'Shake the screen side to side.' },
      ),
      Type.Object(
        {
          type: Type.Literal('hideEvent'),
          hidden: Type.Boolean(),
          /** Another event on this map; leave out for the event running the command. */
          event: Type.Optional(Id),
        },
        {
          additionalProperties: false,
          description:
            'Hide an event (as if it had no page) or show it again, until the map loads again.',
        },
      ),
      Type.Object(
        { type: Type.Literal('loop'), commands: CommandList },
        {
          additionalProperties: false,
          description: 'Repeat these commands until a Break loop (or Exit event) inside them.',
        },
      ),
      Type.Object(
        { type: Type.Literal('break') },
        { additionalProperties: false, description: 'Leave the loop this is in.' },
      ),
      Type.Object(
        { type: Type.Literal('exitEvent') },
        {
          additionalProperties: false,
          description: 'Stop the event here (also from inside a common event it called).',
        },
      ),
      Type.Object(
        {
          type: Type.Literal('callCommon'),
          common: Id,
        },
        {
          additionalProperties: false,
          description: 'Run a common event’s commands, then carry on here.',
        },
      ),
      Type.Object(
        {
          type: Type.Literal('comment'),
          text: Type.String(),
        },
        { additionalProperties: false, description: 'Note for authors. Does nothing.' },
      ),
    ]),
  },
  'Command',
);
export type Command = Static<typeof Command>;
export type CommandType = Command['type'];
export type CommandOf<T extends CommandType> = Extract<Command, { type: T }>;

/** Visit every command in a tree, depth first, including those nested in blocks. */
export function walkCommands(
  commands: readonly Command[],
  visit: (command: Command, path: string) => void,
  path = 'commands',
): void {
  commands.forEach((command, i) => {
    const here = `${path}[${i}]`;
    visit(command, here);
    if (command.type === 'if') {
      walkCommands(command.then, visit, `${here}.then`);
      if (command.else) walkCommands(command.else, visit, `${here}.else`);
    } else if (command.type === 'loop') {
      walkCommands(command.commands, visit, `${here}.commands`);
    } else if (command.type === 'choice') {
      command.options.forEach((option, j) =>
        walkCommands(option.commands, visit, `${here}.options[${j}].commands`),
      );
    } else if (command.type === 'battle') {
      for (const branch of ['onWin', 'onEscape', 'onLose'] as const) {
        const list = command[branch];
        if (list) walkCommands(list, visit, `${here}.${branch}`);
      }
    }
  });
}

/** A message's face: an image of square faces in one row, and which one. */
export interface MessageFace {
  readonly image: string;
  readonly index: number;
}

/**
 * How a face sheet of `width` × `height` pixels divides: square faces as tall
 * as the image, side by side. `count` is 0 for an image narrower than it is
 * tall (or empty).
 */
export function faceSheetLayout(width: number, height: number): { size: number; count: number } {
  const size = Math.floor(height);
  return { size, count: size > 0 ? Math.floor(width / size) : 0 };
}

/** Every face image the messages in these command lists show (each once, in order of use). */
export function faceImages(lists: readonly (readonly Command[])[]): string[] {
  const found = new Set<string>();
  for (const list of lists) {
    walkCommands(list, (command) => {
      if (command.type === 'message' && command.face) found.add(command.face.image);
    });
  }
  return [...found];
}

/**
 * Rebuild a command tree bottom-up: nested lists first, then `change` on
 * each command. Unchanged lists and commands keep their identity, so
 * `mapCommands(list, (c) => c) === list`.
 */
/**
 * Paths (as walkCommands writes them) of `break` commands that aren't inside
 * a loop of the same list, where they'd do nothing.
 */
export function strayBreaks(commands: readonly Command[], path = 'commands'): string[] {
  const found: string[] = [];
  const visit = (list: readonly Command[], at: string, inLoop: boolean) =>
    list.forEach((command, i) => {
      const here = `${at}[${i}]`;
      if (command.type === 'break' && !inLoop) found.push(here);
      if (command.type === 'loop') visit(command.commands, `${here}.commands`, true);
      else if (command.type === 'if') {
        visit(command.then, `${here}.then`, inLoop);
        if (command.else) visit(command.else, `${here}.else`, inLoop);
      } else if (command.type === 'choice') {
        command.options.forEach((o, j) =>
          visit(o.commands, `${here}.options[${j}].commands`, inLoop),
        );
      } else if (command.type === 'battle') {
        for (const branch of ['onWin', 'onEscape', 'onLose'] as const) {
          const list = command[branch];
          if (list) visit(list, `${here}.${branch}`, inLoop);
        }
      }
    });
  visit(commands, path, false);
  return found;
}

export function mapCommands(
  commands: readonly Command[],
  change: (command: Command) => Command,
): Command[] {
  let changed = false;
  const result = commands.map((command) => {
    let inner: Command = command;
    if (command.type === 'if') {
      const then = mapCommands(command.then, change);
      const otherwise = command.else && mapCommands(command.else, change);
      if (then !== command.then || otherwise !== command.else) {
        inner = { ...command, then, ...(otherwise ? { else: otherwise } : {}) };
      }
    } else if (command.type === 'loop') {
      const list = mapCommands(command.commands, change);
      if (list !== command.commands) inner = { ...command, commands: list };
    } else if (command.type === 'choice') {
      const options = command.options.map((option) => {
        const list = mapCommands(option.commands, change);
        return list === option.commands ? option : { ...option, commands: list };
      });
      if (options.some((option, i) => option !== command.options[i]))
        inner = { ...command, options };
    } else if (command.type === 'battle') {
      let next = command;
      for (const branch of ['onWin', 'onEscape', 'onLose'] as const) {
        const list = next[branch];
        if (!list) continue;
        const mapped = mapCommands(list, change);
        if (mapped !== list) next = { ...next, [branch]: mapped };
      }
      inner = next;
    }
    const out = change(inner);
    if (out !== command) changed = true;
    return out;
  });
  return changed ? result : (commands as Command[]);
}
