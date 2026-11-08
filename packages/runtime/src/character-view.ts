import type { GridMover } from '@freequest/core';
import type { CharacterSheet } from '@freequest/schema';
import { Sprite, type Texture } from 'pixi.js';

/** Animation frames advanced per tile walked. */
const FRAMES_PER_TILE = 2;

/** Draws a GridMover with its character sheet. Purely a view: reads state, never changes it. */
export class CharacterView {
  readonly sprite: Sprite;
  private readonly sheet: CharacterSheet;
  /** frames[row][column] */
  private readonly frames: Texture[][];

  constructor(sheet: CharacterSheet, frames: readonly Texture[]) {
    this.sheet = sheet;
    this.frames = sheet.rows.map((_, row) =>
      frames.slice(row * sheet.frames, (row + 1) * sheet.frames),
    );
    this.sprite = new Sprite(this.frameFor('down', sheet.idleFrame));
    // Feet at the bottom center of the tile.
    this.sprite.anchor.set(0.5, 1);
  }

  private frameFor(direction: GridMover['direction'], column: number): Texture {
    const row = this.sheet.rows.indexOf(direction);
    const texture = this.frames[row]?.[column];
    if (!texture)
      throw new Error(`character "${this.sheet.id}": no frame ${column} for ${direction}`);
    return texture;
  }

  /** `realX`/`realY` are interpolated tile coordinates. */
  update(
    mover: GridMover,
    realX: number,
    realY: number,
    tileWidth: number,
    tileHeight: number,
  ): void {
    const { walkCycle, idleFrame } = this.sheet;
    const column = mover.isMoving
      ? (walkCycle[Math.floor(mover.distanceWalked * FRAMES_PER_TILE) % walkCycle.length] ??
        idleFrame)
      : idleFrame;
    this.sprite.texture = this.frameFor(mover.direction, column);
    this.sprite.position.set((realX + 0.5) * tileWidth, (realY + 1) * tileHeight);
  }
}
