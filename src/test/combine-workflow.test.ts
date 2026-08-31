import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import CombinePanel from '../components/CombinePanel.svelte';
import { world } from '../lib/app/state';
import { DB_NAME, closeDatabase, putRecords } from '../lib/storage/db';
import { listCanonicalGroups, listRatings, upsertEntities } from '../lib/storage/repo';
import type { CanonicalGroup, Entity, RatingEvent } from '../lib/domain/types';
import { makeEntity, rate, resetFixtureCounters, T0 } from './fixtures';

/**
 * Combining duplicates, as the reader meets it.
 *
 * What is worth proving in the DOM rather than only in the domain: the
 * workflow is discoverable but closed by default; a candidate is offered with
 * its evidence and its verdict rather than as a bare row; the exact rating
 * consequence is shown *before* the confirm; and the confirm is the only thing
 * that writes.
 */

const original: Entity = makeEntity('album', 'original', {
  name: 'Kid A',
  subtitle: 'Radiohead',
  releaseDate: '2000-10-02',
  externalUrl: 'https://open.spotify.com/album/original',
});
const remaster: Entity = makeEntity('album', 'remaster', {
  name: 'Kid A (2016 Remaster)',
  subtitle: 'Radiohead',
  releaseDate: '2016-05-01',
  externalUrl: 'https://open.spotify.com/album/remaster',
});
const live: Entity = makeEntity('album', 'live', {
  name: 'Kid A (Live in Oslo)',
  subtitle: 'Radiohead',
});
const song: Entity = makeEntity('track', 'song', { name: 'Kid A', subtitle: 'Radiohead' });

/**
 * The world the panel reads, and the store it will write into.
 *
 * Both, because that is the arrangement in the app: the preview is computed
 * from what the screen already holds, and the write re-plans from the store so
 * the sentence the reader confirmed is about the data being changed.
 */
async function seed(
  ratings: RatingEvent[] = [],
  groups: CanonicalGroup[] = [],
  entities: Entity[] = [original, remaster, live, song],
): Promise<void> {
  world.set({
    entities,
    memberships: [],
    ratings,
    comparisons: [],
    queueStates: [],
    annotations: [],
    collections: [],
    scales: [],
    canonicalGroups: groups,
  });
  await upsertEntities(entities);
  await putRecords('ratings', ratings);
  await putRecords('canonicalGroups', groups);
}

async function wipe(): Promise<void> {
  await closeDatabase();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

let host: HTMLDivElement | null = null;
let app: any = null;

beforeEach(async () => {
  resetFixtureCounters();
  await wipe();
});

afterEach(async () => {
  if (app) void unmount(app, { outro: false });
  host?.remove();
  app = null;
  host = null;
  world.set({
    entities: [],
    memberships: [],
    ratings: [],
    comparisons: [],
    queueStates: [],
    annotations: [],
    collections: [],
    scales: [],
    canonicalGroups: [],
  });
  await closeDatabase();
});

function render(entity: Entity): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  app = mount(CombinePanel as any, { target: host, props: { entity } });
  flushSync();
  return host;
}

function buttons(): HTMLButtonElement[] {
  return [...(host?.querySelectorAll('button') ?? [])] as HTMLButtonElement[];
}

function button(text: RegExp): HTMLButtonElement {
  const found = buttons().find((b) => text.test(b.textContent ?? ''));
  if (!found) {
    throw new Error(
      `no button matching ${text} — saw ${buttons()
        .map((b) => `"${(b.textContent ?? '').trim()}"`)
        .join(', ')}`,
    );
  }
  return found;
}

function press(text: RegExp): void {
  button(text).click();
  flushSync();
}

function text(): string {
  return host?.textContent ?? '';
}

describe('the combine workflow', async () => {
  it('stays out of the way until it is asked for', async () => {
    await seed();
    render(original);
    expect(button(/Combine with a duplicate/i).getAttribute('aria-expanded')).toBe('false');
    expect(text()).not.toMatch(/2016 Remaster/);
  });

  it('offers same-title copies with their evidence and their verdict', async () => {
    await seed();
    render(original);
    press(/Combine with a duplicate/i);

    expect(text()).toMatch(/Kid A \(2016 Remaster\)/);
    expect(text()).toMatch(/Reissue or remaster/i);
    // The live record is offered, but named for what it is rather than
    // recommended: whether it is the same record is the listener's call.
    expect(text()).toMatch(/A different version/i);
    expect(text()).toMatch(/Released in 2000 and 2016/);
    // A track can never be the same record as an album, so it is never offered.
    expect(text()).not.toMatch(/track/i);
  });

  it('separates repeated Spotify identity from distinct Let It Bleed editions', async () => {
    const first = makeEntity('album', 'stones-a', {
      id: 'album:spotify:stones-a',
      provider: 'spotify',
      providerId: 'stones-a',
      name: 'Let It Bleed',
      subtitle: 'The Rolling Stones',
      releaseDate: '1969-12-05',
      totalChildren: 9,
      externalUrl: 'https://open.spotify.com/album/stones-a',
    });
    const repeatedSearchRow = {
      ...first,
      id: 'album:spotify:search-copy',
    };
    const anniversary = makeEntity('album', 'stones-b', {
      id: 'album:spotify:stones-b',
      provider: 'spotify',
      providerId: 'stones-b',
      name: 'Let It Bleed (50th Anniversary Edition)',
      subtitle: 'The Rolling Stones',
      releaseDate: '2019-11-01',
      totalChildren: 41,
      externalUrl: 'https://open.spotify.com/album/stones-b',
    });
    await seed([], [], [first, repeatedSearchRow, anniversary]);
    render(first);
    press(/Combine with a duplicate/i);

    expect(text().match(/50th Anniversary Edition/g)).toHaveLength(1);
    expect(text()).not.toMatch(/search-copy/);
    buttons()
      .find((candidate) => /50th Anniversary Edition/.test(candidate.textContent ?? ''))
      ?.click();
    flushSync();
    press(/Preview combining 2 items/i);

    expect(text()).toMatch(
      /Release · The Rolling Stones · 1969-12-05 · 9 tracks · Spotify ID stones-a/,
    );
    expect(text()).toMatch(
      /Release · The Rolling Stones · 2019-11-01 · 41 tracks · Spotify ID stones-b/,
    );
    const editionLinks = [
      ...(host?.querySelectorAll('a[data-external]') ?? []),
    ] as HTMLAnchorElement[];
    expect(editionLinks.map((link) => link.href)).toEqual([
      'https://open.spotify.com/album/stones-a',
      'https://open.spotify.com/album/stones-b',
    ]);
  });

  it('explains what combining does before anything is chosen', async () => {
    await seed();
    render(original);
    press(/Combine with a duplicate/i);
    expect(text()).toMatch(/Nothing is deleted/i);
    expect(text()).toMatch(/averaged into one new entry/i);
    expect(text()).toMatch(/It can be undone/i);
  });

  it('will not move on until something is chosen', async () => {
    await seed();
    render(original);
    press(/Combine with a duplicate/i);
    expect(button(/Preview combining/i).disabled).toBe(true);
  });

  it('keeps an in-progress choice across a world refresh of the same entity', async () => {
    await seed();
    render(original);
    press(/Combine with a duplicate/i);
    buttons()
      .find((candidate) => /2016 Remaster/.test(candidate.textContent ?? ''))
      ?.click();
    flushSync();

    world.update((current) => ({
      ...current,
      entities: current.entities.map((entity) => ({ ...entity })),
    }));
    flushSync();

    expect(button(/Preview combining 2 items/i).disabled).toBe(false);
    expect(text()).toMatch(/Kid A \(2016 Remaster\)/);
  });

  it('states the exact rating consequence, and writes nothing until confirmed', async () => {
    await seed([rate(original, 70, { at: T0 }), rate(remaster, 90, { at: T0 + 1 })]);
    render(original);
    press(/Combine with a duplicate/i);

    const pick = buttons().find((b) => /2016 Remaster/.test(b.textContent ?? ''));
    pick?.click();
    flushSync();
    expect(pick?.getAttribute('aria-pressed')).toBe('true');

    press(/Preview combining 2 items/i);
    expect(text()).toMatch(/Which one represents them/i);
    // 70 and 90 average to 80, which on the ten-point scale reads as 8.
    expect(text()).toMatch(/the average of 7 and 9/i);
    expect(text()).toMatch(/recorded as 8/);
    expect(text()).toMatch(/stays in your history/i);

    // Still nothing written.
    expect(await listCanonicalGroups()).toHaveLength(0);

    press(/^\s*Combine 2 items/i);
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const groups = await listCanonicalGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.memberIds.sort()).toEqual([original.id, remaster.id].sort());
    expect(groups[0]!.primaryId).toBe(original.id);
    const written = await listRatings();
    // The two originals are untouched; the average is a third entry beside them.
    expect(written).toHaveLength(3);
    const averaged = written.find((event) => event.origin?.kind === 'combine-average');
    expect(averaged?.normalized).toBe(80);
    expect(averaged?.value).toBe(8);
    expect(averaged?.entityId).toBe(original.id);
    expect(written.filter((event) => event.retracted)).toHaveLength(0);
  });

  it('lets another source be made primary in the preview', async () => {
    await seed();
    render(original);
    press(/Combine with a duplicate/i);
    buttons()
      .find((b) => /2016 Remaster/.test(b.textContent ?? ''))
      ?.click();
    flushSync();
    press(/Preview combining 2 items/i);

    const radios = [...(host?.querySelectorAll('input[type="radio"]') ?? [])] as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    // The item this was started from is chosen by default.
    expect(radios.find((r) => r.checked)?.value).toBe(original.id);
    const other = radios.find((r) => r.value === remaster.id)!;
    other.checked = true;
    other.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(text()).toMatch(/Combine 2 items/);
  });

  it('says nothing about a rating when nothing is rated', async () => {
    await seed();
    render(original);
    press(/Combine with a duplicate/i);
    buttons()
      .find((b) => /2016 Remaster/.test(b.textContent ?? ''))
      ?.click();
    flushSync();
    press(/Preview combining 2 items/i);
    expect(text()).toMatch(/None of these is rated, so no rating is written/i);
  });

  it('shows every source of a combined record, each with its own Spotify link', async () => {
    await seed(
      [],
      [
        {
          id: 'grp-1',
          entityType: 'album',
          primaryId: original.id,
          memberIds: [original.id, remaster.id],
          createdAt: T0,
          updatedAt: T0,
        },
      ],
    );
    render(original);

    expect(text()).toMatch(/Combined from 2 sources/i);
    const links = [...(host?.querySelectorAll('a[data-external]') ?? [])] as HTMLAnchorElement[];
    expect(links.map((a) => a.href)).toEqual([
      'https://open.spotify.com/album/original',
      'https://open.spotify.com/album/remaster',
    ]);
    expect(text()).toMatch(/Represents this record/i);
    expect(button(/Make primary/i)).toBeTruthy();
    // The candidate list excludes what is already in the group.
    press(/Add another source/i);
    expect(text()).toMatch(/Live in Oslo/);
  });

  it('asks before separating, and says what separating does', async () => {
    await seed(
      [],
      [
        {
          id: 'grp-1',
          entityType: 'album',
          primaryId: original.id,
          memberIds: [original.id, remaster.id],
          createdAt: T0,
          updatedAt: T0,
        },
      ],
    );
    render(original);
    press(/Separate them again/i);
    expect(text()).toMatch(/goes back to answering for itself/i);
    expect(button(/Separate 2 items/i)).toBeTruthy();
    press(/Keep them combined/i);
    expect(text()).not.toMatch(/Separate 2 items/);
  });
});
