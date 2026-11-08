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

  update(tileWidth: number, tileHeight: number): void {
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
      view.update(
        { direction: event.direction, isMoving: false, distanceWalked: 0 },
        event.x,
        event.y,
        tileWidth,
        tileHeight,
      );
      view.sprite.zIndex = depthFor(event.y, page.layer);
    }
  }
}
