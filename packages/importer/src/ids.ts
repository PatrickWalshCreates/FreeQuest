// FreeQuest ids for things MZ numbers (switch 12, actor 3…). A named thing
// gets an id from its name; an unnamed one gets "<prefix>-<number>". Ids are
// handed out in number order when the table is made, so they never depend on
// which reference the import happens to meet first.
import { uniqueId } from '@freequest/editor-core';
import { idFromName, type FlagDeclaration } from '@freequest/schema';
import type { NumberedNames } from './mz-project.js';

export class NumberedIds {
  readonly #ids = new Map<number, string>();
  readonly #used = new Set<number>();

  /**
   * @param names Names by number (index 0 unused).
   * @param prefix For unnamed ones: "switch" gives "switch-12".
   * @param taken Ids already used in the same id space; the table adds its own.
   */
  constructor(
    readonly names: NumberedNames,
    readonly prefix: string,
    private readonly taken: Set<string>,
  ) {
    for (let n = 1; n < names.length; n++) this.#assign(n);
  }

  #assign(n: number): string {
    const name = this.names[n] ?? '';
    const id = uniqueId(idFromName(name, '') || `${this.prefix}-${n}`, this.taken);
    this.taken.add(id);
    this.#ids.set(n, id);
    return id;
  }

  /** The id for number `n`, marking it used. Numbers past the list still get one. */
  id(n: number): string {
    this.#used.add(n);
    return this.#ids.get(n) ?? this.#assign(n);
  }

  /** The thing's name, or "<Label> <n>" when MZ has none. */
  name(n: number, label: string): string {
    return this.names[n] || `${label} ${n}`;
  }

  /** Named ones and unnamed ones that something used, in number order. */
  declarations(label: string): FlagDeclaration[] {
    return [...this.#ids.keys()]
      .filter((n) => (this.names[n] ?? '') !== '' || this.#used.has(n))
      .sort((a, b) => a - b)
      .map((n) => ({ id: this.id(n), name: this.name(n, label) }));
  }
}
