import {
  ActionState,
  DatabaseIndex,
  type Direction,
  FixedTimestep,
  World,
  translateSave,
  computeCamera,
} from '@freequest/core';
import type { SaveFile, ShopGood, SoundKey, Tileset } from '@freequest/schema';
import { Application, Container, Graphics, Text, type Texture } from 'pixi.js';
import { BattleFlow } from './battle-flow.js';
import { BattleView } from './battle-view.js';
import { type MenuLike, type MusicScene, musicFor, uiSoundFor } from './audio-director.js';
import { AudioPlayer } from './audio-player.js';
import { MenuController } from './menu-controller.js';
import { MenuView } from './menu-view.js';
import { type KeyValueStorage, MemoryStorage, SaveStore } from './save-store.js';
import { TitleController } from './title-controller.js';
import { TitleView } from './title-view.js';
import { type CharacterGraphic, CharacterView } from './character-view.js';
import { createDebugPanel } from './debug-panel.js';
import { DialogController } from './dialog.js';
import { DEFAULT_UI_THEME, DialogView, type UiTheme } from './dialog-view.js';
import { EventViews, depthFor } from './event-views.js';
import { loadIconSheet } from './icons.js';
import { OptionsController } from './options-controller.js';
import { OptionsView } from './options-view.js';
import { type GameOptions, OptionsStore, defaultOptions, volumeGain } from './options.js';
import { ShopController } from './shop-controller.js';
import { ShopView } from './shop-view.js';
import { DEFAULT_KEY_BINDINGS, type KeyBindings, bindKeyboard } from './keyboard.js';
import { type LoadedProject, type ProjectSource, getOrThrow, loadProject } from './loader.js';
import { type MapView, createMapView } from './map-view.js';
import { fitScale } from './scale.js';
import { loadPixelTexture, sliceGrid } from './textures.js';
import { TransferController } from './transfer.js';

export interface StartGameOptions {
  /** Element the canvas is added to. The game scales to fit it in whole-number steps. */
  parent: HTMLElement;
  /**
   * The project: a URL of the folder containing project.json (served over
   * HTTP), or any `ProjectSource` (e.g. the editor's unsaved document).
   */
  project: string | URL | ProjectSource;
  /**
   * Start somewhere other than the manifest's start position (playtesting
   * "from here"). New games after a game over start here too.
   */
  start?: { map: string; x: number; y: number; direction?: Direction };
  /** Begin playing at once instead of showing the title screen. */
  skipTitle?: boolean;
  keyBindings?: KeyBindings;
  /** Overrides for the message/choice window look (font, colors, spacing). */
  ui?: Partial<UiTheme>;
  /** Enable the developer debug panel (toggle with F9). */
  debug?: boolean;
  /** Where save slots live. Defaults to localStorage (or memory if it's unavailable). */
  saveStorage?: KeyValueStorage;
}

export interface Game {
  readonly project: LoadedProject;
  /** The current world (replaced when a new game starts after game over). */
  readonly world: World;
  readonly input: ActionState;
  readonly app: Application;
  destroy(): void;
}

/** Load a project and run it in a canvas inside `parent`. */
export async function startGame(options: StartGameOptions): Promise<Game> {
  const project = await loadProject(options.project);
  const { manifest } = project;
  const start = options.start;
  const map = start
    ? await project.loadMap(start.map)
    : getOrThrow(project.maps, manifest.start.map, 'map');
  const tileset = getOrThrow(project.tilesets, map.tileset, 'tileset');

  // Tileset images load when a map using them is first entered.
  const tileTextures = new Map<string, Promise<Texture[]>>();
  const loadTiles = (ts: Tileset): Promise<Texture[]> => {
    let tiles = tileTextures.get(ts.id);
    if (!tiles) {
      tiles = loadPixelTexture(project.assetUrl(ts.image)).then((texture) =>
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
  const icons = await loadIconSheet(project.database.system?.iconset, (path) =>
    project.assetUrl(path),
  );

  const db = new DatabaseIndex(project.database);
  const position = start && {
    x: start.x,
    y: start.y,
    direction: start.direction ?? manifest.start.direction,
  };
  const createWorld = () =>
    new World({ manifest, map, tileset, database: db, ...(position ? { position } : {}) });
  let world = createWorld();
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
  // Events' fades, tints and flashes: over the map, under messages and menus.
  const screenEffects = new Graphics({ label: 'screen-effects' });
  app.stage.addChild(screenEffects);

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

  let dialog = new DialogController();
  const theme = { ...DEFAULT_UI_THEME, ...options.ui };
  const dialogView = new DialogView(width, height, theme, icons);
  app.stage.addChild(dialogView.container);
  const transfer = new TransferController(async (mapId) => {
    const target = await project.loadMap(mapId);
    const targetTileset = getOrThrow(project.tilesets, target.tileset, 'tileset');
    readyTiles.set(targetTileset.id, await loadTiles(targetTileset));
    return { map: target, tileset: targetTileset };
  });
  // Battles: enemy images load when a troop is first fought, then stay cached.
  const enemyTextures = new Map<string, Texture>();
  let battleView: BattleView | null = null;
  const battles = new BattleFlow(db, {
    async prepare(troopId) {
      const enemies = db.troops.get(troopId).enemies.map((id) => db.enemies.get(id));
      await Promise.all(
        enemies.map(async (enemy) => {
          if (enemy.image && !enemyTextures.has(enemy.id)) {
            enemyTextures.set(enemy.id, await loadPixelTexture(project.assetUrl(enemy.image)));
          }
        }),
      );
    },
    begin(battle) {
      battleView = new BattleView(battle, width, height, enemyTextures, theme, icons);
      scene.visible = false;
      dialogView.container.visible = false;
      app.stage.addChildAt(battleView.container, app.stage.getChildIndex(fadeOverlay));
    },
    end() {
      battleView?.destroy();
      battleView = null;
      scene.visible = true;
      dialogView.container.visible = true;
    },
    gameOver() {
      gameOverScreen.visible = true;
    },
  });
  const gameOverScreen = createGameOverScreen(width, height, theme);

  const fadeOverlay = new Graphics().rect(0, 0, width, height).fill(0x000000);
  fadeOverlay.alpha = 0;
  app.stage.addChild(fadeOverlay, gameOverScreen);
  let elapsed = 0;

  const fit = () => {
    const { clientWidth, clientHeight } = options.parent;
    const scale = fitScale(width, height, clientWidth, clientHeight);
    canvas.style.width = `${width * scale}px`;
    canvas.style.height = `${height * scale}px`;
  };
  const resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(options.parent);
  fit();

  const keyboard = bindKeyboard(window, input, options.keyBindings);
  const removeDebugPanel = options.debug
    ? createDebugPanel(options.parent, () => world, manifest)
    : () => undefined;

  // Audio ------------------------------------------------------------------
  const audio = new AudioPlayer((path) => project.assetUrl(path));
  const unlockAudio = () => audio.unlock();
  window.addEventListener('keydown', unlockAudio);
  const sfx = (key: SoundKey | null) => {
    const path = key && db.system.audio?.sounds?.[key];
    if (path) audio.playSound(path);
  };
  let lastBattleEvent: unknown = null;
  let hadBattle = false;

  /** The list the player is moving through this step, for interface sounds. */
  const activeMenu = (): MenuLike | null => {
    if (optionsScreen) return optionsScreen.state;
    if (mode === 'title') return title.state;
    if (menu) return menu.state;
    if (shop) return shop.state;
    const controller = battles.controller;
    if (controller) {
      const state = controller.state;
      if (state.menu) return state.menu;
      // Target selection: treat as a list of valid choices.
      if (state.target)
        return {
          options: [
            { label: '', enabled: true },
            { label: '', enabled: true },
          ],
          cursor: 0,
        };
      return null;
    }
    const choice = dialog.choice;
    return choice
      ? {
          options: choice.options.map((label) => ({ label, enabled: true })),
          cursor: choice.cursor,
        }
      : null;
  };

  const musicScene = (): MusicScene => {
    if (mode !== 'playing') return 'title';
    if (battles.isGameOver) return 'gameOver';
    const controller = battles.controller;
    if (controller) return controller.battlePhase === 'won' ? 'victory' : 'battle';
    return 'map';
  };

  /** Battle sounds: a sting when a battle opens, hits and heals as the log plays. */
  const battleSounds = () => {
    const controller = battles.controller;
    if (controller && !hadBattle) sfx('battleStart');
    hadBattle = controller !== null;
    const event = controller?.state.event ?? null;
    if (event === lastBattleEvent) return;
    lastBattleEvent = event;
    if (event?.type !== 'hit' || event.result.missed) return;
    if (event.result.hpDamage > 0) sfx('damage');
    else if (event.result.hpDamage < 0) sfx('heal');
  };

  // Title screen, menu and saves ---------------------------------------------
  const storage = options.saveStorage ?? defaultStorage();
  const saves = new SaveStore(storage, manifest);
  // The player's options (volumes, keys) live beside the saves, per game.
  const optionsStore = new OptionsStore(
    storage,
    manifest.id,
    defaultOptions(options.keyBindings ?? DEFAULT_KEY_BINDINGS),
  );
  const applyOptions = (o: GameOptions) => {
    audio.setVolumes(volumeGain(o.music), volumeGain(o.sound));
    keyboard.setBindings(o.keys);
  };
  let gameOptions = optionsStore.load();
  applyOptions(gameOptions);
  let optionsScreen: OptionsController | null = null;
  let optionsView: OptionsView | null = null;
  let capturing = false;
  const openOptions = () => {
    optionsScreen = new OptionsController(
      gameOptions,
      defaultOptions(options.keyBindings ?? DEFAULT_KEY_BINDINGS),
      (next) => {
        gameOptions = next;
        optionsStore.save(next);
        applyOptions(next);
      },
    );
    optionsView = new OptionsView(width, height, theme);
    app.stage.addChildAt(optionsView.container, app.stage.getChildIndex(fadeOverlay));
  };
  const closeOptions = () => {
    optionsView?.destroy();
    optionsView = null;
    optionsScreen = null;
    capturing = false;
  };
  const title = new TitleController(manifest.name, saves);
  const titleView = new TitleView(width, height, theme);
  app.stage.addChildAt(titleView.container, app.stage.getChildIndex(fadeOverlay));
  let mode: 'title' | 'loading' | 'playing' = 'title';
  let menu: MenuController | null = null;
  let menuView: MenuView | null = null;
  let shop: ShopController | null = null;
  let shopView: ShopView | null = null;
  let playSeconds = 0;

  const closeMenu = () => {
    menuView?.destroy();
    menuView = null;
    menu = null;
  };

  const closeShop = () => {
    shopView?.destroy();
    shopView = null;
    shop = null;
  };

  /** Open the shop a running event asked for. */
  const openShop = (goods: readonly ShopGood[], canSell: boolean) => {
    shop = new ShopController(world, goods, canSell);
    // The message before the shop goes away (the dialog won't step while the shop is open).
    dialog = new DialogController();
    shopView = new ShopView(width, height, theme, icons);
    app.stage.addChildAt(shopView.container, app.stage.getChildIndex(titleView.container));
  };

  /** Show the title screen (on boot, after "Quit", after game over). */
  const toTitle = (message: string | null = null) => {
    closeMenu();
    closeShop();
    battles.reset();
    gameOverScreen.visible = false;
    scene.visible = false;
    dialogView.container.visible = false;
    titleView.container.visible = true;
    title.reset(message);
    mode = 'title';
  };

  /** Begin playing a world (a new game or a loaded save). */
  const play = (next: World, seconds: number) => {
    world = next;
    playSeconds = seconds;
    dialog = new DialogController();
    battles.reset();
    gameOverScreen.visible = false;
    titleView.container.visible = false;
    scene.visible = true;
    dialogView.container.visible = true;
    showCurrentMap();
    mode = 'playing';
  };

  /** Load a save: fetch its map and tileset first, then rebuild the world from it. */
  const loadGame = async (loaded: SaveFile) => {
    mode = 'loading';
    try {
      // Ids renamed in the editor since the save was made are translated first.
      const save = translateSave(loaded, manifest, db);
      const savedMap = await project.loadMap(save.map);
      const savedTileset = getOrThrow(project.tilesets, savedMap.tileset, 'tileset');
      readyTiles.set(savedTileset.id, await loadTiles(savedTileset));
      play(
        World.fromSave(save, { manifest, map: savedMap, tileset: savedTileset, database: db }),
        save.playSeconds,
      );
    } catch (error) {
      console.error('Could not load the save', error);
      toTitle(
        `Could not load that save: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const openMenu = () => {
    menu = new MenuController({
      world,
      saves,
      game: manifest.id,
      playSeconds: () => playSeconds,
      onSaved: () => sfx('save'),
    });
    menuView = new MenuView(() => world, width, height, theme, icons);
    app.stage.addChildAt(menuView.container, app.stage.getChildIndex(titleView.container));
  };

  /** The menu opens only when nothing else is going on. */
  const canOpenMenu = () =>
    !world.interpreter &&
    !transfer.isActive &&
    !world.player.isMoving &&
    !world.playerOnRoute &&
    !world.hasPendingEncounter;

  // Position before the most recent logic step, for interpolation.
  let prevX = world.player.realX;
  let prevY = world.player.realY;
  showCurrentMap();
  if (options.skipTitle) play(createWorld(), 0);
  else toTitle();

  const render = (alpha: number) => {
    if (shown?.map !== world.map) showCurrentMap();
    const { tileWidth, tileHeight } = world.tileset;
    const rx = prevX + (world.player.realX - prevX) * alpha;
    const ry = prevY + (world.player.realY - prevY) * alpha;
    player.update(world.player, rx, ry, tileWidth, tileHeight);
    player.sprite.zIndex = depthFor(ry);
    shown?.events.update(tileWidth, tileHeight, alpha);
    const camera = computeCamera({
      focusX: (rx + 0.5) * tileWidth,
      focusY: (ry + 0.5) * tileHeight,
      viewWidth: width,
      viewHeight: height,
      mapWidth: world.pixelWidth,
      mapHeight: world.pixelHeight,
    });
    const screen = world.screen;
    scene.position.set(-Math.round(camera.x) + screen.shakeX, -Math.round(camera.y));
    // Only the chunks around the camera are built (and freed again when it moves away).
    shown?.view.update({ x: camera.x, y: camera.y, width, height });
    drawScreenEffects(screenEffects, screen, width, height);
  };

  const tick = () => {
    const alpha = loop.advance(app.ticker.deltaMS / 1000, (dt) => {
      prevX = world.player.realX;
      prevY = world.player.realY;
      shown?.events.remember();
      // Judged on the state before this step's input is handled.
      sfx(uiSoundFor(input, activeMenu()));
      if (optionsScreen) {
        // Over the title or the map menu; nothing behind it moves meanwhile.
        const screen = optionsScreen;
        screen.update(input);
        if (screen.state.capturing && !capturing) {
          capturing = true;
          keyboard.captureNext((code) => {
            capturing = false;
            screen.keyPressed(code);
          });
        }
        if (screen.isClosed) {
          closeOptions();
          title.resume();
          menu?.resume();
        }
      } else if (mode === 'title') {
        title.update(input);
        const choice = title.choice;
        if (choice?.kind === 'new') play(createWorld(), 0);
        else if (choice?.kind === 'load') void loadGame(choice.save);
        else if (choice?.kind === 'options') openOptions();
      } else if (mode === 'playing') {
        playSeconds += dt;
        if (battles.isGameOver) {
          if (input.justPressed('confirm')) toTitle();
        } else if (menu) {
          menu.update(input);
          if (menu.outcome === 'quit') toTitle();
          else if (menu.outcome === 'closed') closeMenu();
          else if (menu.outcome === 'options') openOptions();
        } else if (shop) {
          // The world waits while the shop is open (like the menu).
          shop.update(input);
          if (shop.isClosed) {
            closeShop();
            world.interpreter?.continue();
          }
        } else if (world.interpreter?.pending?.type === 'shop') {
          const request = world.interpreter.pending;
          openShop(request.goods, request.canSell);
        } else {
          // Battles, dialog and transfers first: they consume the input and
          // answer the running event's requests before the world steps.
          battles.update(dt, world, input);
          if (!battles.active) {
            dialog.update(dt, input, world.interpreter);
            transfer.update(dt, world);
            if ((input.justPressed('menu') || input.justPressed('cancel')) && canOpenMenu()) {
              openMenu();
            } else {
              world.step(dt, input);
            }
          }
        }
      }
      input.endStep();
      for (const path of world.drainSounds()) audio.playSound(path);
      elapsed += dt;
    });
    screenEffects.visible = mode === 'playing';
    if (mode === 'title' || mode === 'loading') {
      titleView.render(title.state, manifest.name);
    } else {
      render(alpha);
      dialogView.render(dialog, elapsed);
      if (menu && menuView) menuView.render(menu.state);
      if (shop && shopView) shopView.render(shop.state);
    }
    if (optionsScreen && optionsView) optionsView.render(optionsScreen.state);
    const controller = battles.controller;
    if (battleView && controller) battleView.render(controller.state, elapsed);
    fadeOverlay.alpha = Math.max(transfer.fade, battles.fade);
    battleSounds();
    audio.setMusic(musicFor(musicScene(), db.system.audio, world.music));
  };
  render(1);
  app.ticker.add(tick);

  return {
    project,
    get world() {
      return world;
    },
    input,
    app,
    destroy() {
      app.ticker.remove(tick);
      keyboard.dispose();
      window.removeEventListener('keydown', unlockAudio);
      audio.destroy();
      removeDebugPanel();
      resizeObserver.disconnect();
      // Not `destroy(true)`: that also releases PixiJS's global resources and breaks any
      // other PixiJS app on the page (the editor's map canvas behind a playtest).
      app.destroy({ removeView: true }, { children: true });
    },
  };
}

/** Load and slice the image of every character sheet in the project. */
async function loadCharacterGraphics(
  project: LoadedProject,
): Promise<Map<string, CharacterGraphic>> {
  const entries = await Promise.all(
    [...project.characters.values()].map(async (sheet) => {
      const texture = await loadPixelTexture(project.assetUrl(sheet.image));
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

/** A plain "Game Over" screen; confirm starts a new game. */
function createGameOverScreen(width: number, height: number, theme: UiTheme): Container {
  const screen = new Container({ label: 'game-over' });
  screen.addChild(new Graphics().rect(0, 0, width, height).fill(0x000000));
  const title = new Text({
    text: 'Game Over',
    style: { fontFamily: theme.fontFamily, fontSize: 32, fontWeight: 'bold', fill: 0xd04040 },
  });
  title.anchor.set(0.5);
  title.position.set(width / 2, height / 2 - 12);
  const hint = new Text({
    text: 'Press Enter to start again',
    style: { fontFamily: theme.fontFamily, fontSize: theme.fontSize, fill: theme.textColor },
  });
  hint.anchor.set(0.5);
  hint.position.set(width / 2, height / 2 + 24);
  screen.addChild(title, hint);
  screen.visible = false;
  return screen;
}

/** localStorage when the browser allows it, otherwise in-memory slots (lost on reload). */
function defaultStorage(): KeyValueStorage {
  try {
    const storage = window.localStorage;
    const probe = '__freequest_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    console.warn('localStorage is unavailable; saves will not persist across reloads.');
    return new MemoryStorage();
  }
}

/** Draw the screen's tint, flash and fade (in that order, so a fade covers everything). */
function drawScreenEffects(
  g: Graphics,
  screen: World['screen'],
  width: number,
  height: number,
): void {
  g.clear();
  const layer = (color: string, alpha: number) => {
    if (alpha <= 0) return;
    g.rect(0, 0, width, height).fill({ color: parseInt(color.slice(1), 16), alpha });
  };
  layer(screen.tint.color, screen.tint.strength);
  layer(screen.flash.color, screen.flash.alpha);
  layer('#000000', screen.fade);
}
