import type { Direction, EventPage, MapEvent } from '@freequest/schema';
import { type EventContext, type GameState, evaluateConditions } from './game-state.js';
import { GridMover } from './grid-mover.js';

/**
 * Index of the event's active page: the last page whose conditions all hold,
 * or -1 if none does (the event is then absent from the map).
 */
export function activePageIndex(event: MapEvent, context: EventContext | GameState): number {
  for (let i = event.pages.length - 1; i >= 0; i--) {
    const page = event.pages[i];
    if (page && evaluateConditions(page.conditions, context)) return i;
  }
  return -1;
}

export function activePage(event: MapEvent, context: EventContext | GameState): EventPage | null {
  return event.pages[activePageIndex(event, context)] ?? null;
}

/** Live state of a map event: where it is, which page is active, which way it faces. */
export class EventInstance {
  readonly data: MapEvent;
  /** Position and walking, tile by tile like the player (`x`/`y` = destination while moving). */
  readonly mover: GridMover;
  /** Seconds left standing still before the next step of its own movement. */
  pauseLeft = 0;
  private index = -1;

  constructor(data: MapEvent, context: EventContext | GameState) {
    this.data = data;
    this.mover = new GridMover({ x: data.x, y: data.y, direction: 'down', speed: 1 });
    this.refresh(context);
  }

  get x(): number {
    return this.mover.x;
  }

  get y(): number {
    return this.mover.y;
  }

  get direction(): Direction {
    return this.mover.direction;
  }

  set direction(direction: Direction) {
    this.mover.direction = direction;
  }

  /**
   * True if the event takes up (x, y): its tile, and while it walks the tile
   * it's leaving too, so nobody steps into a character half-way out of it.
   */
  occupies(x: number, y: number): boolean {
    if (x === this.x && y === this.y) return true;
    const m = this.mover;
    return m.isMoving && Math.abs(m.realX - x) < 1 && Math.abs(m.realY - y) < 1;
  }

  get id(): string {
    return this.data.id;
  }

  get pageIndex(): number {
    return this.index;
  }

  /** The active page, or null when the event is absent from the map. */
  get page(): EventPage | null {
    return this.data.pages[this.index] ?? null;
  }

  /** True when the event is present and on the characters' layer, so it blocks movement. */
  get blocks(): boolean {
    return this.page?.layer === 'same';
  }

  /**
   * Re-pick the active page. A page change resets the facing to that page's
   * graphic unless `keepDirection` (used for the event that is mid-conversation).
   */
  refresh(context: EventContext | GameState, keepDirection = false): void {
    const next = activePageIndex(this.data, context);
    if (next === this.index) return;
    this.index = next;
    if (!keepDirection) this.direction = this.page?.graphic?.direction ?? 'down';
  }
}
