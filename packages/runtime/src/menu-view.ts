import type { Actor, World } from '@freequest/core';
import { STAT_KEYS } from '@freequest/schema';
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { type UiTheme, drawWindow } from './dialog-view.js';
import { ListWindow } from './list-window.js';
import type { MenuUiState } from './menu-controller.js';

const STAT_LABELS: Record<(typeof STAT_KEYS)[number], string> = {
  maxHp: 'Max HP',
  maxMp: 'Max MP',
  attack: 'Attack',
  defense: 'Defense',
  magicAttack: 'M.Attack',
  magicDefense: 'M.Defense',
  agility: 'Agility',
  luck: 'Luck',
};

/** Draws the main menu over the map: list window, party/gold panel, status page, message. */
export class MenuView {
  readonly container = new Container({ label: 'menu' });
  private readonly dim: Graphics;
  private readonly list: ListWindow;
  private readonly sideFrame = new Graphics();
  private readonly side = new Container();
  private readonly messageFrame = new Graphics();
  private readonly messageText: Text;
  private readonly style: TextStyle;
  private readonly small: TextStyle;
  private readonly accent: TextStyle;
  private sideKey = '';

  constructor(
    private readonly world: () => World,
    private readonly width: number,
    private readonly height: number,
    private readonly theme: UiTheme,
  ) {
    this.dim = new Graphics().rect(0, 0, width, height).fill({ color: 0x000000, alpha: 0.45 });
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
    });
    this.accent = this.style.clone();
    this.accent.fill = theme.speakerColor;
    this.messageText = new Text({ text: '', style: this.style });
    this.container.addChild(
      this.dim,
      this.list.container,
      this.sideFrame,
      this.side,
      this.messageFrame,
      this.messageText,
    );
  }

  private get listWidth(): number {
    return Math.round(this.width * 0.42);
  }

  render(state: MenuUiState): void {
    const { theme } = this;
    const m = theme.margin;
    this.list.render(state.title, state.options, state.cursor, {
      x: m,
      y: m,
      width: this.listWidth,
      visibleRows: 12,
      emptyText: state.screen === 'status' ? null : '(none)',
    });
    this.renderSide(state);
    this.messageFrame.visible = this.messageText.visible = state.message !== null;
    if (state.message !== null) {
      const h = theme.lineHeight + theme.padding * 2;
      drawWindow(this.messageFrame, theme, this.width - m * 2, h);
      this.messageFrame.position.set(m, this.height - m - h);
      if (this.messageText.text !== state.message) this.messageText.text = state.message;
      this.messageText.position.set(m + theme.padding, this.height - m - h + theme.padding);
    }
  }

  /** Right side: a member's status page, or the party overview with gold. */
  private renderSide(state: MenuUiState): void {
    const world = this.world();
    const party = world.party;
    const actor = state.screen === 'status' ? state.actor : null;
    const key = JSON.stringify([
      state.screen,
      actor?.id,
      party.gold,
      party.members.map((a) => [
        a.id,
        a.level,
        a.hp,
        a.mp,
        a.exp,
        a.states.map((s) => s.id),
        [...a.equipment],
      ]),
    ]);
    if (key === this.sideKey) return;
    this.sideKey = key;

    const { theme } = this;
    const x = theme.margin * 2 + this.listWidth;
    const w = this.width - x - theme.margin;
    const h = this.height - theme.margin * 2 - (theme.lineHeight + theme.padding * 2) - 4;
    drawWindow(this.sideFrame, theme, w, h);
    this.sideFrame.position.set(x, theme.margin);
    this.side.removeChildren().forEach((c) => c.destroy());
    this.side.position.set(x + theme.padding, theme.margin + theme.padding);

    if (actor) {
      this.statusPage(actor, w - theme.padding * 2);
      return;
    }
    let y = 0;
    for (const member of party.members) {
      this.text(member.name, 0, y, this.accent);
      this.text(`Lv ${member.level}`, w - theme.padding * 2 - 40, y, this.small);
      y += theme.lineHeight;
      this.text(
        `HP ${member.hp}/${member.maxHp}   MP ${member.mp}/${member.maxMp}`,
        8,
        y,
        this.small,
      );
      y += theme.lineHeight;
      const states = member.states.map((s) => world.db.states.find(s.id)?.name ?? s.id).join(', ');
      if (states) {
        this.text(states, 8, y, this.small);
        y += theme.lineHeight;
      }
      y += 6;
    }
    this.text(
      `${party.gold} ${world.db.system.currency}`,
      0,
      h - theme.padding * 2 - theme.lineHeight,
      this.accent,
    );
  }

  private statusPage(actor: Actor, width: number): void {
    const db = this.world().db;
    const line = this.theme.lineHeight;
    let y = 0;
    this.text(
      `${actor.name}  ·  ${actor.classEntry.name}  ·  Lv ${actor.level}`,
      0,
      y,
      this.accent,
    );
    y += line;
    const next = actor.nextLevelExp;
    this.text(
      `EXP ${actor.exp}${next === null ? '  (max level)' : `  ·  ${next - actor.exp} to next level`}`,
      0,
      y,
      this.small,
    );
    y += line;
    this.text(`HP ${actor.hp}/${actor.maxHp}   MP ${actor.mp}/${actor.maxMp}`, 0, y, this.small);
    y += line + 4;
    const half = Math.floor(width / 2);
    STAT_KEYS.slice(2).forEach((stat, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      this.text(STAT_LABELS[stat], col * half, y + row * line, this.small);
      const value = new Text({ text: String(actor.stat(stat)), style: this.small });
      value.position.set(col * half + half - 12 - value.width, y + row * line);
      this.side.addChild(value);
    });
    y += Math.ceil((STAT_KEYS.length - 2) / 2) * line + 6;
    for (const slot of db.system.equipmentSlots) {
      const worn = actor.equipment.get(slot.id);
      this.text(`${slot.name}: ${worn ? db.equipment.get(worn).name : '—'}`, 0, y, this.small);
      y += line;
    }
    const states = actor.states.map((s) => db.states.find(s.id)?.name ?? s.id).join(', ');
    if (states) this.text(`States: ${states}`, 0, y + 4, this.small);
  }

  private text(text: string, x: number, y: number, style: TextStyle): void {
    const t = new Text({ text, style });
    t.position.set(x, y);
    this.side.addChild(t);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
