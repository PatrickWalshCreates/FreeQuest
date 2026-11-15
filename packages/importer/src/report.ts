// What an import couldn't bring across, or brought across differently. Every
// item names where it was in the MZ project, so the author can go and look,
// and what it's about (its topics), so the report can open with a summary by
// kind: "Show animation: 80 times in 71 places".

export type ReportLevel =
  /** Left out (or kept only as a comment): the author has to redo it. */
  | 'missing'
  /** Brought across, but it works differently now: worth checking. */
  | 'changed'
  /** For information. */
  | 'note';

/** One kind of thing an item is about, and how many of it (e.g. 3 uses of a command). */
export interface ReportTopic {
  readonly name: string;
  readonly count: number;
}

export interface ReportItem {
  readonly level: ReportLevel;
  /** Where in the MZ project, e.g. "Switches" or "Maps › Town › Old man". */
  readonly where: string;
  readonly message: string;
  /** What it's about; without topics, the message itself is its topic. */
  readonly topics: readonly ReportTopic[];
}

/** A line of the summary: one kind of thing, how often, in how many places. */
export interface SummaryLine {
  readonly level: ReportLevel;
  readonly name: string;
  readonly count: number;
  readonly places: number;
}

const HEADINGS: Record<ReportLevel, string> = {
  missing: 'Not imported',
  changed: 'Imported differently',
  note: 'Notes',
};

const LEVELS: readonly ReportLevel[] = ['missing', 'changed', 'note'];

/**
 * Short names for the summary, for messages that come without topics. The
 * first pattern that matches names the kind; others count as their message.
 */
const KNOWN_TOPICS: readonly (readonly [RegExp, string])[] = [
  [/battle events/, 'Troop battle events'],
  [/passable from some sides only/, 'One-way tiles'],
  [/wore off after actions/, 'States that wore off after actions'],
  [/made the battler attack/, 'States that made battlers attack one side'],
  [/wall shadows/, 'Wall shadows'],
  [/across counters/, 'Talking across counters'],
  [/damage floors/, 'Damage floors'],
  [/cost TP/, 'TP costs'],
  [/hit \d+ times/, 'Skills that hit several times'],
  [/hidden item/, 'Hidden items'],
  [/water shows its first frame/, 'Moving water'],
  [/no character picture/, 'Actors without a character picture'],
  [/drained/, 'Draining skills'],
  [/targeted (allies whether|everyone)/, 'Skills targeting knocked-out allies or everyone'],
  [/Magical damage taken/, 'Separate magical damage rates'],
  [/own commands when cancelled/, 'Choices with a cancel branch'],
  [/route walked once/, 'Page routes that ran once'],
  [/recoloured \(hue\)/, 'Recoloured enemy pictures'],
  [/doesn't fit|can't wear its starting/, 'Starting equipment that doesn’t fit'],
  [/^audio\/.*(is missing|only an \.m4a)/, 'Missing sound files'],
  [/^img\/.*(is missing|is encrypted|couldn't be read)/, 'Missing pictures'],
  [/no enemies, so it was left out/, 'Empty troops'],
  [/left out\.$/, 'Things left out'],
];

function knownTopic(message: string): string | null {
  return KNOWN_TOPICS.find(([pattern]) => pattern.test(message))?.[1] ?? null;
}

/** How many kinds the summary lists before "and N more". */
const SUMMARY_LINES = 20;

export class ImportReport {
  readonly #items: ReportItem[] = [];

  get items(): readonly ReportItem[] {
    return this.#items;
  }

  add(
    level: ReportLevel,
    where: string,
    message: string,
    topics: readonly ReportTopic[] = [],
  ): void {
    this.#items.push({ level, where, message, topics });
  }

  missing(where: string, message: string, topics?: readonly ReportTopic[]): void {
    this.add('missing', where, message, topics);
  }

  changed(where: string, message: string, topics?: readonly ReportTopic[]): void {
    this.add('changed', where, message, topics);
  }

  note(where: string, message: string, topics?: readonly ReportTopic[]): void {
    this.add('note', where, message, topics);
  }

  count(level: ReportLevel): number {
    return this.#items.filter((i) => i.level === level).length;
  }

  /**
   * What didn't come across (or came across differently), by kind, most
   * common first. Items without topics count under their message, with
   * numbers left out so "3 tiles…" and "5 tiles…" are one kind.
   */
  summary(): SummaryLine[] {
    const lines = new Map<
      string,
      { level: ReportLevel; name: string; count: number; places: Set<string> }
    >();
    for (const item of this.#items) {
      if (item.level === 'note') continue;
      const topics =
        item.topics.length > 0
          ? item.topics
          : [{ name: knownTopic(item.message) ?? item.message, count: 1 }];
      for (const topic of topics) {
        const key = `${item.level}|${topic.name.replace(/\d+/g, '#')}`;
        const line = lines.get(key) ?? {
          level: item.level,
          name: topic.name,
          count: 0,
          places: new Set(),
        };
        line.count += topic.count;
        line.places.add(item.where);
        lines.set(key, line);
      }
    }
    return [...lines.values()]
      .map((l) => ({ level: l.level, name: l.name, count: l.count, places: l.places.size }))
      .sort((a, b) => b.count - a.count || b.places - a.places || a.name.localeCompare(b.name));
  }

  /** The report as a Markdown page (written into the new project). */
  toMarkdown(title: string): string {
    const lines = [`# ${title}`, ''];
    if (this.#items.length === 0) {
      lines.push('Everything was imported.', '');
      return lines.join('\n');
    }
    const summary = this.summary();
    if (summary.length > 0) {
      lines.push('## Summary', '', 'What needs work, by kind, most common first:', '');
      for (const s of summary.slice(0, SUMMARY_LINES)) {
        const times = s.count === s.places ? '' : `${s.count} times in `;
        const places = `${s.places} ${s.places === 1 ? 'place' : 'places'}`;
        const what = s.level === 'missing' ? 'not imported' : 'imported differently';
        lines.push(`- **${escape(s.name)}** (${what}): ${times}${places}`);
      }
      const more = summary.length - SUMMARY_LINES;
      if (more > 0)
        lines.push(`- …and ${more} more ${more === 1 ? 'kind' : 'kinds'}, listed below.`);
      lines.push('');
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
