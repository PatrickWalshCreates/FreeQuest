import type { EventPage, MapEvent } from '@freequest/schema';
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
