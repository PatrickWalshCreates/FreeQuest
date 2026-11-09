import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { UiTheme } from './dialog-view.js';
import { ListWindow } from './list-window.js';
import type { TitleUiState } from './title-controller.js';

/** The title screen: backdrop, game name, options, and an optional message. */
export class TitleView {
  readonly container = new Container({ label: 'title' });
  private readonly list: ListWindow;
  private readonly heading: Text;
  private readonly message: Text;

  constructor(
    private readonly width: number,
    private readonly height: number,
    theme: UiTheme,
  ) {
    const backdrop = new Graphics();
    const bands = [0x101a33, 0x16244a, 0x1e3160, 0x283f78];
    bands.forEach((color, i) => {
      const y = Math.round((i * height) / bands.length);
      backdrop.rect(0, y, width, Math.ceil(height / bands.length)).fill(color);
    });
    // Scattered stars from a small seeded generator (same sky every time).
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 60; i++) {
      const sx = Math.floor(next() * width);
      const sy = Math.floor(next() * height * 0.55);
      backdrop.rect(sx, sy, 1, 1).fill({ color: 0xffffff, alpha: 0.35 + next() * 0.6 });
    }
    this.heading = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: theme.fontFamily,
        fontSize: 30,
        fontWeight: 'bold',
        fill: theme.speakerColor,
        stroke: { color: 0x000000, width: 4 },
      }),
    });
    this.heading.anchor.set(0.5);
    this.heading.position.set(width / 2, Math.round(height * 0.28));
    this.message = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: theme.fontFamily,
        fontSize: theme.fontSize - 2,
        fill: 0xff9a8a,
        wordWrap: true,
        wordWrapWidth: width - 40,
      }),
    });
    this.message.anchor.set(0.5, 0);
    this.list = new ListWindow(theme);
    this.container.addChild(backdrop, this.heading, this.list.container, this.message);
  }

  render(state: TitleUiState, gameName: string): void {
    if (this.heading.text !== gameName) this.heading.text = gameName;
    const isLoad = state.screen === 'load';
    const width = isLoad ? Math.round(this.width * 0.8) : 180;
    const rows = state.options.length;
    const listHeight = this.list.heightFor(rows, isLoad);
    const y = Math.round(this.height * 0.45);
    this.list.render(isLoad ? state.title : '', state.options, state.cursor, {
      x: Math.round((this.width - width) / 2),
      y,
      width,
      visibleRows: rows,
    });
    const text = state.message ?? '';
    if (this.message.text !== text) this.message.text = text;
    this.message.position.set(this.width / 2, y + listHeight + 8);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
