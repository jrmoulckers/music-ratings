import { rankingConfidence, type RankingTable } from './elo';
import type { ContainmentGraph } from './graph';
import type { ExplicitRating } from './ratings';
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
 * Skip means "not this, not now". It has to actually remove the item from the
 * queue, or the queue looks like it is insisting. It is not a permanent verdict
 * either, so it lapses — and playing the thing again clears it immediately,
 * because pressing play is a louder signal than a dismissal from this morning.
 */
export const SKIP_COOLDOWN_MS = 6 * 3_600_000;

/** Half-life for how quickly a play stops being a reason to rate something. */
const PLAY_HALF_LIFE_DAYS = 10;

function decay(ageMs: number, halfLifeDays: number): number {
  if (!(halfLifeDays > 0)) return 1;
  return 2 ** (-Math.max(0, ageMs / DAY) / halfLifeDays);
}

function relativeDays(ms: number): string {
  const days = Math.round(ms / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  const months = Math.round(days / 30);
  if (months < 24) return `${months} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

/**
 * A play within the hour is the whole reason this queue exists, so it is worth
 * saying in minutes rather than rounding it away to "today".
 */
function relativePlay(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return relativeDays(ms);
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

const TERM_LABEL: Record<TopSignal['term'], string> = {
  short: 'the last four weeks',
  medium: 'the last six months',
  long: 'your all-time listening',
};

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
      `You played this ${relativePlay(now - play.at)}.`,
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
      `Number ${top.rank + 1} in ${TERM_LABEL[top.term]}.`,
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
      saved.savedAt ? `Saved to your library ${relativeDays(age)}.` : 'Saved to your library.',
    );
  }

  /* --- gaps in what you have already judged ------------------------------ */

  for (const parent of graph.allEntities()) {
    const parentScore = input.scores.get(parent.id);
    const parentRated = input.explicit.get(parent.id);
    const children = graph.children(parent.id);
    if (children.length === 0) continue;

    const coverage = parentScore?.coverage;
    const coverageShortfall = coverage && coverage.total > 0 ? 1 - coverage.ratio : 0;

    for (const edge of children) {
      if (input.explicit.has(edge.childId)) continue;
      if (parentRated) {
        add(
          acc,
          graph,
          enabled,
          edge.childId,
          'unratedChild',
          0.4 + 0.6 * (parentRated.normalized / 100),
          w.unratedChild,
          `You rated ${parent.name} but not this.`,
        );
      }
      if (coverage && !coverage.meetsMinimum && coverageShortfall > 0) {
        add(
          acc,
          graph,
          enabled,
          edge.childId,
          'coverageGap',
          coverageShortfall,
          w.coverageGap,
          `${parent.name} is only ${Math.round((coverage.ratio || 0) * 100)}% rated.`,
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
      add(
        acc,
        graph,
        enabled,
        entityId,
        'staleRating',
        signal,
        w.staleRating,
        `Last rated ${relativeDays(age)}. Still right?`,
      );
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
        state.comparisons === 0
          ? 'Never compared against anything.'
          : `Only ${state.comparisons} comparison${state.comparisons === 1 ? '' : 's'} so far.`,
      );
    }
  }

  if (input.pinnedIds) {
    for (const entityId of input.pinnedIds) {
      add(acc, graph, enabled, entityId, 'pinned', 1, w.pinned, 'You pinned this.');
    }
  }

  /* --- queue state ------------------------------------------------------- */

  const out: Suggestion[] = [];
  for (const item of acc.values()) {
    const state = input.queueStates.get(item.entityId);
    if (state && !state.deleted) {
      if (state.kind === 'snoozed' && (state.until ?? 0) > now) continue;
      if (state.kind === 'unfamiliar' && now - state.at < 90 * DAY) continue;
      if (state.kind === 'skipped') {
        // A skip removes the item outright — a queue that keeps re-offering
        // what you just pushed away is not listening. It lapses after the
        // cooldown, and playing the thing again overrides it at once.
        const playedSince = (item.lastPlayedAt ?? 0) > state.at;
        const lapsed = now - state.at >= SKIP_COOLDOWN_MS;
        if (!playedSince && !lapsed) continue;
      }
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

export function suggestionSourceLabel(source: SuggestionSource): string {
  switch (source) {
    case 'recentlyPlayed':
      return 'Recently played';
    case 'topShortTerm':
      return 'Top — 4 weeks';
    case 'topMediumTerm':
      return 'Top — 6 months';
    case 'topLongTerm':
      return 'Top — all time';
    case 'savedLibrary':
      return 'Saved library';
    case 'unratedChild':
      return 'Unrated inside something you rated';
    case 'staleRating':
      return 'Due for review';
    case 'lowConfidenceRank':
      return 'Unsettled ranking';
    case 'coverageGap':
      return 'Coverage gap';
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
