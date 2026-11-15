// A route's steps as a compact list: quick buttons add moves, turns, waits
// and speed changes, "More…" adds the rest (jumps, looks, sounds…); each row
// edits its value, moves up or down, or goes. Used by the moveRoute command
// dialog and by route page movement.
import { describeStep } from '@freequest/editor-core';
import type { MoveStep, RouteDirection, TurnDirection } from '@freequest/schema';
import { createContext, useContext } from 'react';

/** What some steps pick from: the project's characters, switches and sounds. */
export interface RouteChoices {
  readonly characters: readonly { readonly id: string; readonly name: string }[];
  readonly switches: readonly { readonly id: string; readonly name: string }[];
  readonly sounds: readonly string[];
}

export const RouteChoicesContext = createContext<RouteChoices>({
  characters: [],
  switches: [],
  sounds: [],
});

const MOVE_DIRECTIONS: readonly { value: RouteDirection; label: string }[] = [
  { value: 'up', label: '↑ Up' },
  { value: 'down', label: '↓ Down' },
  { value: 'left', label: '← Left' },
  { value: 'right', label: '→ Right' },
  { value: 'up-left', label: '↖ Up left' },
  { value: 'up-right', label: '↗ Up right' },
  { value: 'down-left', label: '↙ Down left' },
  { value: 'down-right', label: '↘ Down right' },
  { value: 'forward', label: 'Forward' },
  { value: 'backward', label: 'Backward (keeps facing)' },
  { value: 'toward-player', label: 'Toward the player' },
  { value: 'away-from-player', label: 'Away from the player' },
  { value: 'random', label: 'Random' },
];

const TURN_DIRECTIONS: readonly { value: TurnDirection; label: string }[] = [
  { value: 'up', label: '↑ Up' },
  { value: 'down', label: '↓ Down' },
  { value: 'left', label: '← Left' },
  { value: 'right', label: '→ Right' },
  { value: 'clockwise', label: '↻ A quarter clockwise' },
  { value: 'counterclockwise', label: '↺ A quarter counterclockwise' },
  { value: 'around', label: 'Around' },
  { value: 'toward-player', label: 'Toward the player' },
  { value: 'away-from-player', label: 'Away from the player' },
  { value: 'random', label: 'Random' },
];

const QUICK_MOVES: readonly { direction: RouteDirection; label: string }[] = [
  { direction: 'up', label: '↑' },
  { direction: 'down', label: '↓' },
  { direction: 'left', label: '←' },
  { direction: 'right', label: '→' },
];

/** The on/off steps: what their row says. */
const SWITCHES: Readonly<
  Record<'through' | 'fixFacing' | 'walkAnimation' | 'stepAnimation' | 'hidden', string>
> = {
  through: 'Walk through things',
  fixFacing: 'Keep facing',
  walkAnimation: 'Walking animation',
  stepAnimation: 'Step in place',
  hidden: 'Hidden',
};

/** Steps offered under "More…", made with a starting value. */
function moreSteps(choices: RouteChoices): { label: string; make: () => MoveStep | null }[] {
  return [
    { label: 'Jump', make: () => ({ type: 'jump', x: 0, y: 0 }) },
    {
      label: 'Look like a character',
      make: () => {
        const first = choices.characters[0];
        return first ? { type: 'character', character: first.id } : null;
      },
    },
    { label: 'Walk through things', make: () => ({ type: 'through', on: true }) },
    { label: 'Keep facing', make: () => ({ type: 'fixFacing', on: true }) },
    { label: 'Walking animation off', make: () => ({ type: 'walkAnimation', on: false }) },
    { label: 'Step in place', make: () => ({ type: 'stepAnimation', on: true }) },
    { label: 'Hide', make: () => ({ type: 'hidden', on: true }) },
    {
      label: 'Play a sound',
      make: () => {
        const first = choices.sounds[0];
        return first ? { type: 'sound', path: first } : null;
      },
    },
    {
      label: 'Set a switch',
      make: () => {
        const first = choices.switches[0];
        return first ? { type: 'switch', switch: first.id, value: true } : null;
      },
    },
  ];
}

function swap<T>(list: readonly T[], a: number, b: number): T[] {
  const next = [...list];
  const x = next[a];
  const y = next[b];
  if (x === undefined || y === undefined) return next;
  next[a] = y;
  next[b] = x;
  return next;
}

export function RouteSteps(props: {
  readonly steps: readonly MoveStep[];
  readonly onChange: (steps: MoveStep[]) => void;
}) {
  const { steps, onChange } = props;
  const choices = useContext(RouteChoicesContext);
  const add = (step: MoveStep) => onChange([...steps, step]);
  const set = (i: number, step: MoveStep) => onChange(steps.map((s, j) => (j === i ? step : s)));
  const more = moreSteps(choices);
  return (
    <div className="route-steps">
      <ol>
        {steps.map((step, i) => (
          <li key={i}>
            <span className="route-index">{i + 1}</span>
            <StepControl step={step} choices={choices} onChange={(next) => set(i, next)} />
            <span className="spacer" />
            <button
              type="button"
              className="icon"
              aria-label={`Move step ${i + 1} up`}
              disabled={i === 0}
              onClick={() => onChange(swap(steps, i, i - 1))}
            >
              ↑
            </button>
            <button
              type="button"
              className="icon"
              aria-label={`Move step ${i + 1} down`}
              disabled={i === steps.length - 1}
              onClick={() => onChange(swap(steps, i, i + 1))}
            >
              ↓
            </button>
            <button
              type="button"
              className="icon"
              aria-label={`Remove step ${i + 1}`}
              title={steps.length === 1 ? 'A route needs at least one step' : 'Remove this step'}
              disabled={steps.length === 1}
              onClick={() => onChange(steps.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </li>
        ))}
      </ol>
      <div className="route-add">
        <span className="muted small">Add:</span>
        {QUICK_MOVES.map((m) => (
          <button
            key={m.direction}
            type="button"
            title={`Walk one tile ${m.direction}`}
            onClick={() => add({ type: 'move', direction: m.direction })}
          >
            {m.label}
          </button>
        ))}
        <button type="button" onClick={() => add({ type: 'turn', direction: 'toward-player' })}>
          Turn
        </button>
        <button type="button" onClick={() => add({ type: 'wait', seconds: 1 })}>
          Wait
        </button>
        <button type="button" onClick={() => add({ type: 'speed', speed: 4 })}>
          Speed
        </button>
        <select
          aria-label="Add another kind of step"
          value=""
          onChange={(e) => {
            const step = more[Number(e.target.value)]?.make();
            if (step) add(step);
          }}
        >
          <option value="" disabled>
            More…
          </option>
          {more.map((m, i) => (
            <option key={m.label} value={i} disabled={m.make() === null}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function StepControl(props: {
  readonly step: MoveStep;
  readonly choices: RouteChoices;
  readonly onChange: (step: MoveStep) => void;
}) {
  const { step, choices, onChange } = props;
  switch (step.type) {
    case 'move':
      return (
        <label className="route-step">
          <span>Move</span>
          <select
            value={step.direction}
            aria-label="Move direction"
            onChange={(e) => onChange({ ...step, direction: e.target.value as RouteDirection })}
          >
            {MOVE_DIRECTIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      );
    case 'turn':
      return (
        <label className="route-step">
          <span>Turn</span>
          <select
            value={step.direction}
            aria-label="Turn direction"
            onChange={(e) => onChange({ ...step, direction: e.target.value as TurnDirection })}
          >
            {TURN_DIRECTIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      );
    case 'wait':
    case 'speed': {
      const isWait = step.type === 'wait';
      const value = isWait ? step.seconds : step.speed;
      return (
        <label className="route-step" title={describeStep(step)}>
          <span>{isWait ? 'Wait (s)' : 'Speed (tiles/s)'}</span>
          <input
            type="number"
            min={isWait ? 0 : 0.5}
            max={isWait ? 60 : 16}
            step={0.5}
            value={value}
            onChange={(e) => {
              const n = e.target.valueAsNumber;
              if (!Number.isFinite(n)) return;
              if (isWait && n >= 0 && n <= 60) onChange({ type: 'wait', seconds: n });
              if (!isWait && n > 0 && n <= 16) onChange({ type: 'speed', speed: n });
            }}
          />
        </label>
      );
    }
    case 'jump': {
      const axis = (key: 'x' | 'y', label: string) => (
        <input
          type="number"
          min={-8}
          max={8}
          step={1}
          aria-label={label}
          title={label}
          value={step[key]}
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            if (Number.isInteger(n) && n >= -8 && n <= 8) onChange({ ...step, [key]: n });
          }}
        />
      );
      return (
        <span
          className="route-step"
          title="Tiles across (− left) and down (− up); 0, 0 jumps on the spot"
        >
          <span>Jump</span>
          {axis('x', 'Tiles to the right (negative: left)')}
          {axis('y', 'Tiles down (negative: up)')}
        </span>
      );
    }
    case 'character':
      return (
        <label className="route-step">
          <span>Look like</span>
          <select
            value={step.character}
            onChange={(e) => onChange({ ...step, character: e.target.value })}
          >
            {!choices.characters.some((c) => c.id === step.character) && (
              <option value={step.character}>{step.character}</option>
            )}
            {choices.characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      );
    case 'sound':
      return (
        <label className="route-step">
          <span>Sound</span>
          <select value={step.path} onChange={(e) => onChange({ ...step, path: e.target.value })}>
            {!choices.sounds.includes(step.path) && <option value={step.path}>{step.path}</option>}
            {choices.sounds.map((s) => (
              <option key={s} value={s}>
                {s.replace(/^assets\//, '')}
              </option>
            ))}
          </select>
        </label>
      );
    case 'switch':
      return (
        <span className="route-step">
          <span>Switch</span>
          <select
            aria-label="Switch"
            value={step.switch}
            onChange={(e) => onChange({ ...step, switch: e.target.value })}
          >
            {!choices.switches.some((s) => s.id === step.switch) && (
              <option value={step.switch}>{step.switch}</option>
            )}
            {choices.switches.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || s.id}
              </option>
            ))}
          </select>
          <select
            aria-label="On or off"
            value={step.value ? 'on' : 'off'}
            onChange={(e) => onChange({ ...step, value: e.target.value === 'on' })}
          >
            <option value="on">on</option>
            <option value="off">off</option>
          </select>
        </span>
      );
    default:
      return (
        <label className="route-step">
          <span>{SWITCHES[step.type]}</span>
          <select
            value={step.on ? 'on' : 'off'}
            onChange={(e) => onChange({ ...step, on: e.target.value === 'on' })}
          >
            <option value="on">on</option>
            <option value="off">off</option>
          </select>
        </label>
      );
  }
}
