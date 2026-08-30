import { writable } from 'svelte/store';

/**
 * A single monotonic counter that every write bumps. Views derive from it, and
 * autosync watches it to decide when a push is owed.
 *
 * Restoring a snapshot deliberately does *not* bump it: that write came from
 * the cloud, and echoing it back would start a ping-pong between devices.
 */
export const dataVersion = writable(0);

let current = 0;
dataVersion.subscribe((v) => {
  current = v;
});

export function markDataChanged(): void {
  dataVersion.set(current + 1);
}

export function currentDataVersion(): number {
  return current;
}
