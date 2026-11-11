import { type Action, ActionState } from '@freequest/core';
import { describe, expect, it } from 'vitest';
import { OptionsController, volumeBar } from '../src/options-controller.js';
import {
  DEFAULT_KEY_BINDINGS,
  type GameOptions,
  OptionsStore,
  defaultOptions,
  keyLabel,
  keysFor,
  rebind,
  volumeGain,
} from '../src/index.js';
import { MemoryStorage } from '../src/save-store.js';

describe('options', () => {
  it('names keys for players', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit1')).toBe('1');
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel('Escape')).toBe('Esc');
    expect(keyLabel('F5')).toBe('F5');
    expect(volumeGain(5)).toBe(0.5);
    expect(volumeGain(12)).toBe(1);
  });

  it('rebinds an action, taking the key from another one', () => {
    const result = rebind(DEFAULT_KEY_BINDINGS, 'menu', 'KeyX');
    if ('problem' in result) throw new Error(result.problem);
    expect(keysFor(result.keys, 'menu')).toEqual(['KeyX']);
    expect(keysFor(result.keys, 'cancel')).toEqual(['Escape', 'Backspace']);
    expect(keysFor(result.keys, 'up')).toEqual(['ArrowUp', 'KeyW']);
  });

  it("never takes an action's only key", () => {
    const once = rebind(DEFAULT_KEY_BINDINGS, 'menu', 'KeyM');
    if ('problem' in once) throw new Error(once.problem);
    const twice = rebind(once.keys, 'confirm', 'KeyM');
    expect(twice).toEqual({ problem: 'M is the only key for Menu: give it another first.' });
  });

  it('stores options per game, falling back to defaults when damaged', () => {
    const storage = new MemoryStorage();
    const store = new OptionsStore(storage, 'demo');
    expect(store.load()).toEqual(defaultOptions());
    const changed: GameOptions = {
      music: 2,
      sound: 9,
      keys: { ...DEFAULT_KEY_BINDINGS, KeyQ: 'menu' },
    };
    store.save(changed);
    expect(new OptionsStore(storage, 'demo').load()).toEqual(changed);
    expect(new OptionsStore(storage, 'other').load()).toEqual(defaultOptions());
    storage.setItem('freequest:game:demo:options', '{"music":99,"keys":{"KeyA":"up"}}');
    expect(store.load()).toEqual(defaultOptions());
    storage.setItem('freequest:game:demo:options', 'not json');
    expect(store.load()).toEqual(defaultOptions());
  });
});

describe('OptionsController', () => {
  function setup() {
    const changes: GameOptions[] = [];
    const options = new OptionsController(defaultOptions(), defaultOptions(), (o) =>
      changes.push(o),
    );
    const input = new ActionState();
    const tap = (action: Action, times = 1) => {
      for (let i = 0; i < times; i++) {
        input.press(action);
        options.update(input);
        input.endStep();
        input.release(action);
      }
    };
    return { options, changes, tap };
  }

  it('turns the volumes up and down, saving each change', () => {
    const { options, changes, tap } = setup();
    expect(options.state.options[0]).toMatchObject({ label: 'Music', detail: volumeBar(5) });
    tap('right', 7);
    expect(options.options.music).toBe(10);
    tap('down');
    tap('left', 8);
    expect(options.options.sound).toBe(0);
    expect(changes.at(-1)).toMatchObject({ music: 10, sound: 0 });
    tap('confirm');
    expect(options.options.sound).toBe(1);
  });

  it('rebinds a key by pressing it, and Esc keeps the old ones', () => {
    const { options, changes, tap } = setup();
    tap('down', 2);
    tap('confirm'); // Controls…
    expect(options.state.screen).toBe('controls');
    tap('down', 6); // Menu
    tap('confirm');
    expect(options.state.capturing).toBe('menu');
    tap('down'); // ignored while capturing
    options.keyPressed('KeyM');
    expect(keysFor(options.options.keys, 'menu')).toEqual(['KeyM']);
    expect(changes).toHaveLength(1);
    expect(options.state.message).toBe('Menu: M');
    tap('confirm');
    options.keyPressed('Escape');
    expect(keysFor(options.options.keys, 'menu')).toEqual(['KeyM']);
    tap('down'); // Reset
    tap('confirm');
    expect(options.options.keys).toEqual(DEFAULT_KEY_BINDINGS);
    tap('cancel');
    tap('cancel');
    expect(options.isClosed).toBe(true);
  });
});
