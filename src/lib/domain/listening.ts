import type { EntityId, EntityType } from './types';

/**
 * Listening history: what Spotify confirms you actually played.
 *
 * The one rule this whole feature stands on: **a track counts as listened only
 * when Spotify reports it in `/me/player/recently-played`.** Local progress,
 * percentage played and "it reached the last few seconds" are all guesses about
 * what happened in the room, and this app does not record guesses as facts.
 *
 * What is stored here is therefore an *observation log*, not a history. Spotify
 * hands back the latest fifty plays and nothing older, so everything derived
 * from these rows is honestly qualified as "observed by this app" and never as
 * "your listening". The gaps are recorded too, so the app can say where it was
 * not looking rather than quietly implying it was.
 */

export const PLAY_SCHEMA_VERSION = 1;

/** How many plays Spotify will return from one recently-played read. */
export const RECENTLY_PLAYED_WINDOW = 50;

export type PlaySource = 'spotify-recently-played';

/** The kinds of Spotify context a play can carry, where it says so at all. */
export type PlayContextType = 'album' | 'playlist' | 'artist' | 'show' | 'collection';

/**
 * One confirmed play.
 *
 * Identity is deterministic — provider item id plus the exact instant Spotify
 * recorded — so the same play ingested twice, on two devices, from two
 * overlapping refreshes, is the same row. That is what makes deduplication and
 * OneDrive merge fall out for free rather than needing a reconciliation pass.
 */
export interface PlayEvent {
  /** `ply:<provider>:<providerItemId>:<playedAtMs>`. Deterministic everywhere. */
  id: string;
  entityId: EntityId;
  entityType: EntityType;
  /** Epoch ms of the play, as Spotify recorded it. */
  at: number;
  /** Where it was played from, only when the provider actually said. */
  contextType?: PlayContextType;
  /** Canonical entity id of the context, when it resolves to one. */
  contextId?: EntityId;
  /**
   * Track length in ms, copied at ingest. Listening *time* is estimated from
   * this and is never a measurement of how much of it was heard.
   */
  durationMs?: number;
  /** Epoch ms this device first wrote the row. Never the play's own time. */
  ingestedAt: number;
  source: PlaySource;
  /** Row schema version, so a later shape can be migrated rather than guessed. */
  v: number;
  updatedAt: number;
  deleted?: number;
}

/** Deterministic play id. The same play always produces the same key. */
export function playId(provider: string, providerItemId: string, playedAtMs: number): string {
  return `ply:${provider}:${providerItemId}:${playedAtMs}`;
}

/* -------------------------------------------------------------------------- */
/* Album completion                                                           */
/* -------------------------------------------------------------------------- */

export type CompletionPrompt = 'open' | 'rated' | 'dismissed' | 'snoozed';

/**
 * A record heard all the way through.
 *
 * Immutable evidence: which edition, which plays proved it, when the set closed.
 * The prompt state is the one mutable part, because it describes what the
 * listener has done about it — not what happened.
 *
 * It is keyed on the exact album edition. A deluxe reissue is a different record
 * with a different track list, and completing one says nothing about the other.
 */
export interface AlbumCompletion {
  /** `alc:<albumId>:<endAt>`. Deterministic, so two devices agree. */
  id: string;
  albumId: EntityId;
  /** How many usable tracks the edition had when the set closed. */
  trackCount: number;
  /** Earliest evidence play in the window. */
  startAt: number;
  /** The play that supplied the final missing track. */
  endAt: number;
  /** One play id per track, in track order. Compact, checkable evidence. */
  playIds: string[];
  closingPlayId: string;
  /** Every evidence play ran back to back, in the record's own context. */
  sitting: boolean;
  /** 1 for the first completion of this edition, 2 for the next, and so on. */
  ordinal: number;
  /** The rolling window in force when this was recorded, for provenance. */
  windowMs: number;
  prompt: CompletionPrompt;
  /** Epoch ms a snooze lifts. */
  snoozeUntil?: number;
  /** The rating event that answered the prompt, when one did. */
  ratingId?: string;
  createdAt: number;
  updatedAt: number;
  deleted?: number;
}

export function completionId(albumId: EntityId, endAt: number): string {
  return `alc:${albumId}:${endAt}`;
}

/* -------------------------------------------------------------------------- */
/* Coverage                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What this device knows about how well it was watching.
 *
 * Device-local on purpose: "when did *this browser* last read the window" is a
 * fact about a machine, not about the listener, and syncing it would let one
 * device's silence look like the other's.
 */
export interface ListeningCoverage {
  /** Epoch ms of the first successful ingest on this device. */
  firstFetchAt: number | null;
  lastFetchAt: number | null;
  /** Plays returned by the last read. */
  lastFetchCount: number;
  /** Plays actually new to the store on the last read. */
  lastFetchNew: number;
  /** Reads that came back completely full, where older plays may have been lost. */
  saturatedFetches: number;
  /** Newest play instant seen so far, used to spot a window that overran. */
  newestSeenAt: number | null;
  /** Windows the app could not see across. Newest first, capped. */
  gaps: ListeningGap[];
}

export interface ListeningGap {
  /** Newest play the app held before the gap. */
  after: number;
  /** Oldest play the refresh came back with. */
  before: number;
  detectedAt: number;
}

export const MAX_RECORDED_GAPS = 40;

export function emptyCoverage(): ListeningCoverage {
  return {
    firstFetchAt: null,
    lastFetchAt: null,
    lastFetchCount: 0,
    lastFetchNew: 0,
    saturatedFetches: 0,
    newestSeenAt: null,
    gaps: [],
  };
}

/**
 * Fold one read into the coverage record.
 *
 * A read that came back full *and* whose oldest play is newer than the newest
 * play already held means the app was away long enough for Spotify to roll plays
 * out of the window. That is a real hole in the observation and it is recorded
 * as one rather than papered over.
 */
export function foldCoverage(
  coverage: ListeningCoverage,
  read: {
    at: number;
    received: number;
    inserted: number;
    oldestAt: number | null;
    newestAt: number | null;
  },
): ListeningCoverage {
  const saturated = read.received >= RECENTLY_PLAYED_WINDOW;
  const gaps = [...coverage.gaps];
  if (
    saturated &&
    coverage.newestSeenAt !== null &&
    read.oldestAt !== null &&
    read.oldestAt > coverage.newestSeenAt
  ) {
    gaps.unshift({ after: coverage.newestSeenAt, before: read.oldestAt, detectedAt: read.at });
    gaps.length = Math.min(gaps.length, MAX_RECORDED_GAPS);
  }
  return {
    firstFetchAt: coverage.firstFetchAt ?? read.at,
    lastFetchAt: read.at,
    lastFetchCount: read.received,
    lastFetchNew: read.inserted,
    saturatedFetches: coverage.saturatedFetches + (saturated ? 1 : 0),
    newestSeenAt: Math.max(coverage.newestSeenAt ?? 0, read.newestAt ?? 0) || null,
    gaps,
  };
}
