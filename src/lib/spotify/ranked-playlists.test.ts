import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ready, settings, world } from '../app/state';
import { defaultSettings } from '../storage/settings';
import { db } from '../storage/db';
import { currentDataVersion } from '../storage/changes';
import {
  buildSnapshot,
  emptySnapshot,
  parseSnapshot,
  restoreSnapshot,
  serializeSnapshot,
} from '../storage/snapshot';
import { mergeSnapshots } from '../storage/sync';
import { LEGACY_PLAYLISTS_KEY } from '../domain/playlists';
import { storeTokens } from './auth';
import { SpotifyClient } from './client';
import { refreshSpotifySession } from './session';
import {
  loadManagedPlaylists,
  managedPlaylists,
  playlistPreview,
  publishRankedPlaylist,
  setPlaylistLive,
  updateRankedPlaylist,
  watchRankedPlaylists,
} from './ranked-playlists';
import { makeEntity, rate } from '../../test/fixtures';

function seed(count: number) {
  const entities = Array.from({ length: count }, (_, i) =>
    makeEntity('track', `t${i}`, { provider: 'spotify', providerId: `t${i}` }),
  );
  world.update((current) => ({
    ...current,
    entities,
    ratings: entities.map((entity, i) => rate(entity, 100 - i / 10)),
  }));
}

let stop: (() => void) | undefined;
beforeEach(async () => {
  vi.useRealTimers();
  const database = await db();
  await database.delete('meta', LEGACY_PLAYLISTS_KEY);
  await database.clear('spotifyPlaylists');
  managedPlaylists.set([]);
  settings.set(defaultSettings());
  seed(510);
  ready.set(true);
  localStorage.setItem('music-ratings.spotify.profile-id', 'owner');
  storeTokens({
    accessToken: 'test',
    refreshToken: 'test',
    expiresAt: Date.now() + 600_000,
    scopes: ['playlist-modify-private'],
  });
  refreshSpotifySession();
  vi.spyOn(SpotifyClient.prototype, 'profile').mockResolvedValue({ id: 'owner' });
  vi.spyOn(SpotifyClient.prototype, 'createRankedPlaylist').mockResolvedValue({
    id: 'newplaylist',
    name: 'Top Songs',
  });
  vi.spyOn(SpotifyClient.prototype, 'replacePlaylistItems').mockResolvedValue({
    snapshot_id: 'v1',
  });
  vi.spyOn(SpotifyClient.prototype, 'appendPlaylistItems').mockResolvedValue({ snapshot_id: 'v2' });
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  ready.set(false);
  refreshSpotifySession();
});

describe('managed ranked playlists', () => {
  it('writes all 500 songs in exact order in batches no larger than 100', async () => {
    const expected = playlistPreview(500, 'explicit').uris;
    const entry = await publishRankedPlaylist(500, 'explicit', false);
    const replace = vi.mocked(SpotifyClient.prototype.replacePlaylistItems);
    const append = vi.mocked(SpotifyClient.prototype.appendPlaylistItems);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledTimes(4);
    expect([...replace.mock.calls[0]![1], ...append.mock.calls.flatMap((call) => call[1])]).toEqual(
      expected,
    );
    expect(entry.lastUris).toEqual(expected);
    expect(entry.syncedAt).not.toBeNull();
  });

  it('remembers the same playlist across reloads and updates, without creating duplicates', async () => {
    await publishRankedPlaylist(25, 'explicit', true);
    managedPlaylists.set([]);
    await loadManagedPlaylists();
    expect(get(managedPlaylists)[0]?.live).toBe(true);
    await publishRankedPlaylist(25, 'explicit', false);
    expect(SpotifyClient.prototype.createRankedPlaylist).toHaveBeenCalledTimes(1);
    expect(get(managedPlaylists)[0]?.live).toBe(false);
  });

  it('backs up the connection and resumes the same playlist after a library restore', async () => {
    const before = currentDataVersion();
    await publishRankedPlaylist(25, 'explicit', true);
    expect(currentDataVersion()).toBeGreaterThan(before);
    const snapshot = parseSnapshot(serializeSnapshot(await buildSnapshot()));
    expect(snapshot.spotifyPlaylists).toHaveLength(1);
    expect(snapshot.spotifyPlaylists[0]).toMatchObject({
      id: 'newplaylist',
      accountId: 'owner',
      size: 25,
      view: 'explicit',
      live: true,
    });
    expect(serializeSnapshot(snapshot)).not.toContain('accessToken');
    expect(serializeSnapshot(snapshot)).not.toContain('refreshToken');
    await (await db()).clear('spotifyPlaylists');
    managedPlaylists.set([]);
    await restoreSnapshot(snapshot);
    await loadManagedPlaylists();
    expect(get(managedPlaylists)[0]?.live).toBe(true);
    await publishRankedPlaylist(25, 'explicit', true);
    expect(SpotifyClient.prototype.createRankedPlaylist).toHaveBeenCalledTimes(1);
    expect(SpotifyClient.prototype.replacePlaylistItems).toHaveBeenLastCalledWith(
      'newplaylist',
      playlistPreview(25, 'explicit').uris,
      { signal: undefined },
    );
  });

  it('merges connections and resolves update preferences per playlist across devices', async () => {
    const entry = await publishRankedPlaylist(25, 'explicit', true);
    const local = {
      ...emptySnapshot('A'),
      spotifyPlaylists: [{ ...entry, updatedAt: 10, preferenceUpdatedAt: 10 }],
    };
    const remote = {
      ...emptySnapshot('B'),
      spotifyPlaylists: [
        { ...entry, live: false, updatedAt: 20, preferenceUpdatedAt: 20 },
        { ...entry, id: 'anotherplaylist', size: 10 as const, updatedAt: 15 },
      ],
    };
    const first = mergeSnapshots(local, remote);
    const second = mergeSnapshots(remote, local);
    expect(first.snapshot.spotifyPlaylists).toEqual(second.snapshot.spotifyPlaylists);
    expect(first.snapshot.spotifyPlaylists).toHaveLength(2);
    expect(first.snapshot.spotifyPlaylists.find((row) => row.id === entry.id)?.live).toBe(false);
    expect(mergeSnapshots(first.snapshot, second.snapshot).changedLocally).toBe(false);
  });

  it('does not let a later background update undo a newer pause on another device', async () => {
    const entry = await publishRankedPlaylist(25, 'explicit', true);
    const local = {
      ...emptySnapshot('A'),
      spotifyPlaylists: [{ ...entry, live: true, updatedAt: 30, preferenceUpdatedAt: 10 }],
    };
    const remote = {
      ...emptySnapshot('B'),
      spotifyPlaylists: [{ ...entry, live: false, updatedAt: 20, preferenceUpdatedAt: 20 }],
    };
    const merged = mergeSnapshots(local, remote).snapshot;
    expect(merged.spotifyPlaylists[0]).toMatchObject({
      live: false,
      updatedAt: 30,
      preferenceUpdatedAt: 20,
    });
    expect(merged.spotifyPlaylists).toEqual(
      mergeSnapshots(remote, local).snapshot.spotifyPlaylists,
    );
  });

  it('reads older backups and refuses invalid playlist connections before restoring', async () => {
    const old = { ...emptySnapshot(), version: 3, spotifyPlaylists: undefined };
    expect(parseSnapshot(JSON.stringify(old)).spotifyPlaylists).toEqual([]);
    const entry = await publishRankedPlaylist(10, 'explicit', true);
    const invalid = { ...emptySnapshot(), spotifyPlaylists: [{ ...entry, id: '../broken' }] };
    await expect(restoreSnapshot(invalid)).rejects.toThrow('invalid Spotify playlist');
    expect((await loadManagedPlaylists())[0]?.id).toBe('newplaylist');
  });

  it('surfaces unreadable legacy links without creating another remote playlist', async () => {
    await (await db()).put('meta', [{ id: 'broken' }], LEGACY_PLAYLISTS_KEY);
    await expect(publishRankedPlaylist(25, 'explicit', true)).rejects.toThrow('could not be read');
    expect(SpotifyClient.prototype.createRankedPlaylist).not.toHaveBeenCalled();
  });

  it('resumes automatic updates on a later session without recreating the playlist', async () => {
    await publishRankedPlaylist(10, 'explicit', true);
    managedPlaylists.set([]);
    seed(5);
    const replace = vi.mocked(SpotifyClient.prototype.replacePlaylistItems);
    replace.mockClear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stop = watchRankedPlaylists();
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace.mock.calls[0]?.[0]).toBe('newplaylist');
    expect(replace.mock.calls[0]?.[1]).toHaveLength(5);
    expect(SpotifyClient.prototype.createRankedPlaylist).toHaveBeenCalledTimes(1);
  });

  it('keeps the remote id after a partial failure; retry starts from replacement', async () => {
    vi.mocked(SpotifyClient.prototype.appendPlaylistItems).mockRejectedValueOnce(
      new Error('Connection lost'),
    );
    await expect(publishRankedPlaylist(250, 'explicit', true)).rejects.toThrow('may be incomplete');
    expect(get(managedPlaylists)[0]).toMatchObject({
      id: 'newplaylist',
      syncedAt: null,
      lastUris: [],
    });
    await updateRankedPlaylist('newplaylist');
    expect(SpotifyClient.prototype.createRankedPlaylist).toHaveBeenCalledTimes(1);
    expect(SpotifyClient.prototype.replacePlaylistItems).toHaveBeenCalledTimes(2);
    expect(get(managedPlaylists)[0]?.error).toBeNull();
  });

  it('does not write to playlists owned by a different connected account', async () => {
    await publishRankedPlaylist(10, 'explicit', true);
    vi.mocked(SpotifyClient.prototype.replacePlaylistItems).mockClear();
    localStorage.setItem('music-ratings.spotify.profile-id', 'different');
    await expect(updateRankedPlaylist('newplaylist')).rejects.toThrow('same Spotify account');
    expect(SpotifyClient.prototype.replacePlaylistItems).not.toHaveBeenCalled();
  });

  it('checks the live token account before creating or updating', async () => {
    vi.mocked(SpotifyClient.prototype.profile).mockResolvedValue({ id: 'different' });
    await expect(publishRankedPlaylist(10, 'explicit', true)).rejects.toThrow('account changed');
    expect(SpotifyClient.prototype.createRankedPlaylist).not.toHaveBeenCalled();
    expect(SpotifyClient.prototype.replacePlaylistItems).not.toHaveBeenCalled();
  });

  it('requires playlist permission, and does not create an empty playlist', async () => {
    seed(0);
    await expect(publishRankedPlaylist(10, 'explicit', false)).rejects.toThrow('Rate some');
    localStorage.removeItem('music-ratings:spotify-token');
    await expect(publishRankedPlaylist(10, 'explicit', false)).rejects.toThrow(
      'playlist permission',
    );
    expect(SpotifyClient.prototype.createRankedPlaylist).not.toHaveBeenCalled();
  });

  it('debounces rating changes, updates off the Rankings page, and leaves unchanged lists alone', async () => {
    await publishRankedPlaylist(10, 'explicit', true);
    const replace = vi.mocked(SpotifyClient.prototype.replacePlaylistItems);
    replace.mockClear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stop = watchRankedPlaylists();
    await vi.advanceTimersByTimeAsync(2000);
    expect(replace).not.toHaveBeenCalled();
    world.update((current) => ({
      ...current,
      ratings: [...current.ratings]
        .reverse()
        .map((rating, index) => ({ ...rating, normalized: 100 - index / 10 })),
    }));
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace.mock.calls[0]![1][0]).toBe('spotify:track:t509');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(replace).toHaveBeenCalledTimes(1);
    await setPlaylistLive('newplaylist', false);
    seed(20);
    await vi.advanceTimersByTimeAsync(2000);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('does not auto-retry a partial failure until the user retries', async () => {
    await publishRankedPlaylist(250, 'explicit', true);
    vi.mocked(SpotifyClient.prototype.appendPlaylistItems).mockRejectedValue(new Error('Offline'));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stop = watchRankedPlaylists();
    seed(200);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(get(managedPlaylists)[0]?.error).toContain('incomplete'));
    const calls = vi.mocked(SpotifyClient.prototype.replacePlaylistItems).mock.calls.length;
    seed(210);
    await vi.advanceTimersByTimeAsync(5000);
    expect(SpotifyClient.prototype.replacePlaylistItems).toHaveBeenCalledTimes(calls);
  });

  it('catches further rating changes made while an update is still in flight', async () => {
    await publishRankedPlaylist(10, 'explicit', true);
    const replace = vi.mocked(SpotifyClient.prototype.replacePlaylistItems);
    replace.mockClear();
    let finish: (() => void) | undefined;
    replace.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ snapshot_id: 'slow' });
        }),
    );
    seed(5);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stop = watchRankedPlaylists();
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    seed(3);
    await vi.advanceTimersByTimeAsync(2000);
    expect(replace).toHaveBeenCalledTimes(1);
    finish?.();
    await vi.waitFor(() => expect(get(managedPlaylists)[0]?.lastUris).toHaveLength(5));
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(2));
    expect(replace.mock.calls[1]?.[1]).toHaveLength(3);
  });

  it('clears a managed playlist when no ranked tracks remain', async () => {
    await publishRankedPlaylist(10, 'explicit', false);
    seed(0);
    await updateRankedPlaylist('newplaylist');
    expect(SpotifyClient.prototype.replacePlaylistItems).toHaveBeenLastCalledWith(
      'newplaylist',
      [],
      { signal: undefined },
    );
    expect(get(managedPlaylists)[0]?.lastUris).toEqual([]);
  });

  it('rechecks live settings and the latest saved contents after acquiring the write lock', async () => {
    await publishRankedPlaylist(10, 'explicit', true);
    const replace = vi.mocked(SpotifyClient.prototype.replacePlaylistItems);
    replace.mockClear();
    await updateRankedPlaylist('newplaylist', undefined, true);
    expect(replace).not.toHaveBeenCalled();
    await setPlaylistLive('newplaylist', false);
    seed(5);
    await updateRankedPlaylist('newplaylist', undefined, true);
    expect(replace).not.toHaveBeenCalled();
    await updateRankedPlaylist('newplaylist');
    expect(replace).toHaveBeenCalledTimes(1);
  });
});
