import { ActionState, FixedTimestep, World, computeCamera } from '@freequest/core';
import { Application, Container } from 'pixi.js';
import { CharacterView } from './character-view.js';
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
  const sheet = getOrThrow(project.characters, manifest.player.character, 'character');

  const [tilesetTexture, heroTexture] = await Promise.all([
    loadPixelTexture(project.resolve(tileset.image)),
    loadPixelTexture(project.resolve(sheet.image)),
  ]);
  const tileTextures = sliceGrid(
    tilesetTexture,
    tileset.tileWidth,
    tileset.tileHeight,
    tileset.columns,
    tileset.tiles.length,
  );
  const heroFrames = sliceGrid(
    heroTexture,
    sheet.frameWidth,
    sheet.frameHeight,
    sheet.frames,
    sheet.frames * 4,
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
  const player = new CharacterView(sheet, heroFrames);
  const characters = new Container({ label: 'characters' });
  characters.addChild(player.sprite);
  const scene = new Container({ label: 'scene' });
  scene.addChild(mapView.below, characters, mapView.above);
  app.stage.addChild(scene);

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
      world.step(dt, input);
      input.endStep();
    });
    render(alpha);
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
