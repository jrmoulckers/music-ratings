import { hashString } from './ids';
import type { ExplicitRating } from './ratings';
import type { ContainmentGraph } from './graph';
import type { EntityAnnotation, EntityId, EntityType, ScoreBreakdown, ScoreView } from './types';

/**
 * Ranked lists.
 *
 * Ties are reported, not broken silently. Two albums on the same score share a
 * position and are marked as tied; the display order between them is a stable
 * hash so it never shuffles between renders or between devices, but the app
 * never pretends one is ahead of the other.
 */

export interface ListFilters {
  type: EntityType;
  view: ScoreView;
  direction: 'top' | 'bottom';
  /** Only include items rated within this window, in ms. `0` means no limit. */
  withinMs?: number;
  tags?: readonly string[];
  minConfidence?: number;
  minCoverage?: number;
  /** Require at least this many head-to-head comparisons. */
  minComparisons?: number;
  requireExplicit?: boolean;
  search?: string;
  limit?: number;
}

export interface RankedRow {
  entityId: EntityId;
  name: string;
  subtitle?: string;
  score: number;
  /**
   * 1-based competition ranking: tied rows share a position, and the next
   * distinct score skips ahead by however many shared it. Two items at 3rd are
   * both 3rd and the one after them is 5th, because three things are ahead of it.
   */
  position: number;
  tied: boolean;
  breakdown: ScoreBreakdown;
  rating?: ExplicitRating;
  artworkThumbUrl?: string;
}

export interface RankedList {
  rows: RankedRow[];
  /** How many entities were considered before filtering. */
  considered: number;
  /** How many were dropped, by reason, for an honest empty state. */
  dropped: { reason: string; count: number }[];
}

export interface ListInput {
  graph: ContainmentGraph;
  scores: ReadonlyMap<EntityId, ScoreBreakdown>;
  explicit: ReadonlyMap<EntityId, ExplicitRating>;
  annotations?: ReadonlyMap<EntityId, EntityAnnotation>;
  now?: number;
}

function scoreFor(breakdown: ScoreBreakdown, view: ScoreView): number | null {
  if (view === 'explicit') return breakdown.explicit;
  if (view === 'rollup') return breakdown.rollup;
  return breakdown.blended;
}

export function buildRankedList(input: ListInput, filters: ListFilters): RankedList {
  const now = input.now ?? Date.now();
  const limit = filters.limit ?? 50;
  const dropped = new Map<string, number>();
  const drop = (reason: string) => dropped.set(reason, (dropped.get(reason) ?? 0) + 1);

  const needle = filters.search?.trim().toLowerCase() ?? '';
  const candidates = input.graph.entitiesOfType(filters.type);

  const scored: { entityId: EntityId; score: number; breakdown: ScoreBreakdown }[] = [];
  for (const entity of candidates) {
    const breakdown = input.scores.get(entity.id);
    if (!breakdown) {
      drop('no score computed');
      continue;
    }
    const rating = input.explicit.get(entity.id);
    if (filters.requireExplicit && !rating) {
      drop('never rated directly');
      continue;
    }
    if (filters.withinMs && filters.withinMs > 0) {
      if (!rating || now - rating.at > filters.withinMs) {
        drop('outside the time range');
        continue;
      }
    }
    if (filters.minConfidence != null && breakdown.confidence < filters.minConfidence) {
      drop('below the confidence floor');
      continue;
    }
    if (filters.minCoverage != null && breakdown.coverage.ratio < filters.minCoverage) {
      drop('below the coverage floor');
      continue;
    }
    if (filters.minComparisons != null) {
      if ((breakdown.ranking?.comparisons ?? 0) < filters.minComparisons) {
        drop('too few comparisons');
        continue;
      }
    }
    if (filters.tags?.length) {
      const tags = new Set([
        ...(input.annotations?.get(entity.id)?.tags ?? []),
        ...(rating?.tags ?? []),
      ]);
      if (!filters.tags.every((t) => tags.has(t))) {
        drop('missing a required tag');
        continue;
      }
    }
    if (needle) {
      const haystack = `${entity.name} ${entity.subtitle ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) {
        drop('does not match the search');
        continue;
      }
    }
    const value = scoreFor(breakdown, filters.view);
    if (value == null) {
      drop(
        filters.view === 'explicit' ? 'never rated directly' : 'no evidence for a computed score',
      );
      continue;
    }
    scored.push({ entityId: entity.id, score: value, breakdown });
  }

  scored.sort((a, b) => {
    const delta = filters.direction === 'top' ? b.score - a.score : a.score - b.score;
    if (Math.abs(delta) > 1e-9) return delta;
    return hashString(a.entityId) - hashString(b.entityId);
  });

  const rows: RankedRow[] = [];
  let position = 0;
  let previous: number | null = null;
  for (let i = 0; i < scored.length && rows.length < limit; i += 1) {
    const item = scored[i] as { entityId: EntityId; score: number; breakdown: ScoreBreakdown };
    const entity = input.graph.entity(item.entityId);
    if (!entity) continue;
    const same = previous != null && Math.abs(previous - item.score) < 1e-9;
    if (!same) position = i + 1;
    previous = item.score;
    const next = scored[i + 1];
    const prev = scored[i - 1];
    const tied =
      (!!next && Math.abs(next.score - item.score) < 1e-9) ||
      (!!prev && Math.abs(prev.score - item.score) < 1e-9);

    const row: RankedRow = {
      entityId: item.entityId,
      name: entity.name,
      score: item.score,
      position,
      tied,
      breakdown: item.breakdown,
    };
    if (entity.subtitle) row.subtitle = entity.subtitle;
    const art = entity.artworkThumbUrl ?? entity.artworkUrl;
    if (art) row.artworkThumbUrl = art;
    const rating = input.explicit.get(item.entityId);
    if (rating) row.rating = rating;
    rows.push(row);
  }

  return {
    rows,
    considered: candidates.length,
    dropped: [...dropped.entries()].map(([reason, count]) => ({ reason, count })),
  };
}

export const TIME_RANGES: readonly { id: string; label: string; ms: number }[] = [
  { id: 'all', label: 'All time', ms: 0 },
  { id: '30d', label: 'Last 30 days', ms: 30 * 86_400_000 },
  { id: '90d', label: 'Last 90 days', ms: 90 * 86_400_000 },
  { id: '1y', label: 'Last year', ms: 365 * 86_400_000 },
];
