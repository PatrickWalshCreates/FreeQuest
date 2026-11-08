import { type FormulaNode, parseFormula } from '@freequest/schema';

/** Something a formula can read `a.<key>` / `b.<key>` from (stats, hp, mp, level). */
export interface FormulaSubject {
  formulaValue(key: string): number;
}

export interface FormulaContext {
  /** The user of the skill or item. */
  readonly a: FormulaSubject;
  /** The target. */
  readonly b: FormulaSubject;
  variable(id: string): number;
  /** Uniform random number in [0, 1). Injected so results are reproducible in tests. */
  random(): number;
}

const parsed = new Map<string, FormulaNode>();

/** Parse once per distinct formula string. Throws FormulaError for invalid formulas. */
function compile(source: string): FormulaNode {
  let node = parsed.get(source);
  if (!node) {
    node = parseFormula(source);
    parsed.set(source, node);
  }
  return node;
}

const bool = (value: boolean): number => (value ? 1 : 0);

function evaluate(node: FormulaNode, ctx: FormulaContext): number {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'subject':
      return ctx[node.subject].formulaValue(node.key);
    case 'variable':
      return ctx.variable(node.id);
    case 'unary': {
      const value = evaluate(node.operand, ctx);
      return node.op === '-' ? -value : bool(value === 0);
    }
    case 'conditional':
      return evaluate(node.test, ctx) !== 0
        ? evaluate(node.then, ctx)
        : evaluate(node.otherwise, ctx);
    case 'binary': {
      // Short-circuit logic, like most languages.
      if (node.op === '&&') {
        return bool(evaluate(node.left, ctx) !== 0 && evaluate(node.right, ctx) !== 0);
      }
      if (node.op === '||') {
        return bool(evaluate(node.left, ctx) !== 0 || evaluate(node.right, ctx) !== 0);
      }
      const l = evaluate(node.left, ctx);
      const r = evaluate(node.right, ctx);
      switch (node.op) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case '/':
          return r === 0 ? 0 : l / r;
        case '%':
          return r === 0 ? 0 : l % r;
        case '==':
          return bool(l === r);
        case '!=':
          return bool(l !== r);
        case '<':
          return bool(l < r);
        case '<=':
          return bool(l <= r);
        case '>':
          return bool(l > r);
        case '>=':
          return bool(l >= r);
      }
      break;
    }
    case 'call': {
      const args = node.args.map((arg) => evaluate(arg, ctx));
      const [x = 0, y = 0, z = 0] = args;
      switch (node.name) {
        case 'min':
          return Math.min(...args);
        case 'max':
          return Math.max(...args);
        case 'abs':
          return Math.abs(x);
        case 'floor':
          return Math.floor(x);
        case 'ceil':
          return Math.ceil(x);
        case 'round':
          return Math.round(x);
        case 'clamp':
          return Math.min(Math.max(x, y), z);
        case 'random': {
          const lo = Math.ceil(Math.min(x, y));
          const hi = Math.floor(Math.max(x, y));
          return lo + Math.floor(ctx.random() * (hi - lo + 1));
        }
      }
    }
  }
  throw new Error(`unhandled formula node ${JSON.stringify(node)}`);
}

/**
 * Evaluate a formula. Non-finite results (e.g. from huge numbers) become 0,
 * so a bad formula can't poison HP with NaN or Infinity.
 */
export function evaluateFormula(source: string, ctx: FormulaContext): number {
  const value = evaluate(compile(source), ctx);
  return Number.isFinite(value) ? value : 0;
}
