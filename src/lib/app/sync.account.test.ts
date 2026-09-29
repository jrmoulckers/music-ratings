import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { settings } from './state';
import { DB_NAME, closeDatabase, db } from '../storage/db';
import { bindLibraryAccount, libraryAccountId } from '../storage/library-session';
import { LIBRARY_REVISION_KEY, watchLibraryReset } from '../storage/library-revision';
import { stopAutoSync, syncState } from '../storage/autosync';
import { defaultSettings } from '../storage/settings';
import { makeEntity } from '../../test/fixtures';

let microsoftAccount = 'account-a';
const adapterCreated = vi.fn();

vi.mock('../storage/onedrive', () => ({
  signedInAccount: async () => ({ id: microsoftAccount, name: 'person@example.com' }),
  createOneDriveAdapter: () => {
    adapterCreated();
    return {
      read: async () => {
        throw new Error('Test adapter is not connected to Graph.');
      },
      write: async () => null,
      peek: async () => null,
    };
  },
  signIn: async () => {},
  signOut: async () => {},
  OneDriveNotConfiguredError: class extends Error {},
}));

const { disconnectOneDrive, startSyncIfEnabled } = await import('./sync');

beforeEach(async () => {
  stopAutoSync();
  await closeDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  microsoftAccount = 'account-a';
  adapterCreated.mockClear();
  settings.set({ ...defaultSettings(), syncEnabled: true });
});

afterEach(async () => {
  stopAutoSync();
  settings.set(defaultSettings());
  await closeDatabase();
});

describe('OneDrive account changes', () => {
  it('refuses another account before reading or writing its backup', async () => {
    const database = await db();
    await database.put('entities', makeEntity('album', 'mine'));
    await bindLibraryAccount('account-a');
    microsoftAccount = 'account-b';

    await startSyncIfEnabled();

    expect(adapterCreated).not.toHaveBeenCalled();
    expect(await libraryAccountId()).toBe('account-a');
    expect(await database.count('entities')).toBe(1);
    expect(get(syncState).status).toBe('error');
  });

  it('signs out and clears the local library without writing deletions to Graph', async () => {
    const database = await db();
    await database.put('entities', makeEntity('album', 'mine'));
    await bindLibraryAccount('account-a');

    await disconnectOneDrive();

    expect(await libraryAccountId()).toBeUndefined();
    expect(await database.count('entities')).toBe(0);
    expect(get(settings).syncEnabled).toBe(false);
    expect(adapterCreated).not.toHaveBeenCalled();
  });

  it('blocks a stale tab during a reset and reloads only after it commits', async () => {
    const original = localStorage.getItem(LIBRARY_REVISION_KEY);
    const phases: boolean[] = [];
    const stop = watchLibraryReset((pending) => phases.push(pending));
    try {
      localStorage.setItem(LIBRARY_REVISION_KEY, 'pending:next');
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: LIBRARY_REVISION_KEY,
          oldValue: original,
          newValue: 'pending:next',
        }),
      );
      await expect(db()).rejects.toThrow('changed in another tab');

      localStorage.setItem(LIBRARY_REVISION_KEY, 'next');
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: LIBRARY_REVISION_KEY,
          oldValue: 'pending:next',
          newValue: 'next',
        }),
      );
      expect(phases).toEqual([true, false]);
      await expect(db()).rejects.toThrow('changed in another tab');
    } finally {
      stop();
      if (original === null) localStorage.removeItem(LIBRARY_REVISION_KEY);
      else localStorage.setItem(LIBRARY_REVISION_KEY, original);
    }
  });
});
