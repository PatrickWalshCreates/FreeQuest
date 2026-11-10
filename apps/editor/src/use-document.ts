import type { ProjectDocument } from '@freequest/editor-core';
import { useCallback, useSyncExternalStore } from 'react';

/** Re-render whenever the document changes; returns its version. */
export function useDocumentVersion(doc: ProjectDocument): number {
  const subscribe = useCallback((listener: () => void) => doc.subscribe(listener), [doc]);
  return useSyncExternalStore(subscribe, () => doc.version);
}
