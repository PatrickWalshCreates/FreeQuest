// Switches and variables: the project's declared on/off flags and numbers
// (project.json `switches` / `variables`). Pure edits over the manifest;
// ids are made from names and stay fixed (renaming ids is M12 step 3).
import { type Manifest, idFromName } from '@freequest/schema';
import { uniqueId } from './database-edits.js';

export type GameStateKind = 'switches' | 'variables';

/** Declare a new switch or variable named `name`; returns the manifest and its id. */
export function addDeclaration(
  manifest: Manifest,
  kind: GameStateKind,
  name: string,
): { manifest: Manifest; id: string } {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Give it a name');
  const base = idFromName(trimmed, kind === 'switches' ? 'switch' : 'variable');
  // Switches and variables have separate ids, but sharing one makes events harder to read.
  const id = uniqueId(
    base,
    [...manifest.switches, ...manifest.variables].map((d) => d.id),
  );
  return { manifest: { ...manifest, [kind]: [...manifest[kind], { id, name: trimmed }] }, id };
}

/** Change a switch's or variable's display name (its id stays). */
export function renameDeclaration(
  manifest: Manifest,
  kind: GameStateKind,
  id: string,
  name: string,
): Manifest {
  const list = manifest[kind];
  if (!list.some((d) => d.id === id)) return manifest;
  return { ...manifest, [kind]: list.map((d) => (d.id === id ? { ...d, name } : d)) };
}

/** Remove a switch or variable (anything still using it shows a problem). */
export function removeDeclaration(manifest: Manifest, kind: GameStateKind, id: string): Manifest {
  const list = manifest[kind];
  return list.some((d) => d.id === id)
    ? { ...manifest, [kind]: list.filter((d) => d.id !== id) }
    : manifest;
}
