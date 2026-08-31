import { hashString } from './ids';
import type { Comparison, EntityId, EntityType, RankingState } from './types';

/**
 * Head-to-head ranking.
 *
 * Elo, chosen because it is well understood, order-stable given a fixed log,
 * and cheap enough to replay from scratch on every read. Nothing is stored:
 * ranking state is always derived from the comparison log, so undo, edit and
 * sync merges are correct by construction.
 */

export const ELO_SEED = 1500;
export const ELO_SEED_DEVIATION = 350;
export const ELO_MIN_DEVIATION = 40;

/** Outcomes that move ratings. Skips and "both unfamiliar" deliberately do not. */
const DECISIVE = new Set(['a', 'b', 'tie']);

/** K falls as evidence accumulates, so early comparisons move more. */
export function kFactor(comparisons: number): number {
  if (comparisons < 5) return 40;
  if (comparisons < 15) return 28;
  if (comparisons < 40) return 20;
  return 14;
}

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export function deviationFor(comparisons: number): number {
  if (comparisons <= 0) return ELO_SEED_DEVIATION;
  return Math.max(ELO_MIN_DEVIATION, ELO_SEED_DEVIATION / Math.sqrt(1 + comparisons));
}

function seedState(entityId: EntityId, entityType: EntityType): RankingState {
  return {
    entityId,
    entityType,
    rating: ELO_SEED,
    comparisons: 0,
    deviation: ELO_SEED_DEVIATION,
    wins: 0,
    losses: 0,
    draws: 0,
  };
}

/** Deterministic ordering: by timestamp, then by id. */
export function sortComparisons(comparisons: readonly Comparison[]): Comparison[] {
  return [...comparisons].sort((a, b) => (a.at !== b.at ? a.at - b.at : a.id < b.id ? -1 : 1));
}

export type RankingTable = Map<EntityId, RankingState>;

/**
 * Replay the whole comparison log for one entity type.
 *
 * Comparisons are kept strictly within a type: cross-type duels are off by
 * default because "is this album better than that artist" is not a question the
 * rating model can answer honestly.
 *
 * `resolve` maps each side onto its canonical id before the replay, so
 * comparisons made against a copy that has since been combined still count.
 * A pair whose two sides became the same record is dropped: it was a real
 * judgement about two things the user then declared to be one, and feeding it
 * to Elo as a draw against itself would invent evidence.
 */
export function computeRankings(
  comparisons: readonly Comparison[],
  entityType?: EntityType,
  resolve: (id: EntityId) => EntityId = (id) => id,
): RankingTable {
  const table: RankingTable = new Map();
  const relevant = comparisons.filter(
    (c) => !c.deleted && DECISIVE.has(c.outcome) && (!entityType || c.entityType === entityType),
  );

  for (const c of sortComparisons(relevant)) {
    const aId = resolve(c.aId);
    const bId = resolve(c.bId);
    if (aId === bId) continue;
    const a = table.get(aId) ?? seedState(aId, c.entityType);
    const b = table.get(bId) ?? seedState(bId, c.entityType);

    const scoreA = c.outcome === 'a' ? 1 : c.outcome === 'b' ? 0 : 0.5;
    const expA = expectedScore(a.rating, b.rating);
    const kA = kFactor(a.comparisons);
    const kB = kFactor(b.comparisons);

    a.rating += kA * (scoreA - expA);
    b.rating += kB * (1 - scoreA - (1 - expA));

    a.comparisons += 1;
    b.comparisons += 1;
    a.deviation = deviationFor(a.comparisons);
    b.deviation = deviationFor(b.comparisons);

    if (c.outcome === 'a') {
      a.wins += 1;
      b.losses += 1;
    } else if (c.outcome === 'b') {
      b.wins += 1;
      a.losses += 1;
    } else {
      a.draws += 1;
      b.draws += 1;
    }

    table.set(aId, a);
    table.set(bId, b);
  }
  return table;
}

/**
 * Elo → canonical 0..100.
 *
 * This is the probability the user would pick this item over a median item,
 * expressed as a percentage. It is *not* mixed with popularity, play counts or
 * anything from a provider.
 */
export function rankingToNormalized(rating: number): number {
  return Math.min(100, Math.max(0, 100 * expectedScore(rating, ELO_SEED)));
}

/** 0..1 — how settled a ranking is. Drives the "uncertain" mark in lists. */
export function rankingConfidence(state: RankingState | undefined): number {
  if (!state || state.comparisons === 0) return 0;
  const fromDeviation = 1 - (state.deviation - ELO_MIN_DEVIATION) / ELO_SEED_DEVIATION;
  const fromVolume = Math.min(1, state.comparisons / 12);
  return Math.max(0, Math.min(1, 0.5 * fromDeviation + 0.5 * fromVolume));
}

/* -------------------------------------------------------------------------- */
/* Pair selection                                                             */
/* -------------------------------------------------------------------------- */

export interface PairCandidate {
  entityId: EntityId;
  /** Current best estimate of the item's standing, 0..100. */
  estimate: number;
  ranking?: RankingState;
}

export interface ComparisonPair {
  aId: EntityId;
  bId: EntityId;
  /** Plain-language account of why these two were put together. */
  reason: string;
  /** Higher means more information expected from the answer. */
  informationValue: number;
}

function pairKey(a: EntityId, b: EntityId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Pick the pair whose answer would tell us the most.
 *
 * Informative means: close on the axis we already believe in, and at least one
 * side still uncertain. Provider popularity is never consulted — the catalogue
 * only decides which items are *available* to compare.
 */
export function selectPairs(
  candidates: readonly PairCandidate[],
  history: readonly Comparison[],
  options: { limit?: number; avoidRepeatWithinMs?: number; now?: number } = {},
): ComparisonPair[] {
  const limit = options.limit ?? 1;
  const now = options.now ?? Date.now();
  const avoidMs = options.avoidRepeatWithinMs ?? 1000 * 60 * 60 * 24 * 30;

  const seen = new Map<string, number>();
  for (const c of history) {
    if (c.deleted) continue;
    const key = pairKey(c.aId, c.bId);
    seen.set(key, Math.max(seen.get(key) ?? 0, c.at));
  }

  const pool = candidates.filter((c) => Number.isFinite(c.estimate));
  if (pool.length < 2) return [];

  const scored: ComparisonPair[] = [];
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const a = pool[i] as PairCandidate;
      const b = pool[j] as PairCandidate;
      const last = seen.get(pairKey(a.entityId, b.entityId));
      if (last != null && now - last < avoidMs) continue;

      const gap = Math.abs(a.estimate - b.estimate);
      // Closeness dominates: a 40-point gap tells us almost nothing.
      const closeness = Math.exp(-((gap / 12) ** 2));
      const uncertainty =
        (1 - rankingConfidence(a.ranking)) * 0.5 + (1 - rankingConfidence(b.ranking)) * 0.5;
      const freshness = last == null ? 1 : 0.4;
      const informationValue = closeness * (0.35 + 0.65 * uncertainty) * freshness;

      scored.push({
        aId: a.entityId,
        bId: b.entityId,
        informationValue,
        reason: describePair(gap, uncertainty, last == null),
      });
    }
  }

  scored.sort((x, y) => {
    if (y.informationValue !== x.informationValue) return y.informationValue - x.informationValue;
    // Deterministic tie-break so two devices agree on the same queue.
    return hashString(x.aId + x.bId) - hashString(y.aId + y.bId);
  });

  const out: ComparisonPair[] = [];
  const used = new Set<EntityId>();
  for (const pair of scored) {
    if (out.length >= limit) break;
    if (used.has(pair.aId) || used.has(pair.bId)) continue;
    used.add(pair.aId);
    used.add(pair.bId);
    out.push(pair);
  }
  return out;
}

function describePair(gap: number, uncertainty: number, firstTime: boolean): string {
  if (gap < 3) return 'These two sit within three points of each other.';
  if (uncertainty > 0.7) {
    return firstTime
      ? 'Neither has been compared much, and they score close together.'
      : 'Both rankings are still unsettled.';
  }
  if (gap < 10) return 'Close scores, and the order between them is not settled.';
  return 'A spot check against something you rated differently.';
}
