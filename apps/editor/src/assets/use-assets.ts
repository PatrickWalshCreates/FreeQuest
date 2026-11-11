import type { ProjectDocument } from '@freequest/editor-core';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

/** The files under assets/ (null while listing), kept current as files are imported or deleted. */
export function useAssetPaths(doc: ProjectDocument): readonly string[] | null {
  const library = doc.assets;
  const subscribe = useCallback((listener: () => void) => library.subscribe(listener), [library]);
  const version = useSyncExternalStore(subscribe, () => library.version);
  useEffect(() => {
    void library.list();
  }, [library]);
  // version 0: the first listing hasn't finished.
  return version === 0 ? null : library.listed;
}
