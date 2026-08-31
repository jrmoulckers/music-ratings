import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';

import { ContainmentGraph } from '../domain/graph';
import type { Entity, EntityId, Membership } from '../domain/types';

/**
 * The record shown whole.
 *
 * The bug these pin: an album whose tracks arrived two at a time through
 * listening rendered as those two tracks, next to metadata claiming thirteen.
 * Worse, walking through it in album mode would have skipped the other eleven.
 */

const expand = vi.fn();
const upserted: Entity[][] = [];
const linked: Membership[][] = [];
const session = writable({ connected: true });

vi.mock('../spotify/library', () => ({ expandEntity: (...a: unknown[]) => expand(...a) }));
vi.mock('../spotify/client', () => ({ SpotifyClient: class {} }));
vi.mock('../spotify/session', () => ({
  spotifyConfig: () => ({ clientId: 'x', redirectUri: 'y', scopes: [] }),
  get spotifySession() {
    return session;
  },
}));
vi.mock('../storage/repo', () => ({
  upsertEntities: async (e: Entity[]) => void upserted.push(e),
  saveMemberships: async (m: Membership[]) => void linked.push(m),
}));
vi.mock('./state', () => ({ refreshWorld: async () => {} }));

const { ensureRelease, knownTrackCount, releaseLooksComplete, resetReleaseCache, retryRelease } =
  await import('./release');

const ALBUM = 'album:spotify:jlp' as EntityId;

const PROVENANCE = { provider: 'spotify', via: 'test', fetchedAt: 0 } as const;

function track(n: number, disc = 1): Entity {
  return {
    id: `track:spotify:t${disc}-${n}` as EntityId,
    type: 'track',
    provider: 'spotify',
    providerId: `t${disc}-${n}`,
    name: `Track ${n}`,
    trackNumber: n,
    discNumber: disc,
    createdAt: 0,
    updatedAt: 0,
    provenance: PROVENANCE,
  };
}

function member(child: Entity, position: number): Membership {
  return {
    id: `${ALBUM}->${child.id}`,
    parentId: ALBUM,
    childId: child.id,
    parentType: 'album',
    childType: 'track',
    share: 1,
    position,
    updatedAt: 0,
  };
}

function album(total: number | undefined = 13): Entity {
  return {
    id: ALBUM,
    type: 'album',
    provider: 'spotify',
    providerId: 'jlp',
    name: 'Jagged Little Pill',
    ...(total === undefined ? {} : { totalChildren: total }),
    createdAt: 0,
    updatedAt: 0,
    provenance: PROVENANCE,
  };
}

/** Exactly the reported state: thirteen tracks claimed, tracks 2 and 5 stored. */
function partialWorld() {
  const stored = [track(2), track(5)];
  return new ContainmentGraph(
    [album(), ...stored],
    stored.map((t) => member(t, 1000 + (t.trackNumber ?? 0))),
  );
}

function fullTracks(count = 13) {
  const tracks = Array.from({ length: count }, (_, i) => track(i + 1));
  return {
    entities: [album(), ...tracks],
    memberships: tracks.map((t) => member(t, 1000 + (t.trackNumber ?? 0))),
  };
}

beforeEach(() => {
  resetReleaseCache();
  expand.mockReset();
  upserted.length = 0;
  linked.length = 0;
  session.set({ connected: true });
});

describe('knowing whether a release is whole', () => {
  it('trusts Spotify total against what is stored', () => {
    expect(releaseLooksComplete(album(13), 2)).toBe(false);
    expect(releaseLooksComplete(album(13), 13)).toBe(true);
    expect(releaseLooksComplete(album(13), 14)).toBe(true);
  });

  it('treats a release with no stated total as unproven', () => {
    expect(releaseLooksComplete(album(undefined), 9)).toBe(false);
  });

  it('counts only track children', () => {
    expect(knownTrackCount(partialWorld(), album())).toBe(2);
  });
});

describe('filling in a release', () => {
  it('turns the two known tracks into all thirteen', async () => {
    expand.mockResolvedValue(fullTracks());
    const result = await ensureRelease(album(), partialWorld());

    expect(expand).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('complete');
    expect(result.known).toBe(13);
    expect(upserted[0]).toHaveLength(14);
    expect(linked[0]).toHaveLength(13);
  });

  it('keeps disc and track order across a multi-disc set', async () => {
    const discs = [track(1, 1), track(2, 1), track(1, 2), track(2, 2)];
    expand.mockResolvedValue({
      entities: [album(4), ...discs],
      memberships: discs.map((t) => member(t, (t.discNumber ?? 1) * 1000 + (t.trackNumber ?? 0))),
    });
    await ensureRelease(album(4), new ContainmentGraph([album(4)], []));

    const graph = new ContainmentGraph([album(4), ...discs], linked[0] as unknown as Membership[]);
    expect(graph.children(ALBUM).map((e) => e.childId)).toEqual([
      'track:spotify:t1-1',
      'track:spotify:t1-2',
      'track:spotify:t2-1',
      'track:spotify:t2-2',
    ]);
  });

  it('handles a release longer than one Spotify page', async () => {
    expand.mockResolvedValue(fullTracks(80));
    const result = await ensureRelease(album(80), new ContainmentGraph([album(80)], []));
    expect(result.known).toBe(80);
  });

  it('does not ask again once a release is proven whole', async () => {
    expand.mockResolvedValue(fullTracks());
    await ensureRelease(album(), partialWorld());
    await ensureRelease(album(), partialWorld());
    expect(expand).toHaveBeenCalledTimes(1);
  });

  it('never asks about a release already stored in full', async () => {
    const tracks = Array.from({ length: 13 }, (_, i) => track(i + 1));
    const whole = new ContainmentGraph(
      [album(), ...tracks],
      tracks.map((t) => member(t, 1000 + (t.trackNumber ?? 0))),
    );
    const result = await ensureRelease(album(), whole);
    expect(expand).not.toHaveBeenCalled();
    expect(result.status).toBe('complete');
  });

  it('asks once when two surfaces open the same release together', async () => {
    expand.mockResolvedValue(fullTracks());
    const world = partialWorld();
    const [a, b] = await Promise.all([
      ensureRelease(album(), world),
      ensureRelease(album(), world),
    ]);
    expect(expand).toHaveBeenCalledTimes(1);
    expect(a.status).toBe('complete');
    expect(b.status).toBe('complete');
  });
});

describe('when the rest cannot be fetched', () => {
  it('keeps the known tracks and says the list is short', async () => {
    expand.mockRejectedValue(new Error('Spotify is rate limiting requests.'));
    const result = await ensureRelease(album(), partialWorld());

    expect(result.status).toBe('incomplete');
    expect(result.known).toBe(2);
    expect(result.total).toBe(13);
    if (result.status === 'incomplete') expect(result.reason).toMatch(/rate limiting/);
    expect(upserted).toHaveLength(0);
  });

  it('says so plainly when Spotify is not connected', async () => {
    session.set({ connected: false });
    const result = await ensureRelease(album(), partialWorld());
    expect(result.status).toBe('incomplete');
    expect(expand).not.toHaveBeenCalled();
  });

  it('tries again on request rather than remembering the failure', async () => {
    expand.mockRejectedValueOnce(new Error('offline'));
    await ensureRelease(album(), partialWorld());
    expand.mockResolvedValueOnce(fullTracks());

    const second = await retryRelease(album(), partialWorld());
    expect(expand).toHaveBeenCalledTimes(2);
    expect(second.status).toBe('complete');
    expect(second.known).toBe(13);
  });

  it('leaves anything that is not a release alone', async () => {
    const artist = { ...album(), id: 'artist:spotify:a1' as EntityId, type: 'artist' } as Entity;
    const result = await ensureRelease(artist, new ContainmentGraph([artist], []));
    expect(expand).not.toHaveBeenCalled();
    expect(result.status).toBe('complete');
  });
});
