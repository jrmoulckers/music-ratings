import { get, writable } from 'svelte/store';

import { currentDataVersion, dataVersion } from './changes';
import { buildSnapshot, restoreSnapshot, type Snapshot } from './snapshot';
import type { AppSettings } from './settings';
import {
  ConflictError,
  InteractionRequiredError,
  reconcile,
  type MergeResult,
  type RemoteAdapter,
} from './sync';

export type SyncStatus =
  'off' | 'idle' | 'syncing' | 'synced' | 'pending' | 'offline' | 'conflict' | 'error';

export interface SyncState {
  status: SyncStatus;
  message: string;
  lastSyncedAt: number | null;
  account: string | null;
  /** Set when the user must decide; the UI shows a recovery dialog. */
  conflict: { local: Snapshot; remote: Snapshot } | null;
  detail: MergeResult['detail'];
}

export const syncState = writable<SyncState>({
  status: 'off',
  message: 'Sync is off. Everything stays on this device.',
  lastSyncedAt: null,
  account: null,
  conflict: null,
  detail: [],
});

/**
 * Deliberately module-level rather than store state: this is a state mono,
 * and reading it back out of a store during a transition invites races.
 */
let adapter: RemoteAdapter | null = null;
let settingsRef: (() => AppSettings) | null = null;
let etag: string | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let running = false;
let queued = false;
let lastPushedVersion = 0;
let unsubscribe: (() => void) | null = null;
let listenersBound = false;

const PUSH_DEBOUNCE_MS = 2500;
const POLL_MS = 30_000;

function patch(next: Partial<SyncState>): void {
  syncState.update((state) => ({ ...state, ...next }));
}

export function startAutoSync(
  next: RemoteAdapter,
  settings: () => AppSettings,
  account: string | null,
): void {
  stopAutoSync();
  adapter = next;
  settingsRef = settings;
  lastPushedVersion = currentDataVersion();
  patch({ status: 'idle', message: 'Connected.', account, conflict: null });

  unsubscribe = dataVersion.subscribe((version) => {
    if (version === lastPushedVersion) return;
    patch({ status: 'pending', message: 'Changes waiting to sync.' });
    schedulePush();
  });

  pollTimer = setInterval(() => void catchUp('poll'), POLL_MS);
  bindListeners();
  void catchUp('start');
}

export function stopAutoSync(): void {
  adapter = null;
  settingsRef = null;
  etag = null;
  if (pushTimer) clearTimeout(pushTimer);
  if (pollTimer) clearInterval(pollTimer);
  pushTimer = null;
  pollTimer = null;
  unsubscribe?.();
  unsubscribe = null;
  patch({
    status: 'off',
    message: 'Sync is off. Everything stays on this device.',
    account: null,
    conflict: null,
  });
}

function bindListeners(): void {
  if (listenersBound || typeof window === 'undefined') return;
  listenersBound = true;
  const wake = () => void catchUp('wake');
  window.addEventListener('online', wake);
  window.addEventListener('focus', wake);
  window.addEventListener('pageshow', wake);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wake();
  });
  // A tab about to close should not lose the last two seconds of ratings.
  window.addEventListener('pagehide', () => {
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
      void run('flush');
    }
  });
}

function schedulePush(): void {
  if (!adapter) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void run('push');
  }, PUSH_DEBOUNCE_MS);
}

/** Cheap check first: if the remote tag is unchanged and we are clean, do nothing. */
export async function catchUp(reason: string): Promise<void> {
  if (!adapter) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    patch({ status: 'offline', message: 'Offline. Changes are saved here and will sync later.' });
    return;
  }
  const dirty = currentDataVersion() !== lastPushedVersion;
  if (!dirty && reason === 'poll') {
    try {
      const remoteTag = await adapter.peek();
      if (remoteTag && remoteTag === etag) return;
    } catch (error) {
      if (error instanceof InteractionRequiredError) return reportAuth();
      return;
    }
  }
  await run(reason);
}

export async function syncNow(): Promise<void> {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  await run('manual');
}

async function run(reason: string): Promise<void> {
  if (!adapter) return;
  if (running) {
    queued = true;
    return;
  }
  running = true;
  const versionAtStart = currentDataVersion();
  patch({ status: 'syncing', message: reason === 'manual' ? 'Syncing now…' : 'Syncing…' });

  try {
    const outcome = await reconcile({
      adapter,
      local: () => buildSnapshot(settingsRef?.()),
      apply: (snapshot) =>
        restoreSnapshot(snapshot, { markChanged: false, keepLocalSettings: false }),
      ...(settingsRef ? { settings: settingsRef() } : {}),
    });
    etag = outcome.etag;
    lastPushedVersion = versionAtStart;
    patch({
      status: 'synced',
      message: describeOutcome(outcome.status, outcome.detail),
      lastSyncedAt: Date.now(),
      detail: outcome.detail,
      conflict: null,
    });
  } catch (error) {
    if (error instanceof InteractionRequiredError) reportAuth();
    else if (error instanceof ConflictError) {
      patch({
        status: 'conflict',
        message: error.message,
        ...(error.remote && settingsRef
          ? { conflict: { local: await buildSnapshot(settingsRef()), remote: error.remote } }
          : {}),
      });
    } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      patch({ status: 'offline', message: 'Offline. Changes are saved here and will sync later.' });
    } else {
      patch({
        status: 'error',
        message: error instanceof Error ? error.message : 'Sync failed for an unknown reason.',
      });
    }
  } finally {
    running = false;
    if (queued) {
      queued = false;
      void run('queued');
    }
  }
}

function reportAuth(): void {
  patch({
    status: 'error',
    message: 'Your OneDrive sign-in expired. Reconnect in Settings to resume syncing.',
  });
}

function describeOutcome(status: string, detail: MergeResult['detail']): string {
  const changed = detail.reduce((acc, d) => acc + d.added + d.updated, 0);
  switch (status) {
    case 'created':
      return 'Backup created in your OneDrive app folder.';
    case 'up-to-date':
      return 'Up to date.';
    case 'pulled':
      return `Brought in ${changed} change${changed === 1 ? '' : 's'} from your other devices.`;
    case 'merged':
      return `Merged ${changed} change${changed === 1 ? '' : 's'} across devices.`;
    default:
      return 'Saved to OneDrive.';
  }
}

/** Conflict recovery: the user chooses, we never silently pick for them. */
export async function resolveConflict(choice: 'local' | 'remote'): Promise<void> {
  const state = get(syncState);
  if (!state.conflict || !adapter) return;
  if (choice === 'remote') {
    await restoreSnapshot(state.conflict.remote, { markChanged: false });
    lastPushedVersion = currentDataVersion();
  }
  patch({ conflict: null, status: 'idle', message: 'Conflict resolved.' });
  await run('resolve');
}
