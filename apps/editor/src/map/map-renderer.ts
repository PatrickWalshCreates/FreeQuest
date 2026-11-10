// Draws a map for editing: one sprite per cell per layer (so an edit only
// swaps textures), event markers, a grid, and the hovered cell. Purely a
// view: it is told what to show and never changes data.
import type { Viewport } from '@freequest/editor-core';
import { type CharacterGraphic, CharacterView } from '@freequest/runtime';
import { EMPTY_TILE, type GameMap, type MapEvent, type Tileset } from '@freequest/schema';
import { Application, Container, Graphics, Sprite, type Texture } from 'pixi.js';

export interface RenderOptions {
  /** Per layer index; missing means visible. */
  readonly hiddenLayers: ReadonlySet<number>;
  readonly activeLayer: number;
  /** Fade the layers other than the active one. */
  readonly highlightActive: boolean;
  readonly showGrid: boolean;
  readonly showEvents: boolean;
}

const COLORS = {
  background: 0x101216,
  mapFloor: 0x1a1d23,
  grid: 0x000000,
  border: 0x5fb3a1,
  hover: 0xffffff,
  event: 0xf4c44a,
};

interface LayerSprites {
  readonly container: Container;
  /** sprites[y][x] */
  readonly sprites: Sprite[][];
  /** The row arrays last drawn, to skip unchanged rows (map data is immutable). */
  rows: readonly (readonly number[])[];
}

export class MapRenderer {
  private readonly world = new Container();
  private readonly floor = new Graphics();
  private readonly tileLayers = new Container();
  private readonly events = new Container({ sortableChildren: true });
  private readonly grid = new Graphics();
  private readonly hover = new Graphics();
  private readonly border = new Graphics();
  private layers: LayerSprites[] = [];
  private map: GameMap | null = null;
  private tileset: Tileset | null = null;
  private textures: readonly Texture[] = [];
  private gridZoom = 0;
  private hoverCell: { x: number; y: number } | null = null;
  private options: RenderOptions | null = null;

  private constructor(readonly app: Application) {
    this.world.addChild(
      this.floor,
      this.tileLayers,
      this.events,
      this.grid,
      this.border,
      this.hover,
    );
    app.stage.addChild(this.world);
  }

  /** Create the canvas inside `parent`, sized to it. */
  static async create(parent: HTMLElement): Promise<MapRenderer> {
    const app = new Application();
    await app.init({
      resizeTo: parent,
      background: COLORS.background,
      antialias: false,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      // Redraw on demand: the editor only changes when something happens.
      autoStart: false,
    });
    parent.appendChild(app.canvas);
    const renderer = new MapRenderer(app);
    app.renderer.on('resize', () => renderer.render());
    // Handy for inspecting the scene from the console during development.
    if (import.meta.env.DEV) (window as { mapRenderer?: MapRenderer }).mapRenderer = renderer;
    return renderer;
  }

  get viewSize(): { width: number; height: number } {
    return { width: this.app.screen.width, height: this.app.screen.height };
  }

  /** Show a map. Rebuilds when the size, layers or tileset changed; otherwise redraws changed rows. */
  setMap(map: GameMap, tileset: Tileset, textures: readonly Texture[]): void {
    const rebuild =
      !this.map ||
      this.tileset !== tileset ||
      this.textures !== textures ||
      map.width !== this.map.width ||
      map.height !== this.map.height ||
      map.layers.length !== this.layers.length;
    this.map = map;
    this.tileset = tileset;
    this.textures = textures;
    if (rebuild) this.build(map, tileset);
    else this.layers.forEach((layer, i) => this.drawLayer(layer, map.layers[i]?.data ?? []));
    this.applyOptions();
    this.render();
  }

  private build(map: GameMap, tileset: Tileset): void {
    for (const child of this.tileLayers.removeChildren()) child.destroy({ children: true });
    const { tileWidth: tw, tileHeight: th } = tileset;
    this.floor
      .clear()
      .rect(0, 0, map.width * tw, map.height * th)
      .fill(COLORS.mapFloor);
    this.layers = map.layers.map(() => {
      const container = new Container();
      const sprites: Sprite[][] = [];
      for (let y = 0; y < map.height; y++) {
        const row: Sprite[] = [];
        for (let x = 0; x < map.width; x++) {
          const sprite = new Sprite();
          sprite.position.set(x * tw, y * th);
          sprite.visible = false;
          container.addChild(sprite);
          row.push(sprite);
        }
        sprites.push(row);
      }
      this.tileLayers.addChild(container);
      return { container, sprites, rows: [] };
    });
    this.layers.forEach((layer, i) => this.drawLayer(layer, map.layers[i]?.data ?? []));
    this.gridZoom = 0;
  }

  private drawLayer(layer: LayerSprites, rows: readonly (readonly number[])[]): void {
    layer.sprites.forEach((sprites, y) => {
      const row = rows[y];
      if (row === layer.rows[y]) return;
      sprites.forEach((sprite, x) => {
        const index = row?.[x] ?? EMPTY_TILE;
        const texture = index === EMPTY_TILE ? undefined : this.textures[index];
        sprite.visible = texture !== undefined;
        if (texture) sprite.texture = texture;
      });
    });
    layer.rows = rows;
  }

  /** Event markers: the first page's graphic when it has one, over a box on the event's cell. */
  setEvents(events: readonly MapEvent[], graphics: ReadonlyMap<string, CharacterGraphic>): void {
    for (const child of this.events.removeChildren()) child.destroy();
    const tileset = this.tileset;
    if (!tileset) return;
    const { tileWidth: tw, tileHeight: th } = tileset;
    for (const event of events) {
      const box = new Graphics()
        .rect(event.x * tw + 1, event.y * th + 1, tw - 2, th - 2)
        .fill({ color: COLORS.event, alpha: 0.18 })
        .stroke({ color: COLORS.event, width: 1, alpha: 0.8 });
      box.zIndex = -1;
      this.events.addChild(box);
      const page = event.pages[0];
      const graphic = page?.graphic && graphics.get(page.graphic.character);
      if (page?.graphic && graphic) {
        const view = new CharacterView(graphic);
        view.update(
          { direction: page.graphic.direction, isMoving: false, distanceWalked: 0 },
          event.x,
          event.y,
          tw,
          th,
        );
        view.sprite.zIndex = event.y;
        this.events.addChild(view.sprite);
      }
    }
    this.render();
  }

  setOptions(options: RenderOptions): void {
    this.options = options;
    this.applyOptions();
    this.render();
  }

  private applyOptions(): void {
    const options = this.options;
    if (!options) return;
    this.layers.forEach((layer, i) => {
      layer.container.visible = !options.hiddenLayers.has(i);
      layer.container.alpha = options.highlightActive && i !== options.activeLayer ? 0.35 : 1;
    });
    this.events.visible = options.showEvents;
    this.grid.visible = options.showGrid;
  }

  setViewport(view: Viewport): void {
    this.world.scale.set(view.zoom);
    // Whole screen pixels keep tile edges from shimmering.
    this.world.position.set(Math.round(-view.x * view.zoom), Math.round(-view.y * view.zoom));
    this.render();
  }

  /** Outline the cell under the pointer (null hides it). */
  setHover(cell: { x: number; y: number } | null): void {
    this.hoverCell = cell;
    this.drawHover();
    this.render();
  }

  private drawHover(): void {
    const cell = this.hoverCell;
    const tileset = this.tileset;
    this.hover.clear();
    if (!cell || !tileset) return;
    const { tileWidth: tw, tileHeight: th } = tileset;
    this.hover
      .rect(cell.x * tw, cell.y * th, tw, th)
      .fill({ color: COLORS.hover, alpha: 0.15 })
      .stroke({ color: COLORS.hover, width: this.hairline, alpha: 0.9, alignment: 1 });
  }

  /** One screen pixel in world units (PixiJS's pixelLine strokes don't render here). */
  private get hairline(): number {
    return 1 / this.world.scale.x;
  }

  /** Redraw the zoom-dependent lines (grid, border, hover) after a zoom change. */
  private drawLines(): void {
    const map = this.map;
    const tileset = this.tileset;
    if (!map || !tileset || this.gridZoom === this.world.scale.x) return;
    this.gridZoom = this.world.scale.x;
    this.drawHover();
    const { tileWidth: tw, tileHeight: th } = tileset;
    const w = map.width * tw;
    const h = map.height * th;
    this.grid.clear();
    for (let x = 1; x < map.width; x++) this.grid.moveTo(x * tw, 0).lineTo(x * tw, h);
    for (let y = 1; y < map.height; y++) this.grid.moveTo(0, y * th).lineTo(w, y * th);
    this.grid.stroke({ color: COLORS.grid, alpha: 0.3, width: this.hairline });
    this.border
      .clear()
      .rect(0, 0, w, h)
      .stroke({ color: COLORS.border, width: this.hairline, alignment: 0 });
  }

  /** Draw one frame now (the ticker is off; everything calls this after a change). */
  render(): void {
    this.drawLines();
    this.app.render();
  }

  destroy(): void {
    this.app.destroy({ removeView: true }, { children: true });
  }
}
