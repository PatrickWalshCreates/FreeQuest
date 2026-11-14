// Draws a map for editing: tiles in chunks (core's `chunks.ts`) built only
// where the view is, one sprite per cell per layer inside a chunk (so an edit
// only swaps textures); far out, an overview image (one pixel per cell)
// instead. Plus event markers, a grid, and the hovered cell. Purely a view:
// it is told what to show and never changes data.
import { type Passability, chunkKey, chunkTiles, chunksInView, inRange } from '@freequest/core';
import {
  type Rgba,
  type TileCell,
  type Viewport,
  averageTileColors,
  overviewPixels,
} from '@freequest/editor-core';
import { type CharacterGraphic, CharacterView } from '@freequest/runtime';
import { EMPTY_TILE, type GameMap, type MapEvent, type Tileset } from '@freequest/schema';
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';

/** Below this many screen pixels per tile, the overview replaces the tiles. */
const OVERVIEW_TILE_PX = 6;
/** Chunks this far past the view are kept built; farther ones are freed. */
const KEEP_MARGIN = 3;

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
  selection: 0x5fb3a1,
};

interface Chunk {
  readonly container: Container;
  /** The chunk's first cell. */
  readonly x0: number;
  readonly y0: number;
  /** sprites[y][x], in the chunk's own cells. */
  readonly sprites: Sprite[][];
  /** The map rows last drawn, per chunk row, to skip unchanged rows (map data is immutable). */
  rows: (readonly number[] | undefined)[];
}

interface LayerChunks {
  readonly container: Container;
  readonly chunks: Map<string, Chunk>;
}

export class MapRenderer {
  private readonly world = new Container();
  private readonly floor = new Graphics();
  private readonly tileLayers = new Container();
  private readonly events = new Container({ sortableChildren: true });
  private readonly grid = new Graphics();
  private readonly hover = new Graphics();
  private readonly border = new Graphics();
  /** Ghost tiles: what the current tool would paint. */
  private readonly brush = new Container();
  private readonly walkable = new Graphics();
  private layers: LayerChunks[] = [];
  /** The zoomed-out view: one pixel per cell, scaled up. */
  private readonly overview = new Sprite();
  private overviewCanvas: HTMLCanvasElement | null = null;
  private overviewDirty = true;
  private tileColors: { readonly textures: readonly Texture[]; readonly colors: Rgba[] } | null =
    null;
  private map: GameMap | null = null;
  private tileset: Tileset | null = null;
  private textures: readonly Texture[] = [];
  private gridZoom = 0;
  private hoverCell: { x: number; y: number } | null = null;
  private selectedCell: { x: number; y: number; width?: number; height?: number } | null = null;
  private readonly selection = new Graphics();
  private options: RenderOptions | null = null;

  private constructor(readonly app: Application) {
    this.world.addChild(
      this.floor,
      this.overview,
      this.tileLayers,
      this.events,
      this.walkable,
      this.brush,
      this.grid,
      this.border,
      this.selection,
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
    app.renderer.on('resize', () => {
      // A bigger canvas shows more of the map: build the chunks it now needs.
      renderer.ensureChunks();
      renderer.render();
    });
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
    this.overviewDirty = true;
    this.applyOptions();
    this.ensureChunks();
    this.render();
  }

  /** Whether the view is far enough out to show the overview instead of tiles. */
  private get overviewMode(): boolean {
    return (this.tileset?.tileWidth ?? 32) * this.world.scale.x < OVERVIEW_TILE_PX;
  }

  /** Build the chunks the view shows (with a margin) and free the far ones. */
  ensureChunks(): void {
    const map = this.map;
    const tileset = this.tileset;
    if (!map || !tileset) return;
    const overview = this.overviewMode;
    this.tileLayers.visible = !overview;
    this.overview.visible = overview;
    if (overview) return;
    const zoom = this.world.scale.x;
    const view = {
      x: -this.world.position.x / zoom,
      y: -this.world.position.y / zoom,
      width: this.app.screen.width / zoom,
      height: this.app.screen.height / zoom,
    };
    const { tileWidth: tw, tileHeight: th } = tileset;
    const wanted = chunksInView(view, tw, th, map.width, map.height, 1);
    const kept = chunksInView(view, tw, th, map.width, map.height, KEEP_MARGIN);
    this.layers.forEach((layer, l) => {
      for (const [key, chunk] of layer.chunks) {
        const [cx = 0, cy = 0] = key.split(',').map(Number);
        if (inRange(kept, cx, cy)) continue;
        chunk.container.destroy({ children: true });
        layer.chunks.delete(key);
      }
      if (!wanted) return;
      for (let cy = wanted.y0; cy <= wanted.y1; cy++) {
        for (let cx = wanted.x0; cx <= wanted.x1; cx++) {
          const key = chunkKey(cx, cy);
          if (layer.chunks.has(key)) continue;
          const area = chunkTiles(cx, cy, map.width, map.height);
          const container = new Container();
          const sprites: Sprite[][] = [];
          for (let y = area.y0; y <= area.y1; y++) {
            const row: Sprite[] = [];
            for (let x = area.x0; x <= area.x1; x++) {
              const sprite = new Sprite();
              sprite.position.set(x * tw, y * th);
              sprite.visible = false;
              container.addChild(sprite);
              row.push(sprite);
            }
            sprites.push(row);
          }
          const chunk: Chunk = { container, x0: area.x0, y0: area.y0, sprites, rows: [] };
          this.drawChunk(chunk, map.layers[l]?.data ?? []);
          layer.container.addChild(container);
          layer.chunks.set(key, chunk);
        }
      }
    });
  }

  /** The overview image, redrawn from the map data (one pixel per cell). */
  private drawOverview(): void {
    const map = this.map;
    const tileset = this.tileset;
    if (!map || !tileset || !this.overviewDirty) return;
    this.overviewDirty = false;
    const colors = this.averageColors(tileset);
    const options = this.options;
    const pixels = overviewPixels(map, colors, {
      floor: { r: 0x1a, g: 0x1d, b: 0x23, a: 255 },
      ...(options ? { hiddenLayers: options.hiddenLayers } : {}),
      layerOpacity: (l) => (options?.highlightActive && l !== options.activeLayer ? 0.35 : 1),
    });
    let canvas = this.overviewCanvas;
    if (!canvas || canvas.width !== map.width || canvas.height !== map.height) {
      canvas = document.createElement('canvas');
      canvas.width = map.width;
      canvas.height = map.height;
      this.overviewCanvas = canvas;
      this.overview.texture.destroy(true);
      this.overview.texture = Texture.from(canvas);
      this.overview.texture.source.scaleMode = 'nearest';
    }
    canvas
      .getContext('2d')
      ?.putImageData(
        new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, map.width, map.height),
        0,
        0,
      );
    this.overview.texture.source.update();
    this.overview.scale.set(tileset.tileWidth, tileset.tileHeight);
  }

  /** Each tile's average colour, from the tileset image (read once per set of textures). */
  private averageColors(tileset: Tileset): Rgba[] {
    if (this.tileColors?.textures === this.textures) return this.tileColors.colors;
    let colors: Rgba[] = [];
    const resource = this.textures[0]?.source.resource as CanvasImageSource | undefined;
    const width = this.textures[0]?.source.width ?? 0;
    const height = this.textures[0]?.source.height ?? 0;
    if (resource && width > 0 && height > 0) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context) {
        context.drawImage(resource, 0, 0);
        const pixels = context.getImageData(0, 0, width, height).data;
        colors = averageTileColors(
          pixels,
          width,
          tileset.tileWidth,
          tileset.tileHeight,
          tileset.columns,
          tileset.tiles.length,
        );
      }
    }
    this.tileColors = { textures: this.textures, colors };
    return colors;
  }

  private build(map: GameMap, tileset: Tileset): void {
    for (const child of this.tileLayers.removeChildren()) child.destroy({ children: true });
    const { tileWidth: tw, tileHeight: th } = tileset;
    this.floor
      .clear()
      .rect(0, 0, map.width * tw, map.height * th)
      .fill(COLORS.mapFloor);
    // Chunks are built as the view needs them (`ensureChunks`).
    this.layers = map.layers.map(() => {
      const container = new Container();
      this.tileLayers.addChild(container);
      return { container, chunks: new Map<string, Chunk>() };
    });
    this.overviewDirty = true;
    this.gridZoom = 0;
  }

  /** Redraw the built chunks' rows whose arrays changed. */
  private drawLayer(layer: LayerChunks, rows: readonly (readonly number[])[]): void {
    for (const chunk of layer.chunks.values()) this.drawChunk(chunk, rows);
  }

  private drawChunk(chunk: Chunk, rows: readonly (readonly number[])[]): void {
    chunk.sprites.forEach((sprites, dy) => {
      const row = rows[chunk.y0 + dy];
      if (row === chunk.rows[dy]) return;
      chunk.rows[dy] = row;
      sprites.forEach((sprite, dx) => {
        const index = row?.[chunk.x0 + dx] ?? EMPTY_TILE;
        const texture = index === EMPTY_TILE ? undefined : this.textures[index];
        sprite.visible = texture !== undefined;
        if (texture) sprite.texture = texture;
      });
    });
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
    // Far out the grid would be a solid block of lines.
    this.grid.visible = options.showGrid && !this.overviewMode;
    this.overviewDirty = true;
  }

  setViewport(view: Viewport): void {
    this.world.scale.set(view.zoom);
    // Whole screen pixels keep tile edges from shimmering.
    this.world.position.set(Math.round(-view.x * view.zoom), Math.round(-view.y * view.zoom));
    this.applyOptions();
    this.ensureChunks();
    this.render();
  }

  /** Show `cells` as half-transparent tiles over the map (empty clears it). */
  setBrush(cells: readonly TileCell[]): void {
    for (const child of this.brush.removeChildren()) child.destroy();
    const tileset = this.tileset;
    if (tileset) {
      const { tileWidth: tw, tileHeight: th } = tileset;
      for (const { x, y, tile } of cells) {
        const texture = tile === EMPTY_TILE ? undefined : this.textures[tile];
        if (texture) {
          const sprite = new Sprite(texture);
          sprite.position.set(x * tw, y * th);
          sprite.alpha = 0.65;
          this.brush.addChild(sprite);
        } else {
          // Erasing: a dark wash over the cell.
          this.brush.addChild(
            new Graphics().rect(x * tw, y * th, tw, th).fill({ color: 0x000000, alpha: 0.45 }),
          );
        }
      }
    }
    this.render();
  }

  /** Tint cells green (walkable) or red (blocked); null hides the overlay. */
  setWalkability(passability: Passability | null): void {
    const tileset = this.tileset;
    this.walkable.clear();
    if (passability && tileset) {
      const { tileWidth: tw, tileHeight: th } = tileset;
      for (let y = 0; y < passability.height; y++) {
        for (let x = 0; x < passability.width; x++) {
          this.walkable.rect(x * tw, y * th, tw, th);
          this.walkable.fill(
            passability.isPassable(x, y)
              ? { color: 0x3ddc84, alpha: 0.28 }
              : { color: 0xff4d4d, alpha: 0.42 },
          );
        }
      }
    }
    this.render();
  }

  /** Outline the cell under the pointer (null hides it). */
  setHover(cell: { x: number; y: number } | null): void {
    this.hoverCell = cell;
    this.drawHover();
    this.render();
  }

  /** Outline the selected event's cell, or a selected area of cells (null clears it). */
  setSelection(cell: { x: number; y: number; width?: number; height?: number } | null): void {
    this.selectedCell = cell;
    this.drawSelection();
    this.render();
  }

  private drawSelection(): void {
    const cell = this.selectedCell;
    const tileset = this.tileset;
    this.selection.clear();
    if (!cell || !tileset) return;
    const { tileWidth: tw, tileHeight: th } = tileset;
    this.selection
      .rect(cell.x * tw, cell.y * th, (cell.width ?? 1) * tw, (cell.height ?? 1) * th)
      .stroke({ color: COLORS.selection, width: 2 * this.hairline, alignment: 1 });
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
    this.drawSelection();
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
    if (this.overview.visible) this.drawOverview();
    this.app.render();
  }

  /** Chunks built right now, per layer (for measuring; dev builds expose the renderer). */
  get builtChunks(): number {
    return this.layers.reduce((n, layer) => n + layer.chunks.size, 0);
  }

  destroy(): void {
    this.app.destroy({ removeView: true }, { children: true });
  }
}
