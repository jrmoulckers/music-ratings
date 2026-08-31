import { uid } from '../domain/ids';
import type { AlbumCompletion, CompletionPrompt, PlayEvent } from '../domain/listening';
import {
  buildCanonicalIndex,
  checkCombine,
  legacyAliases,
  planCombine,
  planUncombine,
  soleContextSnapshot,
  type CanonicalIndex,
  type CombinePlan,
  type CombineProblem,
  type TypedEntity,
  type UncombinePlan,
} from '../domain/canonical';
import type {
  CanonicalGroup,
  Collection,
  Comparison,
  ContextSnapshot,
  Entity,
  EntityAnnotation,
  EntityId,
  EntityType,
  Membership,
  QueueState,
  QueueStateKind,
  RatingConfidence,
  RatingEvent,
  RatingScale,
} from '../domain/types';
import { markDataChanged } from './changes';
import {
  allForSync,
  allLive,
  db,
  getRecord,
  putRecord,
  putRecords,
  raw,
  tombstone,
  type SyncedStore,
} from './db';

/**
 * The only place the app mutates stored data.
 *
 * Two invariants hold everywhere below:
 *  1. Nothing is ever destroyed. Ratings are appended, deletions are
 *     tombstones, and a correction is a new event, not an overwrite.
 *  2. Every mutation bumps `dataVersion` exactly once so sync and the UI both
 *     notice without either polling the database.
 */

/* -------------------------------------------------------------------------- */
/* Entities and containment                                                   */
/* -------------------------------------------------------------------------- */

export async function saveEntity(entity: Entity): Promise<void> {
  await putRecord('entities', { ...entity, updatedAt: entity.updatedAt || Date.now() });
  markDataChanged();
}

/**
 * Catalogue records are refreshed from the provider constantly. Merging keeps
 * anything the provider omitted this time (a thumbnail from an earlier fetch,
 * for example) instead of blanking it.
 */
export async function upsertEntities(entities: readonly Entity[]): Promise<void> {
  if (entities.length === 0) return;
  const database = await db();
  const tx = database.transaction('entities', 'readwrite');
  const merged: Entity[] = [];
  for (const incoming of entities) {
    const existing = (await tx.store.get(incoming.id)) as Entity | undefined;
    merged.push(
      existing
        ? { ...existing, ...incoming, createdAt: existing.createdAt, deleted: undefined }
        : incoming,
    );
  }
  await Promise.all([...merged.map((e) => tx.store.put(raw(e))), tx.done]);
  markDataChanged();
}

export async function getEntity(id: EntityId): Promise<Entity | undefined> {
  return getRecord('entities', id);
}

export async function listEntities(): Promise<Entity[]> {
  return allLive('entities');
}

export async function listEntitiesOfType(type: EntityType): Promise<Entity[]> {
  const database = await db();
  const rows = await database.getAllFromIndex('entities', 'byType', type);
  return rows.filter((r) => !r.deleted);
}

export async function saveMemberships(memberships: readonly Membership[]): Promise<void> {
  if (memberships.length === 0) return;
  await putRecords('memberships', memberships);
  markDataChanged();
}

export async function listMemberships(): Promise<Membership[]> {
  return allLive('memberships');
}

/**
 * Playlists and albums change. Rather than diffing, we tombstone the links that
 * are gone and write the ones that remain, so a removed playlist item stops
 * contributing without erasing the rating the user gave that track.
 */
export async function replaceChildren(
  parentId: EntityId,
  memberships: readonly Membership[],
  now = Date.now(),
): Promise<void> {
  const database = await db();
  const existing = await database.getAllFromIndex('memberships', 'byParent', parentId);
  const keep = new Set(memberships.map((m) => m.id));
  const tx = database.transaction('memberships', 'readwrite');
  const writes: Promise<unknown>[] = [];
  for (const old of existing) {
    if (!keep.has(old.id) && !old.deleted) {
      writes.push(tx.store.put(raw({ ...old, deleted: now, updatedAt: now })));
    }
  }
  for (const m of memberships) writes.push(tx.store.put(raw({ ...m, deleted: undefined })));
  await Promise.all([...writes, tx.done]);
  markDataChanged();
}

/* -------------------------------------------------------------------------- */
/* Ratings                                                                    */
/* -------------------------------------------------------------------------- */

export interface RatingDraft {
  entityId: EntityId;
  entityType: EntityType;
  normalized: number;
  value: number;
  scaleId: string;
  confidence?: RatingConfidence;
  note?: string;
  tags?: string[];
  context?: RatingEvent['context'];
  contextual?: ContextSnapshot | null;
  at?: number;
}

export async function recordRating(draft: RatingDraft): Promise<RatingEvent> {
  const now = Date.now();
  const event: RatingEvent = {
    id: uid('rat'),
    entityId: draft.entityId,
    entityType: draft.entityType,
    at: draft.at ?? now,
    value: draft.value,
    scaleId: draft.scaleId,
    normalized: draft.normalized,
    confidence: draft.confidence ?? 'medium',
    updatedAt: now,
  };
  if (draft.note) event.note = draft.note;
  if (draft.tags?.length) event.tags = draft.tags;
  if (draft.context) event.context = draft.context;
  if (draft.contextual?.facets.length) event.contextual = draft.contextual;
  await putRecord('ratings', event);
  markDataChanged();
  return event;
}

/** Editing a past entry corrects the record in place; the timeline shows it was edited. */
export async function amendRating(
  id: string,
  patch: Partial<
    Pick<RatingEvent, 'value' | 'normalized' | 'scaleId' | 'note' | 'tags' | 'confidence'>
  >,
): Promise<void> {
  const database = await db();
  const existing = await database.get('ratings', id);
  if (!existing) return;
  await putRecord('ratings', { ...existing, ...patch, updatedAt: Date.now(), edited: Date.now() });
  markDataChanged();
}

/** Undo: the event stays in history, marked as withdrawn, and stops counting. */
export async function retractRating(id: string): Promise<void> {
  const database = await db();
  const existing = await database.get('ratings', id);
  if (!existing) return;
  const now = Date.now();
  await putRecord('ratings', { ...existing, retracted: now, updatedAt: now });
  markDataChanged();
}

export async function deleteRating(id: string): Promise<void> {
  await tombstone('ratings', id);
  markDataChanged();
}

export async function listRatings(): Promise<RatingEvent[]> {
  return allLive('ratings');
}

export async function ratingsFor(entityId: EntityId): Promise<RatingEvent[]> {
  const database = await db();
  const rows = await database.getAllFromIndex('ratings', 'byEntity', entityId);
  return rows.filter((r) => !r.deleted).sort((a, b) => b.at - a.at);
}

/* -------------------------------------------------------------------------- */
/* Comparisons                                                                */
/* -------------------------------------------------------------------------- */

export async function recordComparison(
  entityType: EntityType,
  aId: EntityId,
  bId: EntityId,
  outcome: Comparison['outcome'],
  reason?: string,
): Promise<Comparison> {
  const now = Date.now();
  const comparison: Comparison = {
    id: uid('cmp'),
    entityType,
    aId,
    bId,
    outcome,
    at: now,
    updatedAt: now,
  };
  if (reason) comparison.reason = reason;
  await putRecord('comparisons', comparison);
  markDataChanged();
  return comparison;
}

export async function undoComparison(id: string): Promise<void> {
  await tombstone('comparisons', id);
  markDataChanged();
}

export async function listComparisons(): Promise<Comparison[]> {
  return allLive('comparisons');
}

/* -------------------------------------------------------------------------- */
/* Queue states, annotations, collections, scales                             */
/* -------------------------------------------------------------------------- */

export async function setQueueState(
  id: EntityId,
  entityType: EntityType,
  kind: QueueStateKind,
  until?: number,
): Promise<void> {
  const now = Date.now();
  const state: QueueState = { id, entityType, kind, at: now, updatedAt: now };
  if (until !== undefined) state.until = until;
  await putRecord('queueStates', state);
  markDataChanged();
}

export async function clearQueueState(id: EntityId): Promise<void> {
  await tombstone('queueStates', id);
  markDataChanged();
}

export async function listQueueStates(): Promise<QueueState[]> {
  return allLive('queueStates');
}

export async function saveAnnotation(annotation: EntityAnnotation): Promise<void> {
  await putRecord('annotations', { ...annotation, updatedAt: Date.now() });
  markDataChanged();
}

export async function patchAnnotation(
  id: EntityId,
  patch: Partial<Omit<EntityAnnotation, 'id'>>,
): Promise<EntityAnnotation> {
  const existing = (await getRecord('annotations', id)) ?? { id, tags: [], updatedAt: 0 };
  const next: EntityAnnotation = { ...existing, ...patch, id, updatedAt: Date.now() };
  await putRecord('annotations', next);
  markDataChanged();
  return next;
}

/**
 * Replace canonical annotation fields and clear those same fields from aliases.
 *
 * Reads merge source annotations so no pre-combine metadata disappears. A user
 * edit, however, is authoritative for the combined work: leaving an old alias
 * tag, note or pin behind would make a cleared value reappear on the next load.
 */
export async function patchCanonicalAnnotation(
  id: EntityId,
  memberIds: readonly EntityId[],
  patch: Partial<Omit<EntityAnnotation, 'id'>>,
): Promise<EntityAnnotation> {
  const now = Date.now();
  const members = [...new Set(memberIds.length > 0 ? memberIds : [id])];
  const database = await db();
  const tx = database.transaction('annotations', 'readwrite');
  const existing = new Map<EntityId, EntityAnnotation>();
  for (const memberId of members) {
    const row = await tx.store.get(memberId);
    if (row) existing.set(memberId, row);
  }

  const canonical = existing.get(id) ?? { id, tags: [], updatedAt: 0 };
  const next: EntityAnnotation = { ...canonical, ...patch, id, updatedAt: now };
  const writes: Promise<unknown>[] = [tx.store.put(raw(next))];
  for (const memberId of members) {
    if (memberId === id) continue;
    const row = existing.get(memberId);
    if (!row) continue;
    const cleared: EntityAnnotation = { ...row, updatedAt: now };
    if ('tags' in patch) cleared.tags = [];
    if ('note' in patch) delete cleared.note;
    if ('pinned' in patch) delete cleared.pinned;
    writes.push(tx.store.put(raw(cleared)));
  }
  await Promise.all([...writes, tx.done]);
  markDataChanged();
  return next;
}

export async function listAnnotations(): Promise<EntityAnnotation[]> {
  return allLive('annotations');
}

export async function saveCollection(collection: Collection): Promise<void> {
  await putRecord('collections', { ...collection, updatedAt: Date.now() });
  markDataChanged();
}

export async function deleteCollection(id: string): Promise<void> {
  await tombstone('collections', id);
  markDataChanged();
}

export async function listCollections(): Promise<Collection[]> {
  return allLive('collections');
}

export async function saveScale(scale: RatingScale): Promise<void> {
  await putRecord('scales', { ...scale, updatedAt: Date.now() });
  markDataChanged();
}

export async function deleteScale(id: string): Promise<void> {
  await tombstone('scales', id);
  markDataChanged();
}

export async function listScales(): Promise<RatingScale[]> {
  return allLive('scales');
}

/* -------------------------------------------------------------------------- */
/* Listening history                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Write confirmed plays, skipping any the store already holds.
 *
 * Play ids are deterministic, so "already holds" is a key lookup rather than a
 * comparison: the same play arriving from a second refresh, a second device or
 * a sync merge lands on the same row and is dropped here. The whole batch runs
 * in one transaction so an interrupted refresh cannot leave half a window in.
 */
export async function insertPlays(plays: readonly PlayEvent[]): Promise<PlayEvent[]> {
  if (plays.length === 0) return [];
  const database = await db();
  const tx = database.transaction('plays', 'readwrite');
  const inserted: PlayEvent[] = [];
  const offered = new Set<string>();

  for (const play of plays) {
    if (offered.has(play.id)) continue;
    offered.add(play.id);
    const existing = await tx.store.getKey(play.id);
    if (existing !== undefined) continue;
    void tx.store.put(raw(play));
    inserted.push(play);
  }
  await tx.done;
  if (inserted.length > 0) markDataChanged();
  return inserted;
}

export async function listPlays(): Promise<PlayEvent[]> {
  return allLive('plays');
}

/** Plays of one entity inside a half-open window, straight off the index. */
export async function playsForEntityBetween(
  entityId: EntityId,
  from: number,
  to: number,
): Promise<PlayEvent[]> {
  const database = await db();
  const range = IDBKeyRange.bound([entityId, from], [entityId, to]);
  const rows = await database.getAllFromIndex('plays', 'byEntityAt', range);
  return rows.filter((row) => !row.deleted);
}

/**
 * Plays of many entities inside a window, in one transaction.
 *
 * The completion engine needs exactly this shape and nothing wider: one range
 * query per track of the album being evaluated, never a pass over the log.
 */
export async function playsForEntitiesBetween(
  entityIds: readonly EntityId[],
  from: number,
  to: number,
): Promise<PlayEvent[]> {
  if (entityIds.length === 0) return [];
  const canonical = await canonicalIndex();
  const sourceIds = [...new Set(entityIds.flatMap((id) => canonical.members(id)))];
  const database = await db();
  const tx = database.transaction('plays', 'readonly');
  const index = tx.store.index('byEntityAt');
  const out: PlayEvent[] = [];
  for (const entityId of sourceIds) {
    const rows = await index.getAll(IDBKeyRange.bound([entityId, from], [entityId, to]));
    for (const row of rows) {
      if (row.deleted) continue;
      out.push({
        ...row,
        entityId: canonical.resolve(row.entityId),
        ...(row.contextId ? { contextId: canonical.resolve(row.contextId) } : {}),
      });
    }
  }
  await tx.done;
  return out;
}

/**
 * How many plays are actually held.
 *
 * Tombstones are excluded: after deleting the log the count has to read zero,
 * or the figure beside the delete button contradicts the button.
 */
export async function countPlays(): Promise<number> {
  const database = await db();
  let live = 0;
  let cursor = await database.transaction('plays').store.openCursor();
  while (cursor) {
    if (!cursor.value.deleted) live += 1;
    cursor = await cursor.continue();
  }
  return live;
}

/** Delete the listening log outright, leaving synced tombstones behind. */
export async function purgeListeningHistory(): Promise<{ plays: number; completions: number }> {
  const database = await db();
  const now = Date.now();
  let plays = 0;
  let completions = 0;

  const tx = database.transaction(['plays', 'completions'], 'readwrite');
  for await (const cursor of tx.objectStore('plays')) {
    if (cursor.value.deleted) continue;
    void cursor.update(raw({ ...cursor.value, deleted: now, updatedAt: now }));
    plays += 1;
  }
  for await (const cursor of tx.objectStore('completions')) {
    if (cursor.value.deleted) continue;
    void cursor.update(raw({ ...cursor.value, deleted: now, updatedAt: now }));
    completions += 1;
  }
  await tx.done;
  markDataChanged();
  return { plays, completions };
}

/**
 * Drop plays older than the retention floor.
 *
 * Tombstoned rather than deleted outright, so a device that has been offline
 * for a month does not helpfully sync them all back. Completions are left
 * alone: each one carries its own evidence, and a record of having finished an
 * album should not evaporate because the individual plays aged out.
 *
 * Walks the timestamp index and stops at the floor, so the cost is the number
 * of rows actually expiring, not the size of the log.
 */
export async function prunePlaysBefore(floor: number): Promise<number> {
  const database = await db();
  const tx = database.transaction('plays', 'readwrite');
  const now = Date.now();
  let pruned = 0;
  let cursor = await tx.store.index('byAt').openCursor(IDBKeyRange.upperBound(floor, true));
  while (cursor) {
    if (!cursor.value.deleted) {
      void cursor.update(raw({ ...cursor.value, deleted: now, updatedAt: now }));
      pruned += 1;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  if (pruned > 0) markDataChanged();
  return pruned;
}

export async function saveCompletions(completions: readonly AlbumCompletion[]): Promise<void> {
  await putRecords('completions', completions);
  markDataChanged();
}

export async function listCompletions(): Promise<AlbumCompletion[]> {
  return allLive('completions');
}

export async function completionsForAlbum(albumId: EntityId): Promise<AlbumCompletion[]> {
  const database = await db();
  const index = await canonicalIndex();
  const rows = await Promise.all(
    index.members(albumId).map((id) => database.getAllFromIndex('completions', 'byAlbum', id)),
  );
  return rows.flat().filter((row) => !row.deleted);
}

/**
 * Answer a completion prompt.
 *
 * Only the prompt state moves. The evidence — which plays, which window, when
 * the set closed — is what happened, and answering the prompt does not change
 * what happened.
 */
export async function setCompletionPrompt(
  id: string,
  prompt: CompletionPrompt,
  extra: { snoozeUntil?: number; ratingId?: string } = {},
): Promise<void> {
  const existing = await getRecord('completions', id);
  if (!existing) return;
  const next: AlbumCompletion = { ...existing, prompt, updatedAt: Date.now() };
  if (extra.snoozeUntil !== undefined) next.snoozeUntil = extra.snoozeUntil;
  else delete next.snoozeUntil;
  if (extra.ratingId !== undefined) next.ratingId = extra.ratingId;
  await putRecord('completions', next);
  markDataChanged();
}

/* -------------------------------------------------------------------------- */
/* Canonical groups: combining duplicates                                     */
/* -------------------------------------------------------------------------- */

export class CombineError extends Error {
  constructor(readonly problem: CombineProblem) {
    super(problem.detail);
    this.name = 'CombineError';
  }
}

export async function listCanonicalGroups(): Promise<CanonicalGroup[]> {
  return allLive('canonicalGroups');
}

/**
 * The alias resolver, read from the store.
 *
 * The app itself reads the one the state layer already derives; this is for
 * callers holding no world — a background task, a diagnostic, a test — that
 * still need to ask which record a source id stands for.
 */
export async function canonicalIndex(): Promise<CanonicalIndex> {
  const [entities, groups, annotations] = await Promise.all([
    allLive('entities'),
    allLive('canonicalGroups'),
    allLive('annotations'),
  ]);
  return buildCanonicalIndex(
    groups,
    legacyAliases(annotations),
    new Set(entities.map((e) => e.id)),
  );
}

export interface CombineInput {
  entityIds: readonly EntityId[];
  primaryId: EntityId;
  /** The scale an averaged entry is written on: the one in force for this type. */
  scale: RatingScale;
  at?: number;
}

export interface CombineResult {
  group: CanonicalGroup;
  plan: CombinePlan;
  /** The one entry combining wrote, when the sources disagreed enough to need one. */
  averaged: RatingEvent | null;
  /** How the surviving group stood before, when it already existed. */
  previous: CanonicalGroup | null;
  /** The groups this one swallowed, as they were before being swallowed. */
  absorbed: CanonicalGroup[];
}

/** Everything the planner needs, read once from the store. */
async function canonicalContext(): Promise<{
  entities: Map<EntityId, TypedEntity>;
  ratings: RatingEvent[];
  index: CanonicalIndex;
  groups: CanonicalGroup[];
}> {
  const [entities, ratings, groups, annotations] = await Promise.all([
    allLive('entities'),
    allLive('ratings'),
    allLive('canonicalGroups'),
    allLive('annotations'),
  ]);
  return {
    entities: new Map(entities.map((e) => [e.id, { id: e.id, type: e.type, name: e.name }])),
    ratings,
    index: buildCanonicalIndex(
      groups,
      legacyAliases(annotations),
      new Set(entities.map((e) => e.id)),
    ),
    groups,
  };
}

/**
 * What combining would do, without doing it.
 *
 * Read from the store rather than from whatever the screen is holding, so the
 * sentence the user confirms is about the data that will actually be written.
 */
export async function previewCombine(input: CombineInput): Promise<CombinePlan> {
  const context = await canonicalContext();
  const problem = checkCombine({
    entityIds: input.entityIds,
    primaryId: input.primaryId,
    entities: context.entities,
    index: context.index,
  });
  if (problem) throw new CombineError(problem);
  return planCombine({
    entityIds: input.entityIds,
    primaryId: input.primaryId,
    entities: context.entities,
    index: context.index,
    ratings: context.ratings,
    scale: input.scale,
  });
}

/**
 * Declare several catalogue records to be one.
 *
 * Every source entity is left exactly as it was: this writes one group row, at
 * most one rating event, and tombstones any smaller groups it swallowed. The
 * three go in a single transaction because a group that exists without its
 * averaged rating — or an averaged rating with no group to explain it — would
 * be a state no reader could make sense of.
 */
export async function combineEntities(input: CombineInput): Promise<CombineResult> {
  const context = await canonicalContext();
  const problem = checkCombine({
    entityIds: input.entityIds,
    primaryId: input.primaryId,
    entities: context.entities,
    index: context.index,
  });
  if (problem) throw new CombineError(problem);

  const plan = planCombine({
    entityIds: input.entityIds,
    primaryId: input.primaryId,
    entities: context.entities,
    index: context.index,
    ratings: context.ratings,
    scale: input.scale,
  });

  const now = input.at ?? Date.now();
  const existing = plan.existingGroupId
    ? context.groups.find((g) => g.id === plan.existingGroupId)
    : undefined;
  const absorbed = context.groups.filter((g) => plan.absorbedGroupIds.includes(g.id));

  const group: CanonicalGroup = {
    id: existing?.id ?? uid('grp'),
    entityType: plan.entityType,
    primaryId: plan.primaryId,
    memberIds: [...plan.memberIds],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  // Averaged entries written by the groups being swallowed stay attached, so
  // separating this one later still withdraws every entry combining wrote.
  const carriedEventIds = [
    ...(existing?.averagedEventIds ?? []),
    ...absorbed.flatMap((g) => g.averagedEventIds ?? []),
  ];

  let averaged: RatingEvent | null = null;
  if (plan.rating.event) {
    const contextual = soleContextSnapshot(plan.rating, context.ratings);
    averaged = {
      id: uid('rat'),
      entityId: plan.primaryId,
      entityType: plan.entityType,
      at: now,
      value: plan.rating.event.value,
      scaleId: plan.rating.event.scaleId,
      normalized: plan.rating.event.normalized,
      confidence: plan.rating.event.confidence,
      context: 'combine',
      origin: {
        kind: 'combine-average',
        groupId: group.id,
        sourceEventIds: [...plan.rating.event.sourceEventIds],
      },
      updatedAt: now,
    };
    if (plan.rating.event.note) averaged.note = plan.rating.event.note;
    if (plan.rating.event.tags?.length) averaged.tags = [...plan.rating.event.tags];
    if (contextual) averaged.contextual = contextual;
  }

  const averagedEventIds = [...carriedEventIds, ...(averaged ? [averaged.id] : [])];
  if (averagedEventIds.length > 0) group.averagedEventIds = [...new Set(averagedEventIds)];

  const database = await db();
  const tx = database.transaction(['canonicalGroups', 'ratings'], 'readwrite');
  const writes: Promise<unknown>[] = [tx.objectStore('canonicalGroups').put(raw(group))];
  for (const swallowed of absorbed) {
    writes.push(
      tx
        .objectStore('canonicalGroups')
        .put(
          raw({ ...swallowed, deleted: now, updatedAt: now, memberIds: [...swallowed.memberIds] }),
        ),
    );
  }
  if (averaged) writes.push(tx.objectStore('ratings').put(raw(averaged)));
  await Promise.all([...writes, tx.done]);
  markDataChanged();

  return { group, plan, averaged, previous: existing ?? null, absorbed };
}

/**
 * Put back exactly what a combine changed, and nothing else.
 *
 * Undo has to be the inverse of the act, not a bigger version of it: adding one
 * source to a group of four must undo to a group of four, never to five
 * separate records. So the previous state of every row the combine touched
 * travels with its result and is written straight back.
 */
export async function revertCombine(result: CombineResult, now = Date.now()): Promise<void> {
  const database = await db();
  const tx = database.transaction(['canonicalGroups', 'ratings'], 'readwrite');
  const groups = tx.objectStore('canonicalGroups');
  const writes: Promise<unknown>[] = [];

  writes.push(
    groups.put(
      raw(
        result.previous
          ? { ...result.previous, updatedAt: now }
          : { ...result.group, deleted: now, updatedAt: now },
      ),
    ),
  );
  for (const swallowed of result.absorbed) {
    writes.push(groups.put(raw({ ...swallowed, deleted: undefined, updatedAt: now })));
  }
  if (result.averaged) {
    const stored = await tx.objectStore('ratings').get(result.averaged.id);
    if (stored && !stored.retracted) {
      writes.push(
        tx.objectStore('ratings').put(raw({ ...stored, retracted: now, updatedAt: now })),
      );
    }
  }
  await Promise.all([...writes, tx.done]);
  markDataChanged();
}

/**
 * Take a group apart again.
 *
 * The group row is tombstoned so the separation travels like any other change,
 * and the entry combining wrote is withdrawn rather than deleted: every source
 * returns to the rating it had, and the record of the combine stays legible in
 * the timeline.
 */
export async function uncombineGroup(
  groupId: string,
  now = Date.now(),
): Promise<UncombinePlan | null> {
  const [groups, ratings, annotations, entities] = await Promise.all([
    allLive('canonicalGroups'),
    allLive('ratings'),
    allLive('annotations'),
    allLive('entities'),
  ]);
  const stored = groups.find((g) => g.id === groupId);
  const index = buildCanonicalIndex(
    groups,
    legacyAliases(annotations),
    new Set(entities.map((entity) => entity.id)),
  );
  const group =
    stored ??
    entities.map((entity) => index.group(entity.id)).find((candidate) => candidate?.id === groupId);
  if (!group) return null;

  const plan = planUncombine(group, ratings);
  const database = await db();
  const tx = database.transaction(['canonicalGroups', 'ratings', 'annotations'], 'readwrite');
  const writes: Promise<unknown>[] = [];
  if (stored) {
    writes.push(
      tx.objectStore('canonicalGroups').put(raw({ ...stored, deleted: now, updatedAt: now })),
    );
  }
  for (const eventId of plan.withdrawEventIds) {
    const event = ratings.find((r) => r.id === eventId);
    if (!event) continue;
    writes.push(tx.objectStore('ratings').put(raw({ ...event, retracted: now, updatedAt: now })));
  }
  for (const memberId of group.memberIds) {
    const annotation = annotations.find((row) => row.id === memberId);
    if (!annotation?.duplicateOf) continue;
    const cleared = { ...annotation, updatedAt: now };
    delete cleared.duplicateOf;
    writes.push(tx.objectStore('annotations').put(raw(cleared)));
  }
  await Promise.all([...writes, tx.done]);
  markDataChanged();
  return plan;
}

/**
 * Change which source represents the group.
 *
 * The canonical id changes with it, which is the point: the primary is what
 * gets played, linked to and shown. Nothing else moves — every rating and every
 * comparison still names the source it was made against, and resolution simply
 * points at the new primary from now on.
 */
export async function setGroupPrimary(
  groupId: string,
  primaryId: EntityId,
  now = Date.now(),
): Promise<CanonicalGroup | null> {
  const [groups, annotations, entities] = await Promise.all([
    allLive('canonicalGroups'),
    allLive('annotations'),
    allLive('entities'),
  ]);
  const stored = groups.find((g) => g.id === groupId);
  const index = buildCanonicalIndex(
    groups,
    legacyAliases(annotations),
    new Set(entities.map((entity) => entity.id)),
  );
  const group =
    stored ??
    entities.map((entity) => index.group(entity.id)).find((candidate) => candidate?.id === groupId);
  if (!group) return null;
  if (!group.memberIds.includes(primaryId)) {
    throw new CombineError({
      code: 'primary-not-a-member',
      detail: 'That item is not one of the sources in this group.',
    });
  }
  if (group.primaryId === primaryId) return group;
  const next: CanonicalGroup = {
    ...group,
    id: stored?.id ?? uid('grp'),
    primaryId,
    updatedAt: now,
  };
  await putRecord('canonicalGroups', next);
  markDataChanged();
  return next;
}

/* -------------------------------------------------------------------------- */

export async function loadWorld(): Promise<{
  entities: Entity[];
  memberships: Membership[];
  ratings: RatingEvent[];
  comparisons: Comparison[];
  queueStates: QueueState[];
  annotations: EntityAnnotation[];
  collections: Collection[];
  scales: RatingScale[];
  plays: PlayEvent[];
  completions: AlbumCompletion[];
  canonicalGroups: CanonicalGroup[];
}> {
  const [
    entities,
    memberships,
    ratings,
    comparisons,
    queueStates,
    annotations,
    collections,
    scales,
    plays,
    completions,
    canonicalGroups,
  ] = await Promise.all([
    allLive('entities'),
    allLive('memberships'),
    allLive('ratings'),
    allLive('comparisons'),
    allLive('queueStates'),
    allLive('annotations'),
    allLive('collections'),
    allLive('scales'),
    allLive('plays'),
    allLive('completions'),
    allLive('canonicalGroups'),
  ]);
  return {
    entities,
    memberships,
    ratings,
    comparisons,
    queueStates,
    annotations,
    collections,
    scales,
    plays,
    completions,
    canonicalGroups,
  };
}

export async function loadStoreForSync<S extends SyncedStore>(store: S) {
  return allForSync(store);
}
