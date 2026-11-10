/**
 * Check and normalize a project-relative path: `/` separators, no leading
 * slash, no `.` / `..` / empty segments, no backslashes or drive letters.
 * Every `ProjectFs` goes through this, so no path in a project file can
 * reach outside the project folder.
 */
export function normalizeProjectPath(path: string): string {
  if (path === '') throw new InvalidPathError(path, 'is empty');
  if (path.includes('\\')) throw new InvalidPathError(path, 'must use "/" separators');
  if (path.includes('\0')) throw new InvalidPathError(path, 'contains a NUL character');
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    throw new InvalidPathError(path, 'must be relative to the project folder');
  }
  const segments = path.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new InvalidPathError(path, `has an invalid segment "${segment}"`);
    }
  }
  return segments.join('/');
}

export class InvalidPathError extends Error {
  override name = 'InvalidPathError';
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`Path "${path}" ${reason}`);
  }
}
