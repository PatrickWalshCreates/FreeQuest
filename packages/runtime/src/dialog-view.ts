import type { TextRun } from '@freequest/core';
import type { TextColorName } from '@freequest/schema';
import { CanvasTextMetrics, Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import type { DialogController } from './dialog.js';
import { type FaceSheets, NO_FACES } from './faces.js';
import { type IconSheet, NO_ICONS, iconSprite } from './icons.js';
import { type LinePiece, type RichLayout, layoutRuns, revealPiece } from './rich-text.js';

/** Look of the message and choice windows. Swappable per game via `startGame({ ui })`. */
export interface UiTheme {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  textColor: number;
  speakerColor: number;
  windowColor: number;
  windowAlpha: number;
  borderColor: number;
  /** Gap between windows and the screen edge, in pixels. */
  margin: number;
  /** Space between a window's border and its contents, in pixels. */
  padding: number;
  /** Minimum text lines in the message box, so its size doesn't jump between messages. */
  minLines: number;
  /** What `{color:…}` names in messages look like. */
  textColors: Record<TextColorName, number>;
}

export const DEFAULT_UI_THEME: UiTheme = {
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  fontSize: 14,
  lineHeight: 18,
  textColor: 0xf4f1ea,
  speakerColor: 0xffd479,
  windowColor: 0x141a2e,
  windowAlpha: 0.9,
  borderColor: 0xe6dcc3,
  margin: 8,
  padding: 10,
  minLines: 3,
  textColors: {
    white: 0xffffff,
    gray: 0xa8a8b4,
    red: 0xff6b6b,
    orange: 0xffa94d,
    yellow: 0xffd479,
    green: 0x8ce99a,
    blue: 0x74c0fc,
    purple: 0xd0a2ff,
  },
};

/** A `{color:…}` value as a colour: a theme name or #rrggbb (null = the text colour). */
export function textColor(theme: UiTheme, color: string | null): number {
  if (color === null) return theme.textColor;
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return parseInt(color.slice(1), 16);
  return theme.textColors[color as TextColorName] ?? theme.textColor;
}

export function drawWindow(g: Graphics, theme: UiTheme, w: number, h: number): void {
  g.clear()
    .roundRect(0, 0, w, h, 6)
    .fill({ color: theme.windowColor, alpha: theme.windowAlpha })
    .stroke({ width: 2, color: theme.borderColor, alignment: 1 });
}

/** Draws the dialog controller's state in screen space (unaffected by the camera). */
export class DialogView {
  readonly container = new Container({ label: 'dialog' });

  private readonly messageBox = new Container({ label: 'message' });
  private readonly messageFrame = new Graphics();
  private readonly speaker: Text;
  /** The message's face, at the left of the box. */
  private readonly face = new Sprite();
  /** The message's pieces of text and icons, laid out once per message. */
  private readonly body = new Container({ label: 'body' });
  private readonly more = new Graphics();

  private readonly choiceBox = new Container({ label: 'choice' });
  private readonly choiceFrame = new Graphics();
  private readonly cursor = new Graphics();
  private readonly options: Text[] = [];

  private readonly textStyle: TextStyle;
  /** One style per colour used, so pieces of a colour share it. */
  private readonly styles = new Map<number, TextStyle>();
  /** The current message's layout and the node drawing each piece. */
  private laidOut: {
    readonly runs: readonly TextRun[];
    readonly maxWidth: number;
    readonly layout: RichLayout;
    readonly nodes: readonly { readonly piece: LinePiece; readonly node: Text | Sprite }[];
  } | null = null;
  private choiceKey = '';

  constructor(
    private readonly screenWidth: number,
    private readonly screenHeight: number,
    private readonly theme: UiTheme = DEFAULT_UI_THEME,
    private readonly icons: IconSheet = NO_ICONS,
    private readonly faces: FaceSheets = NO_FACES,
  ) {
    this.textStyle = new TextStyle({
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSize,
      lineHeight: theme.lineHeight,
      fill: theme.textColor,
    });
    this.speaker = new Text({
      text: '',
      style: this.textStyle.clone(),
    });
    this.speaker.style.fill = theme.speakerColor;
    this.speaker.style.fontWeight = 'bold';

    this.messageBox.addChild(this.messageFrame, this.face, this.speaker, this.body, this.more);
    this.choiceBox.addChild(this.choiceFrame, this.cursor);
    this.container.addChild(this.messageBox, this.choiceBox);
    this.messageBox.visible = false;
    this.choiceBox.visible = false;
  }

  /** Room for text in the message box, beside `faceSpace` pixels of face. */
  private innerWidth(faceSpace: number): number {
    return this.screenWidth - this.theme.margin * 2 - this.theme.padding * 2 - faceSpace;
  }

  private styleFor(color: number): TextStyle {
    let style = this.styles.get(color);
    if (!style) {
      // Text objects share the style they're given: each colour gets its own copy.
      style = this.textStyle.clone();
      style.fill = color;
      this.styles.set(color, style);
    }
    return style;
  }

  /**
   * Lay the message out once, up front, and reveal it piece by piece, so
   * words never jump to the next line halfway through the reveal.
   */
  private layOut(runs: readonly TextRun[], maxWidth: number): RichLayout {
    if (this.laidOut?.runs === runs && this.laidOut.maxWidth === maxWidth) {
      return this.laidOut.layout;
    }
    for (const child of this.body.removeChildren()) child.destroy();
    const { theme, icons } = this;
    const iconHeight = Math.min(icons.size, theme.lineHeight);
    const layout = layoutRuns(runs, {
      maxWidth,
      measure: (text) => CanvasTextMetrics.measureText(text, this.textStyle).width,
      iconWidth: icons.size > 0 ? iconHeight + 1 : 0,
    });
    const nodes: { piece: LinePiece; node: Text | Sprite }[] = [];
    layout.lines.forEach((line, row) => {
      const y = row * theme.lineHeight;
      for (const piece of line) {
        if (piece.kind === 'icon') {
          const sprite = iconSprite(icons, piece.icon, theme.lineHeight);
          if (!sprite) continue;
          sprite.position.set(piece.x, y + Math.floor((theme.lineHeight - iconHeight) / 2));
          nodes.push({ piece, node: sprite });
          this.body.addChild(sprite);
        } else {
          const text = new Text({ text: '', style: this.styleFor(textColor(theme, piece.color)) });
          text.position.set(piece.x, y);
          nodes.push({ piece, node: text });
          this.body.addChild(text);
        }
      }
    });
    this.laidOut = { runs, maxWidth, layout, nodes };
    return layout;
  }

  /** Show as much of the laid-out message as `revealed` units allow. */
  private reveal(revealed: number): void {
    for (const { piece, node } of this.laidOut?.nodes ?? []) {
      const shown = revealPiece(piece, revealed);
      node.visible = shown !== null;
      if (shown?.kind === 'text' && node instanceof Text && node.text !== shown.text) {
        node.text = shown.text;
      }
    }
  }

  /** `time` (seconds) drives small animations such as the continue marker. */
  render(dialog: DialogController, time: number): void {
    const { theme } = this;
    const message = dialog.message;
    let messageTop = this.screenHeight - theme.margin;

    this.messageBox.visible = message !== null;
    if (message) {
      // The face at its own size (crisp pixels), the text beside it; the box grows to fit it.
      const face = message.face ? this.faces.face(message.face) : null;
      const faceSpace = face ? face.width + theme.padding : 0;
      const layout = this.layOut(message.runs, this.innerWidth(faceSpace));
      const speakerLines = message.speaker ? 1 : 0;
      const lines = Math.max(
        theme.minLines,
        layout.lines.length + speakerLines,
        face ? Math.ceil(face.height / theme.lineHeight) : 0,
      );
      const w = this.screenWidth - theme.margin * 2;
      const h = lines * theme.lineHeight + theme.padding * 2;
      messageTop = this.screenHeight - theme.margin - h;
      this.messageBox.position.set(theme.margin, messageTop);
      drawWindow(this.messageFrame, theme, w, h);

      this.face.visible = face !== null;
      if (face) {
        if (this.face.texture !== face) this.face.texture = face;
        this.face.position.set(
          theme.padding,
          theme.padding + Math.floor((lines * theme.lineHeight - face.height) / 2),
        );
      }
      const left = theme.padding + faceSpace;
      this.speaker.visible = speakerLines > 0;
      this.speaker.text = message.speaker ?? '';
      this.speaker.position.set(left, theme.padding);
      this.body.position.set(left, theme.padding + speakerLines * theme.lineHeight);
      this.reveal(message.revealed);

      // Bobbing "more" marker once the text is fully shown and no choice is open.
      this.more.visible = message.complete && dialog.choice === null;
      if (this.more.visible) {
        const bob = Math.round(Math.sin(time * 6) * 1.5);
        this.more
          .clear()
          .poly([0, 0, 8, 0, 4, 5])
          .fill(theme.textColor)
          .position.set(w - theme.padding - 8, h - theme.padding - 4 + bob);
      }
    }

    const choice = dialog.choice;
    this.choiceBox.visible = choice !== null;
    if (choice) {
      const key = choice.options.join('\n');
      if (key !== this.choiceKey) {
        this.choiceKey = key;
        for (const t of this.options) t.destroy();
        this.options.length = 0;
        choice.options.forEach((label, i) => {
          const t = new Text({ text: label, style: this.textStyle });
          t.position.set(theme.padding + 12, theme.padding + i * theme.lineHeight);
          this.options.push(t);
          this.choiceBox.addChild(t);
        });
      }
      const textWidth = Math.max(...this.options.map((t) => t.width));
      const w = Math.ceil(textWidth) + theme.padding * 2 + 12;
      const h = choice.options.length * theme.lineHeight + theme.padding * 2;
      this.choiceBox.position.set(this.screenWidth - theme.margin - w, messageTop - 4 - h);
      drawWindow(this.choiceFrame, theme, w, h);
      this.cursor
        .clear()
        .roundRect(theme.padding - 2, 0, w - theme.padding * 2 + 4, theme.lineHeight, 3)
        .fill({ color: theme.borderColor, alpha: 0.22 })
        // Arrow in the gutter left of the option text, vertically centered.
        .poly(cursorArrow(theme.padding + 2, theme.lineHeight / 2))
        .fill(theme.speakerColor);
      this.cursor.position.set(0, theme.padding + choice.cursor * theme.lineHeight);
    }
  }
}

/** A small right-pointing triangle with its left edge at `x`, centered on `y`. */
function cursorArrow(x: number, y: number): number[] {
  return [x, y - 4, x + 5, y, x, y + 4];
}
