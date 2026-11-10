import type { ProjectDocument } from '@freequest/editor-core';
import { useLoaded } from '../map/graphics.js';
import type { ProjectLists } from './project-context.js';

const AUDIO = /\.(wav|ogg|mp3)$/i;
const IMAGE = /\.(png|webp|jpe?g)$/i;

/** The project's audio and image files under assets/, listed once per document. */
export function useProjectLists(doc: ProjectDocument): ProjectLists {
  const files = useLoaded(doc, () => doc.fs.list('assets'));
  const all = files.status === 'ready' ? files.value : [];
  return { audio: all.filter((p) => AUDIO.test(p)), images: all.filter((p) => IMAGE.test(p)) };
}
