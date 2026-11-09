// Title screen: New Game, Continue, Load. Free of PixiJS so it can be tested
// in Node; `title-view.ts` draws the state.
import type { InputState } from '@freequest/core';
import type { SaveFile } from '@freequest/schema';
import type { MenuOption } from './battle-controller.js';
import { slotOption } from './menu-controller.js';
import type { SaveStore } from './save-store.js';

export type TitleChoice =
  { readonly kind: 'new' } | { readonly kind: 'load'; readonly save: SaveFile };

export interface TitleUiState {
  readonly screen: 'main' | 'load';
  readonly title: string;
  readonly options: readonly MenuOption[];
  readonly cursor: number;
  readonly message: string | null;
}

const MAIN = ['New Game', 'Continue', 'Load'] as const;

export class TitleController {
  private screen: 'main' | 'load' = 'main';
  private cursor = 0;
  private feedback: string | null = null;
  private chosen: TitleChoice | null = null;

  constructor(
    private readonly gameName: string,
    private readonly saves: SaveStore,
  ) {
    // Start on Continue when there is something to continue.
    if (saves.latest()) this.cursor = 1;
  }

  /** Set once the player has picked how to start. */
  get choice(): TitleChoice | null {
    return this.chosen;
  }

  get state(): TitleUiState {
    return {
      screen: this.screen,
      title: this.screen === 'main' ? this.gameName : 'Load which slot?',
      options: this.options(),
      cursor: this.cursor,
      message: this.feedback,
    };
  }

  private options(): MenuOption[] {
    if (this.screen === 'load') {
      return this.saves
        .list()
        .map((info) => ({ ...slotOption(info), enabled: info.kind === 'save' }));
    }
    const hasSave = this.saves.latest() !== null;
    return MAIN.map((label) => ({ label, enabled: label === 'New Game' || hasSave }));
  }

  update(input: InputState): void {
    if (this.chosen) return;
    const options = this.options();
    const count = options.length;
    if (input.justPressed('down') || input.justPressed('up') || input.justPressed('confirm')) {
      this.feedback = null;
    }
    if (input.justPressed('down')) this.cursor = (this.cursor + 1) % count;
    if (input.justPressed('up')) this.cursor = (this.cursor - 1 + count) % count;
    if (input.justPressed('cancel') && this.screen === 'load') {
      this.screen = 'main';
      this.cursor = 2;
      return;
    }
    if (!input.justPressed('confirm')) return;

    if (this.screen === 'load') {
      const info = this.saves.read(this.cursor + 1);
      if (info.kind === 'save') this.chosen = { kind: 'load', save: info.save };
      else if (info.kind === 'broken') this.feedback = `That save can't be loaded: ${info.reason}`;
      return;
    }
    const option = options[this.cursor];
    if (!option?.enabled) return;
    if (option.label === 'New Game') {
      this.chosen = { kind: 'new' };
    } else if (option.label === 'Continue') {
      const latest = this.saves.latest();
      if (latest) this.chosen = { kind: 'load', save: latest.save };
    } else {
      this.screen = 'load';
      this.cursor = 0;
    }
  }

  /** Back to the main title options (after a failed load or returning from the game). */
  reset(message: string | null = null): void {
    this.screen = 'main';
    this.cursor = this.saves.latest() ? 1 : 0;
    this.chosen = null;
    this.feedback = message;
  }
}
