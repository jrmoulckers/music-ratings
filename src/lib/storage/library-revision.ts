export const LIBRARY_REVISION_KEY = 'music-ratings:library-revision';

function storedRevision(): string | null {
  try {
    return localStorage.getItem(LIBRARY_REVISION_KEY);
  } catch {
    return null;
  }
}

let revision = storedRevision();
let resetting = false;

/** A tab that still holds the previous library must not write into the next one. */
export function assertLibraryRevision(): void {
  if (resetting || revision?.startsWith('pending:') || storedRevision() !== revision) {
    throw new Error('The ratings library changed in another tab. Reload this page to continue.');
  }
}

/** Signal other tabs before clearing the database, then settle the marker on success or failure. */
export function beginLibraryReset(): (success: boolean) => void {
  assertLibraryRevision();
  const previous = revision;
  const next = crypto.randomUUID();
  try {
    localStorage.setItem(LIBRARY_REVISION_KEY, `pending:${next}`);
  } catch {
    throw new Error(
      'Browser storage is unavailable. Close other tabs and allow storage before switching libraries.',
    );
  }
  resetting = true;
  return (success: boolean) => {
    try {
      if (success) {
        localStorage.setItem(LIBRARY_REVISION_KEY, next);
        revision = next;
      } else if (previous === null) {
        localStorage.removeItem(LIBRARY_REVISION_KEY);
      } else {
        localStorage.setItem(LIBRARY_REVISION_KEY, previous);
      }
    } finally {
      resetting = false;
    }
    resetting = false;
  };
}

export function watchLibraryReset(onReset: (pending: boolean) => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== LIBRARY_REVISION_KEY) return;
    if (event.newValue?.startsWith('pending:')) onReset(true);
    else if (event.newValue !== revision || event.oldValue?.startsWith('pending:')) onReset(false);
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
