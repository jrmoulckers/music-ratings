import { derived, get, writable, type Readable } from 'svelte/store';

import {
  buildCanonicalIndex,
  legacyAliases,
  resolveAnnotations,
  resolveCollections,
  resolveQueueStates,
  resolveSignalIds,
  type CanonicalIndex,
} from '../domain/canonical';
import { computeRankings, type RankingTable } from '../domain/elo';
import type { ContextConfig } from '../domain/context';
import { ContainmentGraph } from '../domain/graph';
import { indexCurrentRatings, type ExplicitRating } from '../domain/ratings';
import { computeScores } from '../domain/rollup';
import { BUILTIN_SCALES, resolveScale } from '../domain/scales';
import { typeNoun } from '../domain/reasons';
import { EMPTY_SIGNALS, scoreSuggestions, type ListeningSignals } from '../domain/suggestions';
import type {
  CanonicalGroup,
  Collection,
  Comparison,
  Entity,
  EntityAnnotation,
  EntityId,
  EntityType,
  Membership,
  QueueState,
  RatingEvent,
  RatingScale,
  ScoreBreakdown,
  Suggestion,
} from '../domain/types';
import { ENTITY_TYPES } from '../domain/types';
import { dataVersion } from '../storage/changes';
import { META_SETTINGS, readSettings, writeMeta } from '../storage/db';
import { loadWorld } from '../storage/repo';
import { hydrateSettings, type AppSettings } from '../storage/settings';
import { readSignals } from '../spotify/library';

/**
 * One derived chain, recomputed whenever stored data changes.
 *
 * Everything expensive is computed here once and shared, so no screen has to
 * decide for itself what an item's score is. The chain is deliberately plain:
 * load → canonical → graph → ratings → rankings → scores → suggestions.
 *
 * Canonicalisation sits second on purpose. Combined duplicates are resolved
 * once, here, and every layer below reads a world in which a record the user
 * declared to be one thing *is* one thing — one row in a list, one candidate in
 * a duel, one child in a rollup. No screen resolves an alias for itself.
 */

export interface World {
  entities: Entity[];
  memberships: Membership[];
  ratings: RatingEvent[];
  comparisons: Comparison[];
  queueStates: QueueState[];
  annotations: EntityAnnotation[];
  collections: Collection[];
  scales: RatingScale[];
  canonicalGroups: CanonicalGroup[];
}

const EMPTY_WORLD: World = {
  entities: [],
  memberships: [],
  ratings: [],
  comparisons: [],
  queueStates: [],
  annotations: [],
  collections: [],
  scales: [],
  canonicalGroups: [],
};

export const world = writable<World>(EMPTY_WORLD);
export const settings = writable<AppSettings>(hydrateSettings(undefined));
export const signals = writable<ListeningSignals>(EMPTY_SIGNALS);
/**
 * When each kind of Spotify signal was last read. Listening goes stale in
 * minutes and the library does not, so the two are dated separately.
 */
export const signalsReadAt = writable<{ library: number | null; listening: number | null }>({
  library: null,
  listening: null,
});
export const ready = writable(false);
/** Bumped on every reload so relative times do not go stale mid-session. */
export const clock = writable(Date.now());

/**
 * When the current rating pass began.
 *
 * A pass is one sitting with the queue. Skipping something takes it out for the
 * rest of that pass, so the queue needs to know when the pass started — and
 * starting a new one has to be an explicit act by the Rate page, not a side
 * effect of any component that happens to mount.
 */
export const ratePassStartedAt = writable(Date.now());

export function beginRatePass(): void {
  ratePassStartedAt.set(Date.now());
}

let queue: Promise<void> = Promise.resolve();

export async function loadAll(): Promise<void> {
  const [stored, loaded, storedSignals] = await Promise.all([
    readSettings(),
    loadWorld(),
    readSignals(),
  ]);
  settings.set(hydrateSettings(stored));
  world.set(loaded);
  applySignals(storedSignals);
  clock.set(Date.now());
  ready.set(true);
}

/** Reloads stored data without touching settings, after any mutation. */
export async function refreshWorld(): Promise<void> {
  const [loaded, storedSignals] = await Promise.all([loadWorld(), readSignals()]);
  world.set(loaded);
  applySignals(storedSignals);
  clock.set(Date.now());
}

function applySignals(stored: Awaited<ReturnType<typeof readSignals>>): void {
  if (!stored) return;
  signals.set({
    recentlyPlayed: stored.recentlyPlayed,
    top: stored.top,
    saved: stored.saved,
  });
  signalsReadAt.set({
    library: stored.fetchedAt ?? null,
    listening: stored.listeningFetchedAt ?? stored.fetchedAt ?? null,
  });
}

/** Keeps the UI in step with the repository without either side polling. */
export function startStateSync(): () => void {
  let first = true;
  return dataVersion.subscribe(() => {
    if (first) {
      first = false;
      return;
    }
    queue = queue.then(() => refreshWorld()).catch(() => undefined);
  });
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next: AppSettings = { ...get(settings), ...patch, updatedAt: Date.now() };
  settings.set(next);
  await writeMeta(META_SETTINGS, next);
  return next;
}

/* -------------------------------------------------------------------------- */
/* Derived chain                                                              */
/* -------------------------------------------------------------------------- */

export const allScales: Readable<RatingScale[]> = derived(world, ($world) => [
  ...BUILTIN_SCALES,
  ...$world.scales,
]);

/**
 * Which sources the user has declared to be one record.
 *
 * Built from the stored groups, plus any `duplicateOf` pointer still riding on
 * an annotation — a device that has not upgraded yet can still send one, and it
 * meant the same thing when it was written.
 */
export const canonical: Readable<CanonicalIndex> = derived(world, ($world) =>
  buildCanonicalIndex(
    $world.canonicalGroups,
    legacyAliases($world.annotations),
    new Set($world.entities.map((e) => e.id)),
  ),
);

/** A source id in, the canonical id out. The one function screens reach for. */
export const canonicalId: Readable<(id: EntityId) => EntityId> = derived(
  canonical,
  ($canonical) =>
    (id: EntityId): EntityId =>
      $canonical.resolve(id),
);

export const graph: Readable<ContainmentGraph> = derived(
  [world, canonical],
  ([$world, $canonical]) => new ContainmentGraph($world.entities, $world.memberships, $canonical),
);

export const explicitRatings: Readable<Map<EntityId, ExplicitRating>> = derived(
  [world, canonical],
  ([$world, $canonical]) => indexCurrentRatings($world.ratings, $canonical.resolver),
);

export const annotationsById: Readable<Map<EntityId, EntityAnnotation>> = derived(
  [world, canonical],
  ([$world, $canonical]) => resolveAnnotations($world.annotations, $canonical),
);

/** Lists, with every combined source folded onto the record that stands for it. */
export const collections: Readable<Collection[]> = derived(
  [world, canonical],
  ([$world, $canonical]) => resolveCollections($world.collections, $canonical.resolver),
);

export const queueStatesById: Readable<Map<EntityId, QueueState>> = derived(
  [world, canonical],
  ([$world, $canonical]) => resolveQueueStates($world.queueStates, $canonical.resolver),
);

/** Spotify's evidence, read against the records the user actually keeps. */
export const canonicalSignals: Readable<ListeningSignals> = derived(
  [signals, canonical],
  ([$signals, $canonical]) => {
    if ($canonical.size === 0) return $signals;
    const resolve = $canonical.resolver;
    return {
      recentlyPlayed: resolveSignalIds($signals.recentlyPlayed, resolve),
      top: resolveSignalIds($signals.top, resolve),
      saved: resolveSignalIds($signals.saved, resolve),
    };
  },
);

export const rankings: Readable<Map<EntityType, RankingTable>> = derived(
  [world, canonical],
  ([$world, $canonical]) => {
    // One table per type: comparisons are never made across types, so a single
    // pooled ladder would be meaningless.
    const byType = new Map<EntityType, RankingTable>();
    for (const type of ENTITY_TYPES) {
      byType.set(type, computeRankings($world.comparisons, type, $canonical.resolver));
    }
    return byType;
  },
);

export const scores: Readable<Map<EntityId, ScoreBreakdown>> = derived(
  [graph, explicitRatings, rankings, annotationsById, settings, clock],
  ([$graph, $explicit, $rankings, $annotations, $settings, $clock]) =>
    computeScores(
      {
        graph: $graph,
        explicit: $explicit,
        rankings: $rankings,
        config: $settings.rollup,
        annotations: $annotations,
        blendExplicitWeight: $settings.blendExplicitWeight,
        context: {
          enabled: $settings.contextEnabled,
          contribution: $settings.contextContribution,
          byType: $settings.contextByType,
          facets: $settings.facets,
        },
        now: $clock,
      },
      $graph.allEntities().map((e) => e.id),
    ),
);

/** The facet configuration, as the rating editor and the score engine see it. */
export const contextConfig: Readable<ContextConfig> = derived(settings, ($settings) => ({
  enabled: $settings.contextEnabled,
  contribution: $settings.contextContribution,
  byType: $settings.contextByType,
  facets: $settings.facets,
}));

export const pinnedIds: Readable<Set<EntityId>> = derived(annotationsById, ($annotations) => {
  const out = new Set<EntityId>();
  for (const [id, annotation] of $annotations) {
    if (annotation.pinned) out.add(id);
  }
  return out;
});

export const suggestions: Readable<Suggestion[]> = derived(
  [
    graph,
    explicitRatings,
    scores,
    rankings,
    canonicalSignals,
    settings,
    queueStatesById,
    pinnedIds,
    clock,
    ratePassStartedAt,
  ],
  ([
    $graph,
    $explicit,
    $scores,
    $rankings,
    $signals,
    $settings,
    $queueStates,
    $pinned,
    $clock,
    $passStartedAt,
  ]) =>
    scoreSuggestions({
      graph: $graph,
      explicit: $explicit,
      scores: $scores,
      rankings: $rankings,
      signals: $signals,
      weights: $settings.suggestionWeights,
      queueStates: $queueStates,
      enabledTypes: $settings.enabledTypes,
      staleAfterDays: $settings.staleAfterDays,
      passStartedAt: $passStartedAt,
      pinnedIds: $pinned,
      now: $clock,
    }),
);

/* -------------------------------------------------------------------------- */
/* Conveniences the screens keep needing                                      */
/* -------------------------------------------------------------------------- */

export const scaleForType: Readable<(type: EntityType) => RatingScale> = derived(
  [settings, allScales],
  ([$settings, $scales]) =>
    (type: EntityType) =>
      resolveScale($scales, $settings.scaleByType[type] ?? $settings.defaultScaleId),
);

export interface Progress {
  type: EntityType;
  total: number;
  rated: number;
  ratio: number;
}

export const coverageByType: Readable<Progress[]> = derived(
  [graph, explicitRatings, settings],
  ([$graph, $explicit, $settings]) =>
    $settings.enabledTypes.map((type) => {
      const items = $graph.entitiesOfType(type);
      const rated = items.filter((e) => $explicit.has(e.id)).length;
      return {
        type,
        total: items.length,
        rated,
        ratio: items.length === 0 ? 0 : rated / items.length,
      };
    }),
);

export const recentActivity: Readable<RatingEvent[]> = derived(world, ($world) =>
  [...$world.ratings]
    .filter((r) => !r.deleted && !r.retracted)
    .sort((a, b) => b.at - a.at)
    .slice(0, 12),
);

/**
 * The words for each kind of thing live in the domain, so a reason sentence and
 * a heading can never disagree about whether an album is a "release".
 */
export const entityLabel = typeNoun;

/**
 * The same word at the head of a control or a heading.
 *
 * Type labels are stored lowercase because most of their uses sit inside a
 * sentence. A `<select>` option is not inside a sentence.
 */
export function entityLabelCap(type: EntityType, plural = false): string {
  const word = entityLabel(type, plural);
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * What each kind of thing is, in plain words.
 *
 * These are definitions, not caveats. What Spotify will and will not hand over
 * lives in ENTITY_SUPPORT and is shown separately, so an API limitation never
 * reads as part of the definition.
 */
export const ENTITY_MEANING: Record<EntityType, string> = {
  artist: 'The people or groups who make the music. Example: Radiohead.',
  album:
    'Albums, EPs, singles, compilations, and deluxe editions. A single can be both a release and the track inside it.',
  track: 'Individual songs or recordings. Example: one song from an album.',
  playlist: 'Lists of tracks put together by you or by other listeners.',
  show: 'Podcasts. Example: a weekly interview series.',
  episode: 'Individual episodes of a show.',
  audiobook: 'Books read aloud, divided into chapters.',
  chapter: 'Individual chapters of an audiobook.',
};
