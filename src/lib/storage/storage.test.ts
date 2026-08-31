import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DB_NAME, DB_VERSION, closeDatabase, countAll, db, raw, readMeta, writeMeta } from './db';
import {
  amendRating,
  clearQueueState,
  deleteRating,
  getEntity,
  listComparisons,
  listEntities,
  listMemberships,
  listQueueStates,
  listRatings,
  loadStoreForSync,
  patchAnnotation,
  ratingsFor,
  recordComparison,
  recordRating,
  replaceChildren,
  retractRating,
  saveMemberships,
  setQueueState,
  upsertEntities,
} from './repo';
import { currentDataVersion } from './changes';
import {
  buildSnapshot,
  parseSnapshot,
  restoreSnapshot,
  serializeSnapshot,
  snapshotCounts,
  SnapshotError,
  migrateSnapshot,
  emptySnapshot,
} from './snapshot';
import { currentRating, indexCurrentRatings } from '../domain/ratings';
import { link, makeEntity, resetFixtureCounters } from '../../test/fixtures';

async function wipe(): Promise<void> {
  await closeDatabase();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  resetFixtureCounters();
  await wipe();
});

afterEach(async () => {
  await closeDatabase();
});

describe('database shape', () => {
  it('opens at the current version with every store present', async () => {
    const database = await db();
    expect([...database.objectStoreNames].sort()).toEqual([
      'annotations',
      'collections',
      'comparisons',
      'completions',
      'entities',
      'memberships',
      'meta',
      'plays',
      'queueStates',
      'ratings',
      'scales',
    ]);
  });

  it('upgrades an old database without losing what was in it', async () => {
    await closeDatabase();
    // Recreate the v1 shape by hand, then let the app open it at v2.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
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
      };
      request.onsuccess = () => {
        const database = request.result;
        const tx = database.transaction('entities', 'readwrite');
        tx.objectStore('entities').put(makeEntity('album', 'legacy'));
        tx.oncomplete = () => {
          database.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });

    const database = await db();
    expect(database.version).toBe(DB_VERSION);
    expect(database.objectStoreNames.contains('scales')).toBe(true);
    expect(await getEntity(makeEntity('album', 'legacy').id)).toBeTruthy();
  });

  it('purges the seeded sample catalogue when upgrading past v2', async () => {
    await closeDatabase();
    // A v2 database that still holds sample rows alongside real ones.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 2);
      request.onupgradeneeded = () => {
        const database = request.result;
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
        database.createObjectStore('scales', { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const database = request.result;
        const tx = database.transaction(['entities', 'ratings'], 'readwrite');
        const store = tx.objectStore('entities');
        store.put({ ...makeEntity('album', 'real'), id: 'album:spotify:real' });
        store.put({ ...makeEntity('album', 'fake'), id: 'album:demo:fake' });
        tx.objectStore('ratings').put({
          id: 'r1',
          entityId: 'album:demo:fake',
          entityType: 'album',
          normalized: 80,
          at: 1,
          updatedAt: 1,
        });
        tx.oncomplete = () => {
          database.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });

    const database = await db();
    expect(database.version).toBe(DB_VERSION);
    expect(await getEntity('album:spotify:real')).toBeTruthy();
    expect(await getEntity('album:demo:fake')).toBeUndefined();
    expect((await countAll()).ratings).toBe(0);
  });

  it('strips reactive proxies before writing', () => {
    const proxied = new Proxy({ id: 'x', nested: { n: 1 } }, {});
    expect(raw(proxied)).toEqual({ id: 'x', nested: { n: 1 } });
  });

  it('reads and writes singleton metadata', async () => {
    await writeMeta('probe', { hello: 'there' });
    expect(await readMeta('probe')).toEqual({ hello: 'there' });
  });

  it('counts records per store for diagnostics', async () => {
    await upsertEntities([makeEntity('album', 'a')]);
    expect((await countAll()).entities).toBe(1);
  });
});

describe('entities and containment', () => {
  it('merges a refreshed catalogue record instead of blanking fields', async () => {
    const first = makeEntity('album', 'al', { artworkUrl: 'art.jpg', name: 'Old Name' });
    await upsertEntities([first]);
    await upsertEntities([makeEntity('album', 'al', { name: 'New Name' })]);
    const stored = await getEntity(first.id);
    expect(stored?.name).toBe('New Name');
    expect(stored?.artworkUrl).toBe('art.jpg');
  });

  it('writes brand-new records through the clone gate', async () => {
    // A Spotify search result reaches the repo wrapped in Svelte's reactive
    // proxy, which IndexedDB refuses to structured-clone. New records used to
    // be written straight through, so adopting a search result threw
    // DataCloneError instead of saving.
    const fresh = makeEntity('artist', 'fresh');
    const hostile = Object.assign({}, fresh, { notCloneable: () => 'boom' });
    await upsertEntities([hostile as unknown as typeof fresh]);
    expect((await getEntity(fresh.id))?.name).toBe(fresh.name);
  });

  it('writes memberships through the clone gate', async () => {
    const playlist = makeEntity('playlist', 'p2');
    const track = makeEntity('track', 't2');
    await upsertEntities([playlist, track]);
    const edge = link(playlist, track, { position: 0 });
    const hostile = Object.assign({}, edge, { notCloneable: () => 'boom' });
    await replaceChildren(playlist.id, [hostile as unknown as typeof edge]);
    expect(await listMemberships()).toHaveLength(1);
  });

  it('tombstones links that disappeared from a playlist, keeping the rest', async () => {
    const playlist = makeEntity('playlist', 'p');
    const kept = makeEntity('track', 'kept');
    const removed = makeEntity('track', 'removed');
    await upsertEntities([playlist, kept, removed]);
    await saveMemberships([
      link(playlist, kept, { position: 0 }),
      link(playlist, removed, { position: 1 }),
    ]);
    expect(await listMemberships()).toHaveLength(2);

    await replaceChildren(playlist.id, [link(playlist, kept, { position: 0 })]);
    const live = await listMemberships();
    expect(live).toHaveLength(1);
    expect(live[0]!.childId).toBe(kept.id);

    // The tombstone survives for sync, and the removed track itself is untouched.
    expect(await loadStoreForSync('memberships')).toHaveLength(2);
    expect(await getEntity(removed.id)).toBeTruthy();
  });
});

describe('ratings are events, not fields', () => {
  const album = makeEntity('album', 'al');

  it('appends rather than overwrites, and the newest one counts', async () => {
    await upsertEntities([album]);
    await recordRating({
      entityId: album.id,
      entityType: 'album',
      normalized: 40,
      value: 4,
      scaleId: 'int-10',
    });
    await new Promise((r) => setTimeout(r, 2));
    await recordRating({
      entityId: album.id,
      entityType: 'album',
      normalized: 90,
      value: 9,
      scaleId: 'int-10',
    });

    const history = await ratingsFor(album.id);
    expect(history).toHaveLength(2);
    expect(currentRating(history)?.normalized).toBe(90);
  });

  it('retracting restores the previous verdict without erasing the record', async () => {
    await upsertEntities([album]);
    await recordRating({
      entityId: album.id,
      entityType: 'album',
      normalized: 40,
      value: 4,
      scaleId: 'int-10',
    });
    await new Promise((r) => setTimeout(r, 2));
    const second = await recordRating({
      entityId: album.id,
      entityType: 'album',
      normalized: 90,
      value: 9,
      scaleId: 'int-10',
    });
    await retractRating(second.id);

    const history = await ratingsFor(album.id);
    expect(history).toHaveLength(2);
    expect(currentRating(history)?.normalized).toBe(40);
  });

  it('amending marks the entry as edited', async () => {
    const event = await recordRating({
      entityId: album.id,
      entityType: 'album',
      normalized: 40,
      value: 4,
      scaleId: 'int-10',
    });
    await amendRating(event.id, { normalized: 55, value: 5.5 });
    const [stored] = await ratingsFor(album.id);
    expect(stored?.normalized).toBe(55);
    expect(stored?.edited).toBeGreaterThan(0);
  });

  it('deleting leaves a tombstone that sync can carry', async () => {
    const event = await recordRating({
      entityId: album.id,
      entityType: 'album',
      normalized: 40,
      value: 4,
      scaleId: 'int-10',
    });
    await deleteRating(event.id);
    expect(await listRatings()).toHaveLength(0);
    const all = await loadStoreForSync('ratings');
    expect(all).toHaveLength(1);
    expect(all[0]!.deleted).toBeGreaterThan(0);
  });

  it('indexes the current rating per entity', async () => {
    const other = makeEntity('album', 'other');
    await recordRating({
      entityId: album.id,
      entityType: 'album',
      normalized: 40,
      value: 4,
      scaleId: 'int-10',
    });
    await recordRating({
      entityId: other.id,
      entityType: 'album',
      normalized: 70,
      value: 7,
      scaleId: 'int-10',
    });
    const index = indexCurrentRatings(await listRatings());
    expect(index.get(album.id)?.normalized).toBe(40);
    expect(index.get(other.id)?.normalized).toBe(70);
  });

  it('bumps the change counter exactly once per write', async () => {
    const before = currentDataVersion();
    await recordRating({
      entityId: album.id,
      entityType: 'album',
      normalized: 40,
      value: 4,
      scaleId: 'int-10',
    });
    expect(currentDataVersion()).toBe(before + 1);
  });
});

describe('comparisons, queue states and notes', () => {
  const a = makeEntity('album', 'a');
  const b = makeEntity('album', 'b');

  it('records and undoes a comparison', async () => {
    const comparison = await recordComparison('album', a.id, b.id, 'a');
    expect(await listComparisons()).toHaveLength(1);
    const { undoComparison } = await import('./repo');
    await undoComparison(comparison.id);
    expect(await listComparisons()).toHaveLength(0);
    expect(await loadStoreForSync('comparisons')).toHaveLength(1);
  });

  it('stores a snooze with its expiry, and clears it', async () => {
    await setQueueState(a.id, 'album', 'snoozed', 12345);
    const [state] = await listQueueStates();
    expect(state).toMatchObject({ kind: 'snoozed', until: 12345 });
    await clearQueueState(a.id);
    expect(await listQueueStates()).toHaveLength(0);
  });

  it('patches annotations without dropping earlier fields', async () => {
    await patchAnnotation(a.id, { tags: ['loud'] });
    const next = await patchAnnotation(a.id, { pinned: 'favorite' });
    expect(next.tags).toEqual(['loud']);
    expect(next.pinned).toBe('favorite');
  });
});

describe('snapshots', () => {
  it('round-trips through export and import', async () => {
    const album = makeEntity('album', 'al');
    await upsertEntities([album]);
    await recordRating({
      entityId: album.id,
      entityType: 'album',
      normalized: 80,
      value: 8,
      scaleId: 'int-10',
    });

    const exported = await buildSnapshot();
    const text = serializeSnapshot(exported);

    await wipe();
    expect(await listEntities()).toHaveLength(0);

    await restoreSnapshot(parseSnapshot(text));
    expect(await listEntities()).toHaveLength(1);
    expect((await listRatings())[0]!.normalized).toBe(80);
  });

  it('carries tombstones so a deletion survives a restore', async () => {
    const album = makeEntity('album', 'al');
    const event = await recordRating({
      entityId: album.id,
      entityType: 'album',
      normalized: 80,
      value: 8,
      scaleId: 'int-10',
    });
    await deleteRating(event.id);
    const exported = await buildSnapshot();
    expect(exported.ratings).toHaveLength(1);
    expect(exported.ratings[0]!.deleted).toBeGreaterThan(0);
  });

  it('does not report a restore as a local change', async () => {
    const before = currentDataVersion();
    await restoreSnapshot(emptySnapshot('X'));
    expect(currentDataVersion()).toBe(before);
  });

  it('refuses a file from a different app', () => {
    expect(() => parseSnapshot('{"kind":"something-else","version":1}')).toThrow(SnapshotError);
    expect(() => parseSnapshot('not json at all')).toThrow(SnapshotError);
  });

  it('refuses a file from a newer version of this app', () => {
    expect(() => parseSnapshot(JSON.stringify({ ...emptySnapshot('X'), version: 99 }))).toThrow(
      /newer version/i,
    );
  });

  it('drops malformed rows rather than importing rubbish', () => {
    const parsed = parseSnapshot(
      JSON.stringify({
        ...emptySnapshot('X'),
        entities: [{ nope: true }, makeEntity('album', 'ok')],
      }),
    );
    expect(parsed.entities).toHaveLength(1);
  });

  it('upgrades an older backup format', () => {
    const old = { ...emptySnapshot('X'), version: 0 } as unknown as Parameters<
      typeof migrateSnapshot
    >[0];
    expect(migrateSnapshot(old).version).toBe(1);
  });

  it('summarises a backup in plain language', async () => {
    await upsertEntities([makeEntity('album', 'al')]);
    const counts = snapshotCounts(await buildSnapshot());
    expect(counts.find((c) => c.label === 'catalogue items')?.count).toBe(1);
  });
});
