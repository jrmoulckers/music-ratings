import type { ContainmentGraph } from './graph';
import type { AlbumCompletion, PlayEvent } from './listening';
import type { ExplicitRating } from './ratings';
import type { Entity, EntityId } from './types';

/**
 * A compact, sorted index over the play log.
 *
 * A hundred thousand plays is an ordinary amount of history for someone who has
 * had this running for a year, and holding that many objects and re-filtering
 * them on every render is how a page starts dropping frames. So the log is
 * dictionary-coded into parallel typed arrays once per change and every
 * aggregate is one linear sweep over a binary-searched slice of it.
 *
 * The index is derived state and holds no opinions: it never decides what
 * counts as a play, only how quickly the counted ones can be added up.
 */
export class PlayIndex {
  /** Play instants, ascending. */
  readonly at: Float64Array;
  /** Dictionary code of the played entity, parallel to `at`. */
  readonly track: Int32Array;
  /** Dictionary code of the context entity, or -1. */
  readonly context: Int32Array;
  /** Track length in ms at ingest, or 0 when unknown. */
  readonly duration: Int32Array;

  /** Dictionary: code → canonical entity id. */
  readonly ids: string[];
  private readonly codes = new Map<string, number>();

  /** All-time play count per code. */
  readonly countByCode: Int32Array;
  /** First and last observed play per code, or 0. */
  readonly firstByCode: Float64Array;
  readonly lastByCode: Float64Array;

  constructor(plays: readonly PlayEvent[]) {
    const live = plays.filter((play) => !play.deleted);
    live.sort((a, b) => (a.at === b.at ? (a.id < b.id ? -1 : 1) : a.at - b.at));

    const n = live.length;
    this.at = new Float64Array(n);
    this.track = new Int32Array(n);
    this.context = new Int32Array(n);
    this.duration = new Int32Array(n);
    this.ids = [];

    for (let i = 0; i < n; i += 1) {
      const play = live[i];
      if (!play) continue;
      this.at[i] = play.at;
      this.track[i] = this.code(play.entityId);
      this.context[i] = play.contextId === undefined ? -1 : this.code(play.contextId);
      this.duration[i] = play.durationMs && play.durationMs > 0 ? Math.round(play.durationMs) : 0;
    }

    const width = this.ids.length;
    this.countByCode = new Int32Array(width);
    this.firstByCode = new Float64Array(width);
    this.lastByCode = new Float64Array(width);
    for (let i = 0; i < n; i += 1) {
      const code = this.track[i] ?? 0;
      const when = this.at[i] ?? 0;
      this.countByCode[code] = (this.countByCode[code] ?? 0) + 1;
      if ((this.firstByCode[code] ?? 0) === 0) this.firstByCode[code] = when;
      this.lastByCode[code] = when;
    }
  }

  private code(id: string): number {
    const held = this.codes.get(id);
    if (held !== undefined) return held;
    const next = this.ids.length;
    this.ids.push(id);
    this.codes.set(id, next);
    return next;
  }

  codeOf(id: string): number {
    return this.codes.get(id) ?? -1;
  }

  get length(): number {
    return this.at.length;
  }

  /** Epoch ms of the earliest play held, or null. */
  get earliestAt(): number | null {
    return this.at.length > 0 ? (this.at[0] ?? null) : null;
  }

  get latestAt(): number | null {
    return this.at.length > 0 ? (this.at[this.at.length - 1] ?? null) : null;
  }

  /** First index whose play is at or after `from`. */
  lowerBound(from: number): number {
    let lo = 0;
    let hi = this.at.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((this.at[mid] ?? 0) < from) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** All-time plays of one entity, without a sweep. */
  playsOf(id: string): number {
    const code = this.codeOf(id);
    return code < 0 ? 0 : (this.countByCode[code] ?? 0);
  }

  lastPlayOf(id: string): number | null {
    const code = this.codeOf(id);
    if (code < 0) return null;
    const at = this.lastByCode[code] ?? 0;
    return at > 0 ? at : null;
  }

  firstPlayOf(id: string): number | null {
    const code = this.codeOf(id);
    if (code < 0) return null;
    const at = this.firstByCode[code] ?? 0;
    return at > 0 ? at : null;
  }
}

export const EMPTY_PLAY_INDEX = new PlayIndex([]);

/* -------------------------------------------------------------------------- */
/* Time filters                                                               */
/* -------------------------------------------------------------------------- */

const DAY = 86_400_000;

export const LISTENING_RANGES = ['sitting', '7d', '30d', '6m', 'all'] as const;
export type ListeningRange = (typeof LISTENING_RANGES)[number];

export const RANGE_LABEL: Record<ListeningRange, string> = {
  sitting: 'This sitting',
  '7d': '7 days',
  '30d': '30 days',
  '6m': '6 months',
  all: 'All observed',
};

/** The longest pause that still counts as the same sitting. */
export const SITTING_IDLE_MS = 45 * 60_000;

/**
 * Where a range starts.
 *
 * "This sitting" is the only one that is not a fixed offset: it walks back from
 * the newest play while the gaps stay short, so a sitting is however long you
 * actually sat there rather than an arbitrary hour.
 */
export function rangeStart(index: PlayIndex, range: ListeningRange, now: number): number {
  switch (range) {
    case '7d':
      return now - 7 * DAY;
    case '30d':
      return now - 30 * DAY;
    case '6m':
      return now - 182 * DAY;
    case 'all':
      return 0;
    case 'sitting':
      return sittingStart(index);
  }
}

function sittingStart(index: PlayIndex): number {
  const n = index.length;
  if (n === 0) return Number.MAX_SAFE_INTEGER;
  let start = index.at[n - 1] ?? 0;
  for (let i = n - 1; i > 0; i -= 1) {
    const current = index.at[i] ?? 0;
    const previous = index.at[i - 1] ?? 0;
    if (current - previous > SITTING_IDLE_MS) break;
    start = previous;
  }
  return start;
}

/* -------------------------------------------------------------------------- */
/* The catalogue view the statistics need                                     */
/* -------------------------------------------------------------------------- */

export interface Catalogue {
  entity(id: EntityId): Entity | undefined;
  /** The release a track belongs to, or null. */
  releaseOf(id: EntityId): EntityId | null;
  /** Credited artists of a track, in credit order. */
  artistsOf(id: EntityId): EntityId[];
  /** Track ids of a release, available ones only. */
  tracksOf(id: EntityId): EntityId[];
  /** Releases and tracks credited to an artist. */
  worksOf(id: EntityId): { releases: EntityId[]; tracks: EntityId[] };
}

/**
 * A catalogue view over the containment graph.
 *
 * Built once per world change and cached, because `parents()` and `children()`
 * are cheap but calling them for every play in a hundred-thousand-play sweep is
 * not.
 */
export function catalogueFrom(graph: ContainmentGraph): Catalogue {
  const release = new Map<EntityId, EntityId | null>();
  const artists = new Map<EntityId, EntityId[]>();
  const tracks = new Map<EntityId, EntityId[]>();
  const works = new Map<EntityId, { releases: EntityId[]; tracks: EntityId[] }>();

  return {
    entity: (id) => graph.entity(id),
    releaseOf(id) {
      const held = release.get(id);
      if (held !== undefined) return held;
      const entity = graph.entity(id);
      const named = entity?.parentIds?.find((parent) => graph.entity(parent)?.type === 'album');
      const found =
        named ?? graph.parents(id).find((edge) => edge.parentType === 'album')?.parentId ?? null;
      release.set(id, found);
      return found;
    },
    artistsOf(id) {
      const held = artists.get(id);
      if (held) return held;
      const entity = graph.entity(id);
      const named = (entity?.artistIds ?? []).filter((a) => graph.has(a));
      const found =
        named.length > 0
          ? named
          : graph
              .parents(id)
              .filter((edge) => edge.parentType === 'artist')
              .map((edge) => edge.parentId);
      artists.set(id, found);
      return found;
    },
    tracksOf(id) {
      const held = tracks.get(id);
      if (held) return held;
      const found = graph
        .children(id)
        .filter((edge) => edge.childType === 'track')
        .map((edge) => edge.childId)
        .filter((child) => graph.entity(child)?.available !== false);
      tracks.set(id, found);
      return found;
    },
    worksOf(id) {
      const held = works.get(id);
      if (held) return held;
      const children = graph.children(id);
      const found = {
        releases: children.filter((e) => e.childType === 'album').map((e) => e.childId),
        tracks: children.filter((e) => e.childType === 'track').map((e) => e.childId),
      };
      works.set(id, found);
      return found;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Statistics                                                                 */
/* -------------------------------------------------------------------------- */

export interface RankedItem {
  entityId: EntityId;
  name: string;
  /** Plays observed in the range. */
  plays: number;
  /** Estimated ms, from track lengths. Never a measurement. */
  estimatedMs: number;
  /** Share of observed plays in the range, 0..1. */
  playShare: number;
  /** Share of estimated listening time in the range, 0..1. */
  timeShare: number;
  /** Newest observed play in the range. */
  lastAt: number;
}

export interface Breadth {
  /** Distinct items heard. */
  heard: number;
  /** Items the app knows about locally. */
  known: number;
  ratio: number;
}

export interface RatingTension {
  entityId: EntityId;
  name: string;
  plays: number;
  normalized: number;
}

export interface ListeningStats {
  range: ListeningRange;
  from: number;
  to: number;
  /** Plays observed inside the range. */
  plays: number;
  uniqueTracks: number;
  uniqueReleases: number;
  uniqueArtists: number;
  /** Sum of known track lengths across observed plays. */
  estimatedMs: number;
  /** Plays whose track length was not known, so time is an undercount. */
  playsWithoutDuration: number;

  topTracks: RankedItem[];
  topReleases: RankedItem[];
  /** By the track's first credited artist, so the shares sum to one. */
  topArtists: RankedItem[];
  /** By any credit, which double counts on purpose. Breadth, not share. */
  artistCredits: { entityId: EntityId; name: string; plays: number }[];

  /** Plays of something already heard earlier in the range. */
  repeatPlays: number;
  /** Tracks whose first observed play anywhere falls inside the range. */
  newToObservation: RankedItem[];
  /** Heard in the range, and not for a long time before it. */
  resurfaced: RankedItem[];

  completions: AlbumCompletion[];
  /** Releases with at least one play in the range but no completion in it. */
  startedNotCompleted: number;
  /** Median span of the completions in the range, ms. */
  medianCompletionSpanMs: number | null;
  /** Longest run of consecutive days with a completion. */
  completionStreakDays: number;

  /** Mean direct rating of the distinct tracks heard, 0..100. */
  meanRatingOfHeard: number | null;
  /** Distinct tracks heard that carry a direct rating. */
  ratedHeard: number;
  lovedButNeglected: RatingTension[];
  playedButUnrated: RankedItem[];
  highPlayLowRating: RatingTension[];
}

export interface StatsInput {
  index: PlayIndex;
  catalogue: Catalogue;
  explicit: ReadonlyMap<EntityId, ExplicitRating>;
  completions: readonly AlbumCompletion[];
  range: ListeningRange;
  now: number;
  /** How many rows each top list returns. */
  limit?: number;
}

interface Bucket {
  plays: number;
  estimatedMs: number;
  lastAt: number;
  firstAt: number;
}

function bucket(map: Map<EntityId, Bucket>, id: EntityId, at: number, ms: number): void {
  const held = map.get(id);
  if (held) {
    held.plays += 1;
    held.estimatedMs += ms;
    if (at > held.lastAt) held.lastAt = at;
    if (at < held.firstAt) held.firstAt = at;
    return;
  }
  map.set(id, { plays: 1, estimatedMs: ms, lastAt: at, firstAt: at });
}

/**
 * Everything the Listening surface shows, in one sweep.
 *
 * Deterministic: identical inputs give identical output, no clock is read
 * beyond the `now` handed in, and every number is a count or a ratio over the
 * rows above. Nothing is modelled, predicted, or compared against other people
 * — the provider exposes no such data and the app does not invent it.
 */
export function computeListeningStats(input: StatsInput): ListeningStats {
  const { index, catalogue } = input;
  const limit = input.limit ?? 8;
  const from = rangeStart(index, input.range, input.now);
  const to = input.now;
  const start = index.lowerBound(from);
  const end = index.length;

  const tracks = new Map<EntityId, Bucket>();
  const releases = new Map<EntityId, Bucket>();
  const primaryArtists = new Map<EntityId, Bucket>();
  const creditedArtists = new Map<EntityId, number>();
  const seen = new Set<EntityId>();

  let plays = 0;
  let estimatedMs = 0;
  let playsWithoutDuration = 0;
  let repeatPlays = 0;

  for (let i = start; i < end; i += 1) {
    const at = index.at[i] ?? 0;
    if (at > to) continue;
    const code = index.track[i] ?? 0;
    const id = index.ids[code];
    if (id === undefined) continue;
    const ms = index.duration[i] ?? 0;

    plays += 1;
    estimatedMs += ms;
    if (ms === 0) playsWithoutDuration += 1;
    if (seen.has(id)) repeatPlays += 1;
    else seen.add(id);

    bucket(tracks, id, at, ms);

    const release = catalogue.releaseOf(id);
    if (release) bucket(releases, release, at, ms);

    const credits = catalogue.artistsOf(id);
    const primary = credits[0];
    if (primary) bucket(primaryArtists, primary, at, ms);
    for (const artist of credits) {
      creditedArtists.set(artist, (creditedArtists.get(artist) ?? 0) + 1);
    }
  }

  const name = (id: EntityId) => catalogue.entity(id)?.name ?? id;
  const rank = (map: Map<EntityId, Bucket>) =>
    [...map.entries()]
      .map(([entityId, b]) => ({
        entityId,
        name: name(entityId),
        plays: b.plays,
        estimatedMs: b.estimatedMs,
        playShare: plays > 0 ? b.plays / plays : 0,
        timeShare: estimatedMs > 0 ? b.estimatedMs / estimatedMs : 0,
        lastAt: b.lastAt,
      }))
      .sort(
        (a, b) =>
          b.plays - a.plays ||
          b.estimatedMs - a.estimatedMs ||
          (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0),
      );

  const rankedTracks = rank(tracks);
  const rankedReleases = rank(releases);
  const rankedArtists = rank(primaryArtists);

  /* --- discovery and resurfacing ---------------------------------------- */

  const newToObservation = rankedTracks.filter((row) => {
    const first = index.firstPlayOf(row.entityId);
    return first !== null && first >= from;
  });

  const resurfaced = rankedTracks.filter((row) => {
    const first = index.firstPlayOf(row.entityId);
    if (first === null || first >= from) return false;
    const bucketed = tracks.get(row.entityId);
    if (!bucketed) return false;
    return bucketed.firstAt - first >= 90 * DAY;
  });

  /* --- completions ------------------------------------------------------- */

  const completions = input.completions
    .filter((c) => !c.deleted && c.endAt >= from && c.endAt <= to)
    .sort((a, b) => b.endAt - a.endAt);
  const completedIn = new Set(completions.map((c) => c.albumId));
  const startedNotCompleted = [...releases.keys()].filter((id) => !completedIn.has(id)).length;

  const spans = completions.map((c) => c.endAt - c.startAt).sort((a, b) => a - b);
  const medianCompletionSpanMs =
    spans.length === 0
      ? null
      : spans.length % 2 === 1
        ? (spans[(spans.length - 1) / 2] ?? null)
        : Math.round(((spans[spans.length / 2 - 1] ?? 0) + (spans[spans.length / 2] ?? 0)) / 2);

  /* --- rating overlays --------------------------------------------------- */

  let ratedHeard = 0;
  let ratingTotal = 0;
  const highPlayLowRating: RatingTension[] = [];
  const playedButUnrated: RankedItem[] = [];

  for (const row of rankedTracks) {
    const rating = input.explicit.get(row.entityId);
    if (!rating) {
      playedButUnrated.push(row);
      continue;
    }
    ratedHeard += 1;
    ratingTotal += rating.normalized;
    if (row.plays >= 3 && rating.normalized <= 40) {
      highPlayLowRating.push({
        entityId: row.entityId,
        name: row.name,
        plays: row.plays,
        normalized: rating.normalized,
      });
    }
  }

  const lovedButNeglected: RatingTension[] = [];
  for (const [entityId, rating] of input.explicit) {
    if (rating.normalized < 75) continue;
    if (tracks.has(entityId) || releases.has(entityId)) continue;
    const last = index.lastPlayOf(entityId);
    if (last !== null && last >= from) continue;
    const entity = catalogue.entity(entityId);
    if (!entity || (entity.type !== 'track' && entity.type !== 'album')) continue;
    lovedButNeglected.push({
      entityId,
      name: entity.name,
      plays: index.playsOf(entityId),
      normalized: rating.normalized,
    });
  }
  lovedButNeglected.sort(
    (a, b) =>
      b.normalized - a.normalized ||
      a.plays - b.plays ||
      (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0),
  );

  return {
    range: input.range,
    from: plays > 0 ? Math.max(from, index.earliestAt ?? from) : from,
    to,
    plays,
    uniqueTracks: tracks.size,
    uniqueReleases: releases.size,
    uniqueArtists: primaryArtists.size,
    estimatedMs,
    playsWithoutDuration,
    topTracks: rankedTracks.slice(0, limit),
    topReleases: rankedReleases.slice(0, limit),
    topArtists: rankedArtists.slice(0, limit),
    artistCredits: [...creditedArtists.entries()]
      .map(([entityId, count]) => ({ entityId, name: name(entityId), plays: count }))
      .sort(
        (a, b) =>
          b.plays - a.plays || (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0),
      )
      .slice(0, limit),
    repeatPlays,
    newToObservation: newToObservation.slice(0, limit),
    resurfaced: resurfaced.slice(0, limit),
    completions,
    startedNotCompleted,
    medianCompletionSpanMs,
    completionStreakDays: streak(completions),
    meanRatingOfHeard: ratedHeard > 0 ? ratingTotal / ratedHeard : null,
    ratedHeard,
    lovedButNeglected: lovedButNeglected.slice(0, limit),
    playedButUnrated: playedButUnrated.slice(0, limit),
    highPlayLowRating: highPlayLowRating
      .sort((a, b) => b.plays - a.plays || a.normalized - b.normalized)
      .slice(0, limit),
  };
}

/** Longest run of consecutive local days that each closed a record. */
function streak(completions: readonly AlbumCompletion[]): number {
  if (completions.length === 0) return 0;
  const days = [
    ...new Set(
      completions.map((c) => {
        const d = new Date(c.endAt);
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      }),
    ),
  ].sort((a, b) => a - b);
  let best = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    const gap = (days[i] ?? 0) - (days[i - 1] ?? 0);
    run = gap === DAY ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Per-entity detail                                                          */
/* -------------------------------------------------------------------------- */

export interface AlbumListening {
  albumId: EntityId;
  plays: number;
  /** Tracks with at least one confirmed play, against those known locally. */
  breadth: Breadth;
  lastAt: number | null;
  firstAt: number | null;
  completions: number;
  lastCompletionAt: number | null;
}

/**
 * One release's observed listening, without a sweep.
 *
 * Reads the per-entity totals the index already carries, so an album page costs
 * one lookup per track rather than a pass over the whole log.
 */
export function albumListening(
  index: PlayIndex,
  catalogue: Catalogue,
  albumId: EntityId,
  completions: readonly AlbumCompletion[],
): AlbumListening {
  const tracks = catalogue.tracksOf(albumId);
  let plays = 0;
  let heard = 0;
  let lastAt = 0;
  let firstAt = Number.MAX_SAFE_INTEGER;

  for (const track of tracks) {
    const count = index.playsOf(track);
    if (count === 0) continue;
    heard += 1;
    plays += count;
    lastAt = Math.max(lastAt, index.lastPlayOf(track) ?? 0);
    firstAt = Math.min(firstAt, index.firstPlayOf(track) ?? Number.MAX_SAFE_INTEGER);
  }

  const mine = completions.filter((c) => !c.deleted && c.albumId === albumId);
  return {
    albumId,
    plays,
    breadth: { heard, known: tracks.length, ratio: tracks.length > 0 ? heard / tracks.length : 0 },
    lastAt: lastAt > 0 ? lastAt : null,
    firstAt: firstAt < Number.MAX_SAFE_INTEGER ? firstAt : null,
    completions: mine.length,
    lastCompletionAt: mine.length > 0 ? Math.max(...mine.map((c) => c.endAt)) : null,
  };
}

export interface ArtistListening {
  artistId: EntityId;
  plays: number;
  trackBreadth: Breadth;
  releaseBreadth: Breadth;
  lastAt: number | null;
  completions: number;
}

export function artistListening(
  index: PlayIndex,
  catalogue: Catalogue,
  artistId: EntityId,
  completions: readonly AlbumCompletion[],
): ArtistListening {
  const { releases, tracks } = catalogue.worksOf(artistId);
  let plays = 0;
  let heardTracks = 0;
  let lastAt = 0;

  const knownTracks = new Set(tracks);
  for (const release of releases) for (const t of catalogue.tracksOf(release)) knownTracks.add(t);

  for (const track of knownTracks) {
    const count = index.playsOf(track);
    if (count === 0) continue;
    heardTracks += 1;
    plays += count;
    lastAt = Math.max(lastAt, index.lastPlayOf(track) ?? 0);
  }

  let heardReleases = 0;
  for (const release of releases) {
    if (catalogue.tracksOf(release).some((t) => index.playsOf(t) > 0)) heardReleases += 1;
  }

  const releaseSet = new Set(releases);
  const mine = completions.filter((c) => !c.deleted && releaseSet.has(c.albumId));

  return {
    artistId,
    plays,
    trackBreadth: {
      heard: heardTracks,
      known: knownTracks.size,
      ratio: knownTracks.size > 0 ? heardTracks / knownTracks.size : 0,
    },
    releaseBreadth: {
      heard: heardReleases,
      known: releases.length,
      ratio: releases.length > 0 ? heardReleases / releases.length : 0,
    },
    lastAt: lastAt > 0 ? lastAt : null,
    completions: mine.length,
  };
}
