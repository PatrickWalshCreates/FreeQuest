// Draws plugins' canvases over the map: one sprite per drawing plugin, its
// canvas cleared and redrawn every frame (see plugin-drawing.ts).
import type { PluginHost, World } from '@freequest/core';
import { Container, Sprite, Texture } from 'pixi.js';
import type { FrameBase, PluginDrawing } from './plugin-drawing.js';

interface Layer {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly texture: Texture;
  readonly sprite: Sprite;
}

export class PluginLayer {
  readonly container = new Container({ label: 'plugins' });
  private readonly layers = new Map<string, Layer>();

  constructor(
    private readonly drawing: PluginDrawing,
    private readonly host: PluginHost,
    width: number,
    height: number,
  ) {
    for (const plugin of drawing.plugins) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) continue;
      context.imageSmoothingEnabled = false;
      const texture = Texture.from(canvas);
      texture.source.scaleMode = 'nearest';
      const sprite = new Sprite(texture);
      sprite.label = `plugin ${plugin}`;
      this.container.addChild(sprite);
      this.layers.set(plugin, { canvas, context, texture, sprite });
    }
  }

  /** Redraw every drawing plugin's canvas (nothing while the layer is hidden). */
  render(world: World, base: FrameBase): void {
    if (!this.container.visible) return;
    for (const [plugin, layer] of this.layers) {
      if (!layer.sprite.visible) continue;
      layer.context.setTransform(1, 0, 0, 1, 0, 0);
      layer.context.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
      // A plugin that fails is switched off: its canvas stays cleared and hidden.
      if (!this.drawing.draw(this.host, world, plugin, layer.context, base)) {
        layer.context.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        layer.sprite.visible = false;
      }
      layer.texture.source.update();
    }
  }

  destroy(): void {
    for (const layer of this.layers.values()) layer.texture.destroy(true);
    this.container.destroy({ children: true });
  }
}
