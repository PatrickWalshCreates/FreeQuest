// The main menu on the map: items, skills, equipment, status, save, quit.
// Free of PixiJS so it can be tested in Node; `menu-view.ts` draws the state.
import {
  type Actor,
  type InputState,
  type TargetResult,
  type World,
  canTarget,
  itemProblem,
  skillProblem,
  useItem,
  useSkill,
} from '@freequest/core';
import type { ItemEntry, SkillEntry, TargetScope } from '@freequest/schema';
import { describeEvent } from './battle-text.js';
import type { MenuOption } from './battle-controller.js';
import type { SaveStore, SlotInfo } from './save-store.js';

export type MenuScreen =
  | 'root'
  | 'items'
  | 'skillUser'
  | 'skills'
  | 'equipActor'
  | 'equipSlots'
  | 'equipChoices'
  | 'statusActor'
  | 'status'
  | 'target'
  | 'save'
  | 'quit';

/** Everything the view needs to draw one frame. */
export interface MenuUiState {
  readonly screen: MenuScreen;
  readonly title: string;
  readonly options: readonly MenuOption[];
  readonly cursor: number;
  /** The member the current screen is about (skills, equipment, status). */
  readonly actor: Actor | null;
  /** Feedback such as "Hero recovers 100 HP." Cleared by the next key press. */
  readonly message: string | null;
}

/** How the menu ended: closed back to the map, or quit to the title screen. */
export type MenuOutcome = 'closed' | 'quit';

interface Screen {
  readonly kind: MenuScreen;
  cursor: number;
  readonly actor?: Actor;
  readonly slot?: string;
  /** For target screens: what is being used. */
  readonly use?:
    { kind: 'item'; entry: ItemEntry } | { kind: 'skill'; entry: SkillEntry; user: Actor };
}

export interface MenuControllerOptions {
  readonly world: World;
  readonly saves: SaveStore;
  readonly game: string;
  /** Total play time so far, for save files. */
  readonly playSeconds: () => number;
  readonly random?: () => number;
}

const ROOT = ['Items', 'Skills', 'Equipment', 'Status', 'Save', 'Quit'] as const;

const usableInMenu = (o: SkillEntry['occasion']) => o === 'always' || o === 'menu';

export class MenuController {
  private readonly stack: Screen[] = [{ kind: 'root', cursor: 0 }];
  private feedback: string | null = null;
  private result: MenuOutcome | null = null;
  private readonly world: World;
  private readonly random: () => number;

  constructor(private readonly options: MenuControllerOptions) {
    this.world = options.world;
    this.random = options.random ?? Math.random;
  }

  /** Set once the menu is done; the game then closes it (or goes to the title). */
  get outcome(): MenuOutcome | null {
    return this.result;
  }

  private get top(): Screen {
    return this.stack[this.stack.length - 1] ?? { kind: 'root', cursor: 0 };
  }

  get state(): MenuUiState {
    const top = this.top;
    return {
      screen: top.kind,
      title: this.title(top),
      options: this.optionsFor(top),
      cursor: top.cursor,
      actor: top.actor ?? (top.use?.kind === 'skill' ? top.use.user : null),
      message: this.feedback,
    };
  }

  // Building screens --------------------------------------------------------

  private get party() {
    return this.world.party;
  }

  private get db() {
    return this.world.db;
  }

  private title(screen: Screen): string {
    switch (screen.kind) {
      case 'root':
        return 'Menu';
      case 'items':
        return 'Items';
      case 'skillUser':
      case 'equipActor':
      case 'statusActor':
        return 'Who?';
      case 'skills':
        return `${screen.actor?.name ?? ''}'s skills`;
      case 'equipSlots':
        return `${screen.actor?.name ?? ''}'s equipment`;
      case 'equipChoices':
        return this.db.system.equipmentSlots.find((s) => s.id === screen.slot)?.name ?? 'Equip';
      case 'status':
        return screen.actor?.name ?? '';
      case 'target':
        return `Use ${screen.use?.entry.name ?? ''} on`;
      case 'save':
        return 'Save to which slot?';
      case 'quit':
        return 'Quit to the title screen?';
    }
  }

  private carriedItems(): { entry: ItemEntry; count: number }[] {
    return this.party
      .list('item')
      .map(({ id, count }) => ({ entry: this.db.items.get(id), count }));
  }

  private menuSkills(actor: Actor): SkillEntry[] {
    return actor.skills.map((id) => this.db.skills.get(id)).filter((s) => usableInMenu(s.occasion));
  }

  /** Member rows show just the level: the party panel beside the list shows HP/MP. */
  private memberOption(actor: Actor, enabled = true): MenuOption {
    return { label: actor.name, detail: `Lv ${actor.level}`, enabled };
  }

  private optionsFor(screen: Screen): MenuOption[] {
    switch (screen.kind) {
      case 'root':
        return ROOT.map((label) => ({
          label,
          enabled:
            label !== 'Skills' || this.party.members.some((m) => this.menuSkills(m).length > 0),
        }));
      case 'items':
        return this.carriedItems().map(({ entry, count }) => ({
          label: entry.name,
          detail: `×${count}`,
          enabled:
            itemProblem(this.party, entry, 'menu') === null && this.scopeHasTargets(entry.target),
        }));
      case 'skillUser':
        return this.party.members.map((m) => this.memberOption(m, this.menuSkills(m).length > 0));
      case 'equipActor':
      case 'statusActor':
        return this.party.members.map((m) => this.memberOption(m));
      case 'skills': {
        const actor = screen.actor;
        if (!actor) return [];
        return this.menuSkills(actor).map((s) => ({
          label: s.name,
          detail: s.mpCost > 0 ? `${s.mpCost} MP` : '',
          enabled: skillProblem(actor, s, 'menu') === null && this.scopeHasTargets(s.target),
        }));
      }
      case 'equipSlots': {
        const actor = screen.actor;
        if (!actor) return [];
        return this.db.system.equipmentSlots.map((slot) => {
          const worn = actor.equipment.get(slot.id);
          return {
            label: slot.name,
            detail: worn ? this.db.equipment.get(worn).name : '—',
            enabled: true,
          };
        });
      }
      case 'equipChoices':
        return [
          ...this.equipChoices(screen).map((id) => ({
            label: this.db.equipment.get(id).name,
            detail: `×${this.party.count('equipment', id)}`,
            enabled: true,
          })),
          { label: '(Remove)', enabled: screen.actor?.equipment.has(screen.slot ?? '') ?? false },
        ];
      case 'target': {
        const use = screen.use;
        if (!use) return [];
        return this.party.members.map((m) => this.memberOption(m, canTarget(use.entry.target, m)));
      }
      case 'save':
        return this.options.saves.list().map((info) => slotOption(info));
      case 'quit':
        return [
          { label: 'Yes', enabled: true },
          { label: 'No', enabled: true },
        ];
      case 'status':
        return [];
    }
  }

  private equipChoices(screen: Screen): string[] {
    return screen.actor && screen.slot
      ? this.party.equippableFor(screen.actor.id, screen.slot)
      : [];
  }

  /** Whether a scope could do anything from the menu (ally scopes with a valid member, or the user). */
  private scopeHasTargets(scope: TargetScope): boolean {
    if (scope.side === 'user') return true;
    if (scope.side !== 'ally') return false;
    return this.party.members.some((m) => canTarget(scope, m));
  }

  // Input -------------------------------------------------------------------

  /** Call once per fixed logic step while the menu is open. */
  update(input: InputState): void {
    if (this.result) return;
    const pressed = (['confirm', 'cancel', 'menu', 'up', 'down'] as const).some((a) =>
      input.justPressed(a),
    );
    if (pressed) this.feedback = null;

    const top = this.top;
    const options = this.optionsFor(top);
    const count = options.length;
    if (count > 0 && input.justPressed('down')) top.cursor = (top.cursor + 1) % count;
    if (count > 0 && input.justPressed('up')) top.cursor = (top.cursor - 1 + count) % count;
    if (input.justPressed('cancel') || (input.justPressed('menu') && top.kind === 'root')) {
      this.back();
      return;
    }
    if (!input.justPressed('confirm')) return;
    const option = options[top.cursor];
    if (top.kind !== 'status' && !option?.enabled) return;
    this.select(top, top.cursor);
  }

  private push(screen: Omit<Screen, 'cursor'>): void {
    this.stack.push({ ...screen, cursor: 0 });
  }

  private back(): void {
    if (this.stack.length <= 1) {
      this.result = 'closed';
      return;
    }
    this.stack.pop();
  }

  private select(screen: Screen, index: number): void {
    const members = this.party.members;
    switch (screen.kind) {
      case 'root': {
        const command = ROOT[index];
        if (command === 'Items') this.push({ kind: 'items' });
        else if (command === 'Skills') this.push({ kind: 'skillUser' });
        else if (command === 'Equipment') this.push({ kind: 'equipActor' });
        else if (command === 'Status') this.push({ kind: 'statusActor' });
        else if (command === 'Save') this.push({ kind: 'save' });
        else if (command === 'Quit') this.push({ kind: 'quit' });
        return;
      }
      case 'items': {
        const item = this.carriedItems()[index];
        if (item) this.beginUse({ kind: 'item', entry: item.entry });
        return;
      }
      case 'skillUser': {
        const actor = members[index];
        if (actor) this.push({ kind: 'skills', actor });
        return;
      }
      case 'skills': {
        const actor = screen.actor;
        const skill = actor && this.menuSkills(actor)[index];
        if (actor && skill) this.beginUse({ kind: 'skill', entry: skill, user: actor });
        return;
      }
      case 'target': {
        const target = members[index];
        if (screen.use && target) this.applyUse(screen.use, [target]);
        return;
      }
      case 'equipActor': {
        const actor = members[index];
        if (actor) this.push({ kind: 'equipSlots', actor });
        return;
      }
      case 'equipSlots': {
        const slot = this.db.system.equipmentSlots[index];
        if (screen.actor && slot)
          this.push({ kind: 'equipChoices', actor: screen.actor, slot: slot.id });
        return;
      }
      case 'equipChoices': {
        const { actor, slot } = screen;
        if (!actor || !slot) return;
        const choice = this.equipChoices(screen)[index] ?? null; // past the end: (Remove)
        this.party.equip(actor.id, slot, choice);
        this.stack.pop();
        return;
      }
      case 'statusActor': {
        const actor = members[index];
        if (actor) this.push({ kind: 'status', actor });
        return;
      }
      case 'status':
        return;
      case 'save':
        return this.saveTo(index + 1);
      case 'quit':
        if (index === 0) this.result = 'quit';
        else this.stack.pop();
        return;
    }
  }

  /** Single-ally scopes pick a target; others apply right away. */
  private beginUse(use: NonNullable<Screen['use']>): void {
    const scope = use.entry.target;
    if (scope.side === 'ally' && scope.select === 'one') {
      this.push({ kind: 'target', use });
      return;
    }
    const user = use.kind === 'skill' ? use.user : this.party.members[0];
    if (!user) return;
    const targets =
      scope.side === 'user' ? [user] : this.party.members.filter((m) => canTarget(scope, m));
    this.applyUse(use, targets);
  }

  private applyUse(use: NonNullable<Screen['use']>, targets: Actor[]): void {
    const ctx = { state: this.world.state, random: this.random };
    const leader = this.party.members[0];
    let results: TargetResult[];
    try {
      results =
        use.kind === 'skill'
          ? useSkill(use.user, use.entry, targets, 'menu', ctx)
          : leader
            ? useItem(this.party, leader, use.entry, targets, 'menu', ctx)
            : [];
    } catch (error) {
      this.feedback = error instanceof Error ? error.message : String(error);
      return;
    }
    const user = use.kind === 'skill' ? use.user : leader;
    const lines = user
      ? results.flatMap((result) => describeEvent({ type: 'hit', user, result }, this.db))
      : [];
    this.feedback = lines.join(' ') || 'Nothing happened.';
    // Leave the target list once the item runs out or the skill can't be paid for again.
    const exhausted =
      use.kind === 'item'
        ? this.party.count('item', use.entry.id) === 0
        : skillProblem(use.user, use.entry, 'menu') !== null;
    if (this.top.kind === 'target' && exhausted) this.stack.pop();
  }

  private saveTo(slot: number): void {
    try {
      const save = this.world.toSave({
        game: this.options.game,
        playSeconds: this.options.playSeconds(),
      });
      this.options.saves.write(slot, save);
      this.feedback = `Saved to slot ${slot}.`;
    } catch (error) {
      this.feedback = `Couldn't save: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

/** "Meadow · Hero Lv 3, Mira Lv 4 · 0:12:34" style label for a save slot. */
export function slotOption(info: SlotInfo): MenuOption {
  if (info.kind === 'empty') return { label: `Slot ${info.slot}`, detail: 'Empty', enabled: true };
  if (info.kind === 'broken')
    return { label: `Slot ${info.slot}`, detail: 'Unreadable', enabled: true };
  const { summary, playSeconds } = info.save;
  const members = summary.members.map((m) => `${m.name} Lv ${m.level}`).join(', ');
  return {
    label: `Slot ${info.slot}: ${summary.location}`,
    detail: `${members}  ${formatPlayTime(playSeconds)}`,
    enabled: true,
  };
}

export function formatPlayTime(seconds: number): string {
  const s = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}
