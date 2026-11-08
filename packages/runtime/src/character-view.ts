import type { Direction } from '@freequest/core';
import type { CharacterSheet } from '@freequest/schema';
import { Sprite, type Texture } from 'pixi.js';

/** Animation frames advanced per tile walked. */
const FRAMES_PER_TILE = 2;

/** What a character view needs to know to pick a frame. GridMover satisfies it. */
export interface CharacterPose {
  readonly direction: Direction;
  readonly isMoving: boolean;
  readonly distanceWalked: number;
}

/** A character sheet with its image cut into frames, row by row. */
export interface CharacterGraphic {
  readonly sheet: CharacterSheet;
  readonly frames: readonly Texture[];
}

/** Draws a character. Purely a view: reads state, never changes it. */
export class CharacterView {
  readonly sprite: Sprite;
  private graphic: CharacterGraphic;

  constructor(graphic: CharacterGraphic) {
    this.graphic = graphic;
    this.sprite = new Sprite(this.frameFor('down', graphic.sheet.idleFrame));
    // Feet at the bottom center of the tile.
    this.sprite.anchor.set(0.5, 1);
  }

  /** Switch to another character sheet (e.g. an event page with a different graphic). */
  setGraphic(graphic: CharacterGraphic): void {
    this.graphic = graphic;
  }

  private frameFor(direction: Direction, column: number): Texture {
    const { sheet, frames } = this.graphic;
    const row = sheet.rows.indexOf(direction);
    const texture = column < sheet.frames ? frames[row * sheet.frames + column] : undefined;
    if (row === -1 || !texture) {
      throw new Error(`character "${sheet.id}": no frame ${column} for ${direction}`);
    }
    return texture;
  }

  /** `realX`/`realY` are interpolated tile coordinates. */
  update(
    pose: CharacterPose,
    realX: number,
    realY: number,
    tileWidth: number,
    tileHeight: number,
  ): void {
    const { walkCycle, idleFrame } = this.graphic.sheet;
    const column = pose.isMoving
      ? (walkCycle[Math.floor(pose.distanceWalked * FRAMES_PER_TILE) % walkCycle.length] ??
        idleFrame)
      : idleFrame;
    this.sprite.texture = this.frameFor(pose.direction, column);
    this.sprite.position.set((realX + 0.5) * tileWidth, (realY + 1) * tileHeight);
  }
}
