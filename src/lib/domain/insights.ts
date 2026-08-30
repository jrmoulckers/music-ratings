import { rankingConfidence, type RankingTable } from './elo';
import type { ContainmentGraph } from './graph';
import type { ExplicitRating } from './ratings';
import type { ListeningSignals } from './suggestions';
import type { EntityId, EntityType, RatingEvent, ScoreBreakdown } from './types';

/**
 * Taste insights.
 *
 * Everything here is descriptive statistics over the user's own judgements,
 * computed on the device. Nothing is trained, inferred from other users, or
 * borrowed from a provider's recommender. Each insight carries the evidence
 * that produced it so the user can disagree with it on the facts.
 */

export interface Insight {
  id: string;
  kind: InsightKind;
  title: string;
  /** One-sentence plain-language finding. */
  finding: string;
  /** The rule that produced it, stated so the user can check it. */
  evidence: string;
  entities: InsightEntity[];
  /** Sort weight; higher is more notable. */
  weight: number;
}

export type InsightKind =
  | 'favourite'
  | 'avoid'
  | 'polarizing'
  | 'hidden-gem'
  | 'drift'
  | 'coverage'
  | 'stable'
  | 'uncertain'
  | 'explore'
  | 'deprioritise';

export interface InsightEntity {
  entityId: EntityId;
  name: string;
  detail: string;
  value?: number;
}

export interface InsightInput {
  graph: ContainmentGraph;
  explicit: ReadonlyMap<EntityId, ExplicitRating>;
  scores: ReadonlyMap<EntityId, ScoreBreakdown>;
  rankings: ReadonlyMap<EntityType, RankingTable>;
  events: readonly RatingEvent[];
  signals: ListeningSignals;
  enabledTypes: readonly EntityType[];
  now?: number;
}

const DAY = 86_400_000;

function name(graph: ContainmentGraph, id: EntityId): string {
  return graph.entity(id)?.name ?? id;
}

function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function computeInsights(input: InsightInput): Insight[] {
  const now = input.now ?? Date.now();
  const enabled = new Set(input.enabledTypes);
  const out: Insight[] = [];

  const rated = [...input.explicit.entries()].filter(([id]) => {
    const e = input.graph.entity(id);
    return e && enabled.has(e.type);
  });

  if (rated.length === 0) return out;

  /* --- what you actually love and avoid ---------------------------------- */

  const byValue = [...rated].sort((a, b) => b[1].normalized - a[1].normalized);
  const top = byValue.slice(0, 5);
  const bottom = [...byValue].reverse().slice(0, 5);

  if (top.length > 0) {
    out.push({
      id: 'favourite',
      kind: 'favourite',
      title: 'Your highest judgements',
      finding: `${top.length} item${top.length === 1 ? '' : 's'} sit at the top of everything you have rated.`,
      evidence: 'Ranked by your explicit rating, highest first. No computed scores involved.',
      weight: 100,
      entities: top.map(([id, r]) => ({
        entityId: id,
        name: name(input.graph, id),
        detail: `${Math.round(r.normalized)} / 100`,
        value: r.normalized,
      })),
    });
  }

  if (bottom.length > 0 && byValue.length >= 4) {
    out.push({
      id: 'avoid',
      kind: 'avoid',
      title: 'Your lowest judgements',
      finding: 'These are the things you have rated furthest down.',
      evidence: 'Ranked by your explicit rating, lowest first.',
      weight: 90,
      entities: bottom.map(([id, r]) => ({
        entityId: id,
        name: name(input.graph, id),
        detail: `${Math.round(r.normalized)} / 100`,
        value: r.normalized,
      })),
    });
  }

  /* --- polarizing parents ------------------------------------------------ */

  const polarizing: InsightEntity[] = [];
  const coverageGaps: InsightEntity[] = [];
  const explore: InsightEntity[] = [];
  const deprioritise: InsightEntity[] = [];

  for (const entity of input.graph.allEntities()) {
    if (!enabled.has(entity.type)) continue;
    const children = input.graph.children(entity.id);
    if (children.length < 3) continue;
    const childValues: number[] = [];
    for (const edge of children) {
      const r = input.explicit.get(edge.childId);
      if (r) childValues.push(r.normalized);
    }
    if (childValues.length >= 3) {
      const spread = stdev(childValues);
      if (spread >= 18) {
        polarizing.push({
          entityId: entity.id,
          name: entity.name,
          detail: `spread ${Math.round(spread)} across ${childValues.length} rated items`,
          value: spread,
        });
      }
      const mean = childValues.reduce((a, b) => a + b, 0) / childValues.length;
      const coverageRatio = childValues.length / children.length;
      if (mean >= 72 && coverageRatio < 0.5) {
        explore.push({
          entityId: entity.id,
          name: entity.name,
          detail: `you rated ${childValues.length} of ${children.length}, averaging ${Math.round(mean)}`,
          value: mean,
        });
      }
      if (mean <= 35 && childValues.length >= 4) {
        deprioritise.push({
          entityId: entity.id,
          name: entity.name,
          detail: `${childValues.length} rated items, averaging ${Math.round(mean)}`,
          value: -mean,
        });
      }
    }
    const score = input.scores.get(entity.id);
    if (score && score.coverage.total >= 4 && !score.coverage.meetsMinimum) {
      coverageGaps.push({
        entityId: entity.id,
        name: entity.name,
        detail: `${score.coverage.rated} of ${score.coverage.total} rated`,
        value: -score.coverage.ratio,
      });
    }
  }

  pushList(out, {
    id: 'polarizing',
    kind: 'polarizing',
    title: 'Where you disagree with yourself',
    finding: 'Inside these, your ratings are spread far apart.',
    evidence:
      'Standard deviation of at least 18 points across three or more rated items directly inside.',
    weight: 80,
    entities: polarizing,
  });

  pushList(out, {
    id: 'coverage',
    kind: 'coverage',
    title: 'Thinly covered',
    finding: 'These have a computed score standing on very little evidence.',
    evidence: 'Coverage below your minimum threshold with at least four items inside.',
    weight: 70,
    entities: coverageGaps,
  });

  /* --- hidden gems ------------------------------------------------------- */

  const played = new Set<EntityId>([
    ...input.signals.recentlyPlayed.map((p) => p.entityId),
    ...input.signals.top.map((t) => t.entityId),
  ]);
  const gems: InsightEntity[] = [];
  if (played.size > 0) {
    for (const [id, r] of rated) {
      if (r.normalized < 75 || played.has(id)) continue;
      const age = now - r.at;
      if (age < 14 * DAY) continue;
      gems.push({
        entityId: id,
        name: name(input.graph, id),
        detail: `rated ${Math.round(r.normalized)} but absent from your recent listening`,
        value: r.normalized,
      });
    }
  }
  pushList(out, {
    id: 'hidden-gem',
    kind: 'hidden-gem',
    title: 'Rated high, not in rotation',
    finding: 'You rate these well but they are missing from your recent and top listening.',
    evidence:
      'Explicit rating of 75 or more, rated over two weeks ago, and not present in recently played or any top-items list.',
    weight: 75,
    entities: gems,
  });

  /* --- drift ------------------------------------------------------------- */

  const byMonth = new Map<string, number[]>();
  for (const e of input.events) {
    if (e.deleted || e.retracted) continue;
    const d = new Date(e.at);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const list = byMonth.get(key);
    if (list) list.push(e.normalized);
    else byMonth.set(key, [e.normalized]);
  }
  const months = [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (months.length >= 3) {
    const first = months[0] as [string, number[]];
    const last = months[months.length - 1] as [string, number[]];
    const firstMean = first[1].reduce((a, b) => a + b, 0) / first[1].length;
    const lastMean = last[1].reduce((a, b) => a + b, 0) / last[1].length;
    const delta = lastMean - firstMean;
    if (Math.abs(delta) >= 5) {
      out.push({
        id: 'drift',
        kind: 'drift',
        title: delta > 0 ? 'You have grown more generous' : 'You have grown harsher',
        finding: `Your average rating moved ${delta > 0 ? 'up' : 'down'} ${Math.abs(Math.round(delta))} points between ${first[0]} and ${last[0]}.`,
        evidence: `Mean of every rating recorded in ${first[0]} (${Math.round(firstMean)}) against ${last[0]} (${Math.round(lastMean)}).`,
        weight: 65,
        entities: months.slice(-8).map(([key, values]) => ({
          entityId: key,
          name: key,
          detail: `${Math.round(values.reduce((a, b) => a + b, 0) / values.length)} across ${values.length}`,
          value: values.reduce((a, b) => a + b, 0) / values.length,
        })),
      });
    }
  }

  /* --- ranking stability ------------------------------------------------- */

  const stable: InsightEntity[] = [];
  const uncertain: InsightEntity[] = [];
  for (const [, table] of input.rankings) {
    for (const [id, state] of table) {
      const entity = input.graph.entity(id);
      if (!entity || !enabled.has(entity.type)) continue;
      const confidence = rankingConfidence(state);
      const target = confidence >= 0.7 ? stable : uncertain;
      target.push({
        entityId: id,
        name: entity.name,
        detail: `${state.comparisons} comparison${state.comparisons === 1 ? '' : 's'}, ${Math.round(confidence * 100)}% settled`,
        value: confidence >= 0.7 ? confidence : -confidence,
      });
    }
  }
  pushList(out, {
    id: 'stable',
    kind: 'stable',
    title: 'Settled positions',
    finding: 'These have been compared enough that their position is unlikely to move.',
    evidence: 'Ranking confidence of 70% or more, from comparison count and rating deviation.',
    weight: 60,
    entities: stable,
  });
  pushList(out, {
    id: 'uncertain',
    kind: 'uncertain',
    title: 'Still unsettled',
    finding: 'A few more comparisons would firm these up.',
    evidence: 'Ranking confidence below 70%.',
    weight: 62,
    entities: uncertain,
  });

  pushList(out, {
    id: 'explore',
    kind: 'explore',
    title: 'Probably worth more of your time',
    finding: 'You rate what you have heard of these highly, and there is a lot you have not rated.',
    evidence:
      'Average of your ratings inside is 72 or more, and you have rated fewer than half the items. This is a rule over your own ratings — nothing recommended it.',
    weight: 85,
    entities: explore,
  });
  pushList(out, {
    id: 'deprioritise',
    kind: 'deprioritise',
    title: 'Probably safe to skip',
    finding: 'Consistently low ratings across several items.',
    evidence:
      'Four or more rated items inside, averaging 35 or below. A rule over your own ratings, not a judgement about the music.',
    weight: 55,
    entities: deprioritise,
  });

  return out.sort((a, b) => b.weight - a.weight);
}

function pushList(out: Insight[], insight: Insight, limit = 6): void {
  if (insight.entities.length === 0) return;
  const entities = [...insight.entities]
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, limit);
  out.push({ ...insight, entities });
}
