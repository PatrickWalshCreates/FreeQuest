// A small Markdown reader for the guides shown inside the editor. It covers
// what docs/*.md use (headings, paragraphs, lists, tables, fenced code,
// quotes, bold, italics, code and links) and turns it into plain data, so
// the UI draws it without ever setting HTML.

export type Inline =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'code'; readonly text: string }
  | { readonly type: 'strong'; readonly children: readonly Inline[] }
  | { readonly type: 'em'; readonly children: readonly Inline[] }
  | { readonly type: 'link'; readonly href: string; readonly children: readonly Inline[] };

export type Block =
  | {
      readonly type: 'heading';
      readonly level: number;
      readonly content: readonly Inline[];
      readonly id: string;
    }
  | { readonly type: 'paragraph'; readonly content: readonly Inline[] }
  | {
      readonly type: 'list';
      readonly ordered: boolean;
      readonly items: readonly (readonly Inline[])[];
    }
  | { readonly type: 'code'; readonly language: string; readonly text: string }
  | {
      readonly type: 'table';
      readonly header: readonly (readonly Inline[])[];
      readonly rows: readonly (readonly (readonly Inline[])[])[];
    }
  | { readonly type: 'quote'; readonly blocks: readonly Block[] };

/** A heading's anchor: "## 4. Someone to talk to" → "4-someone-to-talk-to". */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_[\]()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Plain text of inline content (for anchors, titles). */
export function plainText(content: readonly Inline[]): string {
  return content
    .map((n) => (n.type === 'text' || n.type === 'code' ? n.text : plainText(n.children)))
    .join('');
}

/** Inline Markdown: `code`, **bold**, _em_ / *em*, [text](href), \escapes. */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ type: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    const ch = source[i] ?? '';
    if (ch === '\\' && i + 1 < source.length) {
      text += source[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = source.indexOf('`', i + 1);
      if (end > i) {
        flush();
        out.push({ type: 'code', text: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (rest.startsWith('**')) {
      const end = source.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ type: 'strong', children: parseInline(source.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === '_' || ch === '*') && /\S/.test(source[i + 1] ?? '')) {
      // An underscore inside a word (snake_case) isn't emphasis.
      const before = source[i - 1] ?? ' ';
      const end = source.indexOf(ch, i + 1);
      if (end > i + 1 && !(ch === '_' && /\w/.test(before))) {
        flush();
        out.push({ type: 'em', children: parseInline(source.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '[') {
      const link = /^\[([^\]]*)\]\(([^)\s]*)\)/.exec(rest);
      if (link) {
        flush();
        out.push({ type: 'link', href: link[2] ?? '', children: parseInline(link[1] ?? '') });
        i += link[0].length;
        continue;
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

const cells = (row: string): string[] =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));

const isTableRule = (line: string) =>
  /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

/** Block Markdown, as the guides use it. Unknown syntax reads as plain paragraphs. */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  const line = (n: number) => lines[n] ?? '';
  while (i < lines.length) {
    const current = line(i);
    if (current.trim() === '') {
      i++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(current);
    if (heading) {
      const text = heading[2] ?? '';
      blocks.push({
        type: 'heading',
        level: heading[1]?.length ?? 1,
        content: parseInline(text),
        id: slug(text),
      });
      i++;
      continue;
    }
    const fence = /^```(\S*)/.exec(current);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !line(i).startsWith('```')) body.push(line(i++));
      i++;
      blocks.push({ type: 'code', language: fence[1] ?? '', text: body.join('\n') });
      continue;
    }
    if (current.trimStart().startsWith('|') && isTableRule(line(i + 1))) {
      const header = cells(current).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && line(i).trimStart().startsWith('|')) {
        rows.push(cells(line(i++)).map(parseInline));
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    if (current.startsWith('>')) {
      const quoted: string[] = [];
      while (i < lines.length && line(i).startsWith('>')) {
        quoted.push(line(i++).replace(/^>\s?/, ''));
      }
      blocks.push({ type: 'quote', blocks: parseMarkdown(quoted.join('\n')) });
      continue;
    }
    const item = LIST_ITEM.exec(current);
    if (item) {
      const ordered = /\d/.test(item[2] ?? '');
      const items: string[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(line(i));
        if (m && /\d/.test(m[2] ?? '') === ordered && (m[1] ?? '').length === 0) {
          items.push(m[3] ?? '');
          i++;
        } else if (items.length > 0 && /^\s+\S/.test(line(i))) {
          // An indented line continues the item above it.
          items[items.length - 1] += ` ${line(i).trim()}`;
          i++;
        } else break;
      }
      blocks.push({ type: 'list', ordered, items: items.map(parseInline) });
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      line(i).trim() !== '' &&
      !/^(#{1,6}\s|```|>)/.test(line(i)) &&
      !LIST_ITEM.test(line(i)) &&
      !(line(i).trimStart().startsWith('|') && isTableRule(line(i + 1)))
    ) {
      paragraph.push(line(i++).trim());
    }
    blocks.push({ type: 'paragraph', content: parseInline(paragraph.join(' ')) });
  }
  return blocks;
}
