// A route's steps as a compact list: quick buttons add moves, turns, waits
// and speed changes; each row edits its value, moves up or down, or goes.
// Used by the moveRoute command dialog and by route page movement.
import { describeStep } from '@freequest/editor-core';
import type { MoveStep, RouteDirection, TurnDirection } from '@freequest/schema';

const MOVE_DIRECTIONS: readonly { value: RouteDirection; label: string }[] = [
  { value: 'up', label: '↑ Up' },
  { value: 'down', label: '↓ Down' },
  { value: 'left', label: '← Left' },
  { value: 'right', label: '→ Right' },
  { value: 'forward', label: 'Forward' },
  { value: 'toward-player', label: 'Toward the player' },
  { value: 'away-from-player', label: 'Away from the player' },
  { value: 'random', label: 'Random' },
];

const TURN_DIRECTIONS: readonly { value: TurnDirection; label: string }[] = [
  { value: 'up', label: '↑ Up' },
  { value: 'down', label: '↓ Down' },
  { value: 'left', label: '← Left' },
  { value: 'right', label: '→ Right' },
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
  const add = (step: MoveStep) => onChange([...steps, step]);
  const set = (i: number, step: MoveStep) => onChange(steps.map((s, j) => (j === i ? step : s)));
  return (
    <div className="route-steps">
      <ol>
        {steps.map((step, i) => (
          <li key={i}>
            <span className="route-index">{i + 1}</span>
            <StepControl step={step} onChange={(next) => set(i, next)} />
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
      </div>
    </div>
  );
}

function StepControl(props: {
  readonly step: MoveStep;
  readonly onChange: (step: MoveStep) => void;
}) {
  const { step, onChange } = props;
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
  }
}
