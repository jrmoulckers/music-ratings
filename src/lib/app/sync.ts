import { get } from 'svelte/store';

import { notify } from './notices';
import { loadAll, settings, world } from './state';
import { resolveOneDriveClientId } from '../config';
import {
  catchUp,
  startAutoSync,
  stopAutoSync,
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

let started = false;

export async function startSyncIfEnabled(): Promise<void> {
  const current = get(settings);
  if (!current.syncEnabled || !resolveOneDriveClientId(current.onedriveClientId)) {
    stopAutoSync();
    started = false;
    return;
  }
  if (started) return;
  try {
    const config = oneDriveConfig();
    const account = await signedInAccount(config);
    if (!account) {
      syncState.update((state) => ({
        ...state,
        status: 'error',
        message: 'OneDrive needs you to sign in again before it can sync.',
      }));
      return;
    }
    startAutoSync(createOneDriveAdapter(config), () => get(settings), account);
    started = true;
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
    stopAutoSync();
    started = false;
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
  await loadAll();
  const restored = get(world);
  return restored.ratings.length > 0 || restored.entities.length > 0;
}

export async function disconnectOneDrive(): Promise<void> {
  stopAutoSync();
  started = false;
  await signOut(oneDriveConfig());
  notify('OneDrive disconnected. Your ratings stay on this device.');
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
