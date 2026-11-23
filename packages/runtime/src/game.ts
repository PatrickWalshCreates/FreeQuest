import {
  ActionState,
  DatabaseIndex,
  type Direction,
  FixedTimestep,
  type PluginError,
  type PluginHost,
  World,
  translateSave,
  computeCamera,
} from '@freequest/core';
import {
  type SaveFile,
  type ShopGood,
  type SoundKey,
  type Tileset,
  faceImages,
  resolveWindowLook,
} from '@freequest/schema';
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
import { DialogView, type UiTheme } from './dialog-view.js';
import { colorNumber, loadWindowFont, themeFromLook } from './window-theme.js';
import { EventViews, depthFor } from './event-views.js';
import { createFaceSheets } from './faces.js';
import { loadIconSheet } from './icons.js';
import { OptionsController } from './options-controller.js';
import { OptionsView } from './options-view.js';
import { type GameOptions, OptionsStore, defaultOptions, volumeGain } from './options.js';
import { ShopController } from './shop-controller.js';
import { ShopView } from './shop-view.js';
import { DEFAULT_KEY_BINDINGS, type KeyBindings, bindKeyboard } from './keyboard.js';
import { GamepadInput } from './gamepad.js';
import { HeldInputs } from './held-inputs.js';
import { type LoadedProject, type ProjectSource, getOrThrow, loadProject } from './loader.js';
import { type MapView, createMapView } from './map-view.js';
import { PictureView } from './picture-view.js';
import { showPluginNotice } from './plugin-notice.js';
import { loadPlugins } from './plugins.js';
import { PluginDrawing } from './plugin-drawing.js';
import { PluginLayer } from './plugin-layer.js';
import { AnimationSheets, CharacterEffectViews } from './effect-views.js';
import { fitScale, renderResolution } from './scale.js';
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
  /**
   * Run the project's enabled plugins (default true). Off, their commands do
   * nothing and no plugin code is loaded.
   */
  plugins?: boolean;
  /**
   * A plugin failed (it is switched off; the game goes on). Default: logged
   * and shown in a notice over the game.
   */
  onPluginError?: (error: PluginError) => void;
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
  const onPluginError =
    options.onPluginError ??
    ((error: PluginError) => {
      console.error(error, error.cause);
      showPluginNotice(options.parent, error.message);
    });
  const drawing = new PluginDrawing();
  const plugins: PluginHost | null =
    options.plugins === false
      ? null
      : await loadPlugins(project, onPluginError, undefined, drawing.extension);
  drawing.seal();
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

  // Faces load in the background: common events' now, each map's when it appears.
  const faces = createFaceSheets((path) => project.assetUrl(path));
  faces.preload(faceImages((project.database.commonEvents ?? []).map((c) => c.commands)));

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

  // The player looks like the party's leader (see World.playerCharacter).
  let playerCharacter = manifest.player.character;
  const player = new CharacterView(getOrThrow(characterGraphics, playerCharacter, 'character'));
  const characters = new Container({ label: 'characters', sortableChildren: true });
  characters.addChild(player.sprite);
  const scene = new Container({ label: 'scene' });
  scene.addChild(characters);
  app.stage.addChild(scene);
  // Animations and balloons: on the map over every character, and in battles.
  const animationSheets = new AnimationSheets((path) => loadPixelTexture(project.assetUrl(path)));
  const effectViews = new CharacterEffectViews(animationSheets);
  // Pictures events show: over the map, under the screen effects (a fade covers them).
  const pictureView = new PictureView((path) => loadPixelTexture(project.assetUrl(path)));
  app.stage.addChild(pictureView.container);
  // Events' fades, tints and flashes: over the map, under messages and menus.
  // Plugins draw over the map and pictures, under screen effects and windows.
  const pluginLayer = plugins && new PluginLayer(drawing, plugins, width, height);
  if (pluginLayer) app.stage.addChild(pluginLayer.container);
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
    faces.preload(faceImages(world.map.events.flatMap((e) => e.pages.map((p) => p.commands))));
    scene.addChildAt(view.below, 0);
    scene.addChild(view.above);
    // Animations and balloons over everything on the map.
    scene.addChild(effectViews.container);
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
  // Every window's look: the project's (its font loaded first), then startGame's overrides.
  const look = resolveWindowLook(project.database.system?.ui);
  const fontLoaded = await loadWindowFont(look, (path) => project.assetUrl(path));
  const theme: UiTheme = { ...themeFromLook(look, fontLoaded), ...options.ui };
  const baseWindowColor = theme.windowColor;
  const dialogView = new DialogView(width, height, theme, icons, faces);
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
  // Battle backgrounds, cached like enemy images; one that can't load leaves the plain backdrop.
  const backgroundTextures = new Map<string, Texture | null>();
  const battles = new BattleFlow(db, {
    async prepare(troopId, background) {
      if (background !== null && !backgroundTextures.has(background)) {
        backgroundTextures.set(
          background,
          await loadPixelTexture(project.assetUrl(background)).catch((error: unknown) => {
            console.warn(`Battle background ${background} couldn't be loaded`, error);
            return null;
          }),
        );
      }
      const enemies = db.troops.get(troopId).enemies.map((id) => db.enemies.get(id));
      await Promise.all(
        enemies.map(async (enemy) => {
          if (enemy.image && !enemyTextures.has(enemy.id)) {
            enemyTextures.set(enemy.id, await loadPixelTexture(project.assetUrl(enemy.image)));
          }
        }),
      );
    },
    begin(battle, _controller, background) {
      battleView = new BattleView(
        battle,
        width,
        height,
        enemyTextures,
        theme,
        icons,
        animationSheets,
        background === null ? null : (backgroundTextures.get(background) ?? null),
      );
      scene.visible = false;
      dialogView.container.visible = false;
      app.stage.addChildAt(battleView.container, app.stage.getChildIndex(fadeOverlay));
      // Battle events' messages show in the message box, over the battle.
      app.stage.addChildAt(dialogView.container, app.stage.getChildIndex(fadeOverlay));
    },
    end() {
      battleView?.destroy();
      battleView = null;
      scene.visible = true;
      dialogView.container.visible = true;
      // Back under the menus, just over the map.
      app.stage.addChildAt(dialogView.container, app.stage.getChildIndex(screenEffects) + 1);
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
    // Sharp text: render at the screen's resolution (texts redraw themselves when it changes).
    const resolution = renderResolution(scale, window.devicePixelRatio, look.sharpText);
    if (resolution !== app.renderer.resolution) app.renderer.resize(width, height, resolution);
    canvas.style.width = `${width * scale}px`;
    canvas.style.height = `${height * scale}px`;
  };
  const resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(options.parent);
  // A window moved to a display with another pixel ratio resizes without changing its size.
  window.addEventListener('resize', fit);
  fit();

  // Keys and gamepads hold actions together (letting go of one never drops the other's).
  const held = new HeldInputs(input);
  const keyboard = bindKeyboard(window, held, options.keyBindings);
  const gamepads = new GamepadInput(held);
  const connectedPads = (): readonly (Gamepad | null)[] => {
    try {
      return navigator.getGamepads?.() ?? [];
    } catch {
      // Not allowed here (a frame without the gamepad permission): no pads.
      return [];
    }
  };
  const removeDebugPanel = options.debug
    ? createDebugPanel(options.parent, () => world, manifest)
    : () => undefined;

  // Audio ------------------------------------------------------------------
  const audio = new AudioPlayer((path) => project.assetUrl(path));
  const unlockAudio = () => audio.unlock();
  // Try at once: where sound is already allowed (a click on Play in the editor,
  // the desktop apps) the title music starts now; elsewhere the first key does it.
  audio.unlock();
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
    for (const path of controller?.drainSounds() ?? []) audio.playSound(path);
    if (controller && !hadBattle) sfx('battleStart');
    hadBattle = controller !== null;
    const event = controller?.state.event ?? null;
    if (event === lastBattleEvent) return;
    lastBattleEvent = event;
    if (event?.type !== 'hit' || event.result.missed) return;
    // An animation with its own sounds speaks for the hit.
    const animation = event.animation !== null ? db.animations.find(event.animation) : undefined;
    if (animation && animation.sounds.length > 0) return;
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
    gamepads.setBindings(o.pad);
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
      () => gamepads.connected,
    );
    optionsView = new OptionsView(width, height, theme);
    app.stage.addChildAt(optionsView.container, app.stage.getChildIndex(fadeOverlay));
  };
  const closeOptions = () => {
    keyboard.cancelCapture();
    gamepads.cancelCapture();
    optionsView?.destroy();
    optionsView = null;
    optionsScreen = null;
    capturing = false;
  };
  const title = new TitleController(manifest.name, saves);
  const titleView = new TitleView(width, height, theme);
  // The game's title picture, when it has one (the starry sky shows until it loads).
  const titleScreen = db.system.titleScreen;
  if (titleScreen) {
    loadPixelTexture(project.assetUrl(titleScreen.image)).then(
      (texture) => titleView.setPicture(texture, titleScreen.showName),
      (error: unknown) =>
        console.warn(`Could not load the title picture "${titleScreen.image}"`, error),
    );
  }
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
    plugins?.start(next);
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

  /** The map menu, or only its save list for an event's Open save screen. */
  const openMenu = (saveOnly = false) => {
    menu = new MenuController({
      world,
      saves,
      game: manifest.id,
      playSeconds: () => playSeconds,
      onSaved: () => sfx('save'),
      saveOnly,
    });
    menuView = new MenuView(() => world, width, height, theme, icons);
    app.stage.addChildAt(menuView.container, app.stage.getChildIndex(titleView.container));
  };

  /** The menu opens only when nothing else is going on. */
  const canOpenMenu = () =>
    world.access.menu &&
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
    // Change window colour lasts the rest of the game; windows read it as they draw.
    theme.windowColor =
      world.windowColor === null ? baseWindowColor : colorNumber(world.windowColor);
    if (shown?.map !== world.map) showCurrentMap();
    const { tileWidth, tileHeight } = world.tileset;
    const rx = prevX + (world.player.realX - prevX) * alpha;
    const ry = prevY + (world.player.realY - prevY) * alpha;
    if (world.playerCharacter !== playerCharacter) {
      const graphic = characterGraphics.get(world.playerCharacter);
      if (graphic) player.setGraphic(graphic);
      playerCharacter = world.playerCharacter;
    }
    player.sprite.visible = !world.playerHidden;
    player.update(world.player, rx, ry, tileWidth, tileHeight);
    player.sprite.zIndex = depthFor(ry);
    shown?.events.update(tileWidth, tileHeight, alpha);
    const camera = computeCamera({
      // An event may have scrolled the view away from the player.
      focusX: (rx + 0.5 + world.scroll.x) * tileWidth,
      focusY: (ry + 0.5 + world.scroll.y) * tileHeight,
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
    pictureView.render(world.pictures.list);
    pluginLayer?.render(world, {
      width,
      height,
      camera: { x: Math.round(camera.x) - screen.shakeX, y: Math.round(camera.y) },
      tileWidth,
      tileHeight,
      seconds: elapsed,
    });
    effectViews.render(world.effects, db.system.balloons, (target) => {
      if (target !== 'player') return shown?.events.spotOf(target) ?? null;
      const sprite = player.sprite;
      return sprite.visible ? { x: sprite.x, y: sprite.y, height: sprite.height } : null;
    });
  };

  const tick = () => {
    // Pads are read once a frame, before the logic steps that use them.
    if (gamepads.poll(connectedPads())) audio.unlock();
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
          // A key answers either screen (Escape keeps the old binding); a pad only the Gamepad one.
          keyboard.captureNext((code) => {
            capturing = false;
            gamepads.cancelCapture();
            screen.keyPressed(code);
          });
          if (screen.state.capturingFrom === 'gamepad') {
            gamepads.captureNext((id) => {
              capturing = false;
              keyboard.cancelCapture();
              screen.padPressed(id);
            });
          }
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
          else if (menu.outcome === 'closed') {
            const commons = menu.commonEvents;
            closeMenu();
            // An item's or skill's common event runs now, on the map.
            if (commons.length > 0 && !world.interpreter) {
              world.run(commons.flatMap((id) => [{ type: 'callCommon' as const, common: id }]));
            }
            // An event's save screen: the event carries on.
            if (world.interpreter?.pending?.type === 'save') world.interpreter.continue();
          } else if (menu.outcome === 'options') openOptions();
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
        } else if (world.interpreter?.pending?.type === 'save') {
          dialog = new DialogController();
          openMenu(true);
        } else if (world.interpreter?.pending?.type === 'gameOver') {
          battles.showGameOver();
        } else if (world.interpreter?.pending?.type === 'title') {
          toTitle();
        } else {
          // Battles, dialog and transfers first: they consume the input and
          // answer the running event's requests before the world steps.
          // A battle event's message or choice answers before the battle steps.
          if (battles.active)
            dialog.update(dt, input, battles.controller?.eventInterpreter ?? null);
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
    // Pictures belong to the map's scene: not over the title or a battle.
    pictureView.container.visible = mode === 'playing' && scene.visible;
    if (pluginLayer) pluginLayer.container.visible = pictureView.container.visible;
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
    if (battleView && controller) {
      battleView.render(controller.state, elapsed);
      dialogView.container.visible = controller.eventInterpreter !== null;
    }
    fadeOverlay.alpha = Math.max(transfer.fade, battles.fade);
    battleSounds();
    audio.setMusic(musicFor(musicScene(), db.system.audio, world.music, world.battleMusic));
    // The background sound loops only on the map (not in battles or on the title).
    audio.setBackground(musicScene() === 'map' ? world.backgroundSound : null);
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
      window.removeEventListener('resize', fit);
      pluginLayer?.destroy();
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
