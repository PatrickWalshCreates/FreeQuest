import { ActionState, DatabaseIndex, FixedTimestep, World, computeCamera } from '@freequest/core';
import type { Tileset } from '@freequest/schema';
import { Application, Container, Graphics, type Texture } from 'pixi.js';
import { type CharacterGraphic, CharacterView } from './character-view.js';
import { DialogController } from './dialog.js';
import { DEFAULT_UI_THEME, DialogView, type UiTheme } from './dialog-view.js';
import { EventViews, depthFor } from './event-views.js';
import { type KeyBindings, bindKeyboard } from './keyboard.js';
import { type LoadedProject, getOrThrow, loadProject } from './loader.js';
import { type MapView, createMapView } from './map-view.js';
import { loadPixelTexture, sliceGrid } from './textures.js';
import { TransferController } from './transfer.js';

export interface StartGameOptions {
  /** Element the canvas is added to. The game scales to fit it in whole-number steps. */
  parent: HTMLElement;
  /** URL of the project folder (the one containing project.json). */
  projectUrl: string | URL;
  keyBindings?: KeyBindings;
  /** Overrides for the message/choice window look (font, colors, spacing). */
  ui?: Partial<UiTheme>;
}

export interface Game {
  readonly project: LoadedProject;
  readonly world: World;
  readonly input: ActionState;
  readonly app: Application;
  destroy(): void;
}

/** Load a project and run it in a canvas inside `parent`. */
export async function startGame(options: StartGameOptions): Promise<Game> {
  const project = await loadProject(options.projectUrl);
  const { manifest } = project;
  const map = getOrThrow(project.maps, manifest.start.map, 'map');
  const tileset = getOrThrow(project.tilesets, map.tileset, 'tileset');

  // Tileset images load when a map using them is first entered.
  const tileTextures = new Map<string, Promise<Texture[]>>();
  const loadTiles = (ts: Tileset): Promise<Texture[]> => {
    let tiles = tileTextures.get(ts.id);
    if (!tiles) {
      tiles = loadPixelTexture(project.resolve(ts.image)).then((texture) =>
        sliceGrid(texture, ts.tileWidth, ts.tileHeight, ts.columns, ts.tiles.length),
      );
      tileTextures.set(ts.id, tiles);
    }
    return tiles;
  };
  // Filled in before a map becomes current, so scene rebuilds never wait.
  const readyTiles = new Map<string, Texture[]>();

  const [startTiles, characterGraphics] = await Promise.all([
    loadTiles(tileset),
    loadCharacterGraphics(project),
  ]);
  readyTiles.set(tileset.id, startTiles);

  const world = new World({
    manifest,
    map,
    tileset,
    database: new DatabaseIndex(project.database),
  });
  const input = new ActionState();
  const loop = new FixedTimestep();

  const { width, height } = manifest.screen;
  const app = new Application();
  await app.init({
    width,
    height,
    background: '#000000',
    antialias: false,
    roundPixels: true,
    resolution: 1,
  });
  const canvas = app.canvas;
  canvas.style.imageRendering = 'pixelated';
  canvas.tabIndex = 0;
  options.parent.appendChild(canvas);

  const player = new CharacterView(
    getOrThrow(characterGraphics, manifest.player.character, 'character'),
  );
  const characters = new Container({ label: 'characters', sortableChildren: true });
  characters.addChild(player.sprite);
  const scene = new Container({ label: 'scene' });
  scene.addChild(characters);
  app.stage.addChild(scene);

  // Everything drawn for the current map. Rebuilt whenever the world's map changes.
  let shown: { map: World['map']; view: MapView; events: EventViews } | null = null;
  const showCurrentMap = () => {
    if (shown) {
      shown.view.below.destroy({ children: true });
      shown.view.above.destroy({ children: true });
      shown.events.destroy();
    }
    const tiles = getOrThrow(readyTiles, world.tileset.id, 'tileset');
    const view = createMapView(world.map, world.tileset, tiles);
    scene.addChildAt(view.below, 0);
    scene.addChild(view.above);
    shown = {
      map: world.map,
      view,
      events: new EventViews(world.events, characterGraphics, characters),
    };
    // Don't interpolate the player across maps.
    prevX = world.player.realX;
    prevY = world.player.realY;
  };

  const dialog = new DialogController();
  const dialogView = new DialogView(width, height, { ...DEFAULT_UI_THEME, ...options.ui });
  app.stage.addChild(dialogView.container);
  const transfer = new TransferController(async (mapId) => {
    const target = await project.loadMap(mapId);
    const targetTileset = getOrThrow(project.tilesets, target.tileset, 'tileset');
    readyTiles.set(targetTileset.id, await loadTiles(targetTileset));
    return { map: target, tileset: targetTileset };
  });
  const fadeOverlay = new Graphics().rect(0, 0, width, height).fill(0x000000);
  fadeOverlay.alpha = 0;
  app.stage.addChild(fadeOverlay);
  let elapsed = 0;

  const fit = () => {
    const { clientWidth, clientHeight } = options.parent;
    const scale = Math.max(1, Math.floor(Math.min(clientWidth / width, clientHeight / height)));
    canvas.style.width = `${width * scale}px`;
    canvas.style.height = `${height * scale}px`;
  };
  const resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(options.parent);
  fit();

  const unbindKeyboard = bindKeyboard(window, input, options.keyBindings);

  // Position before the most recent logic step, for interpolation.
  let prevX = world.player.realX;
  let prevY = world.player.realY;
  showCurrentMap();

  const render = (alpha: number) => {
    if (shown?.map !== world.map) showCurrentMap();
    const { tileWidth, tileHeight } = world.tileset;
    const rx = prevX + (world.player.realX - prevX) * alpha;
    const ry = prevY + (world.player.realY - prevY) * alpha;
    player.update(world.player, rx, ry, tileWidth, tileHeight);
    player.sprite.zIndex = depthFor(ry);
    shown?.events.update(tileWidth, tileHeight);
    const camera = computeCamera({
      focusX: (rx + 0.5) * tileWidth,
      focusY: (ry + 0.5) * tileHeight,
      viewWidth: width,
      viewHeight: height,
      mapWidth: world.pixelWidth,
      mapHeight: world.pixelHeight,
    });
    scene.position.set(-Math.round(camera.x), -Math.round(camera.y));
  };

  const tick = () => {
    const alpha = loop.advance(app.ticker.deltaMS / 1000, (dt) => {
      prevX = world.player.realX;
      prevY = world.player.realY;
      // Dialog and transfers first: they consume the input / answer the
      // requests of the running event before the world steps.
      dialog.update(dt, input, world.interpreter);
      transfer.update(dt, world);
      world.step(dt, input);
      input.endStep();
      elapsed += dt;
    });
    render(alpha);
    dialogView.render(dialog, elapsed);
    fadeOverlay.alpha = transfer.fade;
  };
  render(1);
  app.ticker.add(tick);

  return {
    project,
    world,
    input,
    app,
    destroy() {
      app.ticker.remove(tick);
      unbindKeyboard();
      resizeObserver.disconnect();
      app.destroy(true, { children: true });
    },
  };
}

/** Load and slice the image of every character sheet in the project. */
async function loadCharacterGraphics(
  project: LoadedProject,
): Promise<Map<string, CharacterGraphic>> {
  const entries = await Promise.all(
    [...project.characters.values()].map(async (sheet) => {
      const texture = await loadPixelTexture(project.resolve(sheet.image));
      const frames = sliceGrid(
        texture,
        sheet.frameWidth,
        sheet.frameHeight,
        sheet.frames,
        sheet.frames * sheet.rows.length,
      );
      return [sheet.id, { sheet, frames }] as const;
    }),
  );
  return new Map(entries);
}
