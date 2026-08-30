import { uid } from '../domain/ids';
import type {
  Collection,
  Comparison,
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
  await Promise.all([...merged.map((e) => tx.store.put(e)), tx.done]);
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
      writes.push(tx.store.put({ ...old, deleted: now, updatedAt: now }));
    }
  }
  for (const m of memberships) writes.push(tx.store.put({ ...m, deleted: undefined }));
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

export async function loadWorld(): Promise<{
  entities: Entity[];
  memberships: Membership[];
  ratings: RatingEvent[];
  comparisons: Comparison[];
  queueStates: QueueState[];
  annotations: EntityAnnotation[];
  collections: Collection[];
  scales: RatingScale[];
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
  ] = await Promise.all([
    allLive('entities'),
    allLive('memberships'),
    allLive('ratings'),
    allLive('comparisons'),
    allLive('queueStates'),
    allLive('annotations'),
    allLive('collections'),
    allLive('scales'),
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
  };
}

export async function loadStoreForSync<S extends SyncedStore>(store: S) {
  return allForSync(store);
}
