// Draws the world's pictures in screen space, over the map and under the
// screen effects. Images load on first use and stay cached; a picture whose
// image hasn't loaded yet (or failed to, after a warning) isn't drawn.
import type { Picture } from '@freequest/core';
import { Container, Sprite, type Texture } from 'pixi.js';

export class PictureView {
  readonly container = new Container({ label: 'pictures' });
  private readonly textures = new Map<string, Texture | 'loading' | 'failed'>();
  private readonly sprites = new Map<number, Sprite>();

  constructor(private readonly load: (path: string) => Promise<Texture>) {}

  private texture(path: string): Texture | null {
    const known = this.textures.get(path);
    if (known === undefined) {
      this.textures.set(path, 'loading');
      this.load(path).then(
        (texture) => this.textures.set(path, texture),
        (error: unknown) => {
          console.warn(`Could not load picture "${path}"`, error);
          this.textures.set(path, 'failed');
        },
      );
      return null;
    }
    return typeof known === 'string' ? null : known;
  }

  /** Show `pictures` (lowest number first) as they are now. */
  render(pictures: readonly Picture[]): void {
    const shown = new Set<number>();
    for (const picture of pictures) {
      const texture = this.texture(picture.image);
      if (!texture) continue;
      shown.add(picture.number);
      let sprite = this.sprites.get(picture.number);
      if (!sprite) {
        sprite = new Sprite(texture);
        this.sprites.set(picture.number, sprite);
      }
      if (sprite.texture !== texture) sprite.texture = texture;
      sprite.anchor.set(picture.origin === 'center' ? 0.5 : 0);
      sprite.position.set(Math.round(picture.x), Math.round(picture.y));
      sprite.scale.set(picture.scaleX, picture.scaleY);
      sprite.alpha = picture.opacity;
      sprite.zIndex = picture.number;
      if (sprite.parent !== this.container) this.container.addChild(sprite);
    }
    for (const [number, sprite] of this.sprites) {
      if (shown.has(number)) continue;
      sprite.destroy();
      this.sprites.delete(number);
    }
    this.container.sortableChildren = true;
  }
}
