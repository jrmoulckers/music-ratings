import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CategoryRatings from '../components/CategoryRatings.svelte';
import { annotationsById, explicitRatings, loadAll, refreshWorld, scores } from '../lib/app/state';
import { buildCanonicalIndex, resolveAnnotations } from '../lib/domain/canonical';
import { categoryKey, categoryStandings } from '../lib/domain/categories';
import { BUILTIN_SCALES } from '../lib/domain/scales';
import { db, SYNCED_STORES } from '../lib/storage/db';
import {
  combineEntities,
  listAnnotations,
  listRatings,
  recordCategoryRating,
  recordRating,
  upsertEntities,
} from '../lib/storage/repo';
import {
  buildSnapshot,
  emptySnapshot,
  parseSnapshot,
  serializeSnapshot,
} from '../lib/storage/snapshot';
import { mergeSnapshots } from '../lib/storage/sync';
import { makeEntity } from './fixtures';

const track = makeEntity('track', 'verification-track');
let component: ReturnType<typeof mount> | undefined;
let host: HTMLDivElement | undefined;

beforeEach(async () => {
  const database = await db();
  const tx = database.transaction([...SYNCED_STORES, 'meta'], 'readwrite');
  await Promise.all([...SYNCED_STORES.map((store) => tx.objectStore(store).clear()), tx.done]);
  await upsertEntities([track]);
  await loadAll();
});
afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  host?.remove();
  host = undefined;
});

describe('independent category ratings', () => {
  it('saves drums at 95/100 without creating or changing an overall song rating', async () => {
    await recordCategoryRating(track.id, 'Drums', 95);
    await refreshWorld();
    expect(get(explicitRatings).get(track.id)).toBeUndefined();
    expect(get(scores).get(track.id)?.blended).toBeNull();
    expect(await listRatings()).toEqual([]);
    expect(get(annotationsById).get(track.id)?.categoryRatings?.[0]).toMatchObject({
      category: 'Drums',
      normalized: 95,
    });
    await recordRating({
      entityId: track.id,
      entityType: 'track',
      normalized: 70,
      value: 70,
      scaleId: 'int-100',
    });
    await recordCategoryRating(track.id, 'Vocals', 85);
    await refreshWorld();
    expect(get(explicitRatings).get(track.id)?.normalized).toBe(70);
    expect(get(scores).get(track.id)?.blended).toBe(70);
  });

  it('retains history, treats category names case-insensitively, and preserves withdrawal', async () => {
    await recordCategoryRating(track.id, '  Drums  ', 95);
    await recordCategoryRating(track.id, 'drums', 90);
    await recordCategoryRating(track.id, 'DRUMS', null);
    const history = (await listAnnotations())[0]!.categoryRatings!;
    expect(history).toHaveLength(3);
    expect(categoryStandings(history)).toHaveLength(1);
    expect(categoryStandings(history)[0]?.normalized).toBeNull();
    expect(categoryKey('  Backing   Vocals ')).toBe('backing vocals');
  });

  it.each([-1, 101, 95.5, NaN, Infinity])('rejects invalid category scores (%s)', async (value) => {
    await expect(recordCategoryRating(track.id, 'Drums', value)).rejects.toThrow('0 to 100');
    expect(await listAnnotations()).toEqual([]);
  });

  it('rejects unnamed and oversized categories', async () => {
    await expect(recordCategoryRating(track.id, ' ', 95)).rejects.toThrow('name');
    await expect(recordCategoryRating(track.id, 'a'.repeat(81), 95)).rejects.toThrow('name');
  });

  it('keeps category events through backup export/import', async () => {
    await recordCategoryRating(track.id, 'Drums', 95);
    const exported = await buildSnapshot();
    const restored = parseSnapshot(serializeSnapshot(exported));
    expect(restored.annotations[0]?.categoryRatings).toEqual(
      exported.annotations[0]?.categoryRatings,
    );
  });

  it('merges independent category events on the same song from two devices without losing either', () => {
    const local = emptySnapshot('local');
    const remote = emptySnapshot('remote');
    const drums = { id: 'a', category: 'Drums', normalized: 95, at: 1 };
    const vocals = { id: 'b', category: 'Vocals', normalized: 80, at: 2 };
    local.annotations = [{ id: track.id, tags: [], categoryRatings: [drums], updatedAt: 1 }];
    remote.annotations = [{ id: track.id, tags: ['tag'], categoryRatings: [vocals], updatedAt: 2 }];
    const forward = mergeSnapshots(local, remote);
    const backward = mergeSnapshots(remote, local);
    expect(forward.snapshot.annotations).toEqual(backward.snapshot.annotations);
    expect(forward.snapshot.annotations[0]?.categoryRatings).toEqual([drums, vocals]);
    expect(forward.changedLocally).toBe(true);
    expect(forward.changedRemotely).toBe(true);
    const settled = mergeSnapshots(forward.snapshot, backward.snapshot);
    expect(settled.changedLocally).toBe(false);
    expect(settled.changedRemotely).toBe(false);
  });

  it('does not resurrect a category from a tombstoned annotation during sync', () => {
    const local = emptySnapshot('local');
    const remote = emptySnapshot('remote');
    local.annotations = [
      {
        id: track.id,
        tags: [],
        categoryRatings: [{ id: 'a', category: 'Drums', normalized: 95, at: 1 }],
        updatedAt: 1,
      },
    ];
    remote.annotations = [{ id: track.id, tags: [], updatedAt: 2, deleted: 2 }];
    expect(mergeSnapshots(local, remote).snapshot.annotations[0]?.categoryRatings).toBeUndefined();
  });

  it('merges categories on combined copies and records newer judgements on the primary', async () => {
    const other = makeEntity('track', 'other');
    await upsertEntities([other]);
    await recordCategoryRating(track.id, 'Drums', 95);
    await recordCategoryRating(other.id, 'Vocals', 80);
    await combineEntities({
      entityIds: [track.id, other.id],
      primaryId: track.id,
      scale: BUILTIN_SCALES.find((scale) => scale.id === 'int-100')!,
    });
    await recordCategoryRating(other.id, 'Vocals', 85);
    const snapshot = await buildSnapshot();
    const canonical = buildCanonicalIndex(snapshot.canonicalGroups);
    const resolved = resolveAnnotations(snapshot.annotations, canonical);
    expect(
      categoryStandings(resolved.get(track.id)!.categoryRatings!).map((entry) => entry.normalized),
    ).toEqual([95, 85]);
  });

  it('allows zero and one hundred, without conflating zero with an empty score', async () => {
    await recordCategoryRating(track.id, 'Drums', 0);
    await recordCategoryRating(track.id, 'Vocals', 100);
    const rows = categoryStandings((await listAnnotations())[0]!.categoryRatings!);
    expect(rows.map((row) => row.normalized)).toEqual([0, 100]);
  });

  it('supports saving a custom category directly from an unrated entity page', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(CategoryRatings, { target: host, props: { entity: track } });
    flushSync();
    const category = host.querySelector<HTMLInputElement>('input[list]')!;
    const score = host.querySelector<HTMLInputElement>('input[type=number]')!;
    category.value = 'Drums';
    category.dispatchEvent(new Event('input', { bubbles: true }));
    score.value = '95';
    score.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(host?.querySelector('[role=status]')?.textContent).toContain('95/100'),
    );
    await refreshWorld();
    flushSync();
    expect(host.textContent).toContain('Drums');
    expect(await listRatings()).toEqual([]);
    expect(host.querySelectorAll('.category-list li')).toHaveLength(1);
  });
});
