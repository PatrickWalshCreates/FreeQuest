// PixiJS normally compiles some shader and uniform code at run time with
// new Function(), which a strict Content Security Policy (the desktop apps')
// forbids. This module installs pre-built replacements; importing it here
// covers every page that uses the runtime (player, editor).
import 'pixi.js/unsafe-eval';
export * from './game.js';
export * from './loader.js';
export * from './keyboard.js';
export * from './map-view.js';
export * from './character-view.js';
export * from './event-views.js';
export * from './dialog.js';
export * from './dialog-view.js';
export * from './faces.js';
export * from './transfer.js';
export * from './debug-text.js';
export * from './debug-panel.js';
export * from './battle-text.js';
export * from './battle-controller.js';
export * from './battle-view.js';
export * from './battle-flow.js';
export * from './save-store.js';
export * from './menu-controller.js';
export * from './menu-view.js';
export * from './title-controller.js';
export * from './title-view.js';
export * from './list-window.js';
export * from './audio-director.js';
export * from './audio-player.js';
export * from './textures.js';
export * from './scale.js';
export * from './text-fit.js';
export * from './options.js';
