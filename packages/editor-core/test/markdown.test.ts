import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Block, parseInline, parseMarkdown, plainText, slug } from '../src/index.js';

const DOCS = join(import.meta.dirname, '..', '..', '..', 'docs');

describe('parseInline', () => {
  it('reads code, bold, emphasis and links', () => {
    expect(parseInline('Press **Play**, then `⌘S` or see [the guide](exporting.md).')).toEqual([
      { type: 'text', text: 'Press ' },
      { type: 'strong', children: [{ type: 'text', text: 'Play' }] },
      { type: 'text', text: ', then ' },
      { type: 'code', text: '⌘S' },
      { type: 'text', text: ' or see ' },
      { type: 'link', href: 'exporting.md', children: [{ type: 'text', text: 'the guide' }] },
      { type: 'text', text: '.' },
    ]);
    expect(parseInline('_behavior_ and *this*')).toEqual([
      { type: 'em', children: [{ type: 'text', text: 'behavior' }] },
      { type: 'text', text: ' and ' },
      { type: 'em', children: [{ type: 'text', text: 'this' }] },
    ]);
  });

  it('leaves snake_case, lone marks and escapes alone', () => {
    expect(plainText(parseInline('wolf_defeated and 2 * 3, a \\* b'))).toBe(
      'wolf_defeated and 2 * 3, a * b',
    );
    expect(parseInline('`a*b*`')).toEqual([{ type: 'code', text: 'a*b*' }]);
  });
});

describe('parseMarkdown', () => {
  it('reads headings, lists with continued lines, code, tables and quotes', () => {
    const blocks = parseMarkdown(
      [
        '# Title',
        '',
        'A paragraph',
        'over two lines.',
        '',
        '- one',
        '  continued',
        '- two',
        '',
        '1. first',
        '2. second',
        '',
        '```sh',
        'pnpm install',
        '```',
        '',
        '| Key | What |',
        '| --- | ---- |',
        '| B   | Pencil \\| brush |',
        '',
        '> Just want a look?',
        '> Try `pnpm editor`.',
      ].join('\n'),
    );
    expect(blocks.map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'list',
      'list',
      'code',
      'table',
      'quote',
    ]);
    const [heading, paragraph, bullets, numbers, code, table, quote] = blocks as [
      Extract<Block, { type: 'heading' }>,
      Extract<Block, { type: 'paragraph' }>,
      Extract<Block, { type: 'list' }>,
      Extract<Block, { type: 'list' }>,
      Extract<Block, { type: 'code' }>,
      Extract<Block, { type: 'table' }>,
      Extract<Block, { type: 'quote' }>,
    ];
    expect(heading).toMatchObject({ level: 1, id: 'title' });
    expect(plainText(paragraph.content)).toBe('A paragraph over two lines.');
    expect(bullets.items.map(plainText)).toEqual(['one continued', 'two']);
    expect(numbers.ordered).toBe(true);
    expect(code).toEqual({ type: 'code', language: 'sh', text: 'pnpm install' });
    expect(table.header.map(plainText)).toEqual(['Key', 'What']);
    expect(table.rows[0]?.map(plainText)).toEqual(['B', 'Pencil | brush']);
    expect(quote.blocks).toHaveLength(1);
  });

  it('makes anchors from headings', () => {
    expect(slug('4. Someone to talk to')).toBe('4-someone-to-talk-to');
    expect(slug('People who move, and things that happen on their own')).toBe(
      'people-who-move-and-things-that-happen-on-their-own',
    );
  });

  it('reads both guides without losing text', () => {
    for (const file of ['getting-started.md', 'exporting.md']) {
      const source = readFileSync(join(DOCS, file), 'utf8');
      const blocks = parseMarkdown(source);
      expect(blocks[0]?.type).toBe('heading');
      const headings = source.split('\n').filter((l) => /^#{1,6} /.test(l)).length;
      expect(blocks.filter((b) => b.type === 'heading')).toHaveLength(headings);
      expect(blocks.some((b) => b.type === 'table' || b.type === 'code')).toBe(true);
    }
  });
});
