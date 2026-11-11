import type { EventInstance } from '@freequest/core';
import type { EventLayer } from '@freequest/schema';
import type { Container } from 'pixi.js';
import { type CharacterGraphic, CharacterView } from './character-view.js';

/** Depth offsets so below/above events always sort under/over characters. */
const LAYER_DEPTH: Record<EventLayer, number> = { below: -10_000, same: 0, above: 10_000 };

/** Depth for something whose feet are on tile row `y`: lower on screen draws in front. */
export function depthFor(y: number, layer: EventLayer = 'same'): number {
  return LAYER_DEPTH[layer] + y;
}

/** Sprites for map events, kept in sync with their active pages. */
export class EventViews {
  private readonly views = new Map<EventInstance, CharacterView>();
  /** Each event's position before the latest logic step, for smooth drawing between steps. */
  private readonly previous = new Map<EventInstance, { x: number; y: number }>();

  constructor(
    private readonly events: readonly EventInstance[],
    private readonly graphics: ReadonlyMap<string, CharacterGraphic>,
    /** Must have `sortableChildren` so depth sorting applies. */
    private readonly container: Container,
  ) {}

  /** Remove and destroy every sprite this created (e.g. when leaving the map). */
  destroy(): void {
    for (const view of this.views.values()) view.sprite.destroy();
    this.views.clear();
  }

  /** Call before every logic step: where events were, to interpolate from. */
  remember(): void {
    for (const event of this.events) {
      this.previous.set(event, { x: event.mover.realX, y: event.mover.realY });
    }
  }

  /** Draw every event `alpha` (0..1) of the way from its previous to its current position. */
  update(tileWidth: number, tileHeight: number, alpha = 1): void {
    for (const event of this.events) {
      const page = event.page;
      const graphic = page?.graphic && this.graphics.get(page.graphic.character);
      let view = this.views.get(event);
      if (!page || !graphic) {
        if (view) view.sprite.visible = false;
        continue;
      }
      if (!view) {
        view = new CharacterView(graphic);
        this.views.set(event, view);
        this.container.addChild(view.sprite);
      }
      view.setGraphic(graphic);
      view.sprite.visible = true;
      const { mover } = event;
      const from = this.previous.get(event) ?? { x: mover.realX, y: mover.realY };
      const x = from.x + (mover.realX - from.x) * alpha;
      const y = from.y + (mover.realY - from.y) * alpha;
      view.update(
        {
          direction: event.direction,
          isMoving: mover.isMoving,
          distanceWalked: mover.distanceWalked,
        },
        x,
        y,
        tileWidth,
        tileHeight,
      );
      view.sprite.zIndex = depthFor(y, page.layer);
    }
  }
}
