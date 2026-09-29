import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { settings, signals } from '../app/state';
import { DB_NAME, closeDatabase, db } from '../storage/db';
import { SpotifyClient } from './client';
import { readSignals, writeSignals } from './library';
import { disconnectSpotify, prepareSpotifyAccount } from './session';

beforeEach(async () => {
  await closeDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  localStorage.clear();
  settings.update((current) => ({ ...current, preferredDeviceId: 'old-device' }));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await closeDatabase();
});

describe('Spotify account switching', () => {
  it('keeps discovery signals when reconnecting the same Spotify account', async () => {
    localStorage.setItem('music-ratings.spotify.profile-id', 'same-account');
    await writeSignals({
      recentlyPlayed: [{ entityId: 'track:spotify:song', at: 1, index: 0 }],
      top: [],
      saved: [],
      fetchedAt: 1,
    });
    vi.spyOn(SpotifyClient.prototype, 'profile').mockResolvedValue({
      id: 'same-account',
      display_name: 'Listener',
    });

    await prepareSpotifyAccount();

    expect((await readSignals())?.recentlyPlayed).toHaveLength(1);
    expect(get(settings).preferredDeviceId).toBe('old-device');
  });

  it('replaces account-specific signals without removing confirmed plays or ratings', async () => {
    const database = await db();
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
    await writeSignals({
      recentlyPlayed: [{ entityId: 'track:spotify:song', at: 1, index: 0 }],
      top: [],
      saved: [],
      fetchedAt: 1,
    });
    localStorage.setItem('music-ratings.spotify.profile-id', 'old-account');
    vi.spyOn(SpotifyClient.prototype, 'profile').mockResolvedValue({
      id: 'friend-account',
      display_name: 'Friend',
    });

    await prepareSpotifyAccount();

    expect(await readSignals()).toBeUndefined();
    expect(get(signals).recentlyPlayed).toEqual([]);
    expect(await database.count('plays')).toBe(1);
    expect(get(settings).preferredDeviceId).toBe('');
    expect(localStorage.getItem('music-ratings.spotify.profile-id')).toBe('friend-account');
  });

  it('keeps the listening log when Spotify disconnects', async () => {
    const database = await db();
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
    await disconnectSpotify();
    expect(await database.count('plays')).toBe(1);
  });
});
