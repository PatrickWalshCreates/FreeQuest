import { type ProjectDocument, mapUsages } from '@freequest/editor-core';
import type { Encounters, GameMap } from '@freequest/schema';
import { useState } from 'react';
import { Field } from '../Dialog.js';
import { ResizeDialog } from './ResizeDialog.js';
import { RenameIdButton } from '../RenameIdButton.js';
import { useProjectLists } from '../forms/use-project-lists.js';

interface Props {
  readonly doc: ProjectDocument;
  readonly path: string;
  readonly map: GameMap;
}

const DEFAULT_ENCOUNTER_STEPS = 30;

/** Map-wide settings: tileset, size, music, random battles. */
export function MapSettings({ doc, path, map }: Props) {
  const [resizing, setResizing] = useState(false);
  const { audio } = useProjectLists(doc);
  const troops = doc.project.database.troops?.data?.entries ?? [];
  const tilesets = [...doc.project.tilesets];

  const change = (label: string, fn: (m: GameMap) => GameMap, coalesce?: string) =>
    doc.update(path, 'map', label, fn, coalesce ? { coalesce } : {});
  const setEncounters = (label: string, fn: (e: Encounters) => Encounters, coalesce?: string) =>
    change(label, (m) => (m.encounters ? { ...m, encounters: fn(m.encounters) } : m), coalesce);

  const musicOptions = [...new Set([...audio, ...(map.music ? [map.music] : [])])].sort();

  const usedBy = mapUsages(doc.project, map.id);
  const isStart = doc.project.manifest.data.start.map === map.id;

  return (
    <div className="settings">
      <p className="hint called-by">
        {[
          isStart ? 'The game starts here' : null,
          usedBy.length > 0
            ? `Doors and other uses: ${usedBy.filter((u) => u !== 'Project settings').join(', ')}`
            : null,
        ]
          .filter((part) => part && !part.endsWith(': '))
          .join('. ') || 'Nothing leads here yet: add a Transfer player to another map.'}
      </p>
      <p className="hint">
        Map id <code>{map.id}</code> <RenameIdButton doc={doc} kind="map" id={map.id} what="map" />
      </p>
      <Field label="Tileset">
        <select
          value={map.tileset}
          onChange={(e) => change('Change tileset', (m) => ({ ...m, tileset: e.target.value }))}
        >
          {tilesets.map(([id, file]) => (
            <option key={id} value={id}>
              {file.data?.name ?? id}
            </option>
          ))}
        </select>
      </Field>

      <div className="field">
        <span>Size</span>
        <div className="inline">
          <span>
            {map.width} × {map.height} tiles
          </span>
          <button onClick={() => setResizing(true)}>Resize…</button>
        </div>
      </div>

      <Field label="Music">
        <select
          value={map.music ?? ''}
          onChange={(e) => {
            const music = e.target.value;
            change('Change music', (m) => {
              const { music: _old, ...rest } = m;
              return music ? { ...rest, music } : rest;
            });
          }}
        >
          <option value="">(silence)</option>
          {musicOptions.map((p) => (
            <option key={p} value={p}>
              {p.replace(/^assets\//, '')}
            </option>
          ))}
        </select>
      </Field>

      <div className="field">
        <label className="toggle">
          <input
            type="checkbox"
            checked={map.encounters !== undefined}
            disabled={!map.encounters && troops.length === 0}
            onChange={(e) => {
              const on = e.target.checked;
              const first = troops[0];
              change(on ? 'Add random battles' : 'Remove random battles', (m) => {
                const { encounters: _old, ...rest } = m;
                return on && first
                  ? {
                      ...rest,
                      encounters: {
                        steps: DEFAULT_ENCOUNTER_STEPS,
                        troops: [{ troop: first.id, weight: 1 }],
                      },
                    }
                  : rest;
              });
            }}
          />
          Random battles
        </label>
        {!map.encounters && troops.length === 0 && (
          <span className="hint">Add troops to the database first.</span>
        )}
      </div>

      {map.encounters && (
        <div className="encounters">
          <Field label="Average steps between battles">
            <input
              type="number"
              min={1}
              step={1}
              value={map.encounters.steps}
              onChange={(e) => {
                const steps = e.target.valueAsNumber;
                if (Number.isInteger(steps) && steps >= 1) {
                  setEncounters(
                    'Change battle rate',
                    (enc) => ({ ...enc, steps }),
                    `steps:${path}`,
                  );
                }
              }}
              onBlur={() => doc.endCoalescing()}
            />
          </Field>
          <table className="troops">
            <thead>
              <tr>
                <th>Troop</th>
                <th title="Relative chance">Weight</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {map.encounters.troops.map((entry, i) => (
                <tr key={i}>
                  <td>
                    <select
                      value={entry.troop}
                      onChange={(e) =>
                        setEncounters('Change troop', (enc) => ({
                          ...enc,
                          troops: enc.troops.map((t, j) =>
                            j === i ? { ...t, troop: e.target.value } : t,
                          ),
                        }))
                      }
                    >
                      {!troops.some((t) => t.id === entry.troop) && (
                        <option value={entry.troop}>{entry.troop} (missing)</option>
                      )}
                      {troops.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={entry.weight}
                      onChange={(e) => {
                        const weight = e.target.valueAsNumber;
                        if (Number.isInteger(weight) && weight >= 1) {
                          setEncounters(
                            'Change troop weight',
                            (enc) => ({
                              ...enc,
                              troops: enc.troops.map((t, j) => (j === i ? { ...t, weight } : t)),
                            }),
                            `weight:${path}:${i}`,
                          );
                        }
                      }}
                      onBlur={() => doc.endCoalescing()}
                    />
                  </td>
                  <td>
                    <button
                      className="icon"
                      title="Remove this troop"
                      aria-label={`Remove ${entry.troop}`}
                      disabled={map.encounters?.troops.length === 1}
                      onClick={() =>
                        setEncounters('Remove troop', (enc) => ({
                          ...enc,
                          troops: enc.troops.filter((_, j) => j !== i),
                        }))
                      }
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            disabled={troops.length === 0}
            onClick={() => {
              const first = troops[0];
              if (first) {
                setEncounters('Add troop', (enc) => ({
                  ...enc,
                  troops: [...enc.troops, { troop: first.id, weight: 1 }],
                }));
              }
            }}
          >
            + Add troop
          </button>
        </div>
      )}

      {resizing && <ResizeDialog doc={doc} map={map} onClose={() => setResizing(false)} />}
    </div>
  );
}
