/**
 * Domain types.
 *
 * This module is deliberately framework-independent: no Svelte, no DOM, no
 * storage. Everything in `src/lib/domain` is a pure, fully typed description of
 * the product's rules so it can be reasoned about and tested on its own.
 */

/* -------------------------------------------------------------------------- */
/* Identity                                                                   */
/* -------------------------------------------------------------------------- */

/** Canonical entity key: `${type}:${provider}:${providerId}`. */
export type EntityId = string;

export const ENTITY_TYPES = [
  'artist',
  'album',
  'track',
  'playlist',
  'show',
  'episode',
  'audiobook',
  'chapter',
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export type Provider = 'spotify' | 'local';

export interface EntityRef {
  readonly type: EntityType;
  readonly id: EntityId;
}

/**
 * Containment. A child type may appear under several parent types; the graph
 * layer resolves which path a child is *counted* through so nothing is counted
 * twice.
 */
export const CONTAINMENT: Readonly<Record<EntityType, readonly EntityType[]>> = {
  artist: ['album', 'track'],
  album: ['track'],
  playlist: ['track'],
  show: ['episode'],
  audiobook: ['chapter'],
  track: [],
  episode: [],
  chapter: [],
};

/** Types that can hold an explicit rating *and* a rollup from children. */
export const PARENT_TYPES = ['artist', 'album', 'playlist', 'show', 'audiobook'] as const;
export type ParentType = (typeof PARENT_TYPES)[number];

export function isParentType(t: EntityType): t is ParentType {
  return (PARENT_TYPES as readonly EntityType[]).includes(t);
}

/* -------------------------------------------------------------------------- */
/* Entities                                                                   */
/* -------------------------------------------------------------------------- */

export type AlbumKind = 'album' | 'single' | 'compilation';

/** Where a record in the local store came from. Shown as data provenance. */
export interface Provenance {
  /** Which catalogue this record describes. */
  provider: Provider;
  /** Which app feature first introduced it, e.g. `search`, `top-tracks`. */
  via: string;
  /** Epoch ms of the last successful catalogue refresh. */
  fetchedAt: number;
}

export interface Entity {
  id: EntityId;
  type: EntityType;
  provider: Provider;
  providerId: string;

  name: string;
  /** Artist names for a release/track, publisher for a show, owner for a playlist. */
  subtitle?: string;
  /** Provider blurb for playlists, shows and audiobooks. Plain text, never markup. */
  description?: string;

  /** Canonical ids of the credited artists, in credit order. */
  artistIds?: EntityId[];
  /** Canonical ids of direct structural parents (album for a track, show for an episode). */
  parentIds?: EntityId[];

  artworkUrl?: string;
  /** Small artwork for dense rows; falls back to `artworkUrl`. */
  artworkThumbUrl?: string;

  releaseDate?: string;
  durationMs?: number;
  trackNumber?: number;
  discNumber?: number;
  albumKind?: AlbumKind;
  totalChildren?: number;
  variousArtists?: boolean;
  explicitContent?: boolean;

  externalUrl?: string;
  /** False when the item is unavailable in the user's market or was removed. */
  available?: boolean;

  /** Epoch ms the item was saved to the user's Spotify library, if known. */
  savedAt?: number;

  provenance: Provenance;

  createdAt: number;
  updatedAt: number;
  /** Tombstone: epoch ms of deletion. Live queries filter these out. */
  deleted?: number;
}

/**
 * A containment edge. Stored separately from entities so a track can belong to
 * an album and any number of playlists without duplication.
 */
export interface Membership {
  id: string;
  parentId: EntityId;
  childId: EntityId;
  parentType: EntityType;
  childType: EntityType;
  /** Track number within an album, or index within a playlist. */
  position?: number;
  /**
   * Credit share in 0..1 for multi-artist attribution. A track credited to two
   * artists contributes 0.5 to each unless the provider says otherwise.
   */
  share?: number;
  addedAt?: number;
  updatedAt: number;
  deleted?: number;
}

/* -------------------------------------------------------------------------- */
/* Rating scales                                                              */
/* -------------------------------------------------------------------------- */

export type ScaleKind = 'stars' | 'half-stars' | 'integer' | 'decimal' | 'thumbs' | 'ordinal';

export interface RatingScale {
  id: string;
  kind: ScaleKind;
  /** Shown in settings and on the rail legend. */
  label: string;
  min: number;
  max: number;
  /** Distance between adjacent detents in raw units. */
  step: number;
  /**
   * Labels for ordinal / thumbs scales, lowest first. Length must equal the
   * number of detents.
   */
  labels?: string[];
  /** Short marks printed in the margin, e.g. tier letters. Same order as `labels`. */
  marks?: string[];
  /**
   * Where each detent sits on the canonical 0..100 axis, lowest first. Same
   * length as the detent list.
   *
   * Only needed when a scale's positions do not mean "this fraction of the
   * maximum" — a thumbs-up is not a 100, and a C is not 40% of a masterpiece.
   * Numeric scales leave this off and are projected by fraction-of-max, which
   * is what makes 4/5, 8/10 and 80/100 the same judgement.
   */
  anchors?: readonly number[];
  builtin: boolean;
  createdAt?: number;
  updatedAt?: number;
  deleted?: number;
}

/* -------------------------------------------------------------------------- */
/* Ratings                                                                    */
/* -------------------------------------------------------------------------- */

export type RatingConfidence = 'low' | 'medium' | 'high';

export type RatingContext = 'queue' | 'detail' | 'duel' | 'import' | 'bulk';

/**
 * A rating is an event, not a field. The current explicit rating for an entity
 * is the newest live event; every earlier one is kept for the timeline.
 */
export interface RatingEvent {
  id: string;
  entityId: EntityId;
  entityType: EntityType;
  /** Epoch ms the judgement was made. */
  at: number;
  /** The value as entered, in the units of `scaleId`. */
  value: number;
  scaleId: string;
  /** Canonical 0..100 projection. This is what every computation reads. */
  normalized: number;
  confidence: RatingConfidence;
  note?: string;
  tags?: string[];
  context?: RatingContext;
  /** Epoch ms this event was retracted (undo). Retracted events never count. */
  retracted?: number;
  /** Epoch ms this event was corrected in place. Shown in the timeline. */
  edited?: number;
  updatedAt: number;
  deleted?: number;
}

/* -------------------------------------------------------------------------- */
/* Comparisons                                                                */
/* -------------------------------------------------------------------------- */

export type ComparisonOutcome = 'a' | 'b' | 'tie' | 'skip' | 'unfamiliar';

export interface Comparison {
  id: string;
  entityType: EntityType;
  aId: EntityId;
  bId: EntityId;
  outcome: ComparisonOutcome;
  at: number;
  /** Why this pair was put in front of the user. Shown in comparison history. */
  reason?: string;
  updatedAt: number;
  deleted?: number;
}

/** Derived, never stored: replayed from the comparison log on demand. */
export interface RankingState {
  entityId: EntityId;
  entityType: EntityType;
  /** Elo rating. Seeded at `ELO_SEED`. */
  rating: number;
  /** Number of decisive comparisons (ties count, skips and unfamiliar do not). */
  comparisons: number;
  /** Rating deviation, shrinking with each decisive comparison. */
  deviation: number;
  wins: number;
  losses: number;
  draws: number;
}

/* -------------------------------------------------------------------------- */
/* Queue                                                                      */
/* -------------------------------------------------------------------------- */

export type QueueStateKind = 'snoozed' | 'skipped' | 'unfamiliar' | 'pinned';

export interface QueueState {
  id: EntityId;
  entityType: EntityType;
  kind: QueueStateKind;
  at: number;
  /** Epoch ms after which a snoozed item returns. */
  until?: number;
  updatedAt: number;
  deleted?: number;
}

/* -------------------------------------------------------------------------- */
/* User annotations                                                           */
/* -------------------------------------------------------------------------- */

export interface Collection {
  id: string;
  name: string;
  description?: string;
  entityIds: EntityId[];
  /** `favorite` and `avoid` are the two built-in pinning collections. */
  builtinKind?: 'favorite' | 'avoid';
  createdAt: number;
  updatedAt: number;
  deleted?: number;
}

export interface EntityAnnotation {
  id: EntityId;
  tags: string[];
  note?: string;
  /** Marks an alternate release the user has folded into another record. */
  duplicateOf?: EntityId;
  /** Standing verdict, independent of any score. */
  pinned?: 'favorite' | 'avoid';
  updatedAt: number;
  deleted?: number;
}

/* -------------------------------------------------------------------------- */
/* Rollup configuration                                                       */
/* -------------------------------------------------------------------------- */

export type AggregationMethod = 'mean' | 'median' | 'trimmed' | 'bayesian';

export type RollupChannel = 'explicit' | 'directChildren' | 'descendants' | 'comparison';

export const ROLLUP_CHANNELS: readonly RollupChannel[] = [
  'explicit',
  'directChildren',
  'descendants',
  'comparison',
];

export type RollupWeights = Record<RollupChannel, number>;

export interface RollupConfig {
  weights: RollupWeights;
  method: AggregationMethod;
  /** Half-life in days for recency decay. `0` disables decay. */
  recencyHalfLifeDays: number;
  /** Minimum ratio of rated children before a rollup is considered covered. */
  minCoverage: number;
  /** Prior strength for the Bayesian aggregator. */
  bayesianPriorWeight: number;
  /** Prior mean for the Bayesian aggregator, 0..100. */
  bayesianPriorMean: number;
  /** Group children by their release before averaging, so long albums do not dominate. */
  groupChildrenByRelease: boolean;
  /** Weight each rating by its stated confidence. */
  weightByConfidence: boolean;
}

export type RollupConfigByType = Record<EntityType, RollupConfig>;

/* -------------------------------------------------------------------------- */
/* Scores                                                                     */
/* -------------------------------------------------------------------------- */

export interface ScoreContributor {
  entityId: EntityId;
  name: string;
  normalized: number;
  weight: number;
  /** Path the contribution was counted through, e.g. `album → track`. */
  via?: string;
}

export interface ChannelExplanation {
  channel: RollupChannel;
  /** 0..100, or null when the channel had no evidence. */
  value: number | null;
  /** Weight the user configured. */
  requestedWeight: number;
  /** Weight after renormalising over channels that actually had evidence. */
  appliedWeight: number;
  /** How many distinct entities contributed. */
  sampleSize: number;
  /** Human-readable account of what went in. */
  detail: string;
  /** Top contributors, for the "Why this score?" label. */
  contributors?: ScoreContributor[];
}

export type ExclusionCode =
  | 'duplicate-path'
  | 'unrated'
  | 'retracted'
  | 'unavailable'
  | 'below-coverage'
  | 'self'
  | 'marked-duplicate';

export interface ExclusionNote {
  code: ExclusionCode;
  count: number;
  detail: string;
}

export interface Coverage {
  rated: number;
  total: number;
  ratio: number;
  meetsMinimum: boolean;
}

export interface ScoreBreakdown {
  entityId: EntityId;
  entityType: EntityType;
  /** Explicit rating, 0..100, or null if never rated. */
  explicit: number | null;
  /** Computed rollup, 0..100, or null when there was no evidence at all. */
  rollup: number | null;
  /** Blend of explicit and rollup per the display preference. */
  blended: number | null;
  channels: ChannelExplanation[];
  coverage: Coverage;
  /** 0..1. Rises with sample size, coverage and stated confidence. */
  confidence: number;
  method: AggregationMethod;
  exclusions: ExclusionNote[];
  ranking?: RankingState;
  computedAt: number;
}

export type ScoreView = 'explicit' | 'rollup' | 'blended';

/* -------------------------------------------------------------------------- */
/* Suggestions                                                                */
/* -------------------------------------------------------------------------- */

export const SUGGESTION_SOURCES = [
  'recentlyPlayed',
  'topShortTerm',
  'topMediumTerm',
  'topLongTerm',
  'savedLibrary',
  'unratedChild',
  'staleRating',
  'lowConfidenceRank',
  'coverageGap',
  'pinned',
] as const;

export type SuggestionSource = (typeof SUGGESTION_SOURCES)[number];

export type SuggestionWeights = Record<SuggestionSource, number>;

export interface SuggestionReason {
  source: SuggestionSource;
  /** Contribution to the final score. */
  weight: number;
  /** Sentence shown on the queue card: "you played this 3 days ago". */
  detail: string;
}

export interface Suggestion {
  entityId: EntityId;
  entityType: EntityType;
  score: number;
  reasons: SuggestionReason[];
  /**
   * Sort band. Lower comes first, and no amount of score lets a lower band be
   * overtaken. `0` is reserved for things the user has actually just listened
   * to, which always outrank anything merely inferred.
   */
  tier: number;
}

/* -------------------------------------------------------------------------- */
/* Sync                                                                       */
/* -------------------------------------------------------------------------- */

export interface Tombstoned {
  id: string;
  updatedAt?: number;
  createdAt?: number;
  deleted?: number;
}
