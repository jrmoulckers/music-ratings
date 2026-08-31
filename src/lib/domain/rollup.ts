import { rankingConfidence, rankingToNormalized, type RankingTable } from './elo';
import {
  adjustedRating,
  effectiveExplicit as pickEffectiveExplicit,
  explainContext,
  NO_CONTEXT,
  type ContextConfig,
} from './context';
import { walkDescendants, type ContainmentGraph, type DescendantHit } from './graph';
import { CONFIDENCE_WEIGHT, recencyWeight, type ExplicitRating } from './ratings';
import { clampNormalized } from './scales';
import type {
  AggregationMethod,
  ChannelExplanation,
  ContextExplanation,
  Coverage,
  EntityAnnotation,
  EntityId,
  EntityType,
  ExclusionCode,
  ExclusionNote,
  RollupChannel,
  RollupConfig,
  RollupConfigByType,
  RollupWeights,
  ScoreBreakdown,
  ScoreContributor,
} from './types';
import { ROLLUP_CHANNELS } from './types';

/**
 * The rollup engine.
 *
 * Three rules govern everything here:
 *
 *   1. An explicit rating is never overwritten by a computed one. They live in
 *      separate fields and are blended only for display.
 *   2. Every number can be explained. The engine returns the weights it was
 *      asked for, the weights it actually applied after renormalising over the
 *      evidence that existed, each channel's sample, and a note for everything
 *      it deliberately left out.
 *   3. Contextual facets reach a score through the explicit channel and nowhere
 *      else. They are never a channel of their own, so no judgement can be
 *      counted twice.
 */

export interface RollupInput {
  graph: ContainmentGraph;
  explicit: ReadonlyMap<EntityId, ExplicitRating>;
  /** One ranking table per entity type; comparisons never cross types. */
  rankings: ReadonlyMap<EntityType, RankingTable>;
  config: RollupConfigByType;
  annotations?: ReadonlyMap<EntityId, EntityAnnotation>;
  /** Weight given to the explicit rating when blending for display, 0..1. */
  blendExplicitWeight?: number;
  /** Contextual facet configuration. Omitted means context is switched off. */
  context?: ContextConfig;
  now?: number;
}

interface WeightedSample {
  entityId: EntityId;
  name: string;
  value: number;
  weight: number;
  via: string;
  groupId: EntityId;
}

/* -------------------------------------------------------------------------- */
/* Aggregation                                                                */
/* -------------------------------------------------------------------------- */

export function weightedMean(samples: readonly { value: number; weight: number }[]): number | null {
  let sum = 0;
  let total = 0;
  for (const s of samples) {
    if (!(s.weight > 0)) continue;
    sum += s.value * s.weight;
    total += s.weight;
  }
  return total > 0 ? sum / total : null;
}

export function weightedMedian(
  samples: readonly { value: number; weight: number }[],
): number | null {
  const live = samples.filter((s) => s.weight > 0).sort((a, b) => a.value - b.value);
  if (live.length === 0) return null;
  const total = live.reduce((acc, s) => acc + s.weight, 0);
  let running = 0;
  for (const s of live) {
    running += s.weight;
    if (running >= total / 2) return s.value;
  }
  return (live[live.length - 1] as { value: number }).value;
}

/** Drop the extreme 10% at each end (at least one item each side when n >= 5). */
export function trimmedMean(
  samples: readonly { value: number; weight: number }[],
  fraction = 0.1,
): number | null {
  const live = samples.filter((s) => s.weight > 0).sort((a, b) => a.value - b.value);
  if (live.length === 0) return null;
  if (live.length < 5) return weightedMean(live);
  const cut = Math.max(1, Math.floor(live.length * fraction));
  return weightedMean(live.slice(cut, live.length - cut));
}

export function bayesianMean(
  samples: readonly { value: number; weight: number }[],
  priorMean: number,
  priorWeight: number,
): number | null {
  if (samples.length === 0) return null;
  let sum = priorMean * priorWeight;
  let total = priorWeight;
  for (const s of samples) {
    if (!(s.weight > 0)) continue;
    sum += s.value * s.weight;
    total += s.weight;
  }
  return total > 0 ? sum / total : null;
}

export function aggregate(
  samples: readonly { value: number; weight: number }[],
  method: AggregationMethod,
  config: Pick<RollupConfig, 'bayesianPriorMean' | 'bayesianPriorWeight'>,
): number | null {
  switch (method) {
    case 'median':
      return weightedMedian(samples);
    case 'trimmed':
      return trimmedMean(samples);
    case 'bayesian':
      return bayesianMean(samples, config.bayesianPriorMean, config.bayesianPriorWeight);
    case 'mean':
    default:
      return weightedMean(samples);
  }
}

/* -------------------------------------------------------------------------- */
/* Weight renormalisation                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Renormalise the configured weights over the channels that actually produced
 * evidence. A user who wants 50% from their own rating still gets a usable
 * score for an album they have never rated directly — the remaining channels
 * simply grow to fill the gap, and the applied weights are reported so the
 * substitution is visible rather than silent.
 */
export function renormaliseWeights(
  requested: RollupWeights,
  available: ReadonlySet<RollupChannel>,
): RollupWeights {
  const applied: RollupWeights = {
    explicit: 0,
    directChildren: 0,
    descendants: 0,
    comparison: 0,
  };
  let total = 0;
  for (const channel of ROLLUP_CHANNELS) {
    if (!available.has(channel)) continue;
    total += Math.max(0, requested[channel]);
  }
  if (total <= 0) {
    // Every available channel was configured to zero: fall back to equal shares
    // rather than silently returning nothing.
    const n = available.size;
    if (n === 0) return applied;
    for (const channel of available) applied[channel] = 1 / n;
    return applied;
  }
  for (const channel of available) {
    applied[channel] = Math.max(0, requested[channel]) / total;
  }
  return applied;
}

/* -------------------------------------------------------------------------- */
/* Score computation                                                          */
/* -------------------------------------------------------------------------- */

const EXCLUSION_TEXT: Record<ExclusionCode, (n: number) => string> = {
  'duplicate-path': (n) =>
    `${n} path${n === 1 ? '' : 's'} led to an item already counted; each item counts once.`,
  unrated: (n) => `${n} item${n === 1 ? ' has' : 's have'} no rating yet.`,
  retracted: (n) => `${n} retracted rating${n === 1 ? '' : 's'} ignored.`,
  unavailable: (n) => `${n} item${n === 1 ? ' is' : 's are'} unavailable in your market.`,
  'below-coverage': () => 'Coverage is below your threshold, so this score is marked provisional.',
  self: () => 'The item itself is not counted as one of its own children.',
  'marked-duplicate': (n) => `${n} item${n === 1 ? '' : 's'} you folded into another record.`,
};

function note(code: ExclusionCode, count: number): ExclusionNote {
  return { code, count, detail: EXCLUSION_TEXT[code](count) };
}

export function computeScore(input: RollupInput, entityId: EntityId): ScoreBreakdown {
  const now = input.now ?? Date.now();
  const entity = input.graph.entity(entityId);
  const entityType = (entity?.type ?? 'track') as EntityType;
  const config = input.config[entityType] ?? DEFAULT_ROLLUP_CONFIG;
  const explicitRating = input.explicit.get(entityId) ?? null;
  const exclusions: ExclusionNote[] = [];

  /* --- context ----------------------------------------------------------- */

  const context = contextFor(input, explicitRating, entityType);
  const directValue_ = explicitRating?.normalized ?? null;
  const contextScore = context?.score ?? null;
  const contextAdjusted = context?.adjusted ?? null;
  const effective = pickEffectiveExplicit(directValue_, contextAdjusted);

  /* --- descendants ------------------------------------------------------- */

  const walk = entity ? walkDescendants(input.graph, entityId) : { hits: [], duplicatePaths: 0 };
  if (walk.duplicatePaths > 0) exclusions.push(note('duplicate-path', walk.duplicatePaths));

  const annotations = input.annotations;
  const usable: DescendantHit[] = [];
  let markedDuplicates = 0;
  let unavailable = 0;
  for (const hit of walk.hits) {
    if (annotations?.get(hit.entityId)?.duplicateOf) {
      markedDuplicates += 1;
      continue;
    }
    const child = input.graph.entity(hit.entityId);
    if (child && child.available === false && !input.explicit.has(hit.entityId)) {
      unavailable += 1;
      continue;
    }
    usable.push(hit);
  }
  if (markedDuplicates > 0) exclusions.push(note('marked-duplicate', markedDuplicates));
  if (unavailable > 0) exclusions.push(note('unavailable', unavailable));

  const direct = usable.filter((h) => h.depth === 1);
  const deeper = usable.filter((h) => h.depth > 1);

  const directSamples = toSamples(direct, input, config, now);
  const deeperSamples = toSamples(deeper, input, config, now);

  const unratedCount = usable.length - (directSamples.length + deeperSamples.length);
  if (unratedCount > 0) exclusions.push(note('unrated', unratedCount));

  /* --- channels ---------------------------------------------------------- */

  const channels: ChannelExplanation[] = [];
  const available = new Set<RollupChannel>();
  const values: Partial<Record<RollupChannel, number>> = {};

  if (explicitRating) {
    available.add('explicit');
    values.explicit = effective ?? explicitRating.normalized;
  }

  // Grouping is a descendant-channel idea: at depth 1 every child is already its
  // own group, so grouping there would silently discard share, confidence and
  // recency weighting.
  const directValue = aggregate(directSamples, config.method, config);
  if (directValue != null) {
    available.add('directChildren');
    values.directChildren = directValue;
  }

  const deeperValue = aggregateGrouped(deeperSamples, config);
  if (deeperValue != null) {
    available.add('descendants');
    values.descendants = deeperValue;
  }

  const ranking = input.rankings.get(entityType)?.get(entityId);
  if (ranking && ranking.comparisons > 0) {
    available.add('comparison');
    values.comparison = rankingToNormalized(ranking.rating);
  }

  const appliedWeights = renormaliseWeights(config.weights, available);

  channels.push(
    channel('explicit', values.explicit ?? null, config.weights, appliedWeights, {
      sampleSize: explicitRating ? 1 : 0,
      detail: explicitRating
        ? contextAdjusted != null
          ? `Your own rating, recorded ${describeAge(now - explicitRating.at)}, adjusted by your context score.`
          : `Your own rating, recorded ${describeAge(now - explicitRating.at)}.`
        : 'You have not rated this directly.',
      ...(explicitRating && entity
        ? {
            contributors: [
              {
                entityId,
                name: entity.name,
                normalized: effective ?? explicitRating.normalized,
                weight: 1,
                via: contextAdjusted != null ? 'context-adjusted' : 'direct',
              },
            ],
          }
        : {}),
    }),
  );

  channels.push(
    channel('directChildren', directValue, config.weights, appliedWeights, {
      sampleSize: directSamples.length,
      detail:
        directSamples.length > 0
          ? `${directSamples.length} rated item${directSamples.length === 1 ? '' : 's'} directly inside this one${
              config.groupChildrenByRelease ? ', grouped so long releases do not dominate' : ''
            }.`
          : 'Nothing directly inside this has been rated yet.',
      contributors: topContributors(directSamples),
    }),
  );

  channels.push(
    channel('descendants', deeperValue, config.weights, appliedWeights, {
      sampleSize: deeperSamples.length,
      detail:
        deeperSamples.length > 0
          ? `${deeperSamples.length} rated item${
              deeperSamples.length === 1 ? '' : 's'
            } further down, grouped by release.`
          : 'Nothing further down has been rated yet.',
      contributors: topContributors(deeperSamples),
    }),
  );

  channels.push(
    channel('comparison', values.comparison ?? null, config.weights, appliedWeights, {
      sampleSize: ranking?.comparisons ?? 0,
      detail: ranking?.comparisons
        ? `${ranking.wins}W · ${ranking.losses}L · ${ranking.draws}D across ${ranking.comparisons} comparison${
            ranking.comparisons === 1 ? '' : 's'
          }.`
        : 'Never put head to head.',
    }),
  );

  /* --- blend ------------------------------------------------------------- */

  let rollup: number | null = null;
  let weightSum = 0;
  let acc = 0;
  for (const ch of channels) {
    if (ch.value == null || ch.appliedWeight <= 0) continue;
    acc += ch.value * ch.appliedWeight;
    weightSum += ch.appliedWeight;
  }
  if (weightSum > 0) rollup = clampNormalized(acc / weightSum);

  const coverage = computeCoverage(usable, input.explicit, config.minCoverage);
  if (!coverage.meetsMinimum && coverage.total > 0) exclusions.push(note('below-coverage', 0));

  const blendWeight = clamp01(input.blendExplicitWeight ?? 0.6);
  // The blend reads the same value the explicit channel did, so one item never
  // means two different numbers on two different screens.
  const explicitValue = effective;
  let blended: number | null;
  if (explicitValue != null && rollup != null) {
    blended = clampNormalized(explicitValue * blendWeight + rollup * (1 - blendWeight));
  } else {
    blended = explicitValue ?? rollup;
  }

  const breakdown: ScoreBreakdown = {
    entityId,
    entityType,
    explicit: directValue_,
    contextScore,
    contextAdjusted,
    effectiveExplicit: effective,
    rollup,
    blended,
    channels,
    coverage,
    confidence: computeConfidence({
      explicit: explicitRating,
      directCount: directSamples.length,
      deeperCount: deeperSamples.length,
      coverage,
      ranking: ranking ? rankingConfidence(ranking) : 0,
    }),
    method: config.method,
    exclusions,
    computedAt: now,
  };
  if (ranking) breakdown.ranking = ranking;
  if (context) breakdown.context = context;
  return breakdown;
}

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

function contextFor(
  input: RollupInput,
  rating: ExplicitRating | null,
  type: EntityType,
): ContextExplanation | null {
  if (!rating?.contextual?.facets?.length) return null;
  return explainContext({
    snapshot: rating.contextual,
    direct: rating.normalized,
    config: input.context ?? NO_CONTEXT,
    type,
  });
}

/**
 * What one rated item is worth to whatever is counting it.
 *
 * A track means the same number to its album as it does on its own page, so
 * children contribute their context-adjusted value wherever context is on.
 */
function effectiveOf(input: RollupInput, rating: ExplicitRating, type: EntityType): number {
  const config = input.context;
  if (!config?.enabled || !rating.contextual?.facets?.length) return rating.normalized;
  const explained = explainContext({
    snapshot: rating.contextual,
    direct: rating.normalized,
    config,
    type,
  });
  return (
    adjustedRating(rating.normalized, explained?.score ?? null, explained?.contribution ?? 0) ??
    rating.normalized
  );
}

function channel(
  name: RollupChannel,
  value: number | null,
  requested: RollupWeights,
  applied: RollupWeights,
  rest: { sampleSize: number; detail: string; contributors?: ScoreContributor[] },
): ChannelExplanation {
  const out: ChannelExplanation = {
    channel: name,
    value: value == null ? null : clampNormalized(value),
    requestedWeight: requested[name],
    appliedWeight: applied[name],
    sampleSize: rest.sampleSize,
    detail: rest.detail,
  };
  if (rest.contributors?.length) out.contributors = rest.contributors;
  return out;
}

function toSamples(
  hits: readonly DescendantHit[],
  input: RollupInput,
  config: RollupConfig,
  now: number,
): WeightedSample[] {
  const out: WeightedSample[] = [];
  for (const hit of hits) {
    const rating = input.explicit.get(hit.entityId);
    if (!rating) continue;
    const entity = input.graph.entity(hit.entityId);
    let weight = hit.share > 0 ? hit.share : 1;
    if (config.weightByConfidence) weight *= CONFIDENCE_WEIGHT[rating.confidence];
    weight *= recencyWeight(rating.at, now, config.recencyHalfLifeDays);
    if (!(weight > 0)) continue;
    out.push({
      entityId: hit.entityId,
      name: entity?.name ?? hit.entityId,
      value: effectiveOf(input, rating, (entity?.type ?? 'track') as EntityType),
      weight,
      via: hit.via,
      groupId: hit.groupId,
    });
  }
  return out.sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0));
}

/**
 * Aggregate with optional release grouping.
 *
 * Without grouping, an artist with one 40-track live album and three tight
 * eight-track records would be judged mostly by the live album. Grouping
 * averages within each release first, then treats every release as one voice.
 */
function aggregateGrouped(samples: readonly WeightedSample[], config: RollupConfig): number | null {
  if (samples.length === 0) return null;
  if (!config.groupChildrenByRelease) return aggregate(samples, config.method, config);

  const groups = new Map<EntityId, WeightedSample[]>();
  for (const s of samples) {
    const list = groups.get(s.groupId);
    if (list) list.push(s);
    else groups.set(s.groupId, [s]);
  }
  if (groups.size === 1) return aggregate(samples, config.method, config);

  const groupValues: { value: number; weight: number }[] = [];
  for (const [, list] of [...groups].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const value = aggregate(list, config.method, config);
    if (value == null) continue;
    // A release with more rated tracks is somewhat more informative, but the
    // effect is logarithmic so length never becomes the loudest voice.
    groupValues.push({ value, weight: 1 + Math.log2(1 + list.length) });
  }
  return aggregate(groupValues, config.method, config);
}

function topContributors(samples: readonly WeightedSample[], limit = 6): ScoreContributor[] {
  return [...samples]
    .sort((a, b) => b.weight * b.value - a.weight * a.value)
    .slice(0, limit)
    .map((s) => ({
      entityId: s.entityId,
      name: s.name,
      normalized: s.value,
      weight: Math.round(s.weight * 100) / 100,
      via: s.via,
    }));
}

function computeCoverage(
  hits: readonly DescendantHit[],
  explicit: ReadonlyMap<EntityId, ExplicitRating>,
  minCoverage: number,
): Coverage {
  const total = hits.length;
  let rated = 0;
  for (const hit of hits) if (explicit.has(hit.entityId)) rated += 1;
  const ratio = total === 0 ? 0 : rated / total;
  return { rated, total, ratio, meetsMinimum: total === 0 ? true : ratio >= minCoverage };
}

function computeConfidence(args: {
  explicit: ExplicitRating | null;
  directCount: number;
  deeperCount: number;
  coverage: Coverage;
  ranking: number;
}): number {
  const n = args.directCount + args.deeperCount;
  const breadth = n === 0 ? 0 : Math.min(1, Math.log2(1 + n) / Math.log2(1 + 16));
  const explicitStated = args.explicit ? CONFIDENCE_WEIGHT[args.explicit.confidence] / 1.5 : 0;
  const parts: { value: number; weight: number }[] = [];
  if (args.explicit) parts.push({ value: explicitStated, weight: 0.45 });
  if (n > 0)
    parts.push({ value: breadth, weight: 0.25 }, { value: args.coverage.ratio, weight: 0.2 });
  if (args.ranking > 0) parts.push({ value: args.ranking, weight: 0.2 });
  if (parts.length === 0) return 0;
  const total = parts.reduce((acc, p) => acc + p.weight, 0);
  return clamp01(parts.reduce((acc, p) => acc + p.value * p.weight, 0) / total);
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function describeAge(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/* -------------------------------------------------------------------------- */
/* Defaults                                                                   */
/* -------------------------------------------------------------------------- */

export const DEFAULT_ROLLUP_WEIGHTS: RollupWeights = {
  explicit: 0.5,
  directChildren: 0.3,
  descendants: 0.1,
  comparison: 0.1,
};

export const DEFAULT_ROLLUP_CONFIG: RollupConfig = {
  weights: { ...DEFAULT_ROLLUP_WEIGHTS },
  method: 'mean',
  recencyHalfLifeDays: 0,
  minCoverage: 0.25,
  bayesianPriorWeight: 3,
  bayesianPriorMean: 50,
  groupChildrenByRelease: true,
  weightByConfidence: true,
};

/** Leaves have no children, so their evidence is their own rating and duels. */
export const DEFAULT_LEAF_CONFIG: RollupConfig = {
  ...DEFAULT_ROLLUP_CONFIG,
  weights: { explicit: 0.8, directChildren: 0, descendants: 0, comparison: 0.2 },
  groupChildrenByRelease: false,
};

export function defaultRollupConfigByType(): RollupConfigByType {
  const leaf = () => ({ ...DEFAULT_LEAF_CONFIG, weights: { ...DEFAULT_LEAF_CONFIG.weights } });
  const parent = () => ({
    ...DEFAULT_ROLLUP_CONFIG,
    weights: { ...DEFAULT_ROLLUP_CONFIG.weights },
  });
  return {
    artist: parent(),
    album: parent(),
    playlist: parent(),
    show: parent(),
    audiobook: parent(),
    track: leaf(),
    episode: leaf(),
    chapter: leaf(),
  };
}

/** Compute breakdowns for many entities in one pass. */
export function computeScores(
  input: RollupInput,
  entityIds: readonly EntityId[],
): Map<EntityId, ScoreBreakdown> {
  const out = new Map<EntityId, ScoreBreakdown>();
  for (const id of entityIds) out.set(id, computeScore(input, id));
  return out;
}
