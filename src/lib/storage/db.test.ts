import 'fake-indexeddb/auto';
import type { IDBPDatabase } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DB_NAME, DB_VERSION, type AppDB } from './db';

/**
 * A device that has seen a newer build.
 *
 * Running a branch once leaves this origin's database at its version, and
 * IndexedDB will not open a database at a lower version than it has: the open
 * rejects, every read after it fails, and the app sits on "Loading your
 * ratings…" with the data present and unreachable.
 *
 * Refusing to start protects nothing, so this build opens whatever is there.
 * The rule these pin: never migrate downward, never lose a store this build
 * does not know about, and never let one failure be remembered forever.
 */

async function resetModule(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/** Leaves a database behind exactly as a later build would have. */
function seedNewer(version: number, extraStore: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, version);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('entities'))
        database.createObjectStore('entities', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta');
      if (!database.objectStoreNames.contains(extraStore))
        database.createObjectStore(extraStore, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

/** The shape this app shipped as version 1, so the real migrations can run. */
function seedOriginal(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const name of [
        'entities',
        'memberships',
        'ratings',
        'comparisons',
        'queueStates',
        'annotations',
        'collections',
      ])
        database.createObjectStore(name, { keyPath: 'id' });
      database.createObjectStore('meta');
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

let openDb: IDBPDatabase<AppDB> | null = null;

beforeEach(async () => {
  await resetModule();
  vi.resetModules();
});

afterEach(async () => {
  openDb?.close();
  openDb = null;
  await resetModule();
});

describe('opening stored data', () => {
  it('creates the database at this build’s version when there is none', async () => {
    const { db: open } = await import('./db');
    const opened = await open();
    openDb = opened;
    expect(opened.version).toBe(DB_VERSION);
  });

  it('opens a database left behind by a newer build', async () => {
    await seedNewer(DB_VERSION + 1, 'plays');
    const module = await import('./db');
    const opened = await module.db();
    openDb = opened;
    expect(opened.version).toBe(DB_VERSION + 1);
  });

  it('leaves stores it does not know about untouched', async () => {
    await seedNewer(DB_VERSION + 1, 'plays');
    const module = await import('./db');
    const opened = await module.db();
    openDb = opened;
    expect([...opened.objectStoreNames]).toContain('plays');
  });

  it('never migrates the database downward', async () => {
    await seedNewer(DB_VERSION + 2, 'completions');
    const module = await import('./db');
    const opened = await module.db();
    openDb = opened;
    expect(opened.version).toBe(DB_VERSION + 2);
  });

  it('still runs its own migrations for an older database', async () => {
    await seedOriginal();
    const module = await import('./db');
    const opened = await module.db();
    openDb = opened;
    expect(opened.version).toBe(DB_VERSION);
    expect([...opened.objectStoreNames]).toContain('scales');
  });
});

/** The shape and contents of a database as it stood at a given version. */
function seedAt(version: number, stores: string[], rows: Record<string, unknown[]>): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, version);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const name of stores) {
        if (database.objectStoreNames.contains(name)) continue;
        if (name === 'meta') database.createObjectStore(name);
        else database.createObjectStore(name, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      const names = Object.keys(rows);
      if (names.length === 0) {
        database.close();
        resolve();
        return;
      }
      const tx = database.transaction(names, 'readwrite');
      for (const [store, values] of Object.entries(rows)) {
        for (const value of values) {
          if (store === 'meta') tx.objectStore(store).put(value, 'settings');
          else tx.objectStore(store).put(value);
        }
      }
      tx.oncomplete = () => {
        database.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

const V3_STORES = [
  'entities',
  'memberships',
  'ratings',
  'comparisons',
  'queueStates',
  'annotations',
  'collections',
  'meta',
  'scales',
];

/** What a person who had been using the app would actually have in there. */
const OWNED_ROWS: Record<string, unknown[]> = {
  entities: [
    { id: 'album:spotify:a1', type: 'album', title: 'One', updatedAt: 1 },
    { id: 'track:spotify:t1', type: 'track', title: 'Two', updatedAt: 1 },
    { id: 'artist:demo:d1', type: 'artist', title: 'Three', updatedAt: 1 },
  ],
  ratings: [
    { id: 'r1', entityId: 'album:spotify:a1', entityType: 'album', value: 80, at: 10 },
    { id: 'r2', entityId: 'artist:demo:d1', entityType: 'artist', value: 40, at: 11 },
  ],
  memberships: [{ id: 'm1', parentId: 'album:spotify:a1', childId: 'track:spotify:t1' }],
  comparisons: [{ id: 'c1', entityType: 'album', aId: 'album:spotify:a1', bId: 'x', at: 12 }],
  annotations: [{ id: 'album:spotify:a1', note: 'kept', updatedAt: 3 }],
  meta: [{ onboarded: true, scaleId: 'ten' }],
};

async function countsFor(opened: IDBPDatabase<AppDB>, stores: string[]): Promise<number[]> {
  return await Promise.all(stores.map((s) => opened.count(s as never)));
}

describe('opening data that predates the merged features', () => {
  it('keeps every record when a version 3 database becomes version 5', async () => {
    await seedAt(3, V3_STORES, OWNED_ROWS);
    const module = await import('./db');
    const opened = await module.db();
    openDb = opened;

    expect(opened.version).toBe(DB_VERSION);
    expect(await countsFor(opened, ['entities', 'ratings', 'memberships', 'comparisons'])).toEqual([
      3, 2, 1, 1,
    ]);
    expect(await opened.get('ratings', 'r1')).toMatchObject({ value: 80 });
    expect(await opened.get('meta', 'settings')).toMatchObject({ onboarded: true });
  });

  it('does not mistake a real library for the sample catalogue it once purged', async () => {
    // The purge is gated at oldVersion < 3, and someone who tried demo mode has
    // demo ids of their own. Opening must not treat those as the old seed.
    await seedAt(3, V3_STORES, OWNED_ROWS);
    const module = await import('./db');
    const opened = await module.db();
    openDb = opened;

    expect(await opened.get('entities', 'artist:demo:d1')).toBeTruthy();
    expect(await opened.get('ratings', 'r2')).toMatchObject({ value: 40 });
  });

  it('adds the stores the merge introduced without filling or clearing anything', async () => {
    await seedAt(3, V3_STORES, OWNED_ROWS);
    const module = await import('./db');
    const opened = await module.db();
    openDb = opened;

    const names = [...opened.objectStoreNames];
    expect(names).toContain('plays');
    expect(names).toContain('completions');
    expect(names).toContain('canonicalGroups');
    expect(await countsFor(opened, ['plays', 'completions'])).toEqual([0, 0]);
  });

  it('keeps the listening history a version 4 device already recorded', async () => {
    // One branch shipped v4 with plays and completions but no canonicalGroups,
    // so v5 has to detect structure rather than believe the version number.
    await seedAt(4, [...V3_STORES, 'plays', 'completions'], {
      ...OWNED_ROWS,
      plays: [{ id: 'p1', entityId: 'track:spotify:t1', at: 20, updatedAt: 20 }],
      completions: [{ id: 'k1', albumId: 'album:spotify:a1', endAt: 21, updatedAt: 21 }],
    });
    const module = await import('./db');
    const opened = await module.db();
    openDb = opened;

    expect(opened.version).toBe(DB_VERSION);
    expect(await countsFor(opened, ['plays', 'completions', 'entities', 'ratings'])).toEqual([
      1, 1, 3, 2,
    ]);
    expect([...opened.objectStoreNames]).toContain('canonicalGroups');
  });

  it('leaves an existing note alone while giving it a group to live in', async () => {
    await seedAt(4, [...V3_STORES, 'plays', 'completions'], {
      ...OWNED_ROWS,
      annotations: [
        { id: 'album:spotify:a1', duplicateOf: 'album:spotify:a2', updatedAt: 3 },
        { id: 'album:spotify:a2', note: 'kept', updatedAt: 4 },
      ],
    });
    const module = await import('./db');
    const opened = await module.db();
    openDb = opened;

    const bridged = await opened.get('annotations', 'album:spotify:a1');
    expect(bridged).toMatchObject({ duplicateOf: 'album:spotify:a2', updatedAt: 3 });
    expect(await opened.count('canonicalGroups')).toBe(1);
  });
});
