import { derived, get, writable } from 'svelte/store';

import { notify } from '../app/notices';
import { explicitRatings, graph, ready, scores } from '../app/state';
import {
  isManagedPlaylist,
  LEGACY_PLAYLISTS_KEY,
  rankedPlaylist,
  type ManagedPlaylist,
  type PlaylistSize,
} from '../domain/playlists';
import { SCORE_VIEW_LABEL } from '../domain/ratings';
import type { ScoreView } from '../domain/types';
import { markDataChanged } from '../storage/changes';
import { db, raw } from '../storage/db';
import { assertLibraryRevision } from '../storage/library-revision';
import { hasScopes, PLAYLIST_WRITE_SCOPE, storedTokens } from './auth';
import { SpotifyClient } from './client';
import { spotifyAccountId, spotifyConfig, spotifySession } from './session';

export type { ManagedPlaylist } from '../domain/playlists';

export const managedPlaylists = writable<ManagedPlaylist[]>([]);
export const playlistBusy = writable(false);
export const playlistStorageError = writable<string | null>(null);

export function playlistPreview(size: PlaylistSize, view: ScoreView) {
  return rankedPlaylist(
    { graph: get(graph), scores: get(scores), explicit: get(explicitRatings) },
    size,
    view,
  );
}

export async function loadManagedPlaylists(): Promise<ManagedPlaylist[]> {
  const database = await db();
  const legacy = await database.get('meta', LEGACY_PLAYLISTS_KEY);
  const stored = await database.getAll('spotifyPlaylists');
  if (legacy !== undefined || !stored.every(isManagedPlaylist)) {
    throw new Error('Saved Spotify playlist links could not be read. No playlists were changed.');
  }
  const entries = stored.filter((entry) => !entry.deleted);
  if (JSON.stringify(get(managedPlaylists)) !== JSON.stringify(entries))
    managedPlaylists.set(entries);
  playlistStorageError.set(null);
  return entries;
}

async function save(entry: ManagedPlaylist): Promise<ManagedPlaylist> {
  const database = await db();
  const tx = database.transaction('spotifyPlaylists', 'readwrite');
  const current = await tx.store.get(entry.id);
  const next = {
    ...entry,
    ...(current && (current.preferenceUpdatedAt ?? 0) > (entry.preferenceUpdatedAt ?? 0)
      ? { live: current.live, preferenceUpdatedAt: current.preferenceUpdatedAt }
      : {}),
    updatedAt: Math.max(Date.now(), (current?.updatedAt ?? 0) + 1),
  };
  await tx.store.put(raw(next));
  const entries = await tx.store.getAll();
  await tx.done;
  managedPlaylists.set(entries.filter((row) => !row.deleted));
  markDataChanged();
  return next;
}

let task: Promise<unknown> = Promise.resolve();

function serial<T>(run: () => Promise<T>): Promise<T> {
  const next = task.then(async () => {
    const locked = async () => {
      playlistBusy.set(true);
      try {
        return await run();
      } finally {
        playlistBusy.set(false);
      }
    };
    return navigator.locks
      ? navigator.locks.request('music-ratings:ranked-playlists', locked)
      : locked();
  });
  task = next.catch(() => undefined);
  return next;
}

function guard(accountId: string, signal?: AbortSignal): void {
  signal?.throwIfAborted();
  assertLibraryRevision();
  if (!get(ready)) throw new Error('Wait for your ratings to finish loading.');
  if (spotifyAccountId() !== accountId || !hasScopes(storedTokens(), [PLAYLIST_WRITE_SCOPE])) {
    throw new Error(
      'Connect the same Spotify account with playlist permission to update this list.',
    );
  }
}

async function write(
  entry: ManagedPlaylist,
  client: SpotifyClient,
  signal?: AbortSignal,
): Promise<ManagedPlaylist> {
  guard(entry.accountId, signal);
  const uris = playlistPreview(entry.size, entry.view).uris;
  try {
    await client.replacePlaylistItems(entry.id, uris.slice(0, 100), { signal });
    for (let offset = 100; offset < uris.length; offset += 100) {
      guard(entry.accountId, signal);
      await client.appendPlaylistItems(entry.id, uris.slice(offset, offset + 100), { signal });
    }
    guard(entry.accountId, signal);
    const next = { ...entry, lastUris: uris, syncedAt: Date.now(), error: null };
    return await save(next);
  } catch (error) {
    const message = `${error instanceof Error ? error.message : String(error)} The playlist may be incomplete. Retry replaces its contents in ranking order.`;
    // Do not attach another account's work to a library that is being cleared.
    guard(entry.accountId, signal);
    await save({ ...entry, error: message });
    throw new Error(message);
  }
}

export function publishRankedPlaylist(
  size: PlaylistSize,
  view: ScoreView,
  live: boolean,
): Promise<ManagedPlaylist> {
  const accountId = spotifyAccountId();
  return serial(async () => {
    if (!accountId) throw new Error('Connect Spotify before creating a playlist.');
    guard(accountId);
    const client = new SpotifyClient({ config: spotifyConfig() });
    const me = await client.profile();
    if (me.id !== accountId)
      throw new Error('Your Spotify account changed. Reconnect and try again.');
    const entries = await loadManagedPlaylists();
    guard(accountId);
    let entry = entries.find(
      (row) => row.accountId === accountId && row.size === size && row.view === view,
    );
    if (entry) {
      entry = {
        ...entry,
        live,
        preferenceUpdatedAt:
          live === entry.live
            ? entry.preferenceUpdatedAt
            : Math.max(Date.now(), (entry.preferenceUpdatedAt ?? 0) + 1),
      };
    } else {
      if (playlistPreview(size, view).uris.length === 0)
        throw new Error('Rate some available Spotify tracks before creating a playlist.');
      const created = await client.createRankedPlaylist(
        `My Top ${size} Songs · ${SCORE_VIEW_LABEL[view]}`,
      );
      guard(accountId);
      entry = {
        id: created.id,
        accountId,
        size,
        view,
        live,
        lastUris: [],
        syncedAt: null,
        error: 'Playlist created; waiting for its first update.',
        updatedAt: Date.now(),
        preferenceUpdatedAt: Date.now(),
      };
    }
    // Remember the remote id before writing tracks, so retry never creates a second list.
    entry = await save(entry);
    return write(entry, client);
  });
}

export function updateRankedPlaylist(
  id: string,
  signal?: AbortSignal,
  liveOnly = false,
): Promise<ManagedPlaylist> {
  return serial(async () => {
    const entries = await loadManagedPlaylists();
    const entry = entries.find((row) => row.id === id);
    if (!entry) throw new Error('This playlist is no longer managed in this library.');
    guard(entry.accountId, signal);
    if (
      liveOnly &&
      (!entry.live ||
        entry.error ||
        JSON.stringify(playlistPreview(entry.size, entry.view).uris) ===
          JSON.stringify(entry.lastUris))
    ) {
      return entry;
    }
    const client = new SpotifyClient({ config: spotifyConfig() });
    const me = await client.profile({ signal });
    if (me.id !== entry.accountId)
      throw new Error('Reconnect the Spotify account that owns this list.');
    return write(entry, client, signal);
  });
}

export function setPlaylistLive(id: string, live: boolean): Promise<void> {
  return serial(async () => {
    const entries = await loadManagedPlaylists();
    const entry = entries.find((row) => row.id === id);
    if (!entry || entry.accountId !== spotifyAccountId())
      throw new Error('Reconnect the Spotify account that owns this list.');
    await save({
      ...entry,
      live,
      preferenceUpdatedAt: Math.max(Date.now(), (entry.preferenceUpdatedAt ?? 0) + 1),
    });
  });
}

/** No server or background permission: updates run only while this app is open. */
export function watchRankedPlaylists(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let rerun = false;
  let active: AbortController | null = null;
  let connected = get(spotifySession).connected;
  let accountId = connected ? spotifyAccountId() : null;
  const schedule = () => {
    rerun = true;
    clearTimeout(timer);
    timer = setTimeout(() => void run(), 1500);
  };
  const run = async () => {
    if (stopped || active || !get(ready) || !get(spotifySession).connected || !navigator.onLine)
      return;
    if (!hasScopes(storedTokens(), [PLAYLIST_WRITE_SCOPE])) return;
    rerun = false;
    const controller = new AbortController();
    active = controller;
    try {
      const entries = await loadManagedPlaylists();
      for (const entry of entries) {
        if (stopped || controller.signal.aborted) break;
        if (!entry.live || entry.error || entry.accountId !== spotifyAccountId()) continue;
        const uris = playlistPreview(entry.size, entry.view).uris;
        if (JSON.stringify(uris) === JSON.stringify(entry.lastUris)) continue;
        try {
          await updateRankedPlaylist(entry.id, controller.signal, true);
        } catch (error) {
          if (controller.signal.aborted) break;
          notify(error instanceof Error ? error.message : String(error), { tone: 'warn' });
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        playlistStorageError.set(message);
        notify(message, { tone: 'warn' });
      }
    } finally {
      active = null;
      if (rerun && !stopped) schedule();
    }
  };
  const stopData = derived([ready, graph, scores, explicitRatings], (values) => values).subscribe(
    schedule,
  );
  const stopSession = spotifySession.subscribe((session) => {
    const nextId = session.connected ? spotifyAccountId() : null;
    if (accountId !== nextId || connected !== session.connected) active?.abort();
    accountId = nextId;
    connected = session.connected;
    schedule();
  });
  const stopEntries = managedPlaylists.subscribe(schedule);
  const storageChanged = () => {
    active?.abort();
    schedule();
  };
  window.addEventListener('online', schedule);
  window.addEventListener('storage', storageChanged);
  window.addEventListener('focus', schedule);
  window.addEventListener('pageshow', schedule);
  const visible = () => {
    if (document.visibilityState === 'visible') schedule();
  };
  document.addEventListener('visibilitychange', visible);
  return () => {
    stopped = true;
    clearTimeout(timer);
    active?.abort();
    stopData();
    stopSession();
    stopEntries();
    window.removeEventListener('online', schedule);
    window.removeEventListener('storage', storageChanged);
    window.removeEventListener('focus', schedule);
    window.removeEventListener('pageshow', schedule);
    document.removeEventListener('visibilitychange', visible);
  };
}
