import type { ContainmentGraph } from './graph';
import { completionId, type AlbumCompletion, type PlayEvent } from './listening';
import type { Entity, EntityId } from './types';

/**
 * When a record has been heard all the way through.
 *
 * Pure and incremental. Nothing here reads a clock, touches storage or knows
 * what a Svelte store is: hand it an edition's track list and the confirmed
 * plays of those tracks, and it says whether the set closed and which play
 * closed it.
 *
 * Three rules keep it honest:
 *
 *  1. **Completeness is knowledge, not inference.** If the app has not fetched
 *     the album's full track list, it says so instead of declaring a record
 *     finished from the four tracks it happens to hold.
 *  2. **A completion is localised in time.** Every track must have a confirmed
 *     play inside one rolling window, so a record cannot become "complete" from
 *     unrelated plays spread across seven years.
 *  3. **The last play closes it.** A completion is only ever emitted at the
 *     moment the play that supplied the final missing track is ingested — never
 *     on a later recount of the same evidence.
 */

const DAY = 86_400_000;

export const DEFAULT_COMPLETION_WINDOW_DAYS = 30;
export const DEFAULT_RECOMPLETION_COOLDOWN_DAYS = 90;

/** The longest pause that still reads as one sitting with a record. */
export const SITTING_GAP_MS = 30 * 60_000;

/* -------------------------------------------------------------------------- */
/* What the app knows about an edition                                        */
/* -------------------------------------------------------------------------- */

export type MembershipConfidence = 'complete' | 'incomplete' | 'empty';

export interface AlbumTrackSet {
  albumId: EntityId;
  /** Distinct, available, non-local track ids in track order. */
  trackIds: EntityId[];
  /** What the provider says the edition holds, when it has said. */
  declaredTotal: number | null;
  /** Links held locally, before anything was excluded. */
  knownTotal: number;
  /**
   * `complete` only when the local link count matches the declared total, so a
   * half-fetched record can never be declared finished.
   */
  confidence: MembershipConfidence;
  excluded: { unavailable: number; duplicate: number; nonTrack: number };
}

/**
 * The usable track list for one edition.
 *
 * Unavailable tracks are excluded because they can never produce a confirmed
 * play — requiring them would make the record permanently unfinishable. They
 * are counted so the interface can say what was left out. Spotify's local-file
 * items never reach the store at all: they carry no provider id, so ingestion
 * cannot name them and drops them. Discs need no special handling either, since
 * every disc's tracks are ordinary links.
 */
export function albumTrackSet(graph: ContainmentGraph, albumId: EntityId): AlbumTrackSet {
  const album = graph.entity(albumId);
  const edges = graph.children(albumId);
  const seen = new Set<EntityId>();
  const trackIds: EntityId[] = [];
  const excluded = { unavailable: 0, duplicate: 0, nonTrack: 0 };
  let knownTotal = 0;

  for (const edge of edges) {
    const child = graph.entity(edge.childId);
    if (!child) continue;
    if (child.type !== 'track') {
      excluded.nonTrack += 1;
      continue;
    }
    knownTotal += 1;
    if (seen.has(child.id)) {
      excluded.duplicate += 1;
      continue;
    }
    seen.add(child.id);
    if (child.available === false) {
      excluded.unavailable += 1;
      continue;
    }
    trackIds.push(child.id);
  }

  const declaredTotal = usableTotal(album);
  const confidence: MembershipConfidence =
    trackIds.length === 0
      ? 'empty'
      : declaredTotal !== null && knownTotal >= declaredTotal
        ? 'complete'
        : 'incomplete';

  return { albumId, trackIds, declaredTotal, knownTotal, confidence, excluded };
}

function usableTotal(album: Entity | undefined): number | null {
  const total = album?.totalChildren;
  return typeof total === 'number' && total > 0 ? total : null;
}

/* -------------------------------------------------------------------------- */
/* Re-completion                                                              */
/* -------------------------------------------------------------------------- */

/**
 * When a record may be recorded as completed a second time.
 *
 * - `off` — once per edition, ever. The completion is a milestone.
 * - `fresh` — every track heard again, entirely after the previous completion
 *   closed. A genuine second listen through, never the same evidence recounted.
 * - `cooldown` — `fresh`, and at least the cooldown apart, for someone who plays
 *   the same record weekly and does not want to be asked about it weekly.
 */
export type RecompletionMode = 'off' | 'fresh' | 'cooldown';

export const DEFAULT_RECOMPLETION: RecompletionMode = 'fresh';

/* -------------------------------------------------------------------------- */
/* Evaluation                                                                 */
/* -------------------------------------------------------------------------- */

export interface CompletionEvidence {
  /** One play per track, in track order. */
  playIds: string[];
  closingPlayId: string;
  startAt: number;
  endAt: number;
  sitting: boolean;
}

export interface EvaluateInput {
  tracks: AlbumTrackSet;
  /** Confirmed plays of this edition's tracks. Any order; sorted internally. */
  plays: readonly PlayEvent[];
  windowMs: number;
  /** Ids of plays that arrived in the ingest pass being evaluated. */
  newPlayIds: ReadonlySet<string>;
  /** Completions already recorded for this edition. Any order. */
  existing: readonly AlbumCompletion[];
  recompletion: RecompletionMode;
  cooldownMs?: number;
  now: number;
}

export type CompletionRefusal =
  | 'track-list-incomplete'
  | 'no-tracks'
  | 'not-complete'
  | 'not-newly-closed'
  | 'already-recorded'
  | 'recompletion-off'
  | 'within-cooldown';

export interface EvaluateResult {
  completion: AlbumCompletion | null;
  refusal: CompletionRefusal | null;
  /** Tracks with at least one play inside the closing window. */
  heard: number;
  required: number;
}

/**
 * Decide whether this ingest pass just finished the record.
 *
 * The search is a single ordered sweep with a sliding window: for each play in
 * turn, drop everything older than `windowMs` behind it and ask whether every
 * required track is still represented. The first play at which that becomes
 * true is the play that closed the set — which is exactly the play the interface
 * is allowed to celebrate, and only if it is one of the ones that just arrived.
 */
export function evaluateAlbumCompletion(input: EvaluateInput): EvaluateResult {
  const required = input.tracks.trackIds.length;
  const wanted = new Set(input.tracks.trackIds);

  if (input.tracks.confidence === 'empty' || required === 0) {
    return { completion: null, refusal: 'no-tracks', heard: 0, required };
  }
  if (input.tracks.confidence !== 'complete') {
    return {
      completion: null,
      refusal: 'track-list-incomplete',
      heard: countHeard(input.plays, wanted),
      required,
    };
  }

  const plays = [...input.plays]
    .filter((play) => !play.deleted && wanted.has(play.entityId))
    .sort((a, b) => (a.at === b.at ? compareIds(a.id, b.id) : a.at - b.at));

  const closings = findClosings(plays, wanted, input.windowMs);
  if (closings.length === 0) {
    return {
      completion: null,
      refusal: 'not-complete',
      heard: countHeard(plays, wanted),
      required,
    };
  }

  const live = input.existing.filter((c) => !c.deleted).sort((a, b) => a.endAt - b.endAt);
  const previous = live[live.length - 1];

  // Walk candidates oldest first and take the first that is genuinely new: a
  // later ingest can legitimately close a window that an earlier one could not.
  for (const closing of closings) {
    const evidence = buildEvidence(plays, closing, input.tracks.trackIds, input.windowMs);
    if (!evidence) continue;
    if (!input.newPlayIds.has(evidence.closingPlayId)) continue;
    if (live.some((c) => c.endAt === evidence.endAt)) continue;

    if (previous) {
      if (input.recompletion === 'off') {
        return { completion: null, refusal: 'recompletion-off', heard: required, required };
      }
      // A second completion must stand on a second listen: every play of the
      // evidence has to fall after the previous completion closed. Otherwise the
      // same plays would keep re-closing the set for the length of the window.
      if (evidence.startAt <= previous.endAt) continue;
      if (
        input.recompletion === 'cooldown' &&
        evidence.endAt - previous.endAt <
          (input.cooldownMs ?? DEFAULT_RECOMPLETION_COOLDOWN_DAYS * DAY)
      ) {
        return { completion: null, refusal: 'within-cooldown', heard: required, required };
      }
    }

    const completion: AlbumCompletion = {
      id: completionId(input.tracks.albumId, evidence.endAt),
      albumId: input.tracks.albumId,
      trackCount: required,
      startAt: evidence.startAt,
      endAt: evidence.endAt,
      playIds: evidence.playIds,
      closingPlayId: evidence.closingPlayId,
      sitting: evidence.sitting,
      ordinal: live.length + 1,
      windowMs: input.windowMs,
      prompt: 'open',
      createdAt: input.now,
      updatedAt: input.now,
    };
    return { completion, refusal: null, heard: required, required };
  }

  const closedBefore = closings.some((index) => {
    const play = plays[index];
    return !!play && !input.newPlayIds.has(play.id);
  });
  return {
    completion: null,
    refusal: closedBefore ? 'already-recorded' : 'not-newly-closed',
    heard: required,
    required,
  };
}

/**
 * Indexes of the plays at which the window first holds every required track.
 *
 * One is enough for the common case, but a batch that lands out of order — or a
 * device that syncs an older stretch of history — can close more than one
 * window at once, so every closing point is reported and the caller picks.
 */
function findClosings(
  plays: readonly PlayEvent[],
  wanted: ReadonlySet<EntityId>,
  windowMs: number,
): number[] {
  const counts = new Map<EntityId, number>();
  const out: number[] = [];
  let distinct = 0;
  let left = 0;
  let complete = false;

  for (let right = 0; right < plays.length; right += 1) {
    const play = plays[right];
    if (!play) continue;
    const before = counts.get(play.entityId) ?? 0;
    counts.set(play.entityId, before + 1);
    if (before === 0) distinct += 1;

    const floor = play.at - windowMs;
    while (left <= right) {
      const oldest = plays[left];
      if (!oldest || oldest.at >= floor) break;
      const held = counts.get(oldest.entityId) ?? 0;
      if (held <= 1) {
        counts.delete(oldest.entityId);
        distinct -= 1;
      } else {
        counts.set(oldest.entityId, held - 1);
      }
      left += 1;
    }

    const nowComplete = distinct >= wanted.size;
    if (nowComplete && !complete) out.push(right);
    complete = nowComplete;
  }

  return out;
}

/**
 * The evidence behind one closing play.
 *
 * For every track, the *latest* play inside the window is cited: it is the one
 * that was still standing when the set closed, and citing it keeps the recorded
 * span as tight and as truthful as the listening actually was.
 */
function buildEvidence(
  plays: readonly PlayEvent[],
  closingIndex: number,
  trackIds: readonly EntityId[],
  windowMs: number,
): CompletionEvidence | null {
  const closing = plays[closingIndex];
  if (!closing) return null;
  const floor = closing.at - windowMs;
  const latest = new Map<EntityId, PlayEvent>();

  for (let i = closingIndex; i >= 0; i -= 1) {
    const play = plays[i];
    if (!play || play.at < floor) break;
    if (!latest.has(play.entityId)) latest.set(play.entityId, play);
  }

  const cited: PlayEvent[] = [];
  for (const trackId of trackIds) {
    const play = latest.get(trackId);
    if (!play) return null;
    cited.push(play);
  }

  const ordered = [...cited].sort((a, b) => a.at - b.at);
  const first = ordered[0];
  if (!first) return null;

  return {
    playIds: cited.map((play) => play.id),
    closingPlayId: closing.id,
    startAt: first.at,
    endAt: closing.at,
    sitting: isSitting(ordered, albumContextOf(cited)),
  };
}

function albumContextOf(cited: readonly PlayEvent[]): EntityId | null {
  const contexts = new Set(
    cited.flatMap((play) =>
      play.contextType === 'album' && play.contextId ? [play.contextId] : [],
    ),
  );
  const only = [...contexts];
  return only.length === 1 ? (only[0] ?? null) : null;
}

/**
 * One sitting: back-to-back plays, and no evidence that they came from anywhere
 * but the record itself. A play with no stated context does not disqualify it —
 * Spotify simply does not always say — but a play from a different record does.
 */
function isSitting(ordered: readonly PlayEvent[], albumContext: EntityId | null): boolean {
  if (!albumContext) return false;
  for (const play of ordered) {
    if (play.contextId && play.contextId !== albumContext) return false;
  }
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1];
    const current = ordered[i];
    if (!previous || !current) return false;
    const gap = current.at - previous.at - (previous.durationMs ?? 0);
    if (gap > SITTING_GAP_MS) return false;
  }
  return true;
}

function countHeard(plays: readonly PlayEvent[], wanted: ReadonlySet<EntityId>): number {
  const seen = new Set<EntityId>();
  for (const play of plays) {
    if (!play.deleted && wanted.has(play.entityId)) seen.add(play.entityId);
  }
  return seen.size;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/* -------------------------------------------------------------------------- */
/* Reading a completion out loud                                              */
/* -------------------------------------------------------------------------- */

export function completionWindowMs(days: number): number {
  return Math.max(1, Math.round(days)) * DAY;
}

/** How the completion is described where it is shown. Plain, never triumphal. */
export function completionSpan(completion: AlbumCompletion): 'sitting' | 'day' | 'span' {
  if (completion.sitting) return 'sitting';
  return completion.endAt - completion.startAt < DAY ? 'day' : 'span';
}
