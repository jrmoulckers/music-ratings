import { get } from 'svelte/store';

import { notify } from './notices';
import { settings } from './state';
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
