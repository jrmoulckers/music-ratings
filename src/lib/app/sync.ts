import { get } from 'svelte/store';

import { notify } from './notices';
import { clearRecentSearches } from './recent-searches';
import { loadAll, settings, world } from './state';
import { cancelImport, waitForSpotifyActivity } from '../spotify/session';
import {
  clearLocalLibrary,
  bindLibraryAccount,
  libraryAccountId,
} from '../storage/library-session';
import { resolveOneDriveClientId } from '../config';
import {
  catchUp,
  startAutoSync,
  stopAutoSync,
  waitForAutoSync,
  syncState,
  resolveConflict as resolveAutoConflict,
  syncNow as pushNow,
} from '../storage/autosync';
import {
  createOneDriveAdapter,
  signedInAccount,
  signIn,
  signOut,
  OneDriveNotConfiguredError,
  type OneDriveConfig,
} from '../storage/onedrive';

/**
 * Turning sync on and off, from the app's point of view.
 *
 * The storage layer knows how to reconcile; this decides whether it should be
 * running at all, and keeps that decision tied to the user's settings rather
 * than to any one screen.
 */

export function oneDriveConfig(): OneDriveConfig {
  const current = get(settings);
  return {
    // The user's own registration if they gave one, otherwise this build's.
    clientId: resolveOneDriveClientId(current.onedriveClientId),
    fileName: current.syncFileName,
    folderMode: current.onedriveFolderMode,
    customPath: current.onedriveCustomPath,
  };
}

let startedFor: string | null = null;
let starting: Promise<void> | null = null;
let generation = 0;
let restartRequested = false;

export function startSyncIfEnabled(): Promise<void> {
  if (starting) {
    restartRequested = true;
    return starting;
  }
  starting = (async () => {
    do {
      restartRequested = false;
      await startSync();
    } while (restartRequested);
  })().finally(() => {
    starting = null;
  });
  return starting;
}

async function startSync(): Promise<void> {
  const initiatedAt = generation;
  const current = get(settings);
  if (!current.syncEnabled || !resolveOneDriveClientId(current.onedriveClientId)) {
    generation += 1;
    stopAutoSync();
    startedFor = null;
    restartRequested = false;
    return;
  }
  try {
    const config = oneDriveConfig();
    const account = await signedInAccount(config);
    if (initiatedAt !== generation || !get(settings).syncEnabled) return;
    if (!account) {
      syncState.update((state) => ({
        ...state,
        status: 'error',
        message: 'OneDrive needs you to sign in again before it can sync.',
      }));
      return;
    }
    const bound = await libraryAccountId();
    if (initiatedAt !== generation || !get(settings).syncEnabled) return;
    if (bound && bound !== account.id) {
      stopAutoSync();
      startedFor = null;
      syncState.update((state) => ({
        ...state,
        status: 'error',
        message:
          'This is a different OneDrive account. Disconnect to start a fresh library, or sign back into the original account.',
      }));
      return;
    }
    const destination = JSON.stringify([
      account.id,
      config.clientId,
      config.folderMode,
      config.customPath,
      config.fileName,
    ]);
    if (startedFor === destination) return;
    stopAutoSync();
    await waitForAutoSync();
    if (initiatedAt !== generation || !get(settings).syncEnabled) return;
    await bindLibraryAccount(account.id);
    startAutoSync(
      createOneDriveAdapter({ ...config, accountId: account.id }),
      () => get(settings),
      account.name,
      async () => (await libraryAccountId()) === account.id,
      account.id,
    );
    startedFor = destination;
  } catch (error) {
    if (error instanceof OneDriveNotConfiguredError) {
      syncState.update((state) => ({ ...state, status: 'error', message: error.message }));
      return;
    }
    throw error;
  }
}

/** Watches the settings and starts or stops sync as they change. */
export function startSyncController(): () => void {
  const stop = settings.subscribe(() => {
    void startSyncIfEnabled();
  });
  return () => {
    stop();
    generation += 1;
    stopAutoSync();
    startedFor = null;
  };
}

export async function connectOneDrive(returnTo = '/settings'): Promise<void> {
  await signIn(oneDriveConfig(), returnTo);
}

/**
 * Pull whatever is in OneDrive down to this device, and say whether anything
 * was actually there.
 *
 * This is the "I have used this before, give me my ratings back" path, so it
 * waits for the first reconcile instead of letting it happen in the background:
 * the answer decides whether the person in front of us is a returning user or a
 * new one, and that question cannot be answered optimistically.
 *
 * An empty result is not a failure. It means this account has no backup yet —
 * a first device, or a wrong account — and the caller should carry on with
 * setup rather than drop someone into an empty library that looks like loss.
 */
export async function restoreFromOneDrive(): Promise<boolean> {
  await startSyncIfEnabled();
  await catchUp('restore');
  await waitForAutoSync();
  if (get(syncState).status !== 'synced') throw new Error(get(syncState).message);
  await loadAll();
  const restored = get(world);
  return restored.ratings.length > 0 || restored.entities.length > 0;
}

export async function disconnectOneDrive(): Promise<void> {
  generation += 1;
  stopAutoSync();
  startedFor = null;
  cancelImport();
  await waitForSpotifyActivity();
  if (starting) await starting;
  await waitForAutoSync();
  await signOut(oneDriveConfig());
  await clearLocalLibrary(get(settings));
  clearRecentSearches();
  await loadAll();
  notify(
    'OneDrive disconnected. This device now has a fresh, empty library; the backup in OneDrive was not deleted.',
  );
}

export async function syncNow(): Promise<void> {
  await startSyncIfEnabled();
  await pushNow();
  await catchUp('manual');
}

export async function resolveConflict(choice: 'local' | 'remote'): Promise<void> {
  await resolveAutoConflict(choice);
  notify(
    choice === 'local'
      ? 'This device won. The file in OneDrive now matches what is here.'
      : 'OneDrive won. This device now matches the file.',
  );
}
