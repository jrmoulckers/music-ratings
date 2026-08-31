import { get, readable, writable } from 'svelte/store';

import { refreshWorld, settings, world } from '../app/state';
import { entityId } from '../domain/ids';
import type { Entity, Membership } from '../domain/types';
import { SpotifyApiError, SpotifyClient } from '../spotify/client';
import { spotifyConfig, spotifySession } from '../spotify/session';
import { saveMemberships, upsertEntities } from '../storage/repo';
import { entitiesForPlaying, playingItemFromEntity } from './entities';
import { isFresher, pollEvery, sameItem } from './model';
import { SimulatedPlayback } from './simulated';
import { SpotifyPlayback } from './spotify';
import type {
  PlaybackCommand,
  PlaybackService,
  PlaybackSnapshot,
  PlaybackState,
  PlayingItem,
  PlayRequest,
  RepeatMode,
} from './types';

/**
 * The live playback state, and the only place that talks to the transport.
 *
 * Three rules shape everything here. Playback is borrowed state, so it is never
 * written to storage and never synced. It is expensive to ask for, so it is
 * only asked for while somebody is watching. And it lies briefly after every
 * command, so every command reconciles against a real reading rather than
 * trusting the optimistic guess it made.
 */

function blank(): PlaybackState {
  return {
    source: 'none',
    status: 'unsupported',
    snapshot: null,
    devices: [],
    queue: [],
    pending: null,
    error: null,
    fetchedAt: null,
    watching: false,
  };
}

export const playback = writable<PlaybackState>(blank());

/**
 * A clock that only runs while something is watching it.
 *
 * The scrubber needs to move between authoritative reads; nothing else does. A
 * store that stops the interval on the last unsubscribe means a background tab
 * costs nothing at all.
 */
export const playbackNow = readable(Date.now(), (set) => {
  set(Date.now());
  const timer = setInterval(() => set(Date.now()), 500);
  return () => clearInterval(timer);
});

/* -------------------------------------------------------------------------- */
/* Choosing a transport                                                       */
/* -------------------------------------------------------------------------- */

let service: PlaybackService | null = null;
let serviceKind: 'spotify' | 'demo' | null = null;

/** Tracks in the local store, most recently added first, as playable items. */
function demoLibrary(): PlayingItem[] {
  const $world = get(world);
  const byId = new Map($world.entities.map((e) => [e.id, e]));
  return $world.entities
    .filter((e) => e.type === 'track' && !e.deleted)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, 60)
    .map((entity) =>
      playingItemFromEntity(
        entity,
        releaseOf(entity, byId, $world.memberships),
        performersOf(entity, byId),
      ),
    )
    .filter((item): item is PlayingItem => item !== null);
}

/**
 * The release a track belongs to.
 *
 * `parentIds` is the fast path, but it is only written by the Spotify mappers.
 * A catalogue restored from a backup, or built by hand, has the same fact in
 * its memberships, and the player should find the record either way.
 */
function releaseOf(
  entity: Entity,
  byId: Map<string, Entity>,
  memberships: readonly Membership[],
): Entity | undefined {
  const named = entity.parentIds?.map((id) => byId.get(id)).find((e) => e?.type === 'album');
  if (named) return named;
  const edge = memberships.find(
    (m) => m.childId === entity.id && m.parentType === 'album' && !m.deleted,
  );
  return edge ? byId.get(edge.parentId) : undefined;
}

function performersOf(entity: Entity, byId: Map<string, Entity>): Entity[] {
  return (entity.artistIds ?? [])
    .map((id) => byId.get(id))
    .filter((e): e is Entity => !!e && !e.deleted);
}

/** The tracks of a release or list, in order, for simulated context playback. */
function demoContextItems(uri: string): PlayingItem[] {
  const parts = uri.split(':');
  const kind = parts[1];
  const id = parts[2];
  if (!id) return [];
  const $world = get(world);
  const byId = new Map($world.entities.map((e) => [e.id, e]));
  const type = kind === 'album' ? 'album' : 'playlist';
  // Match on the provider's own id so a catalogue that did not come from
  // Spotify still finds its record.
  const parent =
    byId.get(entityId(type, 'spotify', id)) ??
    $world.entities.find((e) => e.type === type && e.providerId === id && !e.deleted);
  const parentId = parent?.id;
  if (!parentId) return [];
  const children = $world.memberships
    .filter((m) => m.parentId === parentId && !m.deleted)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((m) => byId.get(m.childId))
    .filter((e): e is Entity => !!e && !e.deleted);
  return children
    .map((entity) => playingItemFromEntity(entity, parent, performersOf(entity, byId)))
    .filter((item): item is PlayingItem => item !== null);
}

function transport(): PlaybackService {
  const connected = get(spotifySession).connected;
  const wanted = connected ? 'spotify' : 'demo';
  if (service && serviceKind === wanted) return service;
  serviceKind = wanted;
  service =
    wanted === 'spotify'
      ? new SpotifyPlayback(new SpotifyClient({ config: spotifyConfig() }))
      : new SimulatedPlayback({ library: demoLibrary, contextItems: demoContextItems });
  return service;
}

/** Forget the transport so the next read picks up a new connection or token. */
export function resetPlayback(): void {
  service = null;
  serviceKind = null;
  playback.set({ ...blank(), watching: get(playback).watching });
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

let reading: Promise<void> | null = null;

/**
 * Ask the transport what is happening.
 *
 * Overlapping calls share one request: a poll tick, a visibility change and a
 * command reconciliation can all land together and only one of them should
 * reach Spotify.
 */
export async function refreshPlayback(options: { quiet?: boolean } = {}): Promise<void> {
  if (reading) return reading;
  const session = get(spotifySession);
  if (session.connected && session.missingPlaybackScopes) {
    playback.update((state) => ({
      ...state,
      source: 'spotify',
      status: 'needs-permission',
      error: null,
    }));
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false && session.connected) {
    playback.update((state) => ({ ...state, status: 'offline' }));
    return;
  }

  const run = (async () => {
    const player = transport();
    try {
      const snapshot = await player.read();
      adopt(snapshot, player.id);
      if (snapshot) void ingest(snapshot.item);
    } catch (error) {
      if (!options.quiet) fail(error);
    } finally {
      reading = null;
    }
  })();
  reading = run;
  return run;
}

function adopt(snapshot: PlaybackSnapshot | null, source: 'spotify' | 'demo'): void {
  playback.update((state) => {
    if (snapshot && !isFresher(snapshot, state.snapshot)) return state;
    return {
      ...state,
      source,
      status: snapshot ? 'active' : 'idle',
      snapshot,
      error: null,
      fetchedAt: Date.now(),
    };
  });
}

function fail(error: unknown): void {
  const api = error instanceof SpotifyApiError ? error : null;
  const status =
    api?.kind === 'premium'
      ? 'needs-premium'
      : api?.kind === 'offline'
        ? 'offline'
        : api?.kind === 'no-device'
          ? 'idle'
          : 'error';
  const message = error instanceof Error ? error.message : 'Playback could not be read.';
  playback.update((state) => ({
    ...state,
    status,
    error: status === 'idle' ? null : message,
    pending: null,
  }));
}

/**
 * Write what is playing into the local store.
 *
 * Rating has to work on a record the listener has never imported, so the first
 * time something plays it becomes an ordinary catalogue row — through the same
 * mappers the library import uses, so ids and credit splits match exactly.
 */
let ingested: string | null = null;

async function ingest(item: PlayingItem | null): Promise<void> {
  if (!item?.id || item.isLocal || item.kind === 'ad') return;
  if (ingested === item.uri) return;
  ingested = item.uri;
  const { entities, memberships } = entitiesForPlaying(item);
  if (!entities.length) return;
  const known = new Set(get(world).entities.map((e) => e.id));
  const unknown = entities.some((entity) => !known.has(entity.id));
  await upsertEntities(entities);
  if (memberships.length) await saveMemberships(memberships);
  // Only rebuild the world when something genuinely new arrived: every track
  // change would otherwise recompute every score in the app.
  if (unknown) await refreshWorld();
}

export async function refreshDevices(): Promise<void> {
  try {
    const devices = await transport().devices();
    playback.update((state) => ({ ...state, devices }));
  } catch (error) {
    fail(error);
  }
}

export async function refreshQueue(): Promise<void> {
  try {
    const queue = await transport().queue();
    playback.update((state) => ({ ...state, queue }));
  } catch {
    // The queue is a courtesy. Losing it must not disturb the transport.
    playback.update((state) => ({ ...state, queue: [] }));
  }
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One command at a time, and always reconciled.
 *
 * Spotify's state lags its own commands by a beat, so a naive refresh right
 * after a press reads back the state before the press. The optimistic patch
 * keeps the control honest in the meantime, and a failure puts the previous
 * reading back rather than leaving a lie on screen.
 */
let chain: Promise<unknown> = Promise.resolve();

function run<T>(
  command: PlaybackCommand,
  work: (player: PlaybackService) => Promise<T>,
  optimistic?: (snapshot: PlaybackSnapshot) => PlaybackSnapshot,
): Promise<void> {
  const task = chain.then(async () => {
    const before = get(playback).snapshot;
    if (optimistic && before) {
      playback.update((state) => ({
        ...state,
        snapshot: state.snapshot ? optimistic(state.snapshot) : state.snapshot,
      }));
    }
    playback.update((state) => ({ ...state, pending: command, error: null }));
    try {
      await work(transport());
      // Spotify needs a beat before it reports the new state.
      await delay(350);
      await forceRefresh();
    } catch (error) {
      playback.update((state) => ({ ...state, snapshot: before }));
      fail(error);
    } finally {
      playback.update((state) => (state.pending === command ? { ...state, pending: null } : state));
    }
  });
  chain = task.catch(() => undefined);
  return task;
}

/** Bypasses the shared in-flight read so a command always sees its own effect. */
async function forceRefresh(): Promise<void> {
  reading = null;
  await refreshPlayback({ quiet: true });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function playbackPlay(request: PlayRequest = {}): Promise<void> {
  return run(
    'play',
    (player) => player.play(request),
    (s) => ({ ...s, playing: true, at: Date.now() }),
  );
}

export function playbackPause(): Promise<void> {
  return run(
    'pause',
    (player) => player.pause(),
    (s) => ({
      ...s,
      playing: false,
      progressMs: s.progressMs + Math.max(0, Date.now() - s.at),
      at: Date.now(),
    }),
  );
}

export function playbackToggle(): Promise<void> {
  const snapshot = get(playback).snapshot;
  if (snapshot?.playing) return playbackPause();
  return playbackPlay();
}

export function playbackNext(): Promise<void> {
  return run('next', (player) => player.next());
}

export function playbackPrevious(): Promise<void> {
  return run('previous', (player) => player.previous());
}

/**
 * Seek and volume coalesce.
 *
 * A dragged scrubber emits dozens of values; sending them all would rate-limit
 * the app and land out of order. Only the value the listener stopped on is
 * sent, and the display follows the drag meanwhile.
 */
let seekWanted: number | null = null;
let seekTimer: ReturnType<typeof setTimeout> | null = null;

export function playbackSeek(positionMs: number): void {
  seekWanted = Math.max(0, Math.round(positionMs));
  playback.update((state) => ({
    ...state,
    snapshot: state.snapshot
      ? { ...state.snapshot, progressMs: seekWanted ?? 0, at: Date.now() }
      : null,
  }));
  if (seekTimer) clearTimeout(seekTimer);
  seekTimer = setTimeout(() => {
    seekTimer = null;
    const target = seekWanted;
    seekWanted = null;
    if (target === null) return;
    void run('seek', (player) => player.seek(target));
  }, 220);
}

let volumeTimer: ReturnType<typeof setTimeout> | null = null;

export function playbackVolume(percent: number): void {
  const wanted = Math.max(0, Math.min(100, Math.round(percent)));
  playback.update((state) => ({
    ...state,
    snapshot: state.snapshot?.device
      ? { ...state.snapshot, device: { ...state.snapshot.device, volumePercent: wanted } }
      : state.snapshot,
  }));
  if (volumeTimer) clearTimeout(volumeTimer);
  volumeTimer = setTimeout(() => {
    volumeTimer = null;
    void run('volume', (player) => player.setVolume(wanted));
  }, 220);
}

export function playbackShuffle(on: boolean): Promise<void> {
  return run(
    'shuffle',
    (player) => player.setShuffle(on),
    (s) => ({ ...s, shuffle: on }),
  );
}

export function playbackRepeat(mode: RepeatMode): Promise<void> {
  return run(
    'repeat',
    (player) => player.setRepeat(mode),
    (s) => ({ ...s, repeat: mode }),
  );
}

export function playbackTransfer(deviceId: string, play = true): Promise<void> {
  return run('transfer', async (player) => {
    await player.transfer(deviceId, play);
    await delay(400);
    await player.devices().then((devices) => playback.update((s) => ({ ...s, devices })));
  });
}

export function playbackEnqueue(uri: string): Promise<void> {
  return run('enqueue', (player) => player.enqueue(uri));
}

/* -------------------------------------------------------------------------- */
/* Watching                                                                   */
/* -------------------------------------------------------------------------- */

let timer: ReturnType<typeof setTimeout> | null = null;
let watchers = 0;
let bound = false;

/**
 * Start following playback, and stop when the last screen that cares goes away.
 *
 * Reference counted because the mini-player and the Now Playing page both want
 * it, and neither should be able to switch the other off.
 */
export function watchPlayback(): () => void {
  watchers += 1;
  if (watchers === 1) {
    playback.update((state) => ({ ...state, watching: true }));
    bind();
    void refreshPlayback();
    void refreshDevices();
    schedule();
  }
  return () => {
    watchers = Math.max(0, watchers - 1);
    if (watchers === 0) {
      if (timer) clearTimeout(timer);
      timer = null;
      playback.update((state) => ({ ...state, watching: false }));
    }
  };
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (watchers === 0) return;
  const state = get(playback);
  const every = pollEvery({
    playing: state.snapshot?.playing === true,
    visible: typeof document === 'undefined' || document.visibilityState !== 'hidden',
    online: typeof navigator === 'undefined' || navigator.onLine !== false,
    preference: get(settings).playbackPolling,
  });
  if (every === null) return;
  timer = setTimeout(() => {
    void refreshPlayback({ quiet: true }).finally(schedule);
  }, every);
}

function bind(): void {
  if (bound || typeof document === 'undefined') return;
  bound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && watchers > 0) {
      void refreshPlayback().finally(schedule);
    } else {
      schedule();
    }
  });
  window.addEventListener('online', () => {
    if (watchers > 0) void refreshPlayback().finally(schedule);
  });
  window.addEventListener('offline', () => {
    playback.update((state) => ({ ...state, status: 'offline' }));
    schedule();
  });
  // A track change should re-plan the poll cadence immediately rather than at
  // the end of the current wait.
  let last: PlayingItem | null = null;
  let wasPlaying = false;
  playback.subscribe((state) => {
    const item = state.snapshot?.item ?? null;
    const playing = state.snapshot?.playing === true;
    const changed = !sameItem(item, last);
    if (changed || playing !== wasPlaying) {
      const previous = last;
      last = item;
      wasPlaying = playing;
      if (watchers > 0) schedule();
      // Moving off a track is the cue to ask Spotify what it recorded. The
      // change itself proves nothing — a skip looks exactly like a finish from
      // here — so this only asks the question, and the answer comes from
      // `/recently-played` or not at all.
      if (changed && previous) trackChanged?.();
    }
  });
}

let trackChanged: (() => void) | null = null;

/**
 * Ask to be told when playback moves off a track.
 *
 * Deliberately a bare notification with no payload: nothing downstream should
 * be able to mistake "the player moved on" for "the track was listened to".
 */
export function onTrackChange(handler: () => void): () => void {
  trackChanged = handler;
  return () => {
    if (trackChanged === handler) trackChanged = null;
  };
}
