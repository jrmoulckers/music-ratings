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
