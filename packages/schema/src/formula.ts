// FreeQuest's formula language, used for damage and recovery amounts.
// It is a small, safe expression language: projects never run JavaScript.
//
//   a.attack * 4 - b.defense * 2
//   max(100, b.maxHp * 0.3)
//   v.boss_rage > 2 ? a.magicAttack * 3 : a.magicAttack * 2
//
// Everything is a number. Comparisons and logic yield 1 or 0. `a` is the
// user, `b` the target, `v.<id>` (or `v["any-id"]`) a game variable.
// This module parses and validates; core evaluates the resulting tree.

import { STAT_KEYS } from './database/common.js';

/** Properties readable on `a` and `b`. */
export const FORMULA_SUBJECT_KEYS: readonly string[] = [...STAT_KEYS, 'hp', 'mp', 'level'];

/** Built-in functions and how many arguments each takes. */
export const FORMULA_FUNCTIONS = {
  min: [1, Infinity],
  max: [1, Infinity],
  abs: [1, 1],
  floor: [1, 1],
  ceil: [1, 1],
  round: [1, 1],
  clamp: [3, 3],
  /** random(lo, hi): a random integer from lo to hi inclusive. */
  random: [2, 2],
} as const satisfies Record<string, readonly [number, number]>;
export type FormulaFunction = keyof typeof FORMULA_FUNCTIONS;

export type BinaryOp =
  '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||';

export type FormulaNode =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'subject'; readonly subject: 'a' | 'b'; readonly key: string }
  | { readonly kind: 'variable'; readonly id: string }
  | { readonly kind: 'unary'; readonly op: '-' | '!'; readonly operand: FormulaNode }
  | {
      readonly kind: 'binary';
      readonly op: BinaryOp;
      readonly left: FormulaNode;
      readonly right: FormulaNode;
    }
  | { readonly kind: 'call'; readonly name: FormulaFunction; readonly args: readonly FormulaNode[] }
  | {
      readonly kind: 'conditional';
      readonly test: FormulaNode;
      readonly then: FormulaNode;
      readonly otherwise: FormulaNode;
    };

export class FormulaError extends Error {
  override name = 'FormulaError';
  constructor(
    message: string,
    /** 0-based character offset in the source. */
    readonly position: number,
  ) {
    super(`${message} (at character ${position + 1})`);
  }
}

/** Longest formula accepted, and deepest nesting, so hostile files can't hang the player. */
export const MAX_FORMULA_LENGTH = 1000;
const MAX_DEPTH = 64;

type Token =
  | { type: 'number'; value: number; pos: number }
  | { type: 'name'; value: string; pos: number }
  | { type: 'string'; value: string; pos: number }
  | { type: 'op'; value: string; pos: number }
  | { type: 'end'; pos: number };

const OPERATORS = [
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
  '!',
  '?',
  ':',
  '(',
  ')',
  ',',
  '.',
  '[',
  ']',
];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i] ?? '';
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const number = /^(?:\d+\.?\d*|\.\d+)/.exec(source.slice(i));
    if (number) {
      tokens.push({ type: 'number', value: Number(number[0]), pos: i });
      i += number[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
    if (name) {
      tokens.push({ type: 'name', value: name[0], pos: i });
      i += name[0].length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = source.indexOf(ch, i + 1);
      if (end === -1) throw new FormulaError('unterminated string', i);
      tokens.push({ type: 'string', value: source.slice(i + 1, end), pos: i });
      i = end + 1;
      continue;
    }
    const op = OPERATORS.find((o) => source.startsWith(o, i));
    if (!op) throw new FormulaError(`unexpected character "${ch}"`, i);
    tokens.push({ type: 'op', value: op, pos: i });
    i += op.length;
  }
  tokens.push({ type: 'end', pos: source.length });
  return tokens;
}

const BINARY_LEVELS: readonly (readonly BinaryOp[])[] = [
  ['||'],
  ['&&'],
  ['==', '!=', '<', '<=', '>', '>='],
  ['+', '-'],
  ['*', '/', '%'],
];

class Parser {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  private get token(): Token {
    return this.tokens[this.index] ?? { type: 'end', pos: 0 };
  }

  private isOp(value: string): boolean {
    return this.token.type === 'op' && this.token.value === value;
  }

  private expectOp(value: string): void {
    if (!this.isOp(value)) throw new FormulaError(`expected "${value}"`, this.token.pos);
    this.index++;
  }

  parse(): FormulaNode {
    const node = this.expression();
    if (this.token.type !== 'end') {
      throw new FormulaError('unexpected input after the end of the formula', this.token.pos);
    }
    return node;
  }

  private expression(): FormulaNode {
    if (++this.depth > MAX_DEPTH)
      throw new FormulaError('formula is nested too deeply', this.token.pos);
    const test = this.binary(0);
    let node = test;
    if (this.isOp('?')) {
      this.index++;
      const then = this.expression();
      this.expectOp(':');
      const otherwise = this.expression();
      node = { kind: 'conditional', test, then, otherwise };
    }
    this.depth--;
    return node;
  }

  private binary(level: number): FormulaNode {
    const ops = BINARY_LEVELS[level];
    if (!ops) return this.unary();
    let left = this.binary(level + 1);
    for (;;) {
      const token = this.token;
      const op = token.type === 'op' ? ops.find((o) => o === token.value) : undefined;
      if (!op) return left;
      this.index++;
      // Comparisons don't chain: `a < b < c` is almost always a mistake.
      if (level === 2 && left.kind === 'binary' && ops.includes(left.op)) {
        throw new FormulaError('comparisons cannot be chained', token.pos);
      }
      left = { kind: 'binary', op, left, right: this.binary(level + 1) };
    }
  }

  private unary(): FormulaNode {
    if (this.isOp('-') || this.isOp('!')) {
      const op = this.token.type === 'op' && this.token.value === '-' ? '-' : '!';
      this.index++;
      if (++this.depth > MAX_DEPTH)
        throw new FormulaError('formula is nested too deeply', this.token.pos);
      const operand = this.unary();
      this.depth--;
      return { kind: 'unary', op, operand };
    }
    return this.primary();
  }

  private primary(): FormulaNode {
    const token = this.token;
    if (token.type === 'number') {
      this.index++;
      return { kind: 'number', value: token.value };
    }
    if (this.isOp('(')) {
      this.index++;
      const inner = this.expression();
      this.expectOp(')');
      return inner;
    }
    if (token.type !== 'name') {
      throw new FormulaError(
        token.type === 'end' ? 'unexpected end of formula' : 'expected a number, name or "("',
        token.pos,
      );
    }
    this.index++;
    const name = token.value;

    if (name === 'a' || name === 'b') {
      this.expectOp('.');
      const key = this.token;
      if (key.type !== 'name' || !FORMULA_SUBJECT_KEYS.includes(key.value)) {
        throw new FormulaError(
          `unknown property; ${name}. can read ${FORMULA_SUBJECT_KEYS.join(', ')}`,
          key.pos,
        );
      }
      this.index++;
      return { kind: 'subject', subject: name, key: key.value };
    }

    if (name === 'v') {
      if (this.isOp('.')) {
        this.index++;
        const id = this.token;
        if (id.type !== 'name') throw new FormulaError('expected a variable id after "v."', id.pos);
        this.index++;
        return { kind: 'variable', id: id.value };
      }
      if (this.isOp('[')) {
        this.index++;
        const id = this.token;
        if (id.type !== 'string') throw new FormulaError('expected a quoted variable id', id.pos);
        this.index++;
        this.expectOp(']');
        return { kind: 'variable', id: id.value };
      }
      throw new FormulaError('use v.<id> or v["id"] to read a variable', this.token.pos);
    }

    if (Object.hasOwn(FORMULA_FUNCTIONS, name)) {
      const fn = name as FormulaFunction;
      this.expectOp('(');
      const args: FormulaNode[] = [];
      if (!this.isOp(')')) {
        do {
          if (args.length > 0) this.index++; // the comma
          args.push(this.expression());
        } while (this.isOp(','));
      }
      this.expectOp(')');
      const [min, max] = FORMULA_FUNCTIONS[fn];
      if (args.length < min || args.length > max) {
        const expected =
          min === max ? `${min}` : max === Infinity ? `at least ${min}` : `${min}-${max}`;
        throw new FormulaError(
          `${fn}() takes ${expected} argument(s), got ${args.length}`,
          token.pos,
        );
      }
      return { kind: 'call', name: fn, args };
    }

    throw new FormulaError(
      `unknown name "${name}"; use a.<stat>, b.<stat>, v.<id> or a function (${Object.keys(FORMULA_FUNCTIONS).join(', ')})`,
      token.pos,
    );
  }
}

/** Parse a formula. Throws FormulaError on syntax errors or unknown names. */
export function parseFormula(source: string): FormulaNode {
  if (source.length > MAX_FORMULA_LENGTH) {
    throw new FormulaError(`formula is longer than ${MAX_FORMULA_LENGTH} characters`, 0);
  }
  return new Parser(tokenize(source)).parse();
}

/** Variable ids a formula reads. */
export function formulaVariables(node: FormulaNode): string[] {
  switch (node.kind) {
    case 'variable':
      return [node.id];
    case 'unary':
      return formulaVariables(node.operand);
    case 'binary':
      return [...formulaVariables(node.left), ...formulaVariables(node.right)];
    case 'call':
      return node.args.flatMap(formulaVariables);
    case 'conditional':
      return [node.test, node.then, node.otherwise].flatMap(formulaVariables);
    default:
      return [];
  }
}

/**
 * Validate a formula: syntax, names, and (if given) that every variable it
 * reads is declared. Returns an error message, or null when it is fine.
 */
export function checkFormula(
  source: string,
  declaredVariables?: ReadonlySet<string>,
): string | null {
  try {
    const node = parseFormula(source);
    if (declaredVariables) {
      const unknown = formulaVariables(node).find((id) => !declaredVariables.has(id));
      if (unknown !== undefined) return `undeclared variable "${unknown}"`;
    }
    return null;
  } catch (error) {
    if (error instanceof FormulaError) return error.message;
    throw error;
  }
}
