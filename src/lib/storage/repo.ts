import { uid } from '../domain/ids';
import type { AlbumCompletion, CompletionPrompt, PlayEvent } from '../domain/listening';
import type {
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
  const database = await db();
  const tx = database.transaction('plays', 'readonly');
  const index = tx.store.index('byEntityAt');
  const out: PlayEvent[] = [];
  for (const entityId of entityIds) {
    const rows = await index.getAll(IDBKeyRange.bound([entityId, from], [entityId, to]));
    for (const row of rows) if (!row.deleted) out.push(row);
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
  const rows = await database.getAllFromIndex('completions', 'byAlbum', albumId);
  return rows.filter((row) => !row.deleted);
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
  };
}

export async function loadStoreForSync<S extends SyncedStore>(store: S) {
  return allForSync(store);
}
