import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';

import AlbumComplete from '../components/AlbumComplete.svelte';
import EntityListening from '../components/EntityListening.svelte';
import { settings, world } from '../lib/app/state';
import { clearStore, readMeta } from '../lib/storage/db';
import { countPlays, listCompletions, listPlays, loadWorld } from '../lib/storage/repo';
import { clearDemoListening, seedDemoListening } from '../lib/listening/demo';
import { META_LISTENING_COVERAGE } from '../lib/listening/ingest';
import {
  albumTrackSet,
  evaluateAlbumCompletion,
  completionWindowMs,
} from '../lib/domain/completion';
import { ContainmentGraph } from '../lib/domain/graph';
import type { ListeningCoverage } from '../lib/domain/listening';
import type { AppSettings } from '../lib/storage/settings';
import { makeAlbum, MINUTE, play, T0 } from './fixtures';

/**
 * The seeded history exists so the surface can be judged without waiting weeks
 * for a real account to fill. That only holds if it behaves like a history and
 * not like a pile: seeding twice must leave one history, and it must write the
 * same provenance a real ingest would, or the preview would quietly be more
 * confident than the product.
 */

beforeEach(async () => {
  await clearStore('plays');
  await clearStore('completions');
  await clearStore('entities');
  await clearStore('memberships');
  await clearStore('meta');
});

describe('the seeded demonstration history', () => {
  it('finishes at least one record, so the completion moment can be seen at all', async () => {
    const seeded = await seedDemoListening(T0);
    expect(seeded.plays).toBeGreaterThan(0);
    expect(seeded.completions.length).toBeGreaterThan(0);

    // The point of the exercise: one of them closed moments ago.
    const newest = [...seeded.completions].sort((a, b) => b.endAt - a.endAt)[0]!;
    expect(T0 - newest.endAt).toBeLessThan(60 * 60 * 1000);
    expect(newest.prompt).toBe('open');
  });

  it('replaces itself rather than layering a second history on top', async () => {
    await seedDemoListening(T0);
    const first = { plays: await countPlays(), completions: (await listCompletions()).length };

    // A different `now` shifts every timestamp, so the deterministic play ids
    // change too. Identity alone cannot deduplicate this; the clear must.
    await seedDemoListening(T0 + 90_000);
    await seedDemoListening(T0 + 175_000);
    const after = { plays: await countPlays(), completions: (await listCompletions()).length };

    expect(after).toEqual(first);
  });

  it('records where the observation starts, as a real ingest would', async () => {
    const seeded = await seedDemoListening(T0);
    const plays = await listPlays();
    const oldest = Math.min(...plays.map((play) => play.at));

    const coverage = await readMeta<ListeningCoverage>(META_LISTENING_COVERAGE);
    expect(coverage?.firstFetchAt).toBe(oldest);
    expect(coverage?.newestSeenAt).toBe(Math.max(...plays.map((play) => play.at)));

    const settings = await readMeta<AppSettings>('settings');
    expect(settings?.listeningObservedFrom).toBe(oldest);
    expect(seeded.observedSince).toBe(oldest);
  });

  it('can be taken away again without touching anything else', async () => {
    await seedDemoListening(T0);
    const removed = await clearDemoListening();

    expect(removed.plays).toBeGreaterThan(0);
    expect(await countPlays()).toBe(0);
    expect(await listCompletions()).toHaveLength(0);
  });

  it.each([false, true])(
    'labels seeded completion evidence as demo data, including quiet history (%s)',
    async (quiet) => {
      await seedDemoListening(T0);
      const loaded = await loadWorld();
      const completion = [...loaded.completions].sort((a, b) => b.endAt - a.endAt)[0]!;
      const previous = get(world);
      const host = document.createElement('div');
      world.set(loaded);
      const app = mount(AlbumComplete, { target: host, props: { completion, quiet } });
      try {
        flushSync();
        expect(host.textContent).toContain('Departures');
        expect(host.textContent).toContain('Demo listening data, not Spotify-confirmed');
        expect(host.textContent).not.toContain('Confirmed from Spotify recently played');
      } finally {
        await unmount(app);
        world.set(previous);
      }
    },
  );

  it.each(['album', 'artist'] as const)(
    'keeps seeded %s listening evidence and completion history truthful',
    async (type) => {
      await seedDemoListening(T0);
      const loaded = await loadWorld();
      const entity = loaded.entities.find((item) => item.type === type)!;
      const previousWorld = get(world);
      const previousSettings = get(settings);
      const host = document.createElement('div');
      world.set(loaded);
      settings.set({ ...previousSettings, listeningEnabled: true });
      const app = mount(EntityListening, { target: host, props: { entity } });
      try {
        flushSync();
        expect(host.textContent).toContain('Demo listening data, not Spotify-confirmed');
        expect(host.textContent).not.toContain('Confirmed from Spotify recently played');
        expect(host.textContent).not.toContain('Based on listening observed by this app');
      } finally {
        await unmount(app);
        world.set(previousWorld);
        settings.set(previousSettings);
      }
    },
  );

  it('preserves Spotify confirmation language for non-demo listening and completion evidence', async () => {
    const fixture = makeAlbum('confirmed', 2);
    const plays = fixture.tracks.map((track, index) => play(track, T0 + index * MINUTE));
    const completion = evaluateAlbumCompletion({
      tracks: albumTrackSet(
        new ContainmentGraph(fixture.entities, fixture.memberships),
        fixture.album.id,
      ),
      plays,
      newPlayIds: new Set(plays.map((item) => item.id)),
      existing: [],
      windowMs: completionWindowMs(30),
      recompletion: 'fresh',
      now: T0 + 2 * MINUTE,
    }).completion!;
    const previousWorld = get(world);
    const previousSettings = get(settings);
    const host = document.createElement('div');
    world.set({
      ...previousWorld,
      entities: fixture.entities,
      memberships: fixture.memberships,
      plays,
      completions: [completion],
    });
    settings.set({ ...previousSettings, listeningEnabled: true });
    const completionApp = mount(AlbumComplete, { target: host, props: { completion } });
    const listeningApp = mount(EntityListening, { target: host, props: { entity: fixture.album } });
    try {
      flushSync();
      expect(host.querySelector('.done__source')?.textContent).toContain(
        'Confirmed from Spotify recently played',
      );
      expect(host.querySelector('.listened__source')?.textContent).toContain(
        'Confirmed from Spotify recently played. Based on listening observed by this app.',
      );
      expect(host.textContent).not.toContain('Demo listening data');
    } finally {
      await unmount(completionApp);
      await unmount(listeningApp);
      world.set(previousWorld);
      settings.set(previousSettings);
    }
  });
});
