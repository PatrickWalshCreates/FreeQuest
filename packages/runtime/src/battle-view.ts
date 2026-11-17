import {
  enemyPlaces,
  type Actor,
  type Battle,
  type BattleEvent,
  type Battler,
  type Enemy,
  MAX_TP,
} from '@freequest/core';
import { Container, Graphics, Sprite, Text, TextStyle, type Texture } from 'pixi.js';
import type { BattleUiState } from './battle-controller.js';
import { DEFAULT_UI_THEME, type UiTheme, drawWindow } from './dialog-view.js';
import type { AnimationSheets } from './effect-views.js';
import { animationSeconds } from '@freequest/schema';
import { type IconSheet, NO_ICONS, iconSprite } from './icons.js';

const STATUS_ROW = 22;
const POPUP_SECONDS = 0.9;
const FADE_SECONDS = 0.4;

interface Popup {
  readonly text: Text;
  readonly startY: number;
  age: number;
}

interface EnemySprite {
  readonly enemy: Enemy;
  readonly display: Container;
  /** Seconds since knocked out (for the fade), or null while standing. */
  fadeAge: number | null;
  flash: number;
  /** The blow that knocks it out has been shown (the battle is worked out before it's shown). */
  felled: boolean;
}

/**
 * Draws a battle: backdrop, enemies, log line, party status, menus, target
 * cursor and damage numbers. Reads the controller's state; never changes
 * the battle.
 */
export class BattleView {
  readonly container = new Container({ label: 'battle' });
  private readonly enemyLayer = new Container({ label: 'enemies' });
  private readonly enemySprites: EnemySprite[] = [];
  private readonly logFrame = new Graphics();
  private readonly logText: Text;
  private readonly statusFrame = new Graphics();
  private readonly statusLayer = new Container();
  private readonly menuFrame = new Graphics();
  private readonly menuLayer = new Container();
  private readonly cursor = new Graphics();
  private readonly popupLayer = new Container();
  private readonly popups: Popup[] = [];
  /** The animation playing on a battler (one at a time: the current log line's). */
  private readonly animationSprite = new Sprite();
  /** A hit whose damage number shows once its animation has played. */
  private pendingHit: Extract<BattleEvent, { type: 'hit' }> | null = null;
  private readonly style: TextStyle;
  private readonly small: TextStyle;
  private lastEvent: BattleEvent | null = null;
  /** Content keys of the last drawn panels: Text objects are rebuilt only on change. */
  private statusKey = '';
  private menuKey = '';
  private lastTime: number | null = null;

  constructor(
    private readonly battle: Battle,
    private readonly width: number,
    private readonly height: number,
    enemyTextures: ReadonlyMap<string, Texture>,
    private readonly theme: UiTheme = DEFAULT_UI_THEME,
    private readonly icons: IconSheet = NO_ICONS,
    private readonly sheets: AnimationSheets | null = null,
    /** The picture behind the battle (scaled to cover the screen); null: the plain backdrop. */
    background: Texture | null = null,
  ) {
    this.style = new TextStyle({
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSize,
      fill: theme.textColor,
    });
    this.small = new TextStyle({
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSize - 2,
      fill: theme.textColor,
    });
    this.logText = new Text({ text: '', style: this.style });

    this.container.addChild(this.backdrop(background), this.enemyLayer);
    this.layoutEnemies(enemyTextures);
    this.container.addChild(this.logFrame, this.logText, this.statusFrame, this.statusLayer);
    this.container.addChild(this.menuFrame, this.menuLayer, this.cursor);
    this.container.addChild(this.animationSprite, this.popupLayer);
    this.animationSprite.anchor.set(0.5);
    this.animationSprite.visible = false;
  }

  private backdrop(picture: Texture | null): Container {
    if (picture) {
      const sprite = new Sprite(picture);
      sprite.anchor.set(0.5);
      sprite.scale.set(Math.max(this.width / picture.width, this.height / picture.height));
      sprite.position.set(this.width / 2, this.height / 2);
      return sprite;
    }
    const g = new Graphics();
    const horizon = Math.round(this.height * 0.55);
    const bands: [number, number][] = [
      [0x1b2440, 0],
      [0x26345c, horizon * 0.35],
      [0x34497a, horizon * 0.7],
    ];
    for (const [color, y] of bands) g.rect(0, y, this.width, horizon - y).fill(color);
    g.rect(0, horizon, this.width, this.height - horizon).fill(0x2f5a2c);
    g.rect(0, horizon, this.width, 3).fill(0x4f8a46);
    return g;
  }

  private layoutEnemies(textures: ReadonlyMap<string, Texture>): void {
    const places = enemyPlaces(
      this.battle.enemies.length,
      this.width,
      this.height,
      this.battle.places,
    );
    this.battle.enemies.forEach((enemy, i) => {
      const display = new Container();
      const texture = textures.get(enemy.id);
      if (texture) {
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5, 1);
        display.addChild(sprite);
      } else {
        display.addChild(placeholderEnemy());
      }
      const place = places[i] ?? { x: this.width / 2, y: Math.round(this.height * 0.6) };
      display.position.set(place.x, place.y);
      this.enemyLayer.addChild(display);
      this.enemySprites.push({ enemy, display, fadeAge: null, flash: 0, felled: false });
    });
  }

  /** `time` is total elapsed seconds; animations advance by the difference. */
  render(state: BattleUiState, time: number): void {
    const dt = this.lastTime === null ? 0 : Math.max(0, time - this.lastTime);
    this.lastTime = time;
    if (state.event !== this.lastEvent) {
      this.lastEvent = state.event;
      // With an animation, the damage number (and a knockout's fade) waits until it has played.
      if (this.pendingHit) this.onHit(this.pendingHit);
      this.pendingHit = null;
      if (state.event?.type === 'hit') {
        if (state.animation) this.pendingHit = state.event;
        else this.onHit(state.event);
      }
      // Poison and the like can knock out at the end of a turn.
      const event = state.event;
      if (event?.type === 'regen') this.fell(event.battler);
    }
    const playing = state.animation;
    if (this.pendingHit && (!playing || playing.elapsed >= animationSeconds(playing.entry))) {
      this.onHit(this.pendingHit);
      this.pendingHit = null;
    }
    // Once the turn's lines are over, anything knocked out falls.
    if (state.stage !== 'playback') for (const s of this.enemySprites) s.felled = true;
    this.renderEnemies(dt);
    this.renderLog(state.line);
    this.renderStatus(state);
    this.renderMenu(state);
    this.renderCursor(state);
    this.renderAnimation(state);
    this.renderPopups(dt);
  }

  private renderAnimation(state: BattleUiState): void {
    const playing = state.animation;
    // Gone after its last frame (the line may stay up longer).
    const over = playing && playing.elapsed >= animationSeconds(playing.entry);
    const texture = playing && !over && this.sheets?.animation(playing.entry, playing.elapsed);
    const at = playing && this.positionOf(playing.target);
    this.animationSprite.visible = Boolean(texture && at);
    if (!texture || !at || !playing) return;
    this.animationSprite.texture = texture;
    // Over an enemy's middle, or over an actor's status row.
    const isEnemy = this.enemySprites.some((s) => s.enemy === playing.target);
    this.animationSprite.position.set(at.x, isEnemy ? at.y : at.y - STATUS_ROW / 2);
  }

  private renderEnemies(dt: number): void {
    for (const s of this.enemySprites) {
      // It falls once the blow that knocked it out has been shown.
      if (s.enemy.isKnockedOut && s.fadeAge === null && s.felled) s.fadeAge = 0;
      if (!s.enemy.isKnockedOut) {
        s.fadeAge = null;
        s.felled = false;
      }
      if (s.fadeAge !== null) s.fadeAge += dt;
      s.flash = Math.max(0, s.flash - dt);
      const fade = s.fadeAge === null ? 1 : Math.max(0, 1 - s.fadeAge / FADE_SECONDS);
      // Blink while recently hit.
      const blink = s.flash > 0 && Math.floor(s.flash * 20) % 2 === 0 ? 0.3 : 1;
      s.display.alpha = fade * blink;
    }
  }

  private renderLog(line: string | null): void {
    const { theme } = this;
    this.logFrame.visible = this.logText.visible = line !== null;
    if (line === null) return;
    const h = theme.lineHeight + theme.padding * 2;
    drawWindow(this.logFrame, theme, this.width - theme.margin * 2, h);
    this.logFrame.position.set(theme.margin, theme.margin);
    if (this.logText.text !== line) this.logText.text = line;
    this.logText.position.set(theme.margin + theme.padding, theme.margin + theme.padding);
  }

  private statusTop(): number {
    const { theme } = this;
    return this.height - theme.margin - this.battle.actors.length * STATUS_ROW - theme.padding * 2;
  }

  private renderStatus(state: BattleUiState): void {
    const { theme } = this;
    const x = Math.round(this.width * 0.4);
    const w = this.width - x - theme.margin;
    const top = this.statusTop();
    const key = JSON.stringify(
      this.battle.actors.map((a) => [
        a.hp,
        a.mp,
        a.maxHp,
        a.maxMp,
        a.tp,
        a.states.map((s) => s.id),
        a === state.actor || a === state.target,
      ]),
    );
    if (key === this.statusKey) return;
    this.statusKey = key;
    drawWindow(this.statusFrame, theme, w, this.height - theme.margin - top);
    this.statusFrame.position.set(x, top);
    this.statusLayer.removeChildren().forEach((c) => c.destroy());
    this.battle.actors.forEach((actor, i) => {
      const y = top + theme.padding + i * STATUS_ROW;
      const row = new Container();
      row.position.set(x + theme.padding, y);
      const highlighted = actor === state.actor || actor === state.target;
      if (highlighted) {
        row.addChild(
          new Graphics()
            .roundRect(-4, -1, w - theme.padding * 2 + 8, STATUS_ROW - 2, 3)
            .fill({ color: theme.borderColor, alpha: 0.2 }),
        );
      }
      const name = new Text({ text: actor.name, style: this.style });
      name.alpha = actor.isKnockedOut ? 0.45 : 1;
      row.addChild(name);
      // HP and MP, and TP when the game uses it.
      const bars = this.battle.usesTp ? 3 : 2;
      const barW = Math.floor((w - theme.padding * 2 - 70) / bars) - 6;
      row.addChild(this.bar(70, 3, barW, actor.hp, actor.maxHp, 0x6fd06a, `${actor.hp}`));
      row.addChild(
        this.bar(70 + barW + 12, 3, barW, actor.mp, actor.maxMp, 0x6aa8f0, `${actor.mp}`),
      );
      if (bars === 3) {
        row.addChild(
          this.bar(70 + (barW + 12) * 2, 3, barW, actor.tp, MAX_TP, 0xf0c060, `${actor.tp}`),
        );
      }
      row.addChild(this.stateMarks(actor, w - theme.padding * 2));
      this.statusLayer.addChild(row);
    });
  }

  private bar(
    x: number,
    y: number,
    w: number,
    value: number,
    max: number,
    color: number,
    label: string,
  ): Container {
    const c = new Container();
    c.position.set(x, y);
    const fill = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    c.addChild(
      new Graphics()
        .rect(0, 11, w, 4)
        .fill(0x0a0d18)
        .rect(0, 11, Math.round(w * fill), 4)
        .fill(color),
    );
    const text = new Text({ text: label, style: this.small });
    text.position.set(w - text.width, -2);
    c.addChild(text);
    return c;
  }

  private stateMarks(actor: Actor, width: number): Container {
    const c = new Container();
    const names = actor.states
      .map((s) => this.battle.stateName(s.id))
      .filter((n): n is string => n !== null);
    if (names.length === 0) return c;
    // Clone: Text objects share the style they are given, so mutating it would recolor others.
    const style = this.small.clone();
    style.fill = this.theme.speakerColor;
    const text = new Text({ text: names.join(' '), style });
    text.position.set(width - text.width, STATUS_ROW - 10);
    c.addChild(text);
    return c;
  }

  private renderMenu(state: BattleUiState): void {
    const { theme } = this;
    const key = JSON.stringify([state.stage, state.menu]);
    if (key === this.menuKey) return;
    this.menuKey = key;
    this.menuLayer.removeChildren().forEach((c) => c.destroy());
    this.menuFrame.visible = state.menu !== null;
    const menu = state.menu;
    if (!menu) return;
    const isList = state.stage === 'skill' || state.stage === 'item';
    const rows = Math.max(1, menu.options.length);
    const w = isList
      ? Math.round(this.width * 0.55)
      : Math.round(this.width * 0.4) - theme.margin - 6;
    const h = (rows + 1) * theme.lineHeight + theme.padding * 2;
    const x = isList ? Math.round((this.width - w) / 2) : theme.margin;
    const y = isList ? Math.round(this.height * 0.2) : this.height - theme.margin - h;
    drawWindow(this.menuFrame, theme, w, h);
    this.menuFrame.position.set(x, y);

    const titleStyle = this.style.clone();
    titleStyle.fill = theme.speakerColor;
    const title = new Text({ text: menu.title, style: titleStyle });
    title.position.set(x + theme.padding, y + theme.padding);
    this.menuLayer.addChild(title);
    if (menu.options.length === 0) {
      const none = new Text({ text: '(none)', style: this.style });
      none.alpha = 0.5;
      none.position.set(x + theme.padding + 12, y + theme.padding + theme.lineHeight);
      this.menuLayer.addChild(none);
    }
    const iconWidth = menu.options.some((o) => o.icon !== undefined && this.icons.texture(o.icon))
      ? Math.min(this.icons.size, theme.lineHeight) + 4
      : 0;
    menu.options.forEach((option, i) => {
      const rowY = y + theme.padding + (i + 1) * theme.lineHeight;
      if (i === menu.cursor) {
        this.menuLayer.addChild(
          new Graphics()
            .roundRect(x + theme.padding - 2, rowY, w - theme.padding * 2 + 4, theme.lineHeight, 3)
            .fill({ color: theme.borderColor, alpha: 0.22 })
            .poly([
              x + theme.padding + 2,
              rowY + 5,
              x + theme.padding + 7,
              rowY + 9,
              x + theme.padding + 2,
              rowY + 13,
            ])
            .fill(theme.speakerColor),
        );
      }
      const label = new Text({ text: option.label, style: this.style });
      label.alpha = option.enabled ? 1 : 0.4;
      label.position.set(x + theme.padding + 12 + iconWidth, rowY);
      const icon =
        option.icon === undefined ? null : iconSprite(this.icons, option.icon, theme.lineHeight);
      if (icon) {
        icon.alpha = label.alpha;
        icon.position.set(
          x + theme.padding + 12,
          rowY + Math.floor((theme.lineHeight - icon.height) / 2),
        );
        this.menuLayer.addChild(icon);
      }
      this.menuLayer.addChild(label);
      if (option.detail) {
        const detail = new Text({ text: option.detail, style: this.small });
        detail.alpha = label.alpha;
        detail.position.set(x + w - theme.padding - detail.width, rowY + 1);
        this.menuLayer.addChild(detail);
      }
    });
  }

  private renderCursor(state: BattleUiState): void {
    const target = state.target;
    const sprite = target && this.enemySprites.find((s) => s.enemy === target);
    this.cursor.visible = Boolean(sprite);
    if (!sprite) return;
    const bounds = sprite.display.getLocalBounds();
    const bob = Math.round(Math.sin((this.lastTime ?? 0) * 8) * 2);
    const x = sprite.display.x;
    const y = sprite.display.y + bounds.minY - 10 + bob;
    this.cursor
      .clear()
      .poly([x - 6, y - 8, x + 6, y - 8, x, y])
      .fill(this.theme.speakerColor);
  }

  /** A blow to this battler has been shown: if it's knocked out, it can fall now. */
  private fell(battler: Battler): void {
    const sprite = this.enemySprites.find((s) => s.enemy === battler);
    if (sprite) sprite.felled = true;
  }

  private onHit(event: Extract<BattleEvent, { type: 'hit' }>): void {
    const { result } = event;
    // Only the hit that knocked it out lets it fall (it may be hit more than once a turn).
    if (result.addedStates.some((id) => result.target.stateEntry(id).knockout)) {
      this.fell(result.target);
    }
    const position = this.positionOf(result.target);
    if (!position) return;
    const sprite = this.enemySprites.find((s) => s.enemy === result.target);
    if (sprite && result.hpDamage > 0) sprite.flash = 0.35;
    let text: string;
    let color: number;
    if (result.missed) {
      text = 'Miss';
      color = 0xdddddd;
    } else if (result.hpDamage !== 0) {
      text = String(Math.abs(result.hpDamage));
      color = result.hpDamage > 0 ? (result.critical ? 0xffd479 : 0xff7a6a) : 0x7ae07a;
    } else if (result.mpDamage !== 0) {
      text = `${Math.abs(result.mpDamage)} MP`;
      color = result.mpDamage > 0 ? 0xc79bff : 0x7ab8ff;
    } else {
      return;
    }
    const popup = new Text({
      text,
      style: new TextStyle({
        fontFamily: this.theme.fontFamily,
        fontSize: this.theme.fontSize + (result.critical ? 6 : 3),
        fontWeight: 'bold',
        fill: color,
        stroke: { color: 0x000000, width: 3 },
      }),
    });
    popup.anchor.set(0.5, 1);
    popup.position.set(position.x, position.y);
    this.popupLayer.addChild(popup);
    this.popups.push({ text: popup, startY: position.y, age: 0 });
  }

  /** Where damage numbers for a battler appear. */
  private positionOf(battler: Battler): { x: number; y: number } | null {
    const sprite = this.enemySprites.find((s) => s.enemy === battler);
    if (sprite) {
      const bounds = sprite.display.getLocalBounds();
      return { x: sprite.display.x, y: sprite.display.y + bounds.minY / 2 };
    }
    const index = this.battle.actors.indexOf(battler as Actor);
    if (index === -1) return null;
    // Numbers are anchored at their bottom edge: put that at the bottom of the
    // actor's status row, over the HP bar.
    const x = Math.round(this.width * 0.4) + this.theme.padding + 110;
    return { x, y: this.statusTop() + this.theme.padding + (index + 1) * STATUS_ROW - 2 };
  }

  private renderPopups(dt: number): void {
    for (const p of [...this.popups]) {
      p.age += dt;
      const t = p.age / POPUP_SECONDS;
      p.text.y = p.startY - Math.min(1, t * 3) * 14;
      p.text.alpha = t < 0.7 ? 1 : Math.max(0, 1 - (t - 0.7) / 0.3);
      if (t >= 1) {
        p.text.destroy();
        this.popups.splice(this.popups.indexOf(p), 1);
      }
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/** Stand-in art for enemies without an image: an original blob with eyes. */
function placeholderEnemy(): Graphics {
  return new Graphics()
    .ellipse(0, -18, 22, 18)
    .fill(0x8a5ab8)
    .ellipse(-7, -22, 4, 5)
    .fill(0xffffff)
    .ellipse(7, -22, 4, 5)
    .fill(0xffffff)
    .circle(-7, -21, 2)
    .fill(0x1a1a1a)
    .circle(7, -21, 2)
    .fill(0x1a1a1a);
}
