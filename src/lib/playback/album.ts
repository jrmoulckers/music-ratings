import { get, writable } from 'svelte/store';

import type { Entity, EntityId } from '../domain/types';
import type { PlaybackSnapshot } from './types';

/**
 * Listening to a record, and rating it as it goes.
 *
 * The session is device-local and momentary: which tracks have gone past your
 * ears since you started listening. Ratings made along the way are ordinary
 * rating events and outlive it; the session itself is forgotten when you close
 * the tab, because "did I hear this today" is not a fact worth syncing.
 */

/**
 * Where a track sits relative to the needle. Position only — never a claim
 * that it was heard, which is what `listened` is for.
 */
export type AlbumTrackState = 'earlier' | 'current' | 'upcoming';

export interface AlbumTrackRow {
  entity: Entity;
  /** 1-based, as printed on the sleeve. */
  position: number;
  state: AlbumTrackState;
  /** Observed playing through, here, during this sitting. */
  listened: boolean;
  /**
   * Confirmed by Spotify's own record of what was played, within this sitting.
   *
   * Stronger than `listened`: this app watching a track run to its end is good
   * evidence, but only `/me/recently-played` settles it. Nothing here fills
   * this in yet, which is why the two are kept apart rather than merged.
   */
  confirmed: boolean;
  rated: boolean;
}

export interface AlbumRowsInput {
  tracks: Entity[];
  /** The URI of what is playing, if it belongs to this record. */
  currentUri: string | null;
  listened: ReadonlySet<EntityId>;
  rated: ReadonlySet<EntityId>;
  /** Plays Spotify has confirmed, already scoped to this sitting by the caller. */
  confirmed?: ReadonlySet<EntityId>;
}

function uriOf(entity: Entity): string {
  return `spotify:track:${entity.providerId}`;
}

/**
 * The track list, with each row's standing.
 *
 * Two different facts, kept apart on purpose. Where the needle is decides
 * `state` — earlier, current, later. Whether a track was actually heard decides
 * `listened`, and only an observed play sets it. Start a record at track six
 * and the first five are earlier without ever having been played, which is why
 * position alone is never allowed to claim otherwise.
 */
export function albumRows(input: AlbumRowsInput): AlbumTrackRow[] {
  const index = input.currentUri
    ? input.tracks.findIndex((track) => uriOf(track) === input.currentUri)
    : -1;
  return input.tracks.map((entity, i) => ({
    entity,
    position: entity.trackNumber ?? i + 1,
    state: index < 0 ? 'upcoming' : i < index ? 'earlier' : i === index ? 'current' : 'upcoming',
    listened: input.listened.has(entity.id),
    confirmed: input.confirmed?.has(entity.id) ?? false,
    rated: input.rated.has(entity.id),
  }));
}

/** A row's standing, in words: short enough for the column, full for a reader. */
export interface AlbumTrackStatus {
  text: string;
  spoken: string;
}

/**
 * What a row's standing is called.
 *
 * These are statuses, not buttons, so they read as descriptions of the track
 * rather than as things you could do to it. "Passed" was neither: it implied
 * you had skipped something you may simply have never reached.
 *
 * Three different claims are kept apart, in descending order of certainty.
 * Spotify's own record settles a play. This app watching a track run through is
 * strong evidence still waiting to be confirmed, and says so. Sitting above the
 * needle in the track list is a position and nothing more — the word for that
 * is "earlier", and it never becomes "played".
 */
export function albumTrackStatus(row: AlbumTrackRow): AlbumTrackStatus {
  if (row.state === 'current') return { text: 'Now playing', spoken: 'Now playing' };
  if (row.confirmed)
    return { text: 'Played this session', spoken: 'Played this session, confirmed by Spotify' };
  if (row.listened)
    return { text: 'Awaiting Spotify', spoken: 'Played here; Spotify has not confirmed it yet' };
  if (row.state === 'earlier')
    return { text: 'Earlier track', spoken: 'Earlier track, not played this session' };
  return { text: 'Up next', spoken: 'Up next' };
}

export interface AlbumProgress {
  total: number;
  rated: number;
  listened: number;
  /** Heard this sitting but still unrated — what the summary asks about. */
  unratedListened: AlbumTrackRow[];
}

export function albumProgress(rows: AlbumTrackRow[]): AlbumProgress {
  return {
    total: rows.length,
    rated: rows.filter((row) => row.rated).length,
    listened: rows.filter((row) => row.listened).length,
    unratedListened: rows.filter((row) => row.listened && !row.rated),
  };
}

/* -------------------------------------------------------------------------- */
/* The session                                                                */
/* -------------------------------------------------------------------------- */

export interface AlbumSession {
  /** Canonical album entity id, or null when no session is running. */
  albumId: EntityId | null;
  /** The Spotify context URI this session follows, when playback started it. */
  contextUri: string | null;
  startedAt: number;
  listened: EntityId[];
  /** Set when playback leaves the record, so the summary can be offered once. */
  endedAt: number | null;
}

const IDLE: AlbumSession = {
  albumId: null,
  contextUri: null,
  startedAt: 0,
  listened: [],
  endedAt: null,
};

export const albumSession = writable<AlbumSession>({ ...IDLE });

export function startAlbumSession(albumId: EntityId, contextUri: string | null): void {
  const current = get(albumSession);
  if (current.albumId === albumId && !current.endedAt) return;
  albumSession.set({
    albumId,
    contextUri,
    startedAt: Date.now(),
    listened: [],
    endedAt: null,
  });
}

export function endAlbumSession(): void {
  albumSession.update((session) =>
    session.albumId && !session.endedAt ? { ...session, endedAt: Date.now() } : session,
  );
}

export function clearAlbumSession(): void {
  albumSession.set({ ...IDLE });
}

/**
 * Remember a track as heard.
 *
 * Called when playback moves on from it, not when it starts: a track skipped
 * after two seconds was not listened to, and asking someone to rate it would be
 * asking them to make something up.
 */
export function noteListened(entityId: EntityId): void {
  albumSession.update((session) =>
    !session.albumId || session.listened.includes(entityId)
      ? session
      : { ...session, listened: [...session.listened, entityId] },
  );
}

/** True when playback is still inside the record this session follows. */
export function stillOnAlbum(session: AlbumSession, snapshot: PlaybackSnapshot | null): boolean {
  if (!session.albumId || !snapshot) return false;
  if (session.contextUri && snapshot.context?.uri === session.contextUri) return true;
  // A track from the record counts even when the context is something else — a
  // playlist that happens to include it, or a queue with no context at all.
  // The record is what is being listened to either way.
  const releaseId = snapshot.item?.release?.id;
  return !!releaseId && session.albumId.endsWith(`:${releaseId}`);
}
