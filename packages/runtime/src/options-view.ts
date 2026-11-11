import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { type UiTheme, drawWindow } from './dialog-view.js';
import { ListWindow } from './list-window.js';
import type { OptionsUiState } from './options-controller.js';

/** Draws the options screen over whatever is behind it (title or map menu). */
export class OptionsView {
  readonly container = new Container({ label: 'options' });
  private readonly list: ListWindow;
  private readonly messageFrame = new Graphics();
  private readonly messageText: Text;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly theme: UiTheme,
  ) {
    this.list = new ListWindow(theme);
    this.messageText = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: theme.fontFamily,
        fontSize: theme.fontSize,
        fill: theme.textColor,
      }),
    });
    this.container.addChild(
      new Graphics().rect(0, 0, width, height).fill({ color: 0x000000, alpha: 0.55 }),
      this.list.container,
      this.messageFrame,
      this.messageText,
    );
  }

  render(state: OptionsUiState): void {
    const { theme } = this;
    const w = Math.round(this.width * 0.7);
    const rows = state.options.length;
    const h = this.list.heightFor(rows);
    this.list.render(state.title, state.options, state.cursor, {
      x: Math.round((this.width - w) / 2),
      y: Math.max(theme.margin, Math.round((this.height - h) / 2) - theme.lineHeight),
      width: w,
      visibleRows: rows,
    });
    const show = state.message !== null;
    this.messageFrame.visible = this.messageText.visible = show;
    if (state.message === null) return;
    const m = theme.margin;
    const mh = theme.lineHeight + theme.padding * 2;
    drawWindow(this.messageFrame, theme, this.width - m * 2, mh);
    this.messageFrame.position.set(m, this.height - m - mh);
    if (this.messageText.text !== state.message) this.messageText.text = state.message;
    this.messageText.position.set(m + theme.padding, this.height - m - mh + theme.padding);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
