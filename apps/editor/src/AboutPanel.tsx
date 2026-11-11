// About FreeQuest (a page of the help window): the version, the licence, and the third-party notices
// that ship with the editor (public/THIRD_PARTY_NOTICES.txt, made by
// `pnpm gen:notices`).
import { FREEQUEST_VERSION } from '@freequest/schema';
import { useEffect, useState } from 'react';

/** The About page: version, licence and the third-party notices. */
export function AboutPanel() {
  const [notices, setNotices] = useState<string | null>(null);
  const [showNotices, setShowNotices] = useState(false);
  useEffect(() => {
    if (!showNotices || notices !== null) return;
    let current = true;
    fetch(new URL('THIRD_PARTY_NOTICES.txt', window.location.href))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(
        (text) => current && setNotices(text),
        (error: unknown) =>
          current && setNotices(`The notices couldn't be loaded (${String(error)}).`),
      );
    return () => {
      current = false;
    };
  }, [showNotices, notices]);
  const count = notices?.match(/^It includes the following (\d+)/m)?.[1];

  return (
    <div className="about">
      <p>
        <strong>FreeQuest Editor {FREEQUEST_VERSION}</strong>
      </p>
      <p>
        A free, open-source editor and engine for classic 2D role-playing games. It's an independent
        project, not affiliated with any other RPG maker.
      </p>
      <p className="muted">
        MIT License · Copyright © 2026 FreeQuest contributors. Games you make with FreeQuest are
        yours; exported games include FreeQuest's player and its licence notices.
      </p>
      <button type="button" onClick={() => setShowNotices((v) => !v)}>
        {showNotices ? 'Hide' : 'Show'} third-party licences
      </button>
      {showNotices && (
        <>
          {count && <p className="hint">{count} packages, with their licences.</p>}
          <pre className="notices">{notices ?? 'Loading…'}</pre>
        </>
      )}
    </div>
  );
}
