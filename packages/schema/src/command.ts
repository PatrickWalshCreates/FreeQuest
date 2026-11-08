import Type, { type Static } from 'typebox';
import { Direction, Id, NonNegativeInt } from './common.js';
import { Condition } from './condition.js';

const CommandList = Type.Array(Type.Ref('Command'));

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
    } else if (command.type === 'choice') {
      command.options.forEach((option, j) =>
        walkCommands(option.commands, visit, `${here}.options[${j}].commands`),
      );
    }
  });
}
