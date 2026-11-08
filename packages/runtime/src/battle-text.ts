// Battle log text. Free of DOM and PixiJS so it can be tested in Node.
import type { BattleEvent, Battler, DatabaseIndex } from '@freequest/core';
import { Actor } from '@freequest/core';

const stateName = (db: DatabaseIndex, id: string) => db.states.find(id)?.name ?? id;

/** The lines of battle log an event produces (none for bookkeeping events). */
export function describeEvent(event: BattleEvent, db: DatabaseIndex): string[] {
  switch (event.type) {
    case 'turnStart':
      return [];
    case 'action':
      return [
        db.system.attackSkill !== undefined &&
        event.name === db.skills.find(db.system.attackSkill)?.name
          ? `${event.user.name} attacks!`
          : `${event.user.name} uses ${event.name}!`,
      ];
    case 'actionFailed':
      return [`${event.user.name} tries ${event.name}, but ${event.reason}.`];
    case 'cannotAct':
      return [`${event.user.name} can't move (${stateName(db, event.state)}).`];
    case 'confused':
      return [`${event.user.name} is confused!`];
    case 'hit':
      return describeHit(event.result, db);
    case 'regen':
      return [
        event.amount < 0
          ? `${event.battler.name} takes ${-event.amount} damage.`
          : `${event.battler.name} recovers ${event.amount} HP.`,
      ];
    case 'stateExpired':
      return [`${event.battler.name} is no longer affected by ${stateName(db, event.state)}.`];
    case 'escape':
      return [event.success ? 'The party escaped!' : "Couldn't escape!"];
    case 'victory': {
      const lines = ['Victory!'];
      if (event.exp > 0) lines.push(`Gained ${event.exp} EXP.`);
      if (event.gold > 0) lines.push(`Found ${event.gold} ${db.system.currency}.`);
      for (const drop of event.drops) {
        const name =
          (drop.kind === 'item' ? db.items : db.equipment).find(drop.id)?.name ?? drop.id;
        lines.push(`Got ${name}!`);
      }
      for (const up of event.levelUps) {
        lines.push(`${up.actor.name} reached level ${up.level}!`);
        for (const skill of up.learnedSkills) {
          lines.push(`${up.actor.name} learned ${db.skills.find(skill)?.name ?? skill}!`);
        }
      }
      return lines;
    }
    case 'defeat':
      return ['The party has fallen...'];
  }
}

function describeHit(
  result: Extract<BattleEvent, { type: 'hit' }>['result'],
  db: DatabaseIndex,
): string[] {
  const name = result.target.name;
  if (result.missed) return [`${name} evades the attack!`];
  const lines: string[] = [];
  const knockedOut = result.addedStates.some((s) => db.states.find(s)?.knockout);
  if (result.hpDamage > 0) {
    lines.push(
      `${result.critical ? 'Critical hit! ' : ''}${name} takes ${result.hpDamage} damage.`,
    );
  } else if (result.hpDamage < 0) {
    lines.push(`${name} recovers ${-result.hpDamage} HP.`);
  } else if (
    result.mpDamage === 0 &&
    result.addedStates.length === 0 &&
    result.removedStates.length === 0 &&
    result.learnedSkills.length === 0
  ) {
    lines.push(`${name} takes no damage.`);
  }
  if (result.mpDamage > 0) lines.push(`${name} loses ${result.mpDamage} MP.`);
  else if (result.mpDamage < 0) lines.push(`${name} recovers ${-result.mpDamage} MP.`);
  for (const state of result.addedStates) {
    const entry = db.states.find(state);
    if (entry?.knockout) continue;
    lines.push(`${name} is affected by ${entry?.name ?? state}.`);
  }
  for (const state of result.removedStates) {
    lines.push(`${name} is no longer affected by ${stateName(db, state)}.`);
  }
  for (const skill of result.learnedSkills) {
    lines.push(`${name} learned ${db.skills.find(skill)?.name ?? skill}!`);
  }
  if (knockedOut) lines.push(knockoutLine(result.target));
  return lines;
}

function knockoutLine(target: Battler): string {
  return target instanceof Actor ? `${target.name} falls!` : `${target.name} is defeated!`;
}
