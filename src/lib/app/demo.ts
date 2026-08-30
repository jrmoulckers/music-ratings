import { buildDemoWorld, demoSignals } from '../demo/seed';
import { db } from '../storage/db';
import { markDataChanged } from '../storage/changes';
import { clearSignals, writeSignals } from '../spotify/library';
import { updateSettings } from './state';

/**
 * Installing and removing the demonstration ledger.
 *
 * The demo is real data in the real database — the same code paths, the same
 * scores, the same sync file. Nothing about it is a special case, which is the
 * only way a demo can honestly stand in for the product.
 */

const DEMO_STORES = ['entities', 'memberships', 'ratings', 'comparisons'] as const;

export async function installDemo(now = Date.now()): Promise<void> {
  const world = buildDemoWorld(now);
  const database = await db();
  const tx = database.transaction([...DEMO_STORES], 'readwrite');
  const writes: Promise<unknown>[] = [];
  for (const entity of world.entities) writes.push(tx.objectStore('entities').put(entity));
  for (const link of world.memberships) writes.push(tx.objectStore('memberships').put(link));
  for (const rating of world.ratings) writes.push(tx.objectStore('ratings').put(rating));
  for (const c of world.comparisons) writes.push(tx.objectStore('comparisons').put(c));
  await Promise.all([...writes, tx.done]);

  await writeSignals(demoSignals(world, now));
  await updateSettings({ demoMode: true });
  markDataChanged();
}

/**
 * Removes only what the seed put there. Anything the user rated on top of the
 * demo is their own judgement and is kept — including ratings of demo items,
 * which simply become ratings of items that are no longer present.
 */
export async function removeDemo(): Promise<void> {
  const database = await db();
  const entities = await database.getAll('entities');
  const demoIds = new Set(
    entities.filter((entity) => entity.provider === 'demo').map((entity) => entity.id),
  );
  if (demoIds.size === 0) {
    await updateSettings({ demoMode: false });
    return;
  }

  const memberships = await database.getAll('memberships');
  const comparisons = await database.getAll('comparisons');

  const tx = database.transaction(['entities', 'memberships', 'comparisons'], 'readwrite');
  const writes: Promise<unknown>[] = [];
  for (const id of demoIds) writes.push(tx.objectStore('entities').delete(id));
  for (const link of memberships) {
    if (demoIds.has(link.parentId) || demoIds.has(link.childId)) {
      writes.push(tx.objectStore('memberships').delete(link.id));
    }
  }
  for (const c of comparisons) {
    if (demoIds.has(c.aId) || demoIds.has(c.bId)) {
      writes.push(tx.objectStore('comparisons').delete(c.id));
    }
  }
  await Promise.all([...writes, tx.done]);

  await clearSignals();
  await updateSettings({ demoMode: false });
  markDataChanged();
}
