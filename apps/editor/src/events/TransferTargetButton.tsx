import type { ProjectDocument } from '@freequest/editor-core';
import type { Command } from '@freequest/schema';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { MapPointPicker } from './MapPointPicker.js';

type Transfer = Extract<Command, { type: 'transfer' }>;

/** "Choose on map…" in a transfer's dialog: pick the destination by clicking the map. */
export function TransferTargetButton(props: {
  readonly doc: ProjectDocument;
  readonly command: Transfer;
  readonly onChange: (command: Transfer) => void;
}) {
  const { doc, command, onChange } = props;
  const [open, setOpen] = useState(false);
  const target = doc.project.maps.get(command.map)?.data;
  return (
    <div className="transfer-target">
      <button type="button" onClick={() => setOpen(true)}>
        Choose on map…
      </button>
      <span className="muted small">
        {target ? `${target.name}, cell ${command.x}, ${command.y}` : 'No map chosen'}
      </span>
      {open &&
        // The picker has its own form; forms can't nest, so it lives outside this dialog's.
        createPortal(
          <MapPointPicker
            doc={doc}
            initial={command}
            onClose={() => setOpen(false)}
            onOk={(point) => {
              const { direction: _, ...rest } = command;
              onChange({
                ...rest,
                map: point.map,
                x: point.x,
                y: point.y,
                ...(point.direction ? { direction: point.direction } : {}),
              });
              setOpen(false);
            }}
          />,
          document.body,
        )}
    </div>
  );
}
