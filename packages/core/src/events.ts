import type { Direction, EventPage, MapEvent } from '@freequest/schema';
import { type GameState, evaluateConditions } from './game-state.js';

/**
 * Index of the event's active page: the last page whose conditions all hold,
 * or -1 if none does (the event is then absent from the map).
 */
export function activePageIndex(event: MapEvent, state: GameState): number {
  for (let i = event.pages.length - 1; i >= 0; i--) {
    const page = event.pages[i];
    if (page && evaluateConditions(page.conditions, state)) return i;
  }
  return -1;
}

export function activePage(event: MapEvent, state: GameState): EventPage | null {
  return event.pages[activePageIndex(event, state)] ?? null;
}

/** Live state of a map event: where it is, which page is active, which way it faces. */
export class EventInstance {
  readonly data: MapEvent;
  x: number;
  y: number;
  direction: Direction;
  private index = -1;

  constructor(data: MapEvent, state: GameState) {
    this.data = data;
    this.x = data.x;
    this.y = data.y;
    this.direction = 'down';
    this.refresh(state);
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
  refresh(state: GameState, keepDirection = false): void {
    const next = activePageIndex(this.data, state);
    if (next === this.index) return;
    this.index = next;
    if (!keepDirection) this.direction = this.page?.graphic?.direction ?? 'down';
  }
}
