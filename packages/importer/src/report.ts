// What an import couldn't bring across, or brought across differently. Every
// item names where it was in the MZ project, so the author can go and look.

export type ReportLevel =
  /** Left out (or kept only as a comment): the author has to redo it. */
  | 'missing'
  /** Brought across, but it works differently now: worth checking. */
  | 'changed'
  /** For information. */
  | 'note';

export interface ReportItem {
  readonly level: ReportLevel;
  /** Where in the MZ project, e.g. "Switches" or "Map 3 (Town) › Old man, page 2". */
  readonly where: string;
  readonly message: string;
}

const HEADINGS: Record<ReportLevel, string> = {
  missing: 'Not imported',
  changed: 'Imported differently',
  note: 'Notes',
};

const LEVELS: readonly ReportLevel[] = ['missing', 'changed', 'note'];

export class ImportReport {
  readonly #items: ReportItem[] = [];

  get items(): readonly ReportItem[] {
    return this.#items;
  }

  add(level: ReportLevel, where: string, message: string): void {
    this.#items.push({ level, where, message });
  }

  missing(where: string, message: string): void {
    this.add('missing', where, message);
  }

  changed(where: string, message: string): void {
    this.add('changed', where, message);
  }

  note(where: string, message: string): void {
    this.add('note', where, message);
  }

  count(level: ReportLevel): number {
    return this.#items.filter((i) => i.level === level).length;
  }

  /** The report as a Markdown page (written into the new project). */
  toMarkdown(title: string): string {
    const lines = [`# ${title}`, ''];
    if (this.#items.length === 0) {
      lines.push('Everything was imported.', '');
      return lines.join('\n');
    }
    for (const level of LEVELS) {
      const items = this.#items.filter((i) => i.level === level);
      if (items.length === 0) continue;
      lines.push(`## ${HEADINGS[level]} (${items.length})`, '');
      for (const item of items) lines.push(`- **${escape(item.where)}**: ${escape(item.message)}`);
      lines.push('');
    }
    return lines.join('\n');
  }
}

/** Keep names from the MZ project from turning into Markdown formatting. */
function escape(text: string): string {
  return text.replace(/([\\`*_[\]<>#|])/g, '\\$1');
}
