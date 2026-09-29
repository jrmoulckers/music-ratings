import { markDataChanged } from './changes';
import { db, META_CURSORS, META_SETTINGS, SYNCED_STORES } from './db';
import { defaultSettings, hydrateSettings, localSettings, type AppSettings } from './settings';
import { beginLibraryReset } from './library-revision';

export const LIBRARY_ACCOUNT_KEY = 'onedrive-library-account';
const DEVICE_META = ['spotify-signals', 'listening-coverage', META_CURSORS] as const;

export async function libraryAccountId(): Promise<string | undefined> {
  const database = await db();
  return database.get('meta', LIBRARY_ACCOUNT_KEY) as Promise<string | undefined>;
}

export async function bindLibraryAccount(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction('meta', 'readwrite');
  const existing = (await tx.store.get(LIBRARY_ACCOUNT_KEY)) as string | undefined;
  if (existing && existing !== id) {
    throw new Error(
      'This device belongs to another OneDrive library. Disconnect it before switching accounts.',
    );
  }
  await tx.store.put(id, LIBRARY_ACCOUNT_KEY);
  await tx.done;
}

/**
 * Sign-out is a local reset, not a synced deletion. Clear all records and the
 * account binding in one transaction so a failed reset cannot leave a partial
 * library behind for the next account.
 */
export async function clearLocalLibrary(current: AppSettings): Promise<void> {
  const database = await db();
  const next = hydrateSettings({
    ...defaultSettings(),
    ...localSettings(current),
    syncEnabled: false,
    preferredDeviceId: '',
  });
  const finish = beginLibraryReset();
  const tx = database.transaction([...SYNCED_STORES, 'meta'], 'readwrite');
  try {
    const writes: Promise<unknown>[] = SYNCED_STORES.map((store) => tx.objectStore(store).clear());
    for (const key of [...DEVICE_META, LIBRARY_ACCOUNT_KEY]) {
      writes.push(tx.objectStore('meta').delete(key));
    }
    writes.push(tx.objectStore('meta').put(next, META_SETTINGS));
    await Promise.all([...writes, tx.done]);
    finish(true);
  } catch (error) {
    try {
      tx.abort();
    } catch (abortError) {
      if (!(abortError instanceof DOMException && abortError.name === 'InvalidStateError')) {
        throw abortError;
      }
    }
    await Promise.allSettled([tx.done]);
    finish(false);
    throw error;
  }
  markDataChanged();
}
