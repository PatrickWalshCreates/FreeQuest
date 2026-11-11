// The help window: the guides from docs/ (bundled with the editor, so they
// match its version) and the About page. Markdown is read by editor-core's
// parseMarkdown and drawn as React elements, never as HTML.
import { type Block, type Inline, parseMarkdown, plainText } from '@freequest/editor-core';
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import exportingGuide from '../../../docs/exporting.md?raw';
import gettingStarted from '../../../docs/getting-started.md?raw';
import { AboutPanel } from './AboutPanel.js';
import { Dialog } from './Dialog.js';
import { openExternal } from './platform.js';

export type HelpPage = 'getting-started' | 'exporting' | 'about';

const PAGES: readonly { id: HelpPage; label: string; source?: string; file?: string }[] = [
  {
    id: 'getting-started',
    label: 'Getting started',
    source: gettingStarted,
    file: 'getting-started.md',
  },
  { id: 'exporting', label: 'Exporting games', source: exportingGuide, file: 'exporting.md' },
  { id: 'about', label: 'About' },
];

interface Props {
  readonly page?: HelpPage;
  readonly onClose: () => void;
}

export function HelpDialog({ page: initial = 'getting-started', onClose }: Props) {
  const [page, setPage] = useState<HelpPage>(initial);
  const [anchor, setAnchor] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const current = PAGES.find((p) => p.id === page) ?? PAGES[0];
  const blocks = useMemo(() => (current?.source ? parseMarkdown(current.source) : []), [current]);
  const sections = blocks.filter(
    (b): b is Extract<Block, { type: 'heading' }> => b.type === 'heading' && b.level === 2,
  );

  // Scroll to the top of a new page, or to the heading a link pointed at.
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const target = anchor ? element.querySelector(`[id="help-${anchor}"]`) : null;
    if (target instanceof HTMLElement) element.scrollTop = target.offsetTop - element.offsetTop - 8;
    else element.scrollTop = 0;
  }, [page, anchor]);

  const follow = (href: string) => {
    if (/^(https?:|mailto:)/.test(href)) {
      void openExternal(href);
      return;
    }
    const [file, hash] = href.split('#');
    const target = PAGES.find((p) => p.file && file && file.endsWith(p.file));
    if (target) setPage(target.id);
    setAnchor(hash ?? null);
  };

  return (
    <Dialog title="Help" onClose={onClose}>
      <div className="help">
        <nav className="help-nav" aria-label="Help pages">
          {PAGES.map((p) => (
            <button
              key={p.id}
              className={p.id === page ? 'item selected' : 'item'}
              aria-current={p.id === page}
              onClick={() => {
                setPage(p.id);
                setAnchor(null);
              }}
            >
              {p.label}
            </button>
          ))}
          {sections.length > 0 && (
            <ul className="help-sections">
              {sections.map((s) => (
                <li key={s.id}>
                  <button className="link" onClick={() => setAnchor(s.id)}>
                    {plainText(s.content)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>
        <div className="help-body" ref={body}>
          {page === 'about' ? (
            <AboutPanel />
          ) : (
            <article className="guide">{blocks.map((b, i) => renderBlock(b, i, follow))}</article>
          )}
        </div>
      </div>
      <div className="actions">
        <button type="button" className="primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

function renderInline(nodes: readonly Inline[], follow: (href: string) => void): ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={i}>{node.text}</Fragment>;
      case 'code':
        return <code key={i}>{node.text}</code>;
      case 'strong':
        return <strong key={i}>{renderInline(node.children, follow)}</strong>;
      case 'em':
        return <em key={i}>{renderInline(node.children, follow)}</em>;
      case 'link':
        return (
          <a
            key={i}
            href={node.href}
            title={/^https?:/.test(node.href) ? `${node.href} (opens in your browser)` : undefined}
            onClick={(event) => {
              event.preventDefault();
              follow(node.href);
            }}
          >
            {renderInline(node.children, follow)}
          </a>
        );
    }
  });
}

function renderBlock(block: Block, key: number, follow: (href: string) => void): ReactNode {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${Math.min(block.level + 1, 6)}` as 'h2';
      return (
        <Tag key={key} id={`help-${block.id}`}>
          {renderInline(block.content, follow)}
        </Tag>
      );
    }
    case 'paragraph':
      return <p key={key}>{renderInline(block.content, follow)}</p>;
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag key={key}>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item, follow)}</li>
          ))}
        </Tag>
      );
    }
    case 'code':
      return (
        <pre key={key}>
          <code>{block.text}</code>
        </pre>
      );
    case 'table':
      return (
        <table key={key}>
          <thead>
            <tr>
              {block.header.map((cell, i) => (
                <th key={i}>{renderInline(cell, follow)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, i) => (
                  <td key={i}>{renderInline(cell, follow)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'quote':
      return (
        <blockquote key={key}>{block.blocks.map((b, i) => renderBlock(b, i, follow))}</blockquote>
      );
  }
}
