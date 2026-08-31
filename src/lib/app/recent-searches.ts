import { writable } from 'svelte/store';

/**
 * The last few things you looked for.
 *
 * A search you ran once you will often run again — the same artist, the same
 * half-remembered title. Keeping the last handful within one keystroke of the
 * empty field saves retyping without turning into a record of anything.
 *
 * This is a device convenience, not part of your library: it lives in this
 * browser's local storage, never in the database and never in OneDrive, and it
 * is capped so it cannot grow into a history worth worrying about.
 */

const KEY = 'music-ratings.recent-searches';

/** How many are kept. Enough to be useful, few enough to scan at a glance. */
export const RECENT_LIMIT = 8;

/** Longest query kept, so a pasted essay cannot fill the store. */
const MAX_LENGTH = 120;

/** The comparison form: whitespace collapsed, case ignored. Never displayed. */
export function searchKey(term: string): string {
  return term.trim().replace(/\s+/g, ' ').toLowerCase();
}

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Anything that is not a usable string is dropped rather than trusted:
    // this file can be edited by hand, and by an older version of this app.
    const seen = new Set<string>();
    const kept: string[] = [];
    for (const value of parsed) {
      if (typeof value !== 'string') continue;
      const term = value.trim().slice(0, MAX_LENGTH);
      const key = searchKey(term);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      kept.push(term);
      if (kept.length >= RECENT_LIMIT) break;
    }
    return kept;
  } catch {
    return [];
  }
}

function write(terms: string[]): void {
  try {
    if (terms.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(terms));
  } catch {
    // A full or blocked storage quota costs the convenience, not the search.
  }
}

const store = writable<string[]>(read());

/** The recent queries, newest first. */
export const recentSearches = { subscribe: store.subscribe };

/**
 * Record a query that was actually run and answered.
 *
 * Called on a completed search, never on a keystroke: half-typed terms and
 * searches that failed or were abandoned are not things you asked for.
 * Re-running a query moves it back to the top and keeps the newer spelling.
 */
export function rememberSearch(term: string): void {
  const text = term.trim().replace(/\s+/g, ' ').slice(0, MAX_LENGTH);
  const key = searchKey(text);
  if (!key) return;
  store.update((terms) => {
    const next = [text, ...terms.filter((t) => searchKey(t) !== key)].slice(0, RECENT_LIMIT);
    write(next);
    return next;
  });
}

/** Drop one query. */
export function forgetSearch(term: string): void {
  const key = searchKey(term);
  store.update((terms) => {
    const next = terms.filter((t) => searchKey(t) !== key);
    write(next);
    return next;
  });
}

/** Drop all of them. */
export function clearRecentSearches(): void {
  store.set([]);
  write([]);
}

/** Test seam: re-read what is in storage now. */
export function reloadRecentSearches(): void {
  store.set(read());
}
