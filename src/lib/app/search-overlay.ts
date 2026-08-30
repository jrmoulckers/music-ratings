import { writable, type Readable } from 'svelte/store';

/**
 * Whether the search overlay is open.
 *
 * Search is a global affordance rather than a page, so it lives in a tiny store
 * of its own: the rail, the home screen and the keyboard shortcut all open the
 * same panel, and none of them needs to know where the others are mounted.
 */

const store = writable(false);

export const searchOpen: Readable<boolean> = { subscribe: store.subscribe };

export function openSearch(): void {
  store.set(true);
}

export function closeSearch(): void {
  store.set(false);
}

export function toggleSearch(): void {
  store.update((open) => !open);
}
