import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DB_NAME, closeDatabase, countAll, db, raw, readMeta, writeMeta } from './db';
import {
  amendRating,
  canonicalIndex,
  clearQueueState,
  combineEntities,
  CombineError,
  deleteRating,
  getEntity,
  listAnnotations,
  listCanonicalGroups,
  listComparisons,
  listEntities,
  listMemberships,
  listQueueStates,
  listRatings,
  loadStoreForSync,
  loadWorld,
  patchAnnotation,
  patchCanonicalAnnotation,
  previewCombine,
  ratingsFor,
  recordComparison,
  recordRating,
  replaceChildren,
  retractRating,
  revertCombine,
  saveMemberships,
  setGroupPrimary,
  setQueueState,
  uncombineGroup,
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
import { buildCanonicalIndex } from '../domain/canonical';
import { BUILTIN_SCALES, findScale } from '../domain/scales';
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
      'canonicalGroups',
      'collections',
      'comparisons',
      'entities',
      'memberships',
      'meta',
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
    expect(database.version).toBe(4);
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
    expect(database.version).toBe(4);
    expect(await getEntity('album:spotify:real')).toBeTruthy();
    expect(await getEntity('album:demo:fake')).toBeUndefined();
    expect((await countAll()).ratings).toBe(0);
  });

  it('migrates a legacy duplicateOf pointer into a real canonical group', async () => {
    await closeDatabase();
    // A v3 database holding the old one-way "this is a duplicate of that" note.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 3);
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
        const tx = database.transaction(['entities', 'annotations'], 'readwrite');
        const store = tx.objectStore('entities');
        store.put(makeEntity('album', 'original'));
        store.put(makeEntity('album', 'remaster'));
        tx.objectStore('annotations').put({
          id: 'album:local:remaster',
          tags: ['loud'],
          duplicateOf: 'album:local:original',
          updatedAt: 1,
        });
        // A pointer across kinds is nonsense and must not become a group.
        tx.objectStore('annotations').put({
          id: 'track:local:stray',
          tags: [],
          duplicateOf: 'album:local:original',
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
    expect(database.version).toBe(4);
    const groups = await listCanonicalGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.primaryId).toBe('album:local:original');
    expect(groups[0]!.memberIds.sort()).toEqual(['album:local:original', 'album:local:remaster']);
    expect(groups[0]!.entityType).toBe('album');
    // The annotation is left exactly as it was: rewriting it would push a stale
    // edit at any device still running the older version.
    const annotation = (await listAnnotations()).find((a) => a.id === 'album:local:remaster');
    expect(annotation?.duplicateOf).toBe('album:local:original');
    expect(annotation?.tags).toEqual(['loud']);
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

describe('combining duplicates', () => {
  const scale = findScale(BUILTIN_SCALES, 'int-10')!;
  const original = makeEntity('album', 'original', { name: 'Kid A' });
  const remaster = makeEntity('album', 'remaster', { name: 'Kid A (2016 Remaster)' });
  const third = makeEntity('album', 'third', { name: 'Kid A (Japanese Edition)' });
  const song = makeEntity('track', 'song', { name: 'Kid A' });

  async function library(): Promise<void> {
    await upsertEntities([original, remaster, third, song]);
  }

  it('averages two current ratings into exactly one new entry', async () => {
    await library();
    await recordRating({
      entityId: original.id,
      entityType: 'album',
      normalized: 70,
      value: 7,
      scaleId: 'int-10',
    });
    await recordRating({
      entityId: remaster.id,
      entityType: 'album',
      normalized: 90,
      value: 9,
      scaleId: 'int-10',
    });

    const before = currentDataVersion();
    const result = await combineEntities({
      entityIds: [original.id, remaster.id],
      primaryId: original.id,
      scale,
    });

    // One mutation, one bump: the group, its tombstones and the averaged entry
    // all land together or not at all.
    expect(currentDataVersion()).toBe(before + 1);
    expect(result.plan.rating.kind).toBe('averaged');
    expect(result.averaged?.normalized).toBe(80);
    expect(result.averaged?.value).toBe(8);
    expect(result.averaged?.entityId).toBe(original.id);
    expect(result.averaged?.context).toBe('combine');
    expect(result.averaged?.origin?.sourceEventIds).toHaveLength(2);

    // The two originals are untouched, and the new entry is the third row.
    const events = await listRatings();
    expect(events).toHaveLength(3);
    expect(events.filter((e) => e.retracted)).toHaveLength(0);

    const index = buildCanonicalIndex(await listCanonicalGroups());
    expect(index.resolve(remaster.id)).toBe(original.id);
    expect(indexCurrentRatings(events, index.resolver).get(original.id)?.normalized).toBe(80);
  });

  it('lets a single rating stand for the group without inventing an entry', async () => {
    await library();
    await recordRating({
      entityId: remaster.id,
      entityType: 'album',
      normalized: 60,
      value: 6,
      scaleId: 'int-10',
    });

    const result = await combineEntities({
      entityIds: [original.id, remaster.id],
      primaryId: original.id,
      scale,
    });
    expect(result.plan.rating.kind).toBe('carried');
    expect(result.averaged).toBeNull();
    expect(await listRatings()).toHaveLength(1);

    const index = buildCanonicalIndex(await listCanonicalGroups());
    const current = indexCurrentRatings(await listRatings(), index.resolver);
    expect(current.get(original.id)?.normalized).toBe(60);
  });

  it('ignores ratings that were withdrawn or deleted', async () => {
    await library();
    const withdrawn = await recordRating({
      entityId: original.id,
      entityType: 'album',
      normalized: 20,
      value: 2,
      scaleId: 'int-10',
    });
    await retractRating(withdrawn.id);
    await recordRating({
      entityId: remaster.id,
      entityType: 'album',
      normalized: 90,
      value: 9,
      scaleId: 'int-10',
    });

    const result = await combineEntities({
      entityIds: [original.id, remaster.id],
      primaryId: original.id,
      scale,
    });
    expect(result.plan.rating.kind).toBe('carried');
    expect(result.averaged).toBeNull();
  });

  it('refuses to combine different kinds, and refuses a group of one', async () => {
    await library();
    await expect(
      combineEntities({ entityIds: [original.id, song.id], primaryId: original.id, scale }),
    ).rejects.toBeInstanceOf(CombineError);
    await expect(
      combineEntities({ entityIds: [original.id], primaryId: original.id, scale }),
    ).rejects.toThrow(/two different items/i);
    expect(await listCanonicalGroups()).toHaveLength(0);
  });

  it('extends the group it is given rather than making a second one', async () => {
    await library();
    await combineEntities({
      entityIds: [original.id, remaster.id],
      primaryId: original.id,
      scale,
    });

    await combineEntities({
      entityIds: [remaster.id, third.id],
      primaryId: remaster.id,
      scale,
    });

    const live = await listCanonicalGroups();
    expect(live).toHaveLength(1);
    expect(live[0]!.memberIds.sort()).toEqual([original.id, remaster.id, third.id].sort());
    expect(live[0]!.primaryId).toBe(remaster.id);

    const index = buildCanonicalIndex(live);
    expect(index.resolve(third.id)).toBe(remaster.id);
    expect(index.resolve(original.id)).toBe(remaster.id);
  });

  it('does not count a previous combine average and its source ratings twice', async () => {
    await library();
    await recordRating({
      entityId: original.id,
      entityType: 'album',
      normalized: 70,
      value: 7,
      scaleId: 'int-10',
    });
    await recordRating({
      entityId: remaster.id,
      entityType: 'album',
      normalized: 90,
      value: 9,
      scaleId: 'int-10',
    });
    const base = await combineEntities({
      entityIds: [original.id, remaster.id],
      primaryId: original.id,
      scale,
    });
    expect(base.averaged?.normalized).toBe(80);
    await recordRating({
      entityId: third.id,
      entityType: 'album',
      normalized: 60,
      value: 6,
      scaleId: 'int-10',
    });

    const grown = await combineEntities({
      entityIds: [original.id, third.id],
      primaryId: original.id,
      scale,
    });
    expect(grown.plan.rating.sources.map((source) => source.normalized)).toEqual([80, 60]);
    expect(grown.averaged?.normalized).toBe(70);
  });

  it('clears edited annotation fields from aliases so they cannot reappear', async () => {
    await library();
    await patchAnnotation(remaster.id, {
      tags: ['vinyl'],
      note: 'old edition note',
      pinned: 'favorite',
    });
    const { group } = await combineEntities({
      entityIds: [original.id, remaster.id],
      primaryId: original.id,
      scale,
    });
    await patchCanonicalAnnotation(group.primaryId, group.memberIds, {
      tags: [],
      note: undefined,
      pinned: undefined,
    });

    const annotations = await listAnnotations();
    const alias = annotations.find((annotation) => annotation.id === remaster.id);
    expect(alias?.tags).toEqual([]);
    expect(alias?.note).toBeUndefined();
    expect(alias?.pinned).toBeUndefined();
  });

  it('can separate a legacy alias without letting duplicateOf recreate it', async () => {
    await library();
    await patchAnnotation(remaster.id, { tags: [], duplicateOf: original.id });
    const legacy = await canonicalIndex();
    const synthetic = legacy.group(original.id);
    expect(synthetic?.id).toMatch(/^legacy:/);

    const plan = await uncombineGroup(synthetic!.id);
    expect(plan?.memberIds.sort()).toEqual([original.id, remaster.id].sort());
    expect((await canonicalIndex()).group(original.id)).toBeUndefined();
    expect(
      (await listAnnotations()).find((row) => row.id === remaster.id)?.duplicateOf,
    ).toBeUndefined();
  });

  it('absorbs a second group instead of leaving a source in two of them', async () => {
    const fourth = makeEntity('album', 'fourth', { name: 'Kid A (Mono)' });
    await library();
    await upsertEntities([fourth]);

    const first = await combineEntities({
      entityIds: [original.id, remaster.id],
      primaryId: original.id,
      scale,
    });
    const second = await combineEntities({
      entityIds: [third.id, fourth.id],
      primaryId: third.id,
      scale,
    });
    expect(await listCanonicalGroups()).toHaveLength(2);

    await combineEntities({ entityIds: [original.id, third.id], primaryId: original.id, scale });

    const live = await listCanonicalGroups();
    expect(live).toHaveLength(1);
    expect(live[0]!.id).toBe(first.group.id);
    expect(live[0]!.memberIds.sort()).toEqual(
      [original.id, remaster.id, third.id, fourth.id].sort(),
    );
    // The swallowed group leaves a tombstone so the merge travels to other devices.
    const stored = await loadStoreForSync('canonicalGroups');
    expect(stored).toHaveLength(2);
    expect(stored.find((g) => g.id === second.group.id)?.deleted).toBeGreaterThan(0);

    const index = buildCanonicalIndex(live);
    expect(index.members(fourth.id)).toHaveLength(4);
    expect(index.resolve(fourth.id)).toBe(original.id);
  });

  it('previews the same plan it would carry out', async () => {
    await library();
    await recordRating({
      entityId: original.id,
      entityType: 'album',
      normalized: 70,
      value: 7,
      scaleId: 'int-10',
    });
    await recordRating({
      entityId: remaster.id,
      entityType: 'album',
      normalized: 90,
      value: 9,
      scaleId: 'int-10',
    });
    const before = currentDataVersion();
    const preview = await previewCombine({
      entityIds: [original.id, remaster.id],
      primaryId: original.id,
      scale,
    });
    expect(preview.rating.event?.normalized).toBe(80);
    // A preview writes nothing at all.
    expect(currentDataVersion()).toBe(before);
    expect(await listCanonicalGroups()).toHaveLength(0);

    const done = await combineEntities({
      entityIds: [original.id, remaster.id],
      primaryId: original.id,
      scale,
    });
    expect(done.plan.rating.event?.normalized).toBe(preview.rating.event?.normalized);
  });

  it('changes which source represents the group without touching history', async () => {
    await library();
    await recordRating({
      entityId: original.id,
      entityType: 'album',
      normalized: 70,
      value: 7,
      scaleId: 'int-10',
    });
    const { group } = await combineEntities({
      entityIds: [original.id, remaster.id],
      primaryId: original.id,
      scale,
    });

    const before = currentDataVersion();
    const moved = await setGroupPrimary(group.id, remaster.id);
    expect(currentDataVersion()).toBe(before + 1);
    expect(moved?.primaryId).toBe(remaster.id);

    const index = buildCanonicalIndex(await listCanonicalGroups());
    expect(index.resolve(original.id)).toBe(remaster.id);
    // The event still names the source it was made against.
    expect((await listRatings())[0]!.entityId).toBe(original.id);
    // And the rating still answers for the group under its new primary.
    expect(
      indexCurrentRatings(await listRatings(), index.resolver).get(remaster.id)?.normalized,
    ).toBe(70);

    await expect(setGroupPrimary(group.id, song.id)).rejects.toBeInstanceOf(CombineError);
  });

  it('separates again, withdrawing only the entry combining wrote', async () => {
    await library();
    await recordRating({
      entityId: original.id,
      entityType: 'album',
      normalized: 70,
      value: 7,
      scaleId: 'int-10',
    });
    await recordRating({
      entityId: remaster.id,
      entityType: 'album',
      normalized: 90,
      value: 9,
      scaleId: 'int-10',
    });
    const { group, averaged } = await combineEntities({
      entityIds: [original.id, remaster.id],
      primaryId: original.id,
      scale,
    });

    const before = currentDataVersion();
    const plan = await uncombineGroup(group.id);
    expect(currentDataVersion()).toBe(before + 1);
    expect(plan?.withdrawEventIds).toEqual([averaged!.id]);

    // Nothing was destroyed: three events remain, one of them withdrawn.
    const events = await listRatings();
    expect(events).toHaveLength(3);
    expect(events.find((e) => e.id === averaged!.id)?.retracted).toBeGreaterThan(0);
    expect(await listCanonicalGroups()).toHaveLength(0);

    const current = indexCurrentRatings(events);
    expect(current.get(original.id)?.normalized).toBe(70);
    expect(current.get(remaster.id)?.normalized).toBe(90);
  });

  it('undoes a combine exactly, whether or not a group already existed', async () => {
    const fourth = makeEntity('album', 'fourth', { name: 'Kid A (Mono)' });
    await library();
    await upsertEntities([fourth]);
    await recordRating({
      entityId: original.id,
      entityType: 'album',
      normalized: 70,
      value: 7,
      scaleId: 'int-10',
    });
    await recordRating({
      entityId: third.id,
      entityType: 'album',
      normalized: 90,
      value: 9,
      scaleId: 'int-10',
    });

    // A fresh combine undoes to nothing at all.
    const fresh = await combineEntities({
      entityIds: [original.id, remaster.id],
      primaryId: original.id,
      scale,
    });
    await revertCombine(fresh);
    expect(await listCanonicalGroups()).toHaveLength(0);

    // A combine that grew an existing group undoes back to that group, not
    // past it into three separate records.
    const base = await combineEntities({
      entityIds: [original.id, remaster.id],
      primaryId: original.id,
      scale,
    });
    const grown = await combineEntities({
      entityIds: [original.id, third.id, fourth.id],
      primaryId: original.id,
      scale,
    });
    expect(grown.previous?.id).toBe(base.group.id);
    expect(grown.averaged).not.toBeNull();

    await revertCombine(grown);
    const live = await listCanonicalGroups();
    expect(live).toHaveLength(1);
    expect(live[0]!.memberIds.sort()).toEqual([original.id, remaster.id].sort());
    // The averaged entry it wrote is withdrawn, so the ratings are as they were.
    const events = await listRatings();
    expect(events.find((e) => e.id === grown.averaged!.id)?.retracted).toBeGreaterThan(0);
    const index = buildCanonicalIndex(live);
    const current = indexCurrentRatings(events, index.resolver);
    expect(current.get(original.id)?.normalized).toBe(70);
    expect(current.get(third.id)?.normalized).toBe(90);
  });

  it('carries combined groups through the world load', async () => {
    await library();
    await combineEntities({
      entityIds: [original.id, remaster.id],
      primaryId: original.id,
      scale,
    });
    const world = await loadWorld();
    expect(world.canonicalGroups).toHaveLength(1);
    // And the resolver can be had without a world at all.
    expect((await canonicalIndex()).resolve(remaster.id)).toBe(original.id);
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

  it('round-trips a combined group, its sources and its averaged entry', async () => {
    const scale = findScale(BUILTIN_SCALES, 'int-10')!;
    const one = makeEntity('album', 'one', { name: 'Kid A' });
    const two = makeEntity('album', 'two', { name: 'Kid A (2016 Remaster)' });
    await upsertEntities([one, two]);
    await recordRating({
      entityId: one.id,
      entityType: 'album',
      normalized: 70,
      value: 7,
      scaleId: 'int-10',
    });
    await recordRating({
      entityId: two.id,
      entityType: 'album',
      normalized: 90,
      value: 9,
      scaleId: 'int-10',
    });
    await combineEntities({ entityIds: [one.id, two.id], primaryId: one.id, scale });

    const text = serializeSnapshot(await buildSnapshot());
    expect(
      snapshotCounts(parseSnapshot(text)).find((c) => c.label === 'combined items')?.count,
    ).toBe(1);

    await wipe();
    await restoreSnapshot(parseSnapshot(text));

    const groups = await listCanonicalGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.memberIds.sort()).toEqual([one.id, two.id].sort());
    // Both source entities survive the trip, and so does the averaged entry.
    expect(await listEntities()).toHaveLength(2);
    const index = buildCanonicalIndex(groups);
    expect(indexCurrentRatings(await listRatings(), index.resolver).get(one.id)?.normalized).toBe(
      80,
    );
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
    const migrated = migrateSnapshot(old);
    expect(migrated.version).toBe(2);
    expect(migrated.canonicalGroups).toEqual([]);
  });

  it('reads a format-1 file, which had no combined groups in it', () => {
    const legacy = { ...emptySnapshot('X'), version: 1 } as Record<string, unknown>;
    delete legacy.canonicalGroups;
    const parsed = parseSnapshot(JSON.stringify(legacy));
    expect(parsed.canonicalGroups).toEqual([]);
    expect(parsed.version).toBe(2);
  });

  it('summarises a backup in plain language', async () => {
    await upsertEntities([makeEntity('album', 'al')]);
    const counts = snapshotCounts(await buildSnapshot());
    expect(counts.find((c) => c.label === 'catalogue items')?.count).toBe(1);
  });
});
