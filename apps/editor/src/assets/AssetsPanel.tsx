// The Assets panel: every image and sound in the project, where each is
// used, importing new files (picked or dropped) and deleting unused ones.
// Logic lives in editor-core (assets.ts); this only draws and forwards.
import {
  ASSET_FOLDERS,
  type AssetEntry,
  IMPORT_EXTENSIONS,
  type ImportFile,
  type ProjectDocument,
  describeAssets,
  importFolderFor,
  pngSize,
} from '@freequest/editor-core';
import { useMemo, useRef, useState } from 'react';
import { useLoaded } from '../map/graphics.js';
import { confirmAction } from '../platform.js';
import { useDocumentVersion } from '../use-document.js';
import { useAssetPaths } from './use-assets.js';

interface Props {
  readonly doc: ProjectDocument;
}

interface Notice {
  readonly kind: 'info' | 'error';
  readonly lines: readonly string[];
  /** Shown as errors under the lines (e.g. files an import refused). */
  readonly errors?: readonly string[];
}

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const folderOf = (path: string) => path.slice(0, path.lastIndexOf('/'));
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** How a folder is shown: its label for the known ones, else its path. */
function folderLabel(path: string): string {
  return ASSET_FOLDERS.find((f) => f.path === path)?.label ?? path;
}

async function readFiles(list: FileList | readonly File[]): Promise<ImportFile[]> {
  return Promise.all(
    [...list].map(async (file) => ({
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  );
}

export function AssetsPanel({ doc }: Props) {
  useDocumentVersion(doc);
  const paths = useAssetPaths(doc);
  const project = doc.project;
  const entries = useMemo(() => describeAssets(project, paths ?? []), [project, paths]);
  const [folder, setFolder] = useState<string>(ASSET_FOLDERS[0]?.path ?? 'assets');
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const importFiles = async (files: readonly ImportFile[]) => {
    if (files.length === 0) return;
    setBusy(true);
    try {
      // Each file goes to a folder for its type (a sound never lands in Tilesets).
      const byFolder = new Map<string, ImportFile[]>();
      for (const file of files) {
        const target = importFolderFor(file.name, folder);
        byFolder.set(target, [...(byFolder.get(target) ?? []), file]);
      }
      const imported: string[] = [];
      const rejected: string[] = [];
      for (const [target, group] of byFolder) {
        const result = await doc.assets.import(target, group);
        imported.push(...result.imported.map((i) => i.path));
        rejected.push(...result.rejected.map((r) => r.reason));
      }
      if (imported[0]) setSelected(imported[0]);
      setNotice({
        kind: 'info',
        lines:
          imported.length > 0
            ? [`Imported ${plural(imported.length, 'file')}: ${imported.join(', ')}`]
            : [],
        errors: rejected.map((r) => `Not imported: ${r}`),
      });
    } catch (error) {
      setNotice({
        kind: 'error',
        lines: [`Import failed: ${error instanceof Error ? error.message : String(error)}`],
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: AssetEntry) => {
    const ok = await confirmAction(
      `Delete ${entry.path} from the project folder? This can't be undone.`,
      { title: 'Delete file', okLabel: 'Delete' },
    );
    if (!ok) return;
    try {
      await doc.assets.remove(doc.project, entry.path);
      setSelected(null);
      setNotice({ kind: 'info', lines: [`Deleted ${entry.path}`] });
    } catch (error) {
      setNotice({ kind: 'error', lines: [error instanceof Error ? error.message : String(error)] });
    }
  };

  const shown = entries.filter((e) => e.path.toLowerCase().includes(filter.trim().toLowerCase()));
  const groups = new Map<string, AssetEntry[]>();
  for (const e of shown) groups.set(folderOf(e.path), [...(groups.get(folderOf(e.path)) ?? []), e]);
  const current = entries.find((e) => e.path === selected) ?? null;
  const unused = entries.filter((e) => !e.missing && e.usedBy.length === 0).length;
  const missing = entries.filter((e) => e.missing).length;

  return (
    <div
      className={dragging ? 'assets dragging' : 'assets'}
      onDragOver={(event) => {
        if (![...event.dataTransfer.types].includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void readFiles(event.dataTransfer.files).then(importFiles);
      }}
    >
      <div className="assets-header">
        <h1>Assets</h1>
        <span className="muted">
          {plural(entries.length - missing, 'file')}
          {unused > 0 && ` · ${unused} unused`}
          {missing > 0 && ` · ${missing} missing`}
        </span>
        <span className="spacer" />
        <label className="inline">
          <span>Import into</span>
          <select value={folder} onChange={(e) => setFolder(e.target.value)}>
            {ASSET_FOLDERS.map((f) => (
              <option key={f.path} value={f.path}>
                {f.label} ({f.path})
              </option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Importing…' : 'Import…'}
        </button>
        <button
          onClick={() => void doc.assets.refresh()}
          title="List the assets folder again (after changing files outside the editor)"
        >
          Refresh
        </button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept={IMPORT_EXTENSIONS.join(',')}
          onChange={(event) => {
            const files = event.target.files;
            if (files) void readFiles(files).then(importFiles);
            event.target.value = '';
          }}
        />
      </div>
      <p className="hint">
        Images (PNG, WebP, JPEG) and sounds (WAV, OGG, MP3) are copied into the project. Drop files
        anywhere here to import them. Sounds always go to Audio.
      </p>
      {notice && (
        <div className={notice.kind === 'error' ? 'notice error' : 'notice'}>
          {notice.lines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          {notice.errors?.map((line, i) => (
            <div key={`e${i}`} className="error-text">
              {line}
            </div>
          ))}
          <button className="link" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="assets-body">
        <div className="assets-list">
          <input
            type="search"
            placeholder="Filter by name"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {paths === null && <p className="muted">Listing files…</p>}
          {paths !== null && shown.length === 0 && (
            <p className="muted">{filter ? 'No matches.' : 'No assets yet. Import some.'}</p>
          )}
          {[...groups].map(([dir, list]) => (
            <section key={dir}>
              <h2>{folderLabel(dir)}</h2>
              <ul>
                {list.map((e) => (
                  <li key={e.path}>
                    <button
                      className={e.path === selected ? 'item selected' : 'item'}
                      onClick={() => setSelected(e.path)}
                      title={e.path}
                    >
                      <span className="asset-icon" aria-hidden>
                        {e.type === 'audio' ? '♪' : '▣'}
                      </span>
                      <span className="asset-name">{fileName(e.path)}</span>
                      {e.missing ? (
                        <span className="badge" title="Used by the project but not in the folder">
                          missing
                        </span>
                      ) : e.usedBy.length === 0 ? (
                        <span className="muted small">unused</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="assets-detail">
          {current ? (
            <AssetDetail
              key={`${current.path}:${doc.assets.version}`}
              doc={doc}
              entry={current}
              onDelete={() => void remove(current)}
            />
          ) : (
            <p className="muted">Select a file to preview it and see where it's used.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function AssetDetail({
  doc,
  entry,
  onDelete,
}: {
  readonly doc: ProjectDocument;
  readonly entry: AssetEntry;
  readonly onDelete: () => void;
}) {
  const info = useLoaded(entry.path, async () => {
    if (entry.missing) return null;
    const [url, bytes] = await Promise.all([
      doc.fs.assetUrl(entry.path),
      doc.fs.readBytes(entry.path),
    ]);
    return { url, size: bytes.length, image: pngSize(bytes) };
  });
  const used = entry.usedBy.length > 0;
  return (
    <>
      <h2 className="asset-title">{fileName(entry.path)}</h2>
      <p className="muted small">{entry.path}</p>
      {entry.missing ? (
        <p className="error">
          This file is used by the project but isn't in the folder. Import it again (same name, same
          folder) or change what uses it.
        </p>
      ) : info.status === 'loading' ? (
        <p className="muted">Loading…</p>
      ) : info.status === 'error' ? (
        <p className="error">Could not read the file: {info.message}</p>
      ) : info.value ? (
        <>
          {entry.type === 'image' ? (
            <div className="asset-preview">
              <img src={info.value.url} alt={entry.path} />
            </div>
          ) : (
            <audio controls src={info.value.url} className="asset-audio" />
          )}
          <p className="muted small">
            {info.value.image && `${info.value.image.width} × ${info.value.image.height} px · `}
            {(info.value.size / 1024).toFixed(1)} KB
          </p>
        </>
      ) : null}
      <h3>Used by</h3>
      {used ? (
        <ul className="usages">
          {entry.usedBy.map((u, i) => (
            <li key={i}>{u}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nothing uses this file yet; exports leave it out.</p>
      )}
      {!entry.missing && (
        <button
          className="danger"
          disabled={used}
          title={used ? 'Still used: change what uses it first' : 'Delete the file from the folder'}
          onClick={onDelete}
        >
          Delete file…
        </button>
      )}
    </>
  );
}
