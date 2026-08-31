import { clampNormalized } from './scales';
import type {
  ContextExplanation,
  ContextSnapshot,
  Coverage,
  EntityType,
  FacetConfig,
  FacetContribution,
  FacetJudgement,
} from './types';
import { CONTEXT_SCHEMA_VERSION } from './types';

/**
 * Contextual ratings.
 *
 * Three numbers, kept apart on purpose:
 *
 *   1. **Your rating** — the direct judgement. Nothing in this file may change
 *      it, and nothing computed here is ever written back over it.
 *   2. **Context score** — a weighted mean of whichever optional facets you
 *      chose to rate. It exists only when you rated at least one.
 *   3. **Context-adjusted rating** — the two blended, and only when you have
 *      asked for that. It is off by default, so installing this feature moves
 *      nobody's scores.
 *
 * Every facet here is the user's own opinion. A release year is a fact and may
 * be printed beside the question; whether a record was innovative, influential
 * or has held up is not something a catalogue can know.
 */

/* -------------------------------------------------------------------------- */
/* Built-in facets                                                            */
/* -------------------------------------------------------------------------- */

const ALL_MUSIC: EntityType[] = ['artist', 'album', 'track'];

/**
 * Restrained on purpose: three to five questions per type. A rubric long
 * enough to feel like paperwork is a rubric nobody fills in.
 */
export const BUILTIN_FACETS: readonly FacetConfig[] = [
  {
    id: 'enjoyment',
    label: 'Enjoyment',
    description: 'How much you personally enjoy it.',
    types: ['artist', 'album', 'track', 'playlist', 'show', 'episode', 'audiobook', 'chapter'],
    weight: 1,
    enabled: true,
    builtin: true,
    order: 0,
  },
  {
    id: 'craft',
    label: 'Craft',
    description: 'How well made or performed it is.',
    types: ['artist', 'album', 'track', 'show', 'episode', 'audiobook'],
    weight: 1,
    enabled: true,
    builtin: true,
    order: 1,
  },
  {
    id: 'innovation',
    label: 'Innovation for its time',
    description: 'How original or forward-looking it was when it came out.',
    types: [...ALL_MUSIC],
    weight: 1,
    enabled: true,
    builtin: true,
    temporal: true,
    order: 2,
  },
  {
    id: 'influence',
    label: 'Influence',
    description: 'How much it shaped what came after it.',
    types: ['artist', 'album'],
    weight: 1,
    enabled: true,
    builtin: true,
    temporal: true,
    order: 3,
  },
  {
    id: 'staying-power',
    label: 'Staying power',
    description: 'How well it holds up now.',
    types: ['album', 'track', 'playlist'],
    weight: 1,
    enabled: true,
    builtin: true,
    order: 4,
  },
  {
    id: 'consistency',
    label: 'Consistency',
    description: 'How reliably good the work is across the whole run.',
    types: ['artist', 'show'],
    weight: 1,
    enabled: true,
    builtin: true,
    order: 5,
  },
  {
    id: 'curation',
    label: 'Curation',
    description: 'How well the choices and the running order work together.',
    types: ['playlist'],
    weight: 1,
    enabled: true,
    builtin: true,
    order: 6,
  },
  {
    id: 'narration',
    label: 'Narration',
    description: 'How well it is read and performed.',
    types: ['audiobook', 'chapter'],
    weight: 1,
    enabled: true,
    builtin: true,
    order: 7,
  },
];

export function defaultFacets(): FacetConfig[] {
  return BUILTIN_FACETS.map((f) => ({ ...f, types: [...f.types] }));
}

/** The default context contribution offered once the feature is switched on. */
export const DEFAULT_CONTEXT_CONTRIBUTION = 0.2;

/**
 * A ceiling, not a preference. Context is meant to inform a judgement, never to
 * outvote it, so the direct rating always keeps the majority.
 */
export const MAX_CONTEXT_CONTRIBUTION = 0.5;

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

export interface ContextConfig {
  /** Whether the context score is allowed to move the result at all. */
  enabled: boolean;
  /** Global contribution, 0..0.5. */
  contribution: number;
  /** Per-type override of the contribution. */
  byType?: Partial<Record<EntityType, number>>;
  facets: readonly FacetConfig[];
}

export const NO_CONTEXT: ContextConfig = {
  enabled: false,
  contribution: 0,
  facets: [],
};

export function clampContribution(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_CONTEXT_CONTRIBUTION, Math.max(0, value));
}

/** The contribution in force for one type: its override, or the global one. */
export function contributionFor(config: ContextConfig, type: EntityType): number {
  if (!config.enabled) return 0;
  const override = config.byType?.[type];
  return clampContribution(override ?? config.contribution);
}

/** The facets offered for one type, in display order. Disabled ones are gone. */
export function facetsForType(facets: readonly FacetConfig[], type: EntityType): FacetConfig[] {
  return facets
    .filter((f) => f.enabled && f.types.includes(type))
    .sort((a, b) => (a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : 1));
}

export function facetById(facets: readonly FacetConfig[], id: string): FacetConfig | undefined {
  return facets.find((f) => f.id === id);
}

/* -------------------------------------------------------------------------- */
/* Snapshots                                                                  */
/* -------------------------------------------------------------------------- */

/** Build the payload saved on a rating event. Returns null when nothing was rated. */
export function makeSnapshot(
  judgements: readonly FacetJudgement[],
  config: ContextConfig,
  type: EntityType,
): ContextSnapshot | null {
  const rated = judgements.filter((j) => Number.isFinite(j.normalized));
  if (rated.length === 0) return null;
  const applicable = facetsForType(config.facets, type);
  const weights: Record<string, number> = {};
  for (const j of rated) {
    const facet = facetById(config.facets, j.facetId);
    weights[j.facetId] = facet ? Math.max(0, facet.weight) : 1;
  }
  return {
    v: CONTEXT_SCHEMA_VERSION,
    facets: rated.map((j) => ({
      facetId: j.facetId,
      value: j.value,
      scaleId: j.scaleId,
      normalized: clampNormalized(j.normalized),
      ...(j.note?.trim() ? { note: j.note.trim() } : {}),
    })),
    weights,
    contribution: clampContribution(config.enabled ? config.contribution : 0),
    applicable: applicable.length,
  };
}

/* -------------------------------------------------------------------------- */
/* The score                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Weighted mean over the facets that were actually rated *and* still count.
 *
 * Weights renormalise over what is present, exactly as the rollup engine does
 * with its channels: rating three of five facets gives a real answer, and the
 * applied weights are reported so the substitution is visible.
 */
export function contextRows(
  snapshot: ContextSnapshot | null | undefined,
  config: ContextConfig,
  type: EntityType,
): FacetContribution[] {
  if (!snapshot?.facets.length) return [];
  const applicable = new Set(facetsForType(config.facets, type).map((f) => f.id));

  const rows: FacetContribution[] = [];
  let total = 0;
  for (const j of snapshot.facets) {
    const facet = facetById(config.facets, j.facetId);
    const orphaned = !facet || !applicable.has(j.facetId);
    const requested = orphaned ? 0 : Math.max(0, facet.weight);
    if (!orphaned) total += requested;
    rows.push({
      facetId: j.facetId,
      label: facet?.label ?? unknownLabel(j.facetId),
      normalized: clampNormalized(j.normalized),
      value: j.value,
      scaleId: j.scaleId,
      requestedWeight: requested,
      appliedWeight: 0,
      ...(j.note ? { note: j.note } : {}),
      ...(orphaned ? { orphaned: true as const } : {}),
    });
  }

  const counting = rows.filter((r) => !r.orphaned);
  if (counting.length > 0) {
    if (total > 0) {
      for (const row of counting) row.appliedWeight = row.requestedWeight / total;
    } else {
      // Every applicable facet was weighted to zero. Equal shares beats
      // silently returning nothing the user cannot see or fix.
      for (const row of counting) row.appliedWeight = 1 / counting.length;
    }
  }
  return rows.sort(byFacetOrder(config.facets));
}

function byFacetOrder(facets: readonly FacetConfig[]) {
  const order = new Map(facets.map((f, i) => [f.id, f.order ?? i]));
  return (a: FacetContribution, b: FacetContribution) => {
    const ao = order.get(a.facetId) ?? Number.MAX_SAFE_INTEGER;
    const bo = order.get(b.facetId) ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.facetId < b.facetId ? -1 : a.facetId > b.facetId ? 1 : 0;
  };
}

/** A facet id with no configuration left. Readable, and obviously a fallback. */
function unknownLabel(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)} (removed)` : 'Removed facet';
}

export function scoreFromRows(rows: readonly FacetContribution[]): number | null {
  let acc = 0;
  let total = 0;
  for (const row of rows) {
    if (row.orphaned || !(row.appliedWeight > 0)) continue;
    acc += row.normalized * row.appliedWeight;
    total += row.appliedWeight;
  }
  return total > 0 ? clampNormalized(acc / total) : null;
}

/**
 * Blend the direct rating with the context score.
 *
 * Returns null when either side is missing: a context score on its own is not a
 * quieter version of your rating, and must never be presented as one.
 */
export function adjustedRating(
  direct: number | null,
  context: number | null,
  contribution: number,
): number | null {
  if (direct == null || context == null) return null;
  const c = clampContribution(contribution);
  if (c <= 0) return null;
  return clampNormalized(direct * (1 - c) + context * c);
}

/**
 * What every downstream computation should treat as "the explicit rating".
 *
 * Exactly one value, counted exactly once. Context reaches the rollup through
 * this and nowhere else, so it can never be scored twice.
 */
export function effectiveExplicit(direct: number | null, adjusted: number | null): number | null {
  return adjusted ?? direct;
}

export function coverageOf(rows: readonly FacetContribution[], applicable: number): Coverage {
  const rated = rows.filter((r) => !r.orphaned).length;
  const total = Math.max(applicable, rated);
  return {
    rated,
    total,
    ratio: total === 0 ? 0 : rated / total,
    meetsMinimum: rated > 0,
  };
}

export interface ExplainContextInput {
  snapshot: ContextSnapshot | null | undefined;
  direct: number | null;
  config: ContextConfig;
  type: EntityType;
}

/**
 * The whole contextual account of one rating: rows, score, blend, coverage, and
 * whether today's weights differ from the ones it was saved with.
 *
 * Today's settings compute today's score — changing a weight is meant to change
 * what you see now. The saved weights are preserved on the event and surfaced
 * here when they differ, so the change is inspectable rather than invisible.
 */
export function explainContext(input: ExplainContextInput): ContextExplanation | null {
  const { snapshot, direct, config, type } = input;
  if (!snapshot?.facets.length) return null;

  const rows = contextRows(snapshot, config, type);
  const score = scoreFromRows(rows);
  const contribution = contributionFor(config, type);
  const adjusted = adjustedRating(direct, score, contribution);
  const applicable = Math.max(snapshot.applicable, facetsForType(config.facets, type).length);

  const out: ContextExplanation = {
    score,
    adjusted,
    contribution,
    enabled: config.enabled,
    coverage: coverageOf(rows, applicable),
    rows,
  };
  const savedWith = differingWeights(snapshot, rows);
  if (savedWith) out.savedWith = savedWith;
  return out;
}

function differingWeights(
  snapshot: ContextSnapshot,
  rows: readonly FacetContribution[],
): Record<string, number> | undefined {
  let differs = false;
  for (const row of rows) {
    if (row.orphaned) continue;
    const then = snapshot.weights[row.facetId];
    if (then === undefined) continue;
    if (Math.abs(then - row.requestedWeight) > 1e-9) differs = true;
  }
  return differs ? { ...snapshot.weights } : undefined;
}

/* -------------------------------------------------------------------------- */
/* Editing                                                                    */
/* -------------------------------------------------------------------------- */

/** Facet judgements keyed for an editor, dropping anything unreadable. */
export function judgementsById(
  snapshot: ContextSnapshot | null | undefined,
): Map<string, FacetJudgement> {
  const out = new Map<string, FacetJudgement>();
  for (const j of snapshot?.facets ?? []) {
    if (!Number.isFinite(j.normalized)) continue;
    out.set(j.facetId, { ...j });
  }
  return out;
}

/** A deep copy for editing, so a draft can be abandoned without trace. */
export function copySnapshot(snapshot: ContextSnapshot | null | undefined): ContextSnapshot | null {
  if (!snapshot) return null;
  return {
    v: snapshot.v,
    facets: snapshot.facets.map((f) => ({ ...f })),
    weights: { ...snapshot.weights },
    contribution: snapshot.contribution,
    applicable: snapshot.applicable,
  };
}

/**
 * Validate one facet judgement before it joins a draft.
 *
 * Nothing here throws: a facet that cannot be read is simply not recorded, and
 * the caller is told which one and why.
 */
export function validateJudgement(judgement: FacetJudgement): string | null {
  if (!judgement.facetId) return 'This judgement has no facet.';
  if (!Number.isFinite(judgement.normalized)) return 'This judgement has no value.';
  if (judgement.normalized < 0 || judgement.normalized > 100) {
    return 'This judgement is outside the 0 to 100 range.';
  }
  if (!judgement.scaleId) return 'This judgement does not say which scale it used.';
  return null;
}
