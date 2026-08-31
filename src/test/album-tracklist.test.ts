import { flushSync, mount, unmount } from 'svelte';
import { get, writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Entity, EntityId, Membership } from '../lib/domain/types';
import type { PlaybackState } from '../lib/playback/types';

/**
 * A record, listed whole.
 *
 * The reported bug: Jagged Little Pill said thirteen tracks and showed two —
 * the two that happened to have been played. These mount the surface that walks
 * through a record and prove it lists everything the release contains, in disc
 * and track order, with a rating control on every row.
 */

const playback = writable<PlaybackState>({
  source: 'demo',
  status: 'idle',
  snapshot: null,
  devices: [],
  queue: [],
  pending: null,
  error: null,
  fetchedAt: Date.now(),
  watching: true,
});

vi.mock('../lib/playback/store', () => ({
  get playback() {
    return playback;
  },
  playbackPlay: async () => undefined,
  playbackSeek: () => undefined,
}));

const AlbumMode = (await import('../components/AlbumMode.svelte')).default;
const { albumSession, startAlbumSession, clearAlbumSession } =
  await import('../lib/playback/album');
const { world } = await import('../lib/app/state');

const ALBUM = 'album:spotify:jlp' as EntityId;

const PROVENANCE = { provider: 'spotify', via: 'test', fetchedAt: 0 } as const;

function track(n: number, disc = 1): Entity {
  return {
    id: `track:spotify:d${disc}n${n}` as EntityId,
    type: 'track',
    provider: 'spotify',
    providerId: `d${disc}n${n}`,
    name: `Track ${disc}-${n}`,
    trackNumber: n,
    discNumber: disc,
    createdAt: 0,
    updatedAt: 0,
    provenance: PROVENANCE,
  };
}

function member(child: Entity): Membership {
  return {
    id: `${ALBUM}->${child.id}`,
    parentId: ALBUM,
    childId: child.id,
    parentType: 'album',
    childType: 'track',
    share: 1,
    position: (child.discNumber ?? 1) * 1000 + (child.trackNumber ?? 0),
    updatedAt: 0,
  };
}

function seed(tracks: Entity[]) {
  const album: Entity = {
    id: ALBUM,
    type: 'album',
    provider: 'spotify',
    providerId: 'jlp',
    name: 'Jagged Little Pill',
    totalChildren: 13,
    createdAt: 0,
    updatedAt: 0,
    provenance: PROVENANCE,
  };
  world.set({
    ...get(world),
    entities: [album, ...tracks],
    memberships: tracks.map(member),
  });
}

let host: HTMLElement | null = null;
let view: Record<string, unknown> | null = null;

function render() {
  host = document.createElement('div');
  document.body.append(host);
  view = mount(AlbumMode, { target: host }) as Record<string, unknown>;
  flushSync();
}

function rows(): HTMLElement[] {
  return [...(host?.querySelectorAll('li.slip') ?? [])] as HTMLElement[];
}

beforeEach(() => {
  startAlbumSession(ALBUM, 'spotify:album:jlp');
});

afterEach(() => {
  if (view) void unmount(view);
  host?.remove();
  view = null;
  host = null;
  clearAlbumSession();
});

describe('listening through a record', () => {
  it('never describes an unplayed earlier track as something you did', () => {
    seed(Array.from({ length: 8 }, (_, i) => track(i + 1)));
    render();

    const states = [...(host?.querySelectorAll('.album__state') ?? [])].map((s) =>
      (s.textContent ?? '').toLowerCase(),
    );
    expect(states.join(' ')).not.toMatch(/passed|skipped/);
  });

  it('gives every row a status a screen reader can hear, including later ones', () => {
    seed(Array.from({ length: 4 }, (_, i) => track(i + 1)));
    render();

    const spoken = [...(host?.querySelectorAll('.album__state .sr-only') ?? [])].map(
      (s) => s.textContent ?? '',
    );
    expect(spoken).toHaveLength(4);
    for (const text of spoken) expect(text.trim().length).toBeGreaterThan(0);
  });

  it('lists every track the release contains, not only the ones already heard', () => {
    seed(Array.from({ length: 13 }, (_, i) => track(i + 1)));
    render();

    expect(rows()).toHaveLength(13);
    expect(host?.textContent).toContain('Track 1-13');
  });

  it('keeps disc order rather than interleaving track numbers', () => {
    seed([track(1, 1), track(2, 1), track(1, 2), track(2, 2)]);
    render();

    const names = rows().map((li) => li.textContent?.match(/Track \d-\d/)?.[0]);
    expect(names).toEqual(['Track 1-1', 'Track 1-2', 'Track 2-1', 'Track 2-2']);
  });

  it('gives every track the standard rating control, once each', () => {
    seed(Array.from({ length: 13 }, (_, i) => track(i + 1)));
    render();

    const controls = host?.querySelectorAll('[data-rating-control]') ?? [];
    // The record's own rating sits above the list, so there is one more.
    expect(controls.length).toBe(14);
  });

  it('counts the record by what it contains, not by what has been played', () => {
    seed(Array.from({ length: 13 }, (_, i) => track(i + 1)));
    render();

    expect(host?.textContent).toContain('of 13 tracks rated');
  });

  it('says nothing is loaded rather than showing a short list as complete', () => {
    seed([]);
    render();
    expect(get(albumSession).albumId).toBe(ALBUM);
    expect(rows()).toHaveLength(0);
  });
});
