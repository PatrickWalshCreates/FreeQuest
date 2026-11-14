// MZ's type lists (elements, skill types, weapon and armor types, equipment
// slots) as FreeQuest's system.json lists. Weapon and armor types become one
// list of equipment types, so they share one id space.
import type { SystemData } from '@freequest/schema';
import { NumberedIds } from './ids.js';
import type { MzSystem } from './mz-project.js';

export type SystemTypeLists = Pick<
  SystemData,
  'currency' | 'elements' | 'equipmentSlots' | 'equipmentTypes' | 'skillTypes'
>;

export class SystemTypes {
  readonly elements: NumberedIds;
  readonly skillTypes: NumberedIds;
  readonly weaponTypes: NumberedIds;
  readonly armorTypes: NumberedIds;
  readonly equipmentSlots: NumberedIds;
  readonly currency: string;

  constructor(system: MzSystem) {
    this.elements = new NumberedIds(system.elements, 'element', new Set());
    this.skillTypes = new NumberedIds(system.skillTypes, 'skill-type', new Set());
    const equipmentTypes = new Set<string>();
    this.weaponTypes = new NumberedIds(system.weaponTypes, 'weapon-type', equipmentTypes);
    this.armorTypes = new NumberedIds(system.armorTypes, 'armor-type', equipmentTypes);
    this.equipmentSlots = new NumberedIds(system.equipTypes, 'slot', new Set());
    this.currency = system.currency || 'G';
  }

  /** The lists for system.json: every named type, and unnamed ones something used. */
  lists(): SystemTypeLists {
    return {
      currency: this.currency,
      elements: this.elements.declarations('Element'),
      skillTypes: this.skillTypes.declarations('Skill type'),
      equipmentTypes: [
        ...this.weaponTypes.declarations('Weapon type'),
        ...this.armorTypes.declarations('Armor type'),
      ],
      equipmentSlots: this.equipmentSlots.declarations('Slot'),
    };
  }
}
