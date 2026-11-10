import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { MenuOption } from './battle-controller.js';
import { type UiTheme, drawWindow } from './dialog-view.js';
import { fitText } from './text-fit.js';

/** Space kept between a row's label and its detail. */
const DETAIL_GAP = 10;

export interface ListWindowLayout {
  x: number;
  y: number;
  width: number;
  /** Rows shown; longer lists scroll to keep the cursor visible. */
  visibleRows: number;
  /** Shown for an empty list; null shows nothing (e.g. a status page). Default "(none)". */
  emptyText?: string | null;
}

/**
 * A window with a title and a list of options with a cursor: the building
 * block of the menus and the title screen. Redraws only when its content
 * changes.
 */
export class ListWindow {
  readonly container = new Container();
  private readonly frame = new Graphics();
  private readonly content = new Container();
  private key = '';

  constructor(private readonly theme: UiTheme) {
    this.container.addChild(this.frame, this.content);
  }

  /** Height in pixels for a number of rows (plus the title row, when there is a title). */
  heightFor(rows: number, hasTitle = true): number {
    return (rows + (hasTitle ? 1 : 0)) * this.theme.lineHeight + this.theme.padding * 2;
  }

  render(
    title: string,
    options: readonly MenuOption[],
    cursor: number,
    layout: ListWindowLayout,
  ): void {
    const key = JSON.stringify([title, options, cursor, layout]);
    if (key === this.key) return;
    this.key = key;
    const { theme } = this;
    const rows =
      options.length === 0 && layout.emptyText === null
        ? 0
        : Math.max(1, Math.min(layout.visibleRows, options.length));
    const titleRows = title ? 1 : 0;
    const h = this.heightFor(rows, title !== '');
    this.container.position.set(layout.x, layout.y);
    drawWindow(this.frame, theme, layout.width, h);
    this.content.removeChildren().forEach((c) => c.destroy());

    const style = new TextStyle({
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSize,
      fill: theme.textColor,
    });
    const small = new TextStyle({
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSize - 2,
      fill: theme.textColor,
    });
    const titleStyle = style.clone();
    titleStyle.fill = theme.speakerColor;
    if (title) {
      const heading = new Text({ text: title, style: titleStyle });
      heading.position.set(theme.padding, theme.padding);
      this.content.addChild(heading);
    }

    if (options.length === 0) {
      const emptyText = layout.emptyText === undefined ? '(none)' : layout.emptyText;
      if (emptyText === null) return;
      const none = new Text({ text: emptyText, style });
      none.alpha = 0.5;
      none.position.set(theme.padding + 12, theme.padding + titleRows * theme.lineHeight);
      this.content.addChild(none);
      return;
    }
    // Scroll so the cursor stays in view.
    const first = Math.min(Math.max(0, cursor - rows + 1), Math.max(0, options.length - rows));
    options.slice(first, first + rows).forEach((option, i) => {
      const index = first + i;
      const y = theme.padding + (i + titleRows) * theme.lineHeight;
      if (index === cursor) {
        this.content.addChild(
          new Graphics()
            .roundRect(
              theme.padding - 2,
              y,
              layout.width - theme.padding * 2 + 4,
              theme.lineHeight,
              3,
            )
            .fill({ color: theme.borderColor, alpha: 0.22 })
            .poly([theme.padding + 2, y + 5, theme.padding + 7, y + 9, theme.padding + 2, y + 13])
            .fill(theme.speakerColor),
        );
      }
      const label = new Text({ text: option.label, style });
      label.alpha = option.enabled ? 1 : 0.4;
      label.position.set(theme.padding + 12, y);
      this.content.addChild(label);
      let labelRight = layout.width - theme.padding;
      if (option.detail) {
        const detail = new Text({ text: option.detail, style: small });
        detail.alpha = label.alpha;
        detail.position.set(layout.width - theme.padding - detail.width, y + 1);
        this.content.addChild(detail);
        labelRight = detail.x - DETAIL_GAP;
      }
      // A long label (a long map name in a save slot) shortens instead of running into the detail.
      label.text = fitText(option.label, labelRight - label.x, (text) => {
        label.text = text;
        return label.width;
      });
    });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
