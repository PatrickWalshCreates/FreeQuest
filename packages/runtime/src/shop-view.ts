import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { type UiTheme, drawWindow } from './dialog-view.js';
import { ListWindow } from './list-window.js';
import type { ShopUiState } from './shop-controller.js';

/**
 * Draws the shop over the map: the list (commands, goods or what to sell), a
 * panel about the highlighted good with the party's gold, the quantity box
 * while choosing how many, and a message line. Rebuilds text only on change.
 */
export class ShopView {
  readonly container = new Container({ label: 'shop' });
  private readonly list: ListWindow;
  private readonly sideFrame = new Graphics();
  private readonly side = new Container();
  private readonly countFrame = new Graphics();
  private readonly countBox = new Container();
  private readonly messageFrame = new Graphics();
  private readonly messageText: Text;
  private readonly style: TextStyle;
  private readonly small: TextStyle;
  private readonly accent: TextStyle;
  private sideKey = '';
  private countKey = '';

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly theme: UiTheme,
  ) {
    this.list = new ListWindow(theme);
    this.style = new TextStyle({
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSize,
      fill: theme.textColor,
    });
    this.small = new TextStyle({
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSize - 2,
      fill: theme.textColor,
      wordWrap: true,
      wordWrapWidth: this.sideWidth - theme.padding * 2,
    });
    this.accent = this.style.clone();
    this.accent.fill = theme.speakerColor;
    this.messageText = new Text({ text: '', style: this.style });
    this.container.addChild(
      new Graphics().rect(0, 0, width, height).fill({ color: 0x000000, alpha: 0.35 }),
      this.list.container,
      this.sideFrame,
      this.side,
      this.countFrame,
      this.countBox,
      this.messageFrame,
      this.messageText,
    );
  }

  private get listWidth(): number {
    return Math.round(this.width * 0.46);
  }

  private get sideWidth(): number {
    return this.width - this.theme.margin * 3 - this.listWidth;
  }

  render(state: ShopUiState): void {
    const { theme } = this;
    const m = theme.margin;
    this.list.render(state.title, state.options, state.cursor, {
      x: m,
      y: m,
      width: this.listWidth,
      visibleRows: 10,
      emptyText: state.screen === 'sell' ? '(nothing to sell)' : '(none)',
    });
    this.renderSide(state);
    this.renderCount(state);
    const showMessage = state.message !== null;
    this.messageFrame.visible = this.messageText.visible = showMessage;
    if (state.message !== null) {
      const h = theme.lineHeight + theme.padding * 2;
      drawWindow(this.messageFrame, theme, this.width - m * 2, h);
      this.messageFrame.position.set(m, this.height - m - h);
      if (this.messageText.text !== state.message) this.messageText.text = state.message;
      this.messageText.position.set(m + theme.padding, this.height - m - h + theme.padding);
    }
  }

  private renderSide(state: ShopUiState): void {
    const key = JSON.stringify([state.info, state.gold, state.currency]);
    if (key === this.sideKey) return;
    this.sideKey = key;
    const { theme } = this;
    const x = theme.margin * 2 + this.listWidth;
    const w = this.sideWidth;
    const h = this.list.heightFor(10);
    drawWindow(this.sideFrame, theme, w, h);
    this.sideFrame.position.set(x, theme.margin);
    this.side.removeChildren().forEach((c) => c.destroy());
    this.side.position.set(x + theme.padding, theme.margin + theme.padding);
    let y = 0;
    for (const line of state.info) {
      const text = new Text({ text: line, style: this.small });
      text.position.set(0, y);
      this.side.addChild(text);
      y += text.height + 4;
    }
    const gold = new Text({ text: `${state.gold} ${state.currency}`, style: this.accent });
    gold.position.set(w - theme.padding * 2 - gold.width, h - theme.padding * 2 - theme.lineHeight);
    this.side.addChild(gold);
  }

  private renderCount(state: ShopUiState): void {
    const q = state.quantity;
    this.countFrame.visible = this.countBox.visible = q !== null;
    if (!q) return;
    const key = JSON.stringify(q);
    if (key === this.countKey) return;
    this.countKey = key;
    const { theme } = this;
    const w = Math.round(this.width * 0.5);
    const h = theme.lineHeight * 3 + theme.padding * 2;
    const x = Math.round((this.width - w) / 2);
    const y = Math.round((this.height - h) / 2);
    drawWindow(this.countFrame, theme, w, h);
    this.countFrame.position.set(x, y);
    this.countBox.removeChildren().forEach((c) => c.destroy());
    this.countBox.position.set(x + theme.padding, y + theme.padding);
    const verb = q.mode === 'buy' ? 'Buy' : 'Sell';
    const lines: [string, TextStyle][] = [
      [`${verb} ${q.name}`, this.accent],
      [`◀ ${q.count} ▶   (most: ${q.max})`, this.style],
      [`${q.mode === 'buy' ? 'Cost' : 'You get'}: ${q.total} ${state.currency}`, this.style],
    ];
    lines.forEach(([text, style], i) => {
      const t = new Text({ text, style });
      t.position.set(0, i * theme.lineHeight);
      this.countBox.addChild(t);
    });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
