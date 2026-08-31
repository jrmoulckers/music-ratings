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

export type AlbumTrackState = 'played' | 'current' | 'upcoming';

export interface AlbumTrackRow {
  entity: Entity;
  /** 1-based, as printed on the sleeve. */
  position: number;
  state: AlbumTrackState;
  /** Heard during this sitting. */
  listened: boolean;
  rated: boolean;
}

export interface AlbumRowsInput {
  tracks: Entity[];
  /** The URI of what is playing, if it belongs to this record. */
  currentUri: string | null;
  listened: ReadonlySet<EntityId>;
  rated: ReadonlySet<EntityId>;
  /**
   * Every Spotify URI a row answers to. A row standing for several combined
   * copies of one recording answers to all of them, because what is playing is
   * one particular copy and the list must still recognise it.
   */
  urisOf?: (entity: Entity) => readonly string[];
}

function uriOf(entity: Entity): string {
  return `spotify:track:${entity.providerId}`;
}

/**
 * The track list, with each row's standing.
 *
 * Playing position decides "played" and "upcoming"; the session's own record of
 * what has been heard decides "listened". They differ whenever someone starts
 * mid-record, shuffles, or comes back to a record later — and both are true at
 * once, so both are kept.
 */
export function albumRows(input: AlbumRowsInput): AlbumTrackRow[] {
  const uris = input.urisOf ?? ((entity: Entity) => [uriOf(entity)]);
  const index = input.currentUri
    ? input.tracks.findIndex((track) => uris(track).includes(input.currentUri as string))
    : -1;
  return input.tracks.map((entity, i) => ({
    entity,
    position: entity.trackNumber ?? i + 1,
    state: index < 0 ? 'upcoming' : i < index ? 'played' : i === index ? 'current' : 'upcoming',
    listened: input.listened.has(entity.id),
    rated: input.rated.has(entity.id),
  }));
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
