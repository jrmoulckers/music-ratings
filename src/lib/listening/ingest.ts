import {
  DEFAULT_COMPLETION_WINDOW_DAYS,
  DEFAULT_RECOMPLETION,
  albumTrackSet,
  completionWindowMs,
  evaluateAlbumCompletion,
  type RecompletionMode,
} from '../domain/completion';
import type { ContainmentGraph } from '../domain/graph';
import { entityId } from '../domain/ids';
import {
  PLAY_SCHEMA_VERSION,
  RECENTLY_PLAYED_WINDOW,
  emptyCoverage,
  foldCoverage,
  playId,
  type AlbumCompletion,
  type ListeningCoverage,
  type PlayContextType,
  type PlayEvent,
} from '../domain/listening';
import type { EntityId } from '../domain/types';
import type { PlayHistory } from '../spotify/client';
import { readMeta, writeMeta } from '../storage/db';
import {
  completionsForAlbum,
  insertPlays,
  playsForEntitiesBetween,
  prunePlaysBefore,
  saveCompletions,
} from '../storage/repo';

/**
 * Turning Spotify's recently-played window into a durable log.
 *
 * Everything below is downstream of one decision: the only evidence this app
 * accepts that a track was listened to is Spotify saying so. Progress bars,
 * "reached the last ten seconds", "was the current item for four minutes" — all
 * of it is inference, and none of it is written here.
 *
 * The endpoint returns the latest fifty plays and nothing else, so ingestion is
 * a repeated read of a sliding window rather than a download of a history. It
 * has to be safe to run constantly, from several devices, with overlapping
 * requests, and never count the same play twice. Deterministic ids do most of
 * that work; the serialised queue below does the rest.
 */

export const META_LISTENING_COVERAGE = 'listening-coverage';

export interface IngestOptions {
  /** Rows straight from `/me/player/recently-played`. */
  items: readonly PlayHistory[];
  graph: ContainmentGraph;
  now?: number;
  /** Rolling window all of a record's tracks must be heard within. */
  completionWindowDays?: number;
  recompletion?: RecompletionMode;
  recompletionCooldownDays?: number;
  /** Whether a completion may raise a prompt at all. */
  prompts?: boolean;
  /** Drop plays older than this many days. 0 keeps everything. */
  retentionDays?: number;
}

export interface IngestResult {
  received: number;
  inserted: number;
  duplicates: number;
  /** Plays dropped for want of a track id or a readable timestamp. */
  unusable: number;
  /** Stored plays tombstoned for falling past the retention floor. */
  pruned: number;
  /** The read came back full, so older plays may never have been seen. */
  windowSaturated: boolean;
  /** A stretch of listening fell out of the window before it was read. */
  gapSuspected: boolean;
  completions: AlbumCompletion[];
  coverage: ListeningCoverage;
}

/* -------------------------------------------------------------------------- */
/* Mapping                                                                    */
/* -------------------------------------------------------------------------- */

const CONTEXT_TYPES: Record<string, PlayContextType> = {
  album: 'album',
  playlist: 'playlist',
  artist: 'artist',
  show: 'show',
  collection: 'collection',
};

/**
 * Read the context Spotify attached to a play.
 *
 * Absent far more often than present, and that is fine: an unknown context is
 * recorded as unknown. It is only ever used to enrich — to mark a run of plays
 * as one sitting with a record — and never to decide whether a play happened.
 */
export function readContext(
  uri: string | undefined | null,
): { contextType: PlayContextType; contextId?: EntityId } | null {
  if (!uri) return null;
  const parts = uri.split(':');
  const kind = parts[1];
  if (!kind) return null;
  const mapped = CONTEXT_TYPES[kind];
  if (!mapped) return null;
  const id = parts[2];
  if (!id || mapped === 'collection') return { contextType: mapped };
  return { contextType: mapped, contextId: entityId(mapped, 'spotify', id) };
}

/**
 * Map one window of provider rows to play events.
 *
 * Pure, so the identity and dedupe rules can be tested without a database. A row
 * with no track id or an unreadable `played_at` is dropped rather than given a
 * synthesised identity — a play the app cannot name is a play it cannot
 * deduplicate, and a double-counted play is worse than a missing one.
 */
export function toPlayEvents(
  items: readonly PlayHistory[],
  now: number,
): { plays: PlayEvent[]; unusable: number } {
  const plays: PlayEvent[] = [];
  const seen = new Set<string>();
  let unusable = 0;

  for (const item of items) {
    const trackId = item.track?.id;
    const at = Date.parse(item.played_at ?? '');
    if (!trackId || !Number.isFinite(at)) {
      unusable += 1;
      continue;
    }
    const id = playId('spotify', trackId, at);
    if (seen.has(id)) continue;
    seen.add(id);

    const context = readContext(item.context?.uri);
    const play: PlayEvent = {
      id,
      entityId: entityId('track', 'spotify', trackId),
      entityType: 'track',
      at,
      ingestedAt: now,
      source: 'spotify-recently-played',
      v: PLAY_SCHEMA_VERSION,
      updatedAt: now,
    };
    if (context) {
      play.contextType = context.contextType;
      if (context.contextId) play.contextId = context.contextId;
    }
    const duration = item.track?.duration_ms;
    if (typeof duration === 'number' && duration > 0) play.durationMs = duration;
    plays.push(play);
  }

  return { plays, unusable };
}

/* -------------------------------------------------------------------------- */
/* Ingestion                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Overlapping refreshes are serialised rather than raced.
 *
 * Two refreshes can easily be in flight at once — a manual pull, a track change,
 * a returning tab — and if both evaluated completions against the same
 * half-written log, both could believe they were the one that closed the record.
 * Queueing is cheap and makes "the play that completed the album" a fact rather
 * than a coin toss.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

/**
 * Fold one recently-played window into the durable log.
 *
 * Order matters and is deliberate:
 *
 *  1. map and write the new plays, in one transaction;
 *  2. record what this read implies about coverage, including any gap;
 *  3. evaluate completions **only for the records the new plays touched**.
 *
 * Step three is what keeps this cheap. A refresh brings at most fifty plays, so
 * at most a few dozen albums can possibly have changed state, and each is
 * checked with one indexed range query per track. Nothing walks the whole log.
 */
export function ingestPlayHistory(options: IngestOptions): Promise<IngestResult> {
  return serialize(() => run(options));
}

async function run(options: IngestOptions): Promise<IngestResult> {
  const now = options.now ?? Date.now();
  const { plays, unusable } = toPlayEvents(options.items, now);
  const retained = retain(plays, now, options.retentionDays ?? 0);

  const received = options.items.length;
  const times = retained.map((play) => play.at);
  const oldestAt = times.length > 0 ? Math.min(...times) : null;
  const newestAt = times.length > 0 ? Math.max(...times) : null;

  const before = await readCoverage();
  const inserted = await insertPlays(retained);

  // Retention is a ceiling on the stored log too, not only on what arrives, or
  // the setting would quietly mean something narrower than it says.
  const retentionDays = options.retentionDays ?? 0;
  const pruned = retentionDays > 0 ? await prunePlaysBefore(now - retentionDays * 86_400_000) : 0;

  const coverage = foldCoverage(before, {
    at: now,
    received,
    inserted: inserted.length,
    oldestAt,
    newestAt,
  });
  await writeMeta(META_LISTENING_COVERAGE, coverage);

  const gapSuspected = coverage.gaps.length > before.gaps.length;
  const windowSaturated = received >= RECENTLY_PLAYED_WINDOW;

  const completions =
    inserted.length === 0 ? [] : await evaluateTouchedAlbums(inserted, options, now);

  return {
    received,
    inserted: inserted.length,
    duplicates: retained.length - inserted.length,
    unusable,
    pruned,
    windowSaturated,
    gapSuspected,
    completions,
    coverage,
  };
}

/** Retention is a ceiling on what is kept, applied before anything is written. */
function retain(plays: readonly PlayEvent[], now: number, retentionDays: number): PlayEvent[] {
  if (retentionDays <= 0) return [...plays];
  const floor = now - retentionDays * 86_400_000;
  return plays.filter((play) => play.at >= floor);
}

/**
 * Check exactly the records the new plays could have finished.
 *
 * A play can only complete the album it belongs to, so the candidate set is the
 * releases those tracks sit on — usually one or two, never the whole library.
 */
async function evaluateTouchedAlbums(
  inserted: readonly PlayEvent[],
  options: IngestOptions,
  now: number,
): Promise<AlbumCompletion[]> {
  if (options.prompts === false) return [];

  const graph = options.graph;
  const albums = new Set<EntityId>();
  for (const play of inserted) {
    for (const edge of graph.parents(play.entityId)) {
      if (edge.parentType === 'album') albums.add(edge.parentId);
    }
  }
  if (albums.size === 0) return [];

  // A missing or unusable window falls back to the default rather than becoming
  // NaN and poisoning every key range built from it.
  const days = Number(options.completionWindowDays);
  const windowMs = completionWindowMs(
    Number.isFinite(days) && days > 0 ? days : DEFAULT_COMPLETION_WINDOW_DAYS,
  );
  const newPlayIds = new Set(inserted.map((play) => play.id));
  const found: AlbumCompletion[] = [];

  for (const albumId of albums) {
    const tracks = albumTrackSet(graph, albumId);
    if (tracks.confidence !== 'complete') continue;

    // Only the stretch that could possibly close now is read, never the album's
    // whole listening history.
    const from = now - windowMs * 2;
    const plays = await playsForEntitiesBetween(tracks.trackIds, from, now);
    if (plays.length < tracks.trackIds.length) continue;

    const existing = await completionsForAlbum(albumId);
    const result = evaluateAlbumCompletion({
      tracks,
      plays,
      windowMs,
      newPlayIds,
      existing,
      recompletion: options.recompletion ?? DEFAULT_RECOMPLETION,
      ...(options.recompletionCooldownDays !== undefined
        ? { cooldownMs: options.recompletionCooldownDays * 86_400_000 }
        : {}),
      now,
    });
    if (result.completion) found.push(result.completion);
  }

  await saveCompletions(found);
  return found;
}

/* -------------------------------------------------------------------------- */
/* Coverage                                                                   */
/* -------------------------------------------------------------------------- */

export async function readCoverage(): Promise<ListeningCoverage> {
  const stored = await readMeta<ListeningCoverage>(META_LISTENING_COVERAGE);
  return stored ? { ...emptyCoverage(), ...stored } : emptyCoverage();
}

export async function resetCoverage(): Promise<void> {
  await writeMeta(META_LISTENING_COVERAGE, emptyCoverage());
}
