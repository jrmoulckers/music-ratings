import type { PollingChoice } from '../storage/settings';
import type { Disallows, PlaybackSnapshot, PlayingContext, PlayingItem } from './types';

/**
 * The arithmetic of playback, with no timers, no fetches and no Svelte.
 *
 * Everything here answers a question the screens ask several times a second —
 * where is the needle, may this button be pressed, is it worth asking Spotify
 * again — so it is kept pure and tested directly.
 */

/* -------------------------------------------------------------------------- */
/* URIs                                                                       */
/* -------------------------------------------------------------------------- */

/** `spotify:album:123` → `{ kind: 'album', id: '123' }`. */
export function parseUri(uri: string | null | undefined): { kind: string; id: string | null } {
  if (!uri) return { kind: 'other', id: null };
  const parts = uri.split(':');
  if (parts.length < 3 || parts[0] !== 'spotify') return { kind: 'other', id: null };
  // `spotify:user:x:playlist:y` is the old shape and still turns up.
  const kind = parts[parts.length - 2] ?? 'other';
  const id = parts[parts.length - 1] ?? null;
  return { kind, id: id || null };
}

export function contextFromUri(uri: string | null | undefined): PlayingContext | null {
  if (!uri) return null;
  const { kind, id } = parseUri(uri);
  const known = ['album', 'playlist', 'artist', 'show', 'collection'];
  return {
    kind: (known.includes(kind) ? kind : 'other') as PlayingContext['kind'],
    uri,
    id,
  };
}

/* -------------------------------------------------------------------------- */
/* Progress                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Where the needle is now, given a reading taken a moment ago.
 *
 * Counted forward locally so the display moves smoothly between authoritative
 * reads, and clamped to the duration so it can never run past the end of a
 * track and claim 3:42 of 3:30 while waiting for the next poll.
 */
export function progressAt(snapshot: PlaybackSnapshot | null, now: number): number {
  if (!snapshot) return 0;
  const elapsed = snapshot.playing ? Math.max(0, now - snapshot.at) : 0;
  const raw = snapshot.progressMs + elapsed;
  if (snapshot.durationMs > 0) return Math.min(snapshot.durationMs, Math.max(0, raw));
  return Math.max(0, raw);
}

/** 0..1 for the scrubber. Zero-length items sit at the start rather than NaN. */
export function progressFraction(snapshot: PlaybackSnapshot | null, now: number): number {
  if (!snapshot || snapshot.durationMs <= 0) return 0;
  return progressAt(snapshot, now) / snapshot.durationMs;
}

/* -------------------------------------------------------------------------- */
/* Polling                                                                    */
/* -------------------------------------------------------------------------- */

export interface PollConditions {
  playing: boolean;
  visible: boolean;
  online: boolean;
  preference: PollingChoice;
}

const CADENCE: Record<Exclude<PollingChoice, 'manual'>, { playing: number; paused: number }> = {
  responsive: { playing: 4_000, paused: 15_000 },
  relaxed: { playing: 10_000, paused: 45_000 },
};

/**
 * How long to wait before asking Spotify again, or null to stop asking.
 *
 * A tab nobody is looking at, a device with no network, and a listener who
 * asked for manual refresh all mean the same thing: stop spending their
 * request quota. Playing and visible is the only state that earns the fast
 * cadence.
 */
export function pollEvery(conditions: PollConditions): number | null {
  if (!conditions.online || !conditions.visible) return null;
  if (conditions.preference === 'manual') return null;
  const cadence = CADENCE[conditions.preference];
  return conditions.playing ? cadence.playing : cadence.paused;
}

/* -------------------------------------------------------------------------- */
/* Permissions on the current device                                          */
/* -------------------------------------------------------------------------- */

export type TransportAction =
  'pause' | 'resume' | 'seek' | 'next' | 'previous' | 'shuffle' | 'repeat' | 'transfer';

const REFUSALS: Record<TransportAction, keyof Disallows> = {
  pause: 'pausing',
  resume: 'resuming',
  seek: 'seeking',
  next: 'skippingNext',
  previous: 'skippingPrevious',
  shuffle: 'togglingShuffle',
  repeat: 'togglingRepeatContext',
  transfer: 'transferring',
};

/** Whether Spotify will accept this action for what is playing right now. */
export function allows(snapshot: PlaybackSnapshot | null, action: TransportAction): boolean {
  if (!snapshot) return false;
  return snapshot.disallows[REFUSALS[action]] !== true;
}

/** Why a control is disabled, in words a listener can act on. */
export function refusalReason(action: TransportAction): string {
  switch (action) {
    case 'next':
      return 'Nothing is queued after this.';
    case 'previous':
      return 'Nothing is queued before this.';
    case 'seek':
      return 'This cannot be scrubbed.';
    case 'shuffle':
      return 'Shuffle is not available here.';
    case 'repeat':
      return 'Repeat is not available here.';
    case 'transfer':
      return 'This device cannot hand playback over.';
    case 'pause':
      return 'This cannot be paused.';
    case 'resume':
      return 'This cannot be resumed.';
  }
}

/* -------------------------------------------------------------------------- */
/* Comparison and freshness                                                   */
/* -------------------------------------------------------------------------- */

/** Same thing playing? Compared by URI, because ids repeat across markets. */
export function sameItem(a: PlayingItem | null, b: PlayingItem | null): boolean {
  if (!a || !b) return a === b;
  if (a.uri && b.uri) return a.uri === b.uri;
  return a.name === b.name && a.durationMs === b.durationMs;
}

/**
 * A reading is only worth adopting if it is newer than the one on screen.
 *
 * Two overlapping polls can answer out of order, and the older answer would
 * otherwise jerk the needle backwards.
 */
export function isFresher(next: PlaybackSnapshot, current: PlaybackSnapshot | null): boolean {
  if (!current) return true;
  return next.at >= current.at;
}

const MINUTE = 60_000;

/** "just now", "2 minutes ago" — used when the state may be stale or offline. */
export function freshness(fetchedAt: number | null, now: number): string {
  if (!fetchedAt) return 'not checked yet';
  const age = Math.max(0, now - fetchedAt);
  if (age < 20_000) return 'just now';
  if (age < MINUTE) return 'less than a minute ago';
  const minutes = Math.round(age / MINUTE);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}
