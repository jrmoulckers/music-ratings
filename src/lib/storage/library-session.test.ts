import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultSettings } from './settings';
import { DB_NAME, closeDatabase, db, META_SETTINGS, readMeta, writeMeta } from './db';
import { bindLibraryAccount, clearLocalLibrary, libraryAccountId } from './library-session';
import { buildSnapshot, emptySnapshot, restoreSnapshot } from './snapshot';
import { makeEntity } from '../../test/fixtures';

beforeEach(async () => {
  await closeDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

afterEach(async () => {
  await closeDatabase();
});

describe('OneDrive library boundary', () => {
  it('refuses to bind a different account to the existing library', async () => {
    await bindLibraryAccount('account-a');
    await expect(bindLibraryAccount('account-b')).rejects.toThrow('Disconnect');
    expect(await libraryAccountId()).toBe('account-a');
    await expect(
      restoreSnapshot(emptySnapshot(), { expectedAccountId: 'account-b' }),
    ).rejects.toThrow('library changed');
    expect(await libraryAccountId()).toBe('account-a');
  });

  it('clears ratings, plays, portable settings and Spotify signals without deleting a backup', async () => {
    const current = {
      ...defaultSettings(),
      theme: 'dark' as const,
      syncEnabled: true,
      onboarded: true,
      listeningEnabled: true,
      preferredDeviceId: 'friend-device',
    };
    const database = await db();
    await database.put('entities', makeEntity('track', 'song'));
    await database.put('ratings', {
      id: 'rating',
      entityId: 'track:spotify:song',
      entityType: 'track',
      at: 1,
      value: 5,
      scaleId: 'stars',
      normalized: 100,
      confidence: 'medium',
      updatedAt: 1,
    });
    await database.put('plays', {
      id: 'play',
      entityId: 'track:spotify:song',
      entityType: 'track',
      at: 1,
      ingestedAt: 1,
      source: 'spotify-recently-played',
      v: 1,
      updatedAt: 1,
    });
    await bindLibraryAccount('account-a');
    await writeMeta('spotify-signals', { recentlyPlayed: ['old'] });
    const oldBackup = await buildSnapshot(current);

    await clearLocalLibrary(current);

    expect(await libraryAccountId()).toBeUndefined();
    expect((await buildSnapshot()).ratings).toEqual([]);
    expect((await buildSnapshot()).plays).toEqual([]);
    expect((await buildSnapshot()).entities).toEqual([]);
    expect(await readMeta('spotify-signals')).toBeUndefined();
    expect(await readMeta<typeof current>(META_SETTINGS)).toMatchObject({
      theme: 'dark',
      onboarded: true,
      syncEnabled: false,
      listeningEnabled: false,
      preferredDeviceId: '',
    });
    expect(oldBackup.ratings).toHaveLength(1);
    await bindLibraryAccount('account-b');
    expect(await libraryAccountId()).toBe('account-b');
  });
});
