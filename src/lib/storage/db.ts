import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from 'idb';

import type {
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
} from '../domain/types';
import type { AlbumCompletion, PlayEvent } from '../domain/listening';
import type { AppSettings } from './settings';

export const DB_NAME = 'music-ratings';
export const DB_VERSION = 4;

/**
 * Everything the app knows lives here, on this device, in the user's browser.
 * The shape is deliberately flat and id-addressed so the sync layer can treat
 * every store as an unordered bag of records with `updatedAt` and tombstones.
 */
export interface AppDB extends DBSchema {
  entities: {
    key: EntityId;
    value: Entity;
    indexes: { byType: EntityType; byUpdated: number };
  };
  memberships: {
    key: string;
    value: Membership;
    indexes: { byParent: EntityId; byChild: EntityId };
  };
  ratings: {
    key: string;
    value: RatingEvent;
    indexes: { byEntity: EntityId; byAt: number; byType: EntityType };
  };
  comparisons: {
    key: string;
    value: Comparison;
    indexes: { byType: EntityType; byAt: number };
  };
  queueStates: { key: EntityId; value: QueueState };
  annotations: { key: EntityId; value: EntityAnnotation };
  collections: { key: string; value: Collection };
  scales: { key: string; value: RatingScale };
  /**
   * Spotify-confirmed plays. Keyed on a deterministic id built from the
   * provider item and the exact instant, so two devices writing the same play
   * write the same row and sync merges it rather than counting it twice.
   */
  plays: {
    key: string;
    value: PlayEvent;
    indexes: {
      byAt: number;
      byEntity: EntityId;
      byEntityAt: [EntityId, number];
      byUpdated: number;
    };
  };
  /** Records heard all the way through, with the evidence that proved it. */
  completions: {
    key: string;
    value: AlbumCompletion;
    indexes: { byAlbum: EntityId; byAt: number; byUpdated: number };
  };
  /** Free-form singletons: settings, sync bookkeeping, provider cursors. */
  meta: { key: string; value: unknown };
}

export type StoreName =
  | 'entities'
  | 'memberships'
  | 'ratings'
  | 'comparisons'
  | 'queueStates'
  | 'annotations'
  | 'collections'
  | 'scales'
  | 'plays'
  | 'completions'
  | 'meta';

/** Stores whose records take part in sync. `meta` is handled separately. */
export const SYNCED_STORES = [
  'entities',
  'memberships',
  'ratings',
  'comparisons',
  'queueStates',
  'annotations',
  'collections',
  'scales',
  'plays',
  'completions',
] as const satisfies readonly StoreName[];

export type SyncedStore = (typeof SYNCED_STORES)[number];

export const META_SETTINGS = 'settings';
export const META_SYNC = 'sync';
export const META_SPOTIFY = 'spotify';
export const META_CURSORS = 'cursors';

/* -------------------------------------------------------------------------- */

let dbp: Promise<IDBPDatabase<AppDB>> | null = null;
let blockedNotice: ((message: string) => void) | null = null;

export function onDatabaseBlocked(handler: (message: string) => void): void {
  blockedNotice = handler;
}

export function db(): Promise<IDBPDatabase<AppDB>> {
  if (!dbp) {
    dbp = openDB<AppDB>(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const entities = database.createObjectStore('entities', { keyPath: 'id' });
          entities.createIndex('byType', 'type');
          entities.createIndex('byUpdated', 'updatedAt');

          const memberships = database.createObjectStore('memberships', { keyPath: 'id' });
          memberships.createIndex('byParent', 'parentId');
          memberships.createIndex('byChild', 'childId');

          const ratings = database.createObjectStore('ratings', { keyPath: 'id' });
          ratings.createIndex('byEntity', 'entityId');
          ratings.createIndex('byAt', 'at');
          ratings.createIndex('byType', 'entityType');

          const comparisons = database.createObjectStore('comparisons', { keyPath: 'id' });
          comparisons.createIndex('byType', 'entityType');
          comparisons.createIndex('byAt', 'at');

          database.createObjectStore('queueStates', { keyPath: 'id' });
          database.createObjectStore('annotations', { keyPath: 'id' });
          database.createObjectStore('collections', { keyPath: 'id' });
          database.createObjectStore('meta');
        }
        if (oldVersion < 2) {
          // v2 introduced user-defined rating scales as first-class records.
          database.createObjectStore('scales', { keyPath: 'id' });
        }
        if (oldVersion < 3) {
          // v3 removed the seeded sample catalogue. Anything that came from it
          // is purged outright rather than tombstoned: it was never real data,
          // and leaving it behind is exactly the confusion the removal fixes.
          purgeSeededSampleData(transaction);
        }
        if (oldVersion < 4) {
          // v4 added the listening log. Confirmed plays are indexed by entity
          // and time together so an album's window can be read with one range
          // query instead of a scan across every play ever recorded.
          const plays = database.createObjectStore('plays', { keyPath: 'id' });
          plays.createIndex('byAt', 'at');
          plays.createIndex('byEntity', 'entityId');
          plays.createIndex('byEntityAt', ['entityId', 'at']);
          plays.createIndex('byUpdated', 'updatedAt');

          const completions = database.createObjectStore('completions', { keyPath: 'id' });
          completions.createIndex('byAlbum', 'albumId');
          completions.createIndex('byAt', 'endAt');
          completions.createIndex('byUpdated', 'updatedAt');
        }
      },
      blocked() {
        blockedNotice?.(
          'Another tab is using an older version of this app. Close it and reload to continue.',
        );
      },
      blocking() {
        // A newer version wants in. Let go so the other tab can upgrade.
        void db().then((instance) => instance.close());
        dbp = null;
      },
      terminated() {
        dbp = null;
      },
    });
  }
  return dbp;
}

/**
 * Removes every trace of the seeded sample catalogue that earlier versions
 * installed. Sample rows were the only ones written with the `demo` provider,
 * so their ids all begin `<type>:demo:`, and the ratings, comparisons and notes
 * that pointed at them go with them.
 */
function purgeSeededSampleData(
  transaction: IDBPTransaction<AppDB, ArrayLike<StoreNames<AppDB>>, 'versionchange'>,
): void {
  const isSampleId = (id: unknown): boolean => typeof id === 'string' && /^[a-z]+:demo:/.test(id);

  const purge = <S extends StoreNames<AppDB>>(store: S, refs: (value: unknown) => unknown[]) => {
    void transaction
      .objectStore(store)
      .openCursor()
      .then(function step(cursor): unknown {
        if (!cursor) return undefined;
        if (refs(cursor.value).some(isSampleId)) void cursor.delete();
        return cursor.continue().then(step);
      });
  };

  purge('entities', (v) => [(v as { id?: unknown }).id]);
  purge('memberships', (v) => [
    (v as { parentId?: unknown }).parentId,
    (v as { childId?: unknown }).childId,
  ]);
  purge('ratings', (v) => [(v as { entityId?: unknown }).entityId]);
  purge('comparisons', (v) => [(v as { aId?: unknown }).aId, (v as { bId?: unknown }).bId]);
  purge('queueStates', (v) => [(v as { id?: unknown }).id]);
  purge('annotations', (v) => [(v as { id?: unknown }).id]);
}

/** For tests and for "erase everything" in settings. */
export async function closeDatabase(): Promise<void> {
  if (!dbp) return;
  const instance = await dbp;
  instance.close();
  dbp = null;
}

/**
 * Svelte 5 `$state` proxies cannot be structured-cloned into IndexedDB, and
 * neither can class instances that sneak in from provider mappers. This is the
 * one gate every write passes through.
 */
export function raw<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/* -------------------------------------------------------------------------- */
/* Generic record access                                                      */
/* -------------------------------------------------------------------------- */

export interface SyncRecord {
  id: string;
  updatedAt: number;
  deleted?: number;
}

export async function putRecord<S extends SyncedStore>(
  store: S,
  value: AppDB[S]['value'],
): Promise<void> {
  const database = await db();
  await database.put(store, raw(value));
}

export async function putRecords<S extends SyncedStore>(
  store: S,
  values: readonly AppDB[S]['value'][],
): Promise<void> {
  if (values.length === 0) return;
  const database = await db();
  const tx = database.transaction(store, 'readwrite');
  await Promise.all([...values.map((v) => tx.store.put(raw(v))), tx.done]);
}

/** Live records only: tombstones are an implementation detail of sync. */
export async function allLive<S extends SyncedStore>(store: S): Promise<AppDB[S]['value'][]> {
  const database = await db();
  const rows = (await database.getAll(store)) as AppDB[S]['value'][];
  return rows.filter((r) => !(r as SyncRecord).deleted);
}

/** Everything, tombstones included. Only sync and export should call this. */
export async function allForSync<S extends SyncedStore>(store: S): Promise<AppDB[S]['value'][]> {
  const database = await db();
  return (await database.getAll(store)) as AppDB[S]['value'][];
}

export async function getRecord<S extends SyncedStore>(
  store: S,
  key: AppDB[S]['key'],
): Promise<AppDB[S]['value'] | undefined> {
  const database = await db();
  const found = (await database.get(store, key)) as AppDB[S]['value'] | undefined;
  if (found && (found as SyncRecord).deleted) return undefined;
  return found;
}

/**
 * Deletion writes a tombstone rather than removing the row, so a delete made
 * offline on one device still wins against a stale copy on another.
 */
export async function tombstone<S extends SyncedStore>(
  store: S,
  key: AppDB[S]['key'],
  now = Date.now(),
): Promise<void> {
  const database = await db();
  const existing = (await database.get(store, key)) as SyncRecord | undefined;
  if (!existing) return;
  await database.put(store, raw({ ...existing, deleted: now, updatedAt: now }) as never);
}

export async function clearStore(store: StoreName): Promise<void> {
  const database = await db();
  await database.clear(store);
}

export async function readMeta<T>(key: string): Promise<T | undefined> {
  const database = await db();
  return (await database.get('meta', key)) as T | undefined;
}

export async function writeMeta<T>(key: string, value: T): Promise<void> {
  const database = await db();
  await database.put('meta', raw(value) as unknown, key);
}

export async function deleteMeta(key: string): Promise<void> {
  const database = await db();
  await database.delete('meta', key);
}

export async function readSettings(): Promise<Partial<AppSettings> | undefined> {
  return readMeta<Partial<AppSettings>>(META_SETTINGS);
}

/** Approximate on-device footprint, for the diagnostics view. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const estimate = await navigator.storage.estimate();
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
}

export async function countAll(): Promise<Record<StoreName, number>> {
  const database = await db();
  const names: StoreName[] = [...SYNCED_STORES, 'meta'];
  const entries = await Promise.all(names.map(async (n) => [n, await database.count(n)] as const));
  return Object.fromEntries(entries) as Record<StoreName, number>;
}
