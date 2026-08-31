import { currentRating, isLiveRating, type ExplicitRating } from './ratings';
import { clampNormalized, denormalize, normalize } from './scales';
import type {
  CanonicalGroup,
  Collection,
  Comparison,
  EntityAnnotation,
  EntityId,
  EntityType,
  QueueState,
  RatingConfidence,
  RatingEvent,
  RatingScale,
} from './types';

/**
 * Combined duplicates.
 *
 * Spotify holds the same record several times over: an original pressing, a
 * remaster, a regional edition, the same song again on a compilation. This
 * module is the whole rule set for treating a handful of those as one thing,
 * and it is deliberately pure — it reads records and returns plans, and never
 * writes anything.
 *
 * Three rules govern everything here:
 *
 *  1. Nothing is destroyed and nothing is rewritten. Every source entity
 *     survives with its own URI, artwork and provenance; every rating event and
 *     every comparison keeps its own id and its own subject. Combining adds one
 *     small group record, and at most one new rating event.
 *  2. The canonical id is the primary member's own entity id, never an invented
 *     one. Resolution maps each source id onto it, so a rating made against an
 *     alias last year still counts today, and changing the primary is one field.
 *  3. Every consequence is stated before it happens. `planCombine` returns the
 *     exact rating that would be written and says in words what becomes of the
 *     notes, tags and context answers that are not carried onto it.
 */

/* -------------------------------------------------------------------------- */
/* Resolution                                                                 */
/* -------------------------------------------------------------------------- */

/** The minimum any consumer needs: a source id in, the canonical id out. */
export interface CanonicalResolver {
  resolve(id: EntityId): EntityId;
  members(id: EntityId): readonly EntityId[];
  group(id: EntityId): CanonicalGroup | undefined;
}

export type IdResolver = (id: EntityId) => EntityId;

/** A legacy `EntityAnnotation.duplicateOf` pointer, bridged rather than dropped. */
export interface LegacyAlias {
  aliasId: EntityId;
  canonicalId: EntityId;
}

function typeOf(id: EntityId): string {
  const first = id.indexOf(':');
  return first > 0 ? id.slice(0, first) : '';
}

/**
 * The resolver every derived query runs through.
 *
 * Built once per world load and read everywhere. Overlaps are settled here
 * rather than being refused at the storage layer: a member can only ever belong
 * to one group, and where two groups claim the same source the older group
 * keeps it, so two devices that combined overlapping sets independently still
 * agree on what they are looking at.
 */
export class CanonicalIndex implements CanonicalResolver {
  private readonly aliasTo = new Map<EntityId, EntityId>();
  private readonly memberList = new Map<EntityId, EntityId[]>();
  private readonly byMember = new Map<EntityId, CanonicalGroup>();
  private readonly live: CanonicalGroup[] = [];

  /**
   * `present` is the set of entities this device actually holds, when the
   * caller knows it. A group whose sources have not all synced here yet must
   * not resolve ratings onto an id with no record behind it: the members that
   * are here stand on their own until the rest arrive, and nothing is hidden in
   * the meantime.
   */
  constructor(
    groups: readonly CanonicalGroup[] = [],
    legacy: readonly LegacyAlias[] = [],
    present?: ReadonlySet<EntityId>,
  ) {
    const claimed = new Set<EntityId>();
    const usable = (id: EntityId, type: string): boolean =>
      !claimed.has(id) && typeOf(id) === type && (!present || present.has(id));

    for (const group of sortGroups(groups)) {
      if (group.deleted) continue;
      const members = unique(group.memberIds)
        .filter((id) => usable(id, group.entityType))
        .sort();
      if (members.length < 2) continue;
      // A primary already spoken for by an older group — or not on this device
      // yet — leaves this one needing another. The lowest id is as good a rule
      // as any and, unlike "whichever came first in the array", it is the same
      // rule on every device.
      const primaryId = members.includes(group.primaryId)
        ? group.primaryId
        : (members[0] as string);
      const settled: CanonicalGroup = { ...group, primaryId, memberIds: members };
      this.adopt(settled, members, primaryId, claimed);
    }

    // A `duplicateOf` written by an older version still means what it said.
    // Pointers are gathered per target first, so three copies folded into one
    // record become one group rather than a chain of pairs. They are only
    // honoured where nothing has since been combined properly, so a real group
    // always wins over the record it replaced.
    const byTarget = new Map<EntityId, EntityId[]>();
    for (const { aliasId, canonicalId } of legacy) {
      if (aliasId === canonicalId) continue;
      const list = byTarget.get(canonicalId);
      if (list) list.push(aliasId);
      else byTarget.set(canonicalId, [aliasId]);
    }
    for (const canonicalId of [...byTarget.keys()].sort()) {
      if (claimed.has(canonicalId)) continue;
      const type = typeOf(canonicalId);
      if (!type || (present && !present.has(canonicalId))) continue;
      const members = unique([canonicalId, ...(byTarget.get(canonicalId) ?? [])])
        .filter((id) => usable(id, type))
        .sort();
      if (members.length < 2) continue;
      const bridged: CanonicalGroup = {
        id: `legacy:${canonicalId}`,
        entityType: type as EntityType,
        primaryId: canonicalId,
        memberIds: members,
        createdAt: 0,
        updatedAt: 0,
      };
      this.adopt(bridged, members, canonicalId, claimed);
    }
  }

  private adopt(
    group: CanonicalGroup,
    members: readonly EntityId[],
    primaryId: EntityId,
    claimed: Set<EntityId>,
  ): void {
    const ordered = [primaryId, ...members.filter((id) => id !== primaryId).sort()];
    this.live.push(group);
    this.memberList.set(primaryId, ordered);
    for (const id of ordered) {
      claimed.add(id);
      this.byMember.set(id, group);
      if (id !== primaryId) this.aliasTo.set(id, primaryId);
    }
  }

  static empty(): CanonicalIndex {
    return new CanonicalIndex([]);
  }

  /** The canonical id for any source id. Unknown ids stand for themselves. */
  resolve(id: EntityId): EntityId {
    return this.aliasTo.get(id) ?? id;
  }

  /** Every source folded into this id's group, primary first. */
  members(id: EntityId): readonly EntityId[] {
    return this.memberList.get(this.resolve(id)) ?? [id];
  }

  /** The sources other than the primary. */
  aliases(id: EntityId): readonly EntityId[] {
    const canonical = this.resolve(id);
    return this.members(canonical).filter((member) => member !== canonical);
  }

  isAlias(id: EntityId): boolean {
    return this.aliasTo.has(id);
  }

  isCombined(id: EntityId): boolean {
    return this.byMember.has(id);
  }

  group(id: EntityId): CanonicalGroup | undefined {
    return this.byMember.get(id);
  }

  groupById(groupId: string): CanonicalGroup | undefined {
    return this.live.find((g) => g.id === groupId);
  }

  all(): readonly CanonicalGroup[] {
    return this.live;
  }

  get size(): number {
    return this.live.length;
  }

  /** A plain function, for the places that only want to map an id. */
  get resolver(): IdResolver {
    return (id: EntityId) => this.resolve(id);
  }
}

export const EMPTY_CANONICAL: CanonicalIndex = CanonicalIndex.empty();

export function buildCanonicalIndex(
  groups: readonly CanonicalGroup[],
  legacy: readonly LegacyAlias[] = [],
  present?: ReadonlySet<EntityId>,
): CanonicalIndex {
  return new CanonicalIndex(groups, legacy, present);
}

/** The legacy pointers still carried by annotations, in a form the index reads. */
export function legacyAliases(annotations: readonly EntityAnnotation[]): LegacyAlias[] {
  const out: LegacyAlias[] = [];
  for (const annotation of annotations) {
    if (annotation.deleted || !annotation.duplicateOf) continue;
    out.push({ aliasId: annotation.id, canonicalId: annotation.duplicateOf });
  }
  return out;
}

function sortGroups(groups: readonly CanonicalGroup[]): CanonicalGroup[] {
  // Oldest first, ties by id: two devices replaying the same set of groups must
  // settle an overlap the same way without talking to each other.
  return [...groups].sort((a, b) =>
    a.createdAt !== b.createdAt ? a.createdAt - b.createdAt : a.id < b.id ? -1 : 1,
  );
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/* -------------------------------------------------------------------------- */
/* Resolving the records that point at entities                               */
/* -------------------------------------------------------------------------- */

/**
 * Comparisons, re-subjected.
 *
 * The stored rows are never touched: this returns copies whose `aId` and `bId`
 * read canonically, so the ladder can be replayed over them. A pair that became
 * a duel with itself once its two sides were combined is dropped — it says
 * nothing, and Elo would treat it as evidence.
 */
export function resolveComparisons(
  comparisons: readonly Comparison[],
  resolve: IdResolver,
): Comparison[] {
  const out: Comparison[] = [];
  for (const comparison of comparisons) {
    const aId = resolve(comparison.aId);
    const bId = resolve(comparison.bId);
    if (aId === bId) continue;
    out.push(
      aId === comparison.aId && bId === comparison.bId ? comparison : { ...comparison, aId, bId },
    );
  }
  return out;
}

/** Queue decisions merged onto the canonical id; the newest decision stands. */
export function resolveQueueStates(
  states: readonly QueueState[],
  resolve: IdResolver,
): Map<EntityId, QueueState> {
  const out = new Map<EntityId, QueueState>();
  for (const state of states) {
    if (state.deleted) continue;
    const id = resolve(state.id);
    const existing = out.get(id);
    const newer =
      !existing || state.at > existing.at || (state.at === existing.at && state.id > existing.id);
    if (!newer) continue;
    out.set(id, state.id === id ? state : { ...state, id });
  }
  return out;
}

/**
 * Notes and tags merged onto the canonical id.
 *
 * Tags are unioned, because a tag is a fact about the thing and every source was
 * describing the same thing. A standing note is not: the primary's note stands,
 * and where the primary has none the newest note among the sources is used, so
 * nothing a user wrote quietly disappears from view.
 */
export function resolveAnnotations(
  annotations: readonly EntityAnnotation[],
  index: CanonicalResolver,
): Map<EntityId, EntityAnnotation> {
  const grouped = new Map<EntityId, EntityAnnotation[]>();
  for (const annotation of annotations) {
    if (annotation.deleted) continue;
    const id = index.resolve(annotation.id);
    const list = grouped.get(id);
    if (list) list.push(annotation);
    else grouped.set(id, [annotation]);
  }

  const out = new Map<EntityId, EntityAnnotation>();
  for (const [id, list] of grouped) {
    if (list.length === 1 && (list[0] as EntityAnnotation).id === id) {
      out.set(id, list[0] as EntityAnnotation);
      continue;
    }
    const ordered = [...list].sort((a, b) =>
      a.id === id ? -1 : b.id === id ? 1 : b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1),
    );
    const tags = unique(ordered.flatMap((a) => a.tags ?? [])).sort();
    const merged: EntityAnnotation = {
      id,
      tags,
      updatedAt: Math.max(...ordered.map((a) => a.updatedAt)),
    };
    const note = ordered.find((a) => a.note?.trim())?.note;
    if (note) merged.note = note;
    const pinned = ordered.find((a) => a.pinned)?.pinned;
    if (pinned) merged.pinned = pinned;
    out.set(id, merged);
  }
  return out;
}

/** Collection membership resolved and de-duplicated, keeping the original order. */
export function resolveCollections(
  collections: readonly Collection[],
  resolve: IdResolver,
): Collection[] {
  return collections.map((collection) => {
    const seen = new Set<EntityId>();
    const entityIds: EntityId[] = [];
    for (const id of collection.entityIds) {
      const canonical = resolve(id);
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      entityIds.push(canonical);
    }
    return entityIds.length === collection.entityIds.length &&
      entityIds.every((id, i) => id === collection.entityIds[i])
      ? collection
      : { ...collection, entityIds };
  });
}

/** Any list of `{ entityId }` signals, mapped onto canonical ids. */
export function resolveSignalIds<T extends { entityId: EntityId }>(
  signals: readonly T[],
  resolve: IdResolver,
): T[] {
  return signals.map((signal) => {
    const entityId = resolve(signal.entityId);
    return entityId === signal.entityId ? signal : { ...signal, entityId };
  });
}

/* -------------------------------------------------------------------------- */
/* Combining: validation                                                      */
/* -------------------------------------------------------------------------- */

export type CombineProblemCode =
  'unknown-entity' | 'type-mismatch' | 'too-few' | 'already-combined' | 'primary-not-a-member';

export interface CombineProblem {
  code: CombineProblemCode;
  /** Said to the user as-is. */
  detail: string;
}

/** What the checks need to know about an entity: nothing but its type. */
export interface TypedEntity {
  id: EntityId;
  type: EntityType;
  name?: string;
}

export interface CombineRequest {
  entityIds: readonly EntityId[];
  primaryId: EntityId;
  entities: ReadonlyMap<EntityId, TypedEntity>;
  index: CanonicalResolver;
}

/**
 * Expand a request to the full set of sources it touches.
 *
 * Picking one member of an existing group means the whole group: combining a
 * remaster that is already folded into its original necessarily brings the
 * original with it, which is what stops a source ending up in two groups at
 * once and a resolver having to guess between them.
 */
export function expandMembers(
  entityIds: readonly EntityId[],
  index: CanonicalResolver,
): EntityId[] {
  const out = new Set<EntityId>();
  for (const id of entityIds) for (const member of index.members(id)) out.add(member);
  return [...out].sort();
}

export function checkCombine(request: CombineRequest): CombineProblem | null {
  const asked = unique(request.entityIds);
  for (const id of asked) {
    if (!request.entities.has(id)) {
      return { code: 'unknown-entity', detail: `${id} is not in your library.` };
    }
  }

  const members = expandMembers(asked, request.index);
  for (const id of members) {
    if (!request.entities.has(id)) {
      return {
        code: 'unknown-entity',
        detail: `${id} is part of one of these groups but is not in your library.`,
      };
    }
  }

  const types = unique(members.map((id) => request.entities.get(id)?.type as EntityType));
  if (types.length > 1) {
    return {
      code: 'type-mismatch',
      detail: `Only items of the same kind can be combined. These are ${types.join(' and ')}.`,
    };
  }

  if (members.length < 2) {
    return { code: 'too-few', detail: 'Combining needs two different items.' };
  }

  if (!members.includes(request.primaryId)) {
    return {
      code: 'primary-not-a-member',
      detail: 'The item chosen to represent the group is not one of the items being combined.',
    };
  }

  const existing = request.index.group(request.primaryId);
  if (
    existing &&
    existing.primaryId === request.primaryId &&
    sameSet(existing.memberIds, members)
  ) {
    return { code: 'already-combined', detail: 'These are already combined, exactly as chosen.' };
  }

  return null;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/* -------------------------------------------------------------------------- */
/* Combining: the rating consequence                                          */
/* -------------------------------------------------------------------------- */

export interface CombineSourceRating {
  entityId: EntityId;
  eventId: string;
  normalized: number;
  value: number;
  scaleId: string;
  at: number;
  confidence: RatingConfidence;
  note?: string;
}

/**
 * What combining does to the rating.
 *
 *  - `none`     — nothing was rated, so nothing is written.
 *  - `carried`  — exactly one source is rated. No event is invented: alias
 *                 resolution simply lets that rating stand as the group's.
 *  - `averaged` — two or more sources are rated, so one new event is written at
 *                 the plain mean of them. The originals stay in history and go
 *                 on counting for their own source.
 */
export type CombineRatingKind = 'none' | 'carried' | 'averaged';

export interface CombineRatingPlan {
  kind: CombineRatingKind;
  sources: CombineSourceRating[];
  /** The exact arithmetic mean of the sources, 0..100. Averaged plans only. */
  mean: number | null;
  /** The event that would be written, when one would be. */
  event: {
    normalized: number;
    value: number;
    scaleId: string;
    confidence: RatingConfidence;
    note?: string;
    tags?: string[];
    sourceEventIds: string[];
  } | null;
  /**
   * The mean re-read off the written value. Where this differs from `mean` the
   * scale in use cannot hold the average exactly, and the preview says so
   * rather than letting the reader discover it afterwards.
   */
  displayNormalized: number | null;
  /** Plain sentences about what is kept, what is carried and what is not. */
  notes: string[];
}

export interface CombinePlan {
  entityType: EntityType;
  primaryId: EntityId;
  memberIds: EntityId[];
  /** Members that were not already in the surviving group. */
  addedIds: EntityId[];
  /** Existing groups folded into this one. Their rows are tombstoned. */
  absorbedGroupIds: string[];
  /** The group being extended, when one already existed. */
  existingGroupId: string | null;
  rating: CombineRatingPlan;
}

export interface PlanCombineInput {
  entityIds: readonly EntityId[];
  primaryId: EntityId;
  entities: ReadonlyMap<EntityId, TypedEntity>;
  index: CanonicalResolver;
  ratings: readonly RatingEvent[];
  /** The scale the averaged event is expressed on: the one in use today. */
  scale: RatingScale;
  groups?: readonly CanonicalGroup[];
}

/**
 * The exact mean of a set of canonical values.
 *
 * Rounded to six places on the way out for the same reason `clampNormalized`
 * rounds: (70 + 85) / 2 is exact, but three sevenths of a hundred is not, and
 * writing 78.33333333333333 into the record would sync a number nobody chose.
 */
export function meanNormalized(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + clampNormalized(value), 0);
  return clampNormalized(sum / values.length);
}

/** The live current rating of each member, in member order. */
export function currentRatingsFor(
  memberIds: readonly EntityId[],
  ratings: readonly RatingEvent[],
  resolve: IdResolver = (id) => id,
): ExplicitRating[] {
  const byEntity = new Map<EntityId, RatingEvent[]>();
  const wanted = new Set(memberIds.map(resolve));
  for (const event of ratings) {
    const id = resolve(event.entityId);
    if (!isLiveRating(event) || !wanted.has(id)) continue;
    const list = byEntity.get(id);
    if (list) list.push(event);
    else byEntity.set(id, [event]);
  }
  const out: ExplicitRating[] = [];
  for (const id of unique(memberIds.map(resolve))) {
    const events = byEntity.get(id);
    if (!events) continue;
    const current = currentRating(events);
    if (current) out.push({ ...current, entityId: id });
  }
  return out;
}

const CONFIDENCE_ORDER: RatingConfidence[] = ['low', 'medium', 'high'];

export function planCombine(input: PlanCombineInput): CombinePlan {
  const memberIds = expandMembers(input.entityIds, input.index);
  const entityType = (input.entities.get(memberIds[0] ?? '')?.type ?? 'track') as EntityType;
  const existing = input.index.group(input.primaryId) ?? null;
  const absorbed = new Set<string>();
  for (const id of memberIds) {
    const group = input.index.group(id);
    if (group && group.id !== existing?.id) absorbed.add(group.id);
  }
  const before = new Set(existing?.memberIds ?? []);

  return {
    entityType,
    primaryId: input.primaryId,
    memberIds,
    addedIds: memberIds.filter((id) => !before.has(id)),
    absorbedGroupIds: [...absorbed].sort(),
    existingGroupId: existing?.id ?? null,
    rating: planCombinedRating(
      memberIds,
      input.ratings,
      input.scale,
      input.index.resolve.bind(input.index),
    ),
  };
}

/**
 * The one rating decision combining makes.
 *
 * Two or more current ratings become one new event at their plain mean — equal
 * weight each, because the user rated each of these thinking it was the record
 * in front of them, and there is no honest reason to prefer one. Everything
 * else about those events stays where it was made: the sources are never
 * edited, never retracted, and remain readable in the timeline.
 *
 * Metadata is carried only where the sources agree, and the disagreements are
 * reported rather than resolved. Averaging two numbers is arithmetic; averaging
 * two sentences someone wrote about two different pressings is invention.
 */
export function planCombinedRating(
  memberIds: readonly EntityId[],
  ratings: readonly RatingEvent[],
  scale: RatingScale,
  resolve: IdResolver = (id) => id,
): CombineRatingPlan {
  const current = currentRatingsFor(memberIds, ratings, resolve);
  const sources: CombineSourceRating[] = current.map((rating) => {
    const source: CombineSourceRating = {
      entityId: rating.entityId,
      eventId: rating.eventId,
      normalized: rating.normalized,
      value: rating.value,
      scaleId: rating.scaleId,
      at: rating.at,
      confidence: rating.confidence,
    };
    if (rating.note) source.note = rating.note;
    return source;
  });

  if (sources.length === 0) {
    return {
      kind: 'none',
      sources,
      mean: null,
      event: null,
      displayNormalized: null,
      notes: ['None of these is rated, so no rating is written.'],
    };
  }

  if (sources.length === 1) {
    const only = sources[0] as CombineSourceRating;
    return {
      kind: 'carried',
      sources,
      mean: only.normalized,
      event: null,
      displayNormalized: only.normalized,
      notes: [
        'Only one of these is rated, so that rating simply becomes the combined rating. No new entry is written.',
      ],
    };
  }

  // Newest current event first, ties broken on event id — the same rule that
  // decides which event is anybody's current rating, so the basis is never a
  // matter of which device asked.
  const ordered = [...sources].sort((a, b) =>
    b.at !== a.at ? b.at - a.at : b.eventId < a.eventId ? -1 : 1,
  );
  const newest = ordered[0] as CombineSourceRating;
  const mean = meanNormalized(sources.map((s) => s.normalized)) ?? newest.normalized;
  const value = denormalize(scale, mean);
  const displayNormalized = normalize(scale, value);

  const confidences = unique(sources.map((s) => s.confidence));
  const confidence =
    confidences.length === 1
      ? (confidences[0] as RatingConfidence)
      : (CONFIDENCE_ORDER.find((c) => confidences.includes(c)) as RatingConfidence);

  const notesWritten = unique(sources.map((s) => s.note?.trim()).filter(Boolean) as string[]);
  const tags = unique(
    sources.flatMap((source) => eventById(ratings, source.eventId)?.tags ?? []),
  ).sort();
  const contexts = sources
    .map((source) => eventById(ratings, source.eventId)?.contextual)
    .filter((snapshot): snapshot is NonNullable<typeof snapshot> => !!snapshot?.facets.length);

  const notes: string[] = [];
  notes.push(
    `Averages ${sources.length} current ratings into one new entry. Every original entry stays in your history and goes on counting for the item you made it on.`,
  );
  if (Math.abs(displayNormalized - mean) > 1e-6) {
    notes.push(
      `The average sits between two positions on the ${scale.label} scale, so the entry records the nearest one it can hold.`,
    );
  }
  if (notesWritten.length === 1) {
    notes.push('One of the ratings carried a note, and it is carried onto the combined entry.');
  } else if (notesWritten.length > 1) {
    notes.push(
      'The ratings carry different notes, so the combined entry carries none. Both notes stay on the entries that made them.',
    );
  }
  if (confidences.length > 1) {
    notes.push(
      `You were not equally sure about these, so the combined entry takes the least certain of them (${confidence}).`,
    );
  }
  if (contexts.length > 1) {
    notes.push(
      'More than one of these carries context answers. They are left where they were answered rather than blended, so the combined entry has none.',
    );
  } else if (contexts.length === 1) {
    notes.push('The context answers on the one rating that had them are carried across.');
  }
  if (tags.length > 0) notes.push(`Tags from every rating are kept: ${tags.join(', ')}.`);

  const event: NonNullable<CombineRatingPlan['event']> = {
    normalized: mean,
    value,
    scaleId: scale.id,
    confidence,
    sourceEventIds: sources.map((s) => s.eventId).sort(),
  };
  if (notesWritten.length === 1) event.note = notesWritten[0] as string;
  if (tags.length > 0) event.tags = tags;

  return { kind: 'averaged', sources, mean, event, displayNormalized, notes };
}

function eventById(events: readonly RatingEvent[], id: string): RatingEvent | undefined {
  return events.find((event) => event.id === id);
}

/** The contextual snapshot to carry, when exactly one source has one. */
export function soleContextSnapshot(
  plan: CombineRatingPlan,
  ratings: readonly RatingEvent[],
): RatingEvent['contextual'] | undefined {
  const snapshots = plan.sources
    .map((source) => eventById(ratings, source.eventId)?.contextual)
    .filter((snapshot): snapshot is NonNullable<typeof snapshot> => !!snapshot?.facets.length);
  return snapshots.length === 1 ? snapshots[0] : undefined;
}

/* -------------------------------------------------------------------------- */
/* Separating again                                                           */
/* -------------------------------------------------------------------------- */

export interface UncombinePlan {
  groupId: string;
  memberIds: EntityId[];
  /** Averaged entries this group wrote that are still counting. */
  withdrawEventIds: string[];
  notes: string[];
}

/**
 * What separating a group does.
 *
 * The group row is tombstoned and each source goes back to answering for
 * itself. The entries the combine wrote are withdrawn rather than deleted, so
 * every source returns to the rating it had before — and the withdrawn entry
 * stays visible in the timeline, struck through, as the record of a combine
 * that happened.
 */
export function planUncombine(
  group: CanonicalGroup,
  ratings: readonly RatingEvent[],
): UncombinePlan {
  const written = new Set(group.averagedEventIds ?? []);
  const withdrawEventIds = ratings
    .filter((event) => written.has(event.id) && isLiveRating(event))
    .map((event) => event.id)
    .sort();
  const notes = [
    'Every source keeps its own ratings, notes, artwork and Spotify link — separating them changes nothing about the items themselves.',
  ];
  if (withdrawEventIds.length > 0) {
    notes.push(
      `The averaged entry combining wrote is withdrawn, so each item goes back to the rating it had. It stays in your history, struck through.`,
    );
  }
  return { groupId: group.id, memberIds: [...group.memberIds], withdrawEventIds, notes };
}
