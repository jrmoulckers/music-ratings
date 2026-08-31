import type {
  ContextSnapshot,
  EntityId,
  RatingConfidence,
  RatingEvent,
  RatingScale,
  ScoreView,
} from './types';
import { clampNormalized, formatNormalizedOn } from './scales';

/**
 * Resolving explicit ratings from the event log.
 *
 * Ratings are events. The current explicit rating is the newest live event for
 * an entity; every earlier one stays in the timeline. Nothing here ever writes,
 * so undo is simply retracting an event and re-resolving.
 */

export interface ExplicitRating {
  entityId: EntityId;
  normalized: number;
  value: number;
  scaleId: string;
  at: number;
  confidence: RatingConfidence;
  note?: string;
  tags?: string[];
  eventId: string;
  /** The contextual facets recorded with this rating, when there were any. */
  contextual?: ContextSnapshot;
}

export function isLiveRating(event: RatingEvent): boolean {
  return !event.deleted && !event.retracted;
}

/** Newest live event wins; ties break on event id so devices agree. */
export function currentRating(events: readonly RatingEvent[]): ExplicitRating | null {
  let best: RatingEvent | null = null;
  for (const e of events) {
    if (!isLiveRating(e)) continue;
    if (!best || e.at > best.at || (e.at === best.at && e.id > best.id)) best = e;
  }
  if (!best) return null;
  const out: ExplicitRating = {
    entityId: best.entityId,
    normalized: clampNormalized(best.normalized),
    value: best.value,
    scaleId: best.scaleId,
    at: best.at,
    confidence: best.confidence,
    eventId: best.id,
  };
  if (best.note) out.note = best.note;
  if (best.tags?.length) out.tags = [...best.tags];
  if (best.contextual?.facets?.length) out.contextual = best.contextual;
  return out;
}

/** Index the whole log once; every downstream computation reads this map. */
export function indexCurrentRatings(events: readonly RatingEvent[]): Map<EntityId, ExplicitRating> {
  const byEntity = new Map<EntityId, RatingEvent[]>();
  for (const e of events) {
    if (!isLiveRating(e)) continue;
    const list = byEntity.get(e.entityId);
    if (list) list.push(e);
    else byEntity.set(e.entityId, [e]);
  }
  const out = new Map<EntityId, ExplicitRating>();
  for (const [id, list] of byEntity) {
    const current = currentRating(list);
    if (current) out.set(id, current);
  }
  return out;
}

/** All live events for one entity, newest first. */
export function historyFor(
  events: readonly RatingEvent[],
  entityId: EntityId,
  options: { includeRetracted?: boolean } = {},
): RatingEvent[] {
  return events
    .filter(
      (e) =>
        e.entityId === entityId && !e.deleted && (options.includeRetracted ? true : !e.retracted),
    )
    .sort((a, b) => (b.at !== a.at ? b.at - a.at : b.id < a.id ? -1 : 1));
}

export const CONFIDENCE_WEIGHT: Readonly<Record<RatingConfidence, number>> = {
  low: 0.5,
  medium: 1,
  high: 1.5,
};

export const CONFIDENCE_LABEL: Readonly<Record<RatingConfidence, string>> = {
  low: 'Not sure',
  medium: 'Fairly sure',
  high: 'Certain',
};

/**
 * Exponential decay by age. `halfLifeDays <= 0` disables decay entirely, which
 * is the default: a rating does not become wrong because it is old.
 */
export function recencyWeight(at: number, now: number, halfLifeDays: number): number {
  if (!(halfLifeDays > 0)) return 1;
  const ageDays = Math.max(0, (now - at) / 86_400_000);
  return 2 ** (-ageDays / halfLifeDays);
}

/** How a canonical value is printed for display. */
export function formatScore(normalized: number | null, scale?: RatingScale): string {
  if (normalized == null) return '—';
  if (scale) return formatNormalizedOn(scale, normalized);
  return String(Math.round(normalized));
}

export function pickView(
  view: ScoreView,
  score: {
    explicit: number | null;
    rollup: number | null;
    blended: number | null;
    contextScore?: number | null;
    contextAdjusted?: number | null;
  },
): number | null {
  if (view === 'explicit') return score.explicit;
  if (view === 'context') return score.contextScore ?? null;
  // An item with no context falls back to the direct rating rather than
  // vanishing: the view asks how context changed things, and "not at all" is a
  // truthful answer.
  if (view === 'contextAdjusted') return score.contextAdjusted ?? score.explicit;
  if (view === 'rollup') return score.rollup;
  return score.blended;
}

export const SCORE_VIEW_LABEL: Readonly<Record<ScoreView, string>> = {
  explicit: 'Your rating',
  context: 'Context score',
  contextAdjusted: 'Context-adjusted',
  rollup: 'Computed',
  blended: 'Blended',
};
