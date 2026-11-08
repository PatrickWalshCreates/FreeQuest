import { ActionState, FixedTimestep, World, computeCamera } from '@freequest/core';
import { Application, Container } from 'pixi.js';
import { type CharacterGraphic, CharacterView } from './character-view.js';
import { DialogController } from './dialog.js';
import { DEFAULT_UI_THEME, DialogView, type UiTheme } from './dialog-view.js';
import { EventViews, depthFor } from './event-views.js';
import { type KeyBindings, bindKeyboard } from './keyboard.js';
import { type LoadedProject, getOrThrow, loadProject } from './loader.js';
import { createMapView } from './map-view.js';
import { loadPixelTexture, sliceGrid } from './textures.js';

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

  const [tilesetTexture, characterGraphics] = await Promise.all([
    loadPixelTexture(project.resolve(tileset.image)),
    loadCharacterGraphics(project),
  ]);
  const tileTextures = sliceGrid(
    tilesetTexture,
    tileset.tileWidth,
    tileset.tileHeight,
    tileset.columns,
    tileset.tiles.length,
  );

  const world = new World({ manifest, map, tileset });
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

  const mapView = createMapView(map, tileset, tileTextures);
  const player = new CharacterView(
    getOrThrow(characterGraphics, manifest.player.character, 'character'),
  );
  const characters = new Container({ label: 'characters', sortableChildren: true });
  characters.addChild(player.sprite);
  const eventViews = new EventViews(world.events, characterGraphics, characters);
  const scene = new Container({ label: 'scene' });
  scene.addChild(mapView.below, characters, mapView.above);
  app.stage.addChild(scene);
  const dialog = new DialogController();
  const dialogView = new DialogView(width, height, { ...DEFAULT_UI_THEME, ...options.ui });
  app.stage.addChild(dialogView.container);
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

  const render = (alpha: number) => {
    const { tileWidth, tileHeight } = tileset;
    const rx = prevX + (world.player.realX - prevX) * alpha;
    const ry = prevY + (world.player.realY - prevY) * alpha;
    player.update(world.player, rx, ry, tileWidth, tileHeight);
    player.sprite.zIndex = depthFor(ry);
    eventViews.update(tileWidth, tileHeight);
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
      // Dialog first: it consumes the input that answers a pending request.
      dialog.update(dt, input, world.interpreter);
      // TODO(M2 step 6): replace with real map transfers.
      if (world.interpreter?.pending?.type === 'transfer') {
        console.warn('Map transfers are not implemented yet; skipping', world.interpreter.pending);
        world.interpreter.continue();
      }
      world.step(dt, input);
      input.endStep();
      elapsed += dt;
    });
    render(alpha);
    dialogView.render(dialog, elapsed);
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
