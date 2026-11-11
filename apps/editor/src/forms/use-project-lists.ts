import type { ProjectDocument } from '@freequest/editor-core';
import { useMemo } from 'react';
import { useAssetPaths } from '../assets/use-assets.js';
import type { ProjectLists } from './project-context.js';

const AUDIO = /\.(wav|ogg|mp3)$/i;
const IMAGE = /\.(png|webp|jpe?g)$/i;

/** The project's audio and image files under assets/, kept current as assets are imported. */
export function useProjectLists(doc: ProjectDocument): ProjectLists {
  const paths = useAssetPaths(doc);
  return useMemo(() => {
    const all = paths ?? [];
    return { audio: all.filter((p) => AUDIO.test(p)), images: all.filter((p) => IMAGE.test(p)) };
  }, [paths]);
}
