// Scrolling the map: events move the view away from the player and back.
// Core keeps the offset (in tiles, advanced with the world's fixed steps);
// the runtime adds it to the camera's focus, where the map's edges still
// stop the view.

/** How far the view is moved from the player, and where it's heading. */
export class MapScroll {
  private currentX = 0;
  private currentY = 0;
  private targetX = 0;
  private targetY = 0;
  private speed = 4;
  /** Bumped by each scroll, so an older scroll's "finished" check knows it was replaced. */
  private generation = 0;

  /** The offset from the player, in tiles (x right, y down). */
  get x(): number {
    return this.currentX;
  }

  get y(): number {
    return this.currentY;
  }

  get isScrolling(): boolean {
    return this.currentX !== this.targetX || this.currentY !== this.targetY;
  }

  /**
   * Scroll by (dx, dy) tiles from where the last scroll is heading, at
   * `speed` tiles/s. Returns a check that's true once it has arrived (or
   * another scroll replaced it).
   */
  by(dx: number, dy: number, speed: number): () => boolean {
    return this.to(this.targetX + dx, this.targetY + dy, speed);
  }

  /** Scroll back to the player. */
  back(speed: number): () => boolean {
    return this.to(0, 0, speed);
  }

  private to(x: number, y: number, speed: number): () => boolean {
    this.targetX = x;
    this.targetY = y;
    this.speed = Math.max(speed, 0.01);
    const generation = ++this.generation;
    return () => generation !== this.generation || !this.isScrolling;
  }

  /** Back on the player at once (a new map). */
  reset(): void {
    this.currentX = this.targetX = 0;
    this.currentY = this.targetY = 0;
    this.generation++;
  }

  /** Move toward the target, in a straight line at the scroll's speed. */
  update(dt: number): void {
    const dx = this.targetX - this.currentX;
    const dy = this.targetY - this.currentY;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    const step = this.speed * dt;
    if (step >= distance - 1e-9) {
      this.currentX = this.targetX;
      this.currentY = this.targetY;
      return;
    }
    this.currentX += (dx / distance) * step;
    this.currentY += (dy / distance) * step;
  }
}
