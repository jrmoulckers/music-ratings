import { rankingConfidence, type RankingTable } from './elo';
import type { ContainmentGraph } from './graph';
import type { ExplicitRating } from './ratings';
import {
  comparisonReason,
  coverageReason,
  pinnedReason,
  playedReason,
  relativeDays,
  relativePlay,
  savedReason,
  staleReason,
  topReason,
  unratedChildReason,
} from './reasons';
import type {
  EntityId,
  EntityType,
  QueueState,
  ScoreBreakdown,
  Suggestion,
  SuggestionReason,
  SuggestionSource,
  SuggestionWeights,
} from './types';
import { SUGGESTION_SOURCES } from './types';
import { hashString } from './ids';

export { relativeDays, relativePlay };

/**
 * What to rate next.
 *
 * Built entirely from signals the user's own account already exposes plus the
 * shape of their own rating history. There is no recommender, no model, and no
 * popularity input: Spotify decides which items are *available* to suggest, and
 * the rules below decide which of those are worth the user's attention.
 *
 * Every suggestion carries the reasons that produced it, so the queue can say
 * out loud why an item is in front of you.
 */

export interface PlaySignal {
  entityId: EntityId;
  /** Epoch ms of the play. */
  at: number;
  /** 0-based position in the recently-played window (0 = most recent). */
  index: number;
}

export interface TopSignal {
  entityId: EntityId;
  term: 'short' | 'medium' | 'long';
  /** 0-based rank in the returned list. */
  rank: number;
  /** Length of the list the rank came from. */
  of: number;
}

export interface SavedSignal {
  entityId: EntityId;
  savedAt?: number;
}

export interface ListeningSignals {
  recentlyPlayed: readonly PlaySignal[];
  top: readonly TopSignal[];
  saved: readonly SavedSignal[];
}

export const EMPTY_SIGNALS: ListeningSignals = { recentlyPlayed: [], top: [], saved: [] };

export interface SuggestionInput {
  graph: ContainmentGraph;
  explicit: ReadonlyMap<EntityId, ExplicitRating>;
  scores: ReadonlyMap<EntityId, ScoreBreakdown>;
  rankings: ReadonlyMap<EntityType, RankingTable>;
  signals: ListeningSignals;
  weights: SuggestionWeights;
  queueStates: ReadonlyMap<EntityId, QueueState>;
  enabledTypes: readonly EntityType[];
  /** A rating older than this is offered for review. */
  staleAfterDays: number;
  /**
   * Start of the current rating pass. Anything skipped since then stays out of
   * the queue for the rest of it, however long the user keeps working.
   */
  passStartedAt?: number;
  pinnedIds?: ReadonlySet<EntityId>;
  now?: number;
}

export const DEFAULT_SUGGESTION_WEIGHTS: SuggestionWeights = {
  recentlyPlayed: 1,
  topShortTerm: 0.9,
  topMediumTerm: 0.75,
  topLongTerm: 0.6,
  savedLibrary: 0.5,
  unratedChild: 0.7,
  staleRating: 0.45,
  lowConfidenceRank: 0.4,
  coverageGap: 0.55,
  pinned: 0.8,
};

const DAY = 86_400_000;

/**
 * Sort bands. A recent play is direct evidence that the music is on the user's
 * mind right now; every other source is an inference about what they might be
 * willing to judge. Bands keep the two from competing on score, which is the
 * only way "what I just listened to" reliably stays at the front.
 */
export const TIER_JUST_PLAYED = 0;
export const TIER_INFERRED = 1;

/**
 * How long a skip holds.
 *
 * Skip means "not this, not now" — it is a dismissal, not a verdict, so it is
 * scoped to the sitting rather than stamped on the item. An item skipped during
 * the current pass stays gone for that pass however long it runs, and the grace
 * window carries the same decision across a reload or a detour into an item's
 * page, which are not new sittings in any sense the user would recognise.
 *
 * Playing the thing again overrides both at once: pressing play is a louder
 * signal than a dismissal from earlier.
 */
export const SKIP_PASS_GRACE_MS = 30 * 60_000;

/** Half-life for how quickly a play stops being a reason to rate something. */
const PLAY_HALF_LIFE_DAYS = 10;

function decay(ageMs: number, halfLifeDays: number): number {
  if (!(halfLifeDays > 0)) return 1;
  return 2 ** (-Math.max(0, ageMs / DAY) / halfLifeDays);
}

/**
 * One entry per track, carrying its most recent play.
 *
 * The window Spotify returns is a play log, not a list of tracks: put an album
 * on twice and it comes back twice. The queue is a list of things to judge, so
 * repeats collapse — and they collapse onto the newest occurrence, because that
 * is the one that decides where the item sits.
 */
export function collapsePlays(plays: readonly PlaySignal[]): PlaySignal[] {
  const best = new Map<EntityId, PlaySignal>();
  for (const play of plays) {
    const held = best.get(play.entityId);
    if (!held || play.at > held.at || (play.at === held.at && play.index < held.index)) {
      best.set(play.entityId, play);
    }
  }
  return [...best.values()];
}

const TERM_SOURCE: Record<TopSignal['term'], SuggestionSource> = {
  short: 'topShortTerm',
  medium: 'topMediumTerm',
  long: 'topLongTerm',
};

interface Accumulator {
  entityId: EntityId;
  entityType: EntityType;
  reasons: Map<SuggestionSource, SuggestionReason>;
  /** When Spotify last saw this played. Undefined for inferred suggestions. */
  lastPlayedAt?: number;
}

function add(
  acc: Map<EntityId, Accumulator>,
  graph: ContainmentGraph,
  enabled: ReadonlySet<EntityType>,
  entityId: EntityId,
  source: SuggestionSource,
  signal: number,
  weight: number,
  detail: string,
): void {
  if (!(signal > 0) || !(weight > 0)) return;
  const entity = graph.entity(entityId);
  if (!entity || !enabled.has(entity.type)) return;
  let item = acc.get(entityId);
  if (!item) {
    item = { entityId, entityType: entity.type, reasons: new Map() };
    acc.set(entityId, item);
  }
  const contribution = signal * weight;
  const existing = item.reasons.get(source);
  if (existing && existing.weight >= contribution) return;
  item.reasons.set(source, { source, weight: contribution, detail });
}

/**
 * Whether a skipped item may come back.
 *
 * Three questions, in the order that matters: have you played it since you
 * pushed it away, did you push it away during this pass, and was that recent
 * enough that this is plainly still the same sitting.
 */
export function skipHasLapsed(
  state: QueueState,
  item: { lastPlayedAt?: number },
  now: number,
  passStartedAt: number,
): boolean {
  if ((item.lastPlayedAt ?? 0) > state.at) return true;
  if (state.at >= passStartedAt) return false;
  return now - state.at >= SKIP_PASS_GRACE_MS;
}

/**
 * Deterministic given identical inputs: no randomness, no wall-clock reads
 * beyond the `now` you pass in.
 */
export function scoreSuggestions(input: SuggestionInput): Suggestion[] {
  const now = input.now ?? Date.now();
  const enabled = new Set(input.enabledTypes);
  const acc = new Map<EntityId, Accumulator>();
  const w = input.weights;
  const graph = input.graph;

  /* --- what you have been playing --------------------------------------- */

  for (const play of collapsePlays(input.signals.recentlyPlayed)) {
    const positional = 1 - Math.min(0.75, play.index / 60);
    const signal = positional * decay(now - play.at, PLAY_HALF_LIFE_DAYS);
    add(
      acc,
      graph,
      enabled,
      play.entityId,
      'recentlyPlayed',
      signal,
      w.recentlyPlayed,
      playedReason(now - play.at),
    );
    const item = acc.get(play.entityId);
    if (item) item.lastPlayedAt = Math.max(item.lastPlayedAt ?? 0, play.at);
  }

  for (const top of input.signals.top) {
    const signal = 1 - Math.min(0.85, top.rank / Math.max(1, top.of));
    add(
      acc,
      graph,
      enabled,
      top.entityId,
      TERM_SOURCE[top.term],
      signal,
      w[TERM_SOURCE[top.term]],
      topReason(top.term, top.rank + 1),
    );
  }

  for (const saved of input.signals.saved) {
    const age = saved.savedAt ? now - saved.savedAt : 0;
    const signal = saved.savedAt ? 0.5 + 0.5 * decay(age, 180) : 0.6;
    add(
      acc,
      graph,
      enabled,
      saved.entityId,
      'savedLibrary',
      signal,
      w.savedLibrary,
      saved.savedAt ? savedReason(age) : savedReason(),
    );
  }

  /* --- gaps in what you have already judged ------------------------------ */

  for (const parent of graph.allEntities()) {
    const parentScore = input.scores.get(parent.id);
    const parentRated = input.explicit.get(parent.id);
    const children = graph.children(parent.id);
    if (children.length === 0) continue;

    const coverage = parentScore?.coverage;
    // A gap is a fact about the child in front of you: it is unrated and its
    // parent still has room. Gating on the parent's coverage *minimum* instead
    // would let a single rating switch every remaining sibling off at once —
    // rate one track of a four-track record and the other three vanish, though
    // nothing about them changed. The weight below still falls as coverage
    // rises, so a nearly-complete parent argues quietly rather than not at all.
    const hasGap = Boolean(coverage && coverage.total > 0 && coverage.rated < coverage.total);
    // Named from the children this parent actually holds, so an artist that
    // only has releases recorded is never described as missing tracks.
    const childTypes = children.flatMap((edge) => {
      const child = graph.entity(edge.childId);
      return child ? [child.type] : [];
    });
    const ratedChildren = children.filter((edge) => input.explicit.has(edge.childId)).length;

    for (const edge of children) {
      if (input.explicit.has(edge.childId)) continue;
      const child = graph.entity(edge.childId);
      if (parentRated) {
        add(
          acc,
          graph,
          enabled,
          edge.childId,
          'unratedChild',
          0.4 + 0.6 * (parentRated.normalized / 100),
          w.unratedChild,
          unratedChildReason(parent.name, child?.type ?? parent.type),
        );
      }
      // Only one of these two ever prints for the same parent: "you rated the
      // album but not this" and "no tracks from the album rated yet" are the
      // same observation, and stacking them reads like the queue is nagging.
      if (hasGap && !parentRated) {
        add(
          acc,
          graph,
          enabled,
          edge.childId,
          'coverageGap',
          1 - (coverage?.ratio ?? 0),
          w.coverageGap,
          coverageReason(
            parent.name,
            childTypes,
            ratedChildren,
            coverage?.total ?? children.length,
          ),
        );
      }
    }
  }

  /* --- judgements that have gone stale or stayed uncertain --------------- */

  const staleMs = Math.max(1, input.staleAfterDays) * DAY;
  for (const [entityId, rating] of input.explicit) {
    const age = now - rating.at;
    if (age > staleMs) {
      const signal = Math.min(1, (age - staleMs) / staleMs);
      add(acc, graph, enabled, entityId, 'staleRating', signal, w.staleRating, staleReason(age));
    }
  }

  for (const [, table] of input.rankings) {
    for (const [entityId, state] of table) {
      const confidence = rankingConfidence(state);
      if (confidence >= 0.7) continue;
      add(
        acc,
        graph,
        enabled,
        entityId,
        'lowConfidenceRank',
        1 - confidence,
        w.lowConfidenceRank,
        comparisonReason(state.comparisons),
      );
    }
  }

  if (input.pinnedIds) {
    for (const entityId of input.pinnedIds) {
      add(acc, graph, enabled, entityId, 'pinned', 1, w.pinned, pinnedReason());
    }
  }

  /* --- queue state ------------------------------------------------------- */

  const out: Suggestion[] = [];
  const passStartedAt = input.passStartedAt ?? now;
  for (const item of acc.values()) {
    const state = input.queueStates.get(item.entityId);
    if (state && !state.deleted) {
      if (state.kind === 'snoozed' && (state.until ?? 0) > now) continue;
      // Retired from the interface, kept here so a record that synced from an
      // older version of the app still means what it meant when it was made.
      if (state.kind === 'unfamiliar' && now - state.at < 90 * DAY) continue;
      if (state.kind === 'skipped' && !skipHasLapsed(state, item, now, passStartedAt)) continue;
    }
    const reasons = [...item.reasons.values()].sort((a, b) => b.weight - a.weight);
    let score = reasons.reduce((acc2, r) => acc2 + r.weight, 0);
    if (input.explicit.has(item.entityId)) {
      // Already judged: only stale or uncertain reasons justify a re-visit.
      const revisit = reasons.filter(
        (r) => r.source === 'staleRating' || r.source === 'lowConfidenceRank',
      );
      if (revisit.length === 0) continue;
      score = revisit.reduce((acc2, r) => acc2 + r.weight, 0);
    }
    if (!(score > 0)) continue;
    // Something you actually pressed play on beats anything the rules merely
    // inferred, however many weak reasons that inference managed to stack up.
    const tier = item.reasons.has('recentlyPlayed') ? TIER_JUST_PLAYED : TIER_INFERRED;
    out.push({
      entityId: item.entityId,
      entityType: item.entityType,
      score,
      reasons,
      tier,
      ...(item.lastPlayedAt !== undefined ? { lastPlayedAt: item.lastPlayedAt } : {}),
    });
  }

  out.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    // Among things you just played, the clock decides and nothing else does.
    // Being saved, or top, or pinned is not a reason to hear about an older
    // play before the one that just finished.
    if (a.tier === TIER_JUST_PLAYED) {
      const played = (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0);
      if (played !== 0) return played;
    }
    if (b.score !== a.score) return b.score - a.score;
    return hashString(a.entityId) - hashString(b.entityId);
  });
  return out;
}

/**
 * The short category word beside a reason.
 *
 * One or two words only. The sentence next to it already carries the specifics
 * — "#3 in your all-time listening." — so a label that repeated the window
 * would be the same fact printed twice on one line.
 */
export function suggestionSourceLabel(source: SuggestionSource): string {
  switch (source) {
    case 'recentlyPlayed':
      return 'Played';
    case 'topShortTerm':
    case 'topMediumTerm':
    case 'topLongTerm':
      return 'Top';
    case 'savedLibrary':
      return 'Saved';
    case 'unratedChild':
      return 'Unrated';
    case 'staleRating':
      return 'Review';
    case 'lowConfidenceRank':
      return 'Unsettled';
    case 'coverageGap':
      return 'Coverage';
    case 'pinned':
      return 'Pinned';
    default:
      return source;
  }
}

export function emptySuggestionWeights(): SuggestionWeights {
  const out = {} as SuggestionWeights;
  for (const source of SUGGESTION_SOURCES) out[source] = 0;
  return out;
}
