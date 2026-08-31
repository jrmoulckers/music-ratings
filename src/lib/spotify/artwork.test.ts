import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Entity, EntityId } from '../domain/types';
import { SpotifyApiError } from './client';
import {
  ARTWORK_MAX_PER_CALL,
  artistNeedsArtwork,
  fillArtistArtwork,
  resetArtistArtwork,
} from './artwork';

/**
 * The pictures Spotify does not send.
 *
 * Almost every artist is first met as a name on a track, so almost every artist
 * arrives without a picture, and only a second request per artist can fix that.
 * The batch endpoint is gone, so the governor is the whole design: ask only
 * about artists that need it, cap the burst, collapse duplicates, and remember
 * what has already been asked — while still being willing to try again after a
 * failure that says nothing about whether a picture exists.
 */

const PROVENANCE = { provider: 'spotify', via: 'test', fetchedAt: 0 } as const;

function artist(providerId: string, extra: Partial<Entity> = {}): Entity {
  return {
    id: `artist:spotify:${providerId}` as EntityId,
    type: 'artist',
    provider: 'spotify',
    providerId,
    name: `Artist ${providerId}`,
    createdAt: 0,
    updatedAt: 0,
    provenance: PROVENANCE,
    ...extra,
  };
}

interface Stub {
  artist: (id: string) => Promise<unknown>;
}

/** A client that answers with a picture, counting what it was asked. */
function client(
  answer: (id: string) => Promise<unknown> = async (id) => ({
    id,
    name: `Artist ${id}`,
    images: [{ url: `https://img/${id}`, width: 640, height: 640 }],
    genres: [],
    popularity: 1,
  }),
): { stub: Stub; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    stub: {
      artist: async (id: string) => {
        asked.push(id);
        return answer(id);
      },
    },
  };
}

const as = (stub: Stub) => stub as any;

beforeEach(() => {
  resetArtistArtwork();
});

describe('artistNeedsArtwork', () => {
  it('wants a Spotify artist with no picture', () => {
    expect(artistNeedsArtwork(artist('a'))).toBe(true);
  });

  it('leaves an artist that already has one alone', () => {
    expect(artistNeedsArtwork(artist('a', { artworkUrl: 'https://img/a' }))).toBe(false);
    expect(artistNeedsArtwork(artist('a', { artworkThumbUrl: 'https://img/a' }))).toBe(false);
  });

  it('ignores anything that is not a Spotify artist', () => {
    expect(artistNeedsArtwork(artist('a', { type: 'track' }))).toBe(false);
    expect(artistNeedsArtwork(artist('a', { provider: 'local' }))).toBe(false);
  });

  it('ignores a deleted artist', () => {
    expect(artistNeedsArtwork(artist('a', { deleted: 1 }))).toBe(false);
  });
});

describe('fillArtistArtwork', () => {
  it('asks only about the artists that lack a picture', async () => {
    const { stub, asked } = client();
    const result = await fillArtistArtwork(as(stub), [
      artist('a'),
      artist('b', { artworkUrl: 'https://img/b' }),
      artist('c', { provider: 'local' }),
    ]);
    expect(asked).toEqual(['a']);
    expect(result.filled.map((e) => e.id)).toEqual(['artist:spotify:a']);
  });

  it('asks once for an artist named on every track', async () => {
    const { stub, asked } = client();
    const sameArtist = Array.from({ length: 12 }, () => artist('a'));
    const result = await fillArtistArtwork(as(stub), sameArtist);
    expect(asked).toEqual(['a']);
    expect(result.filled).toHaveLength(1);
  });

  it('caps a single call so a long page cannot become a storm', async () => {
    const { stub, asked } = client();
    const many = Array.from({ length: 40 }, (_, i) => artist(`a${i}`));
    await fillArtistArtwork(as(stub), many);
    expect(asked).toHaveLength(ARTWORK_MAX_PER_CALL);
  });

  it('honours a caller’s own smaller ceiling', async () => {
    const { stub, asked } = client();
    await fillArtistArtwork(as(stub), [artist('a'), artist('b'), artist('c')], { max: 2 });
    expect(asked).toEqual(['a', 'b']);
  });

  it('asks for nothing at all when the ceiling is zero', async () => {
    const { stub, asked } = client();
    const result = await fillArtistArtwork(as(stub), [artist('a')], { max: 0 });
    expect(asked).toEqual([]);
    expect(result.filled).toEqual([]);
  });

  it('does not ask again about an artist Spotify has no picture for', async () => {
    const { stub, asked } = client(async (id) => ({ id, name: id, images: [], genres: [] }));
    const first = await fillArtistArtwork(as(stub), [artist('a')]);
    const second = await fillArtistArtwork(as(stub), [artist('a')]);
    expect(asked).toEqual(['a']);
    expect(first.missed).toBe(1);
    expect(second.missed).toBe(0);
  });

  it('does not ask again about one it has already filled', async () => {
    const { stub, asked } = client();
    await fillArtistArtwork(as(stub), [artist('a')]);
    await fillArtistArtwork(as(stub), [artist('a')]);
    expect(asked).toEqual(['a']);
  });

  it('keeps the artist and reports why when the request fails', async () => {
    const { stub } = client(async () => {
      throw new SpotifyApiError('artist gone', 404, 'not-found');
    });
    const result = await fillArtistArtwork(as(stub), [artist('a')]);
    expect(result.filled).toEqual([]);
    expect(result.missed).toBe(1);
    expect(result.problems[0]).toContain('a');
  });

  it('remembers a refusal, so it is asked once and never again', async () => {
    const { stub, asked } = client(async () => {
      throw new SpotifyApiError('forbidden', 403, 'forbidden');
    });
    await fillArtistArtwork(as(stub), [artist('a')]);
    await fillArtistArtwork(as(stub), [artist('a')]);
    expect(asked).toEqual(['a']);
  });

  it('forgets a rate limit, so a later pass can try again', async () => {
    let calls = 0;
    const { stub, asked } = client(async (id) => {
      calls += 1;
      if (calls === 1) throw new SpotifyApiError('slow down', 429, 'rate-limit');
      return { id, name: id, images: [{ url: `https://img/${id}`, width: 640, height: 640 }] };
    });
    const first = await fillArtistArtwork(as(stub), [artist('a')]);
    const second = await fillArtistArtwork(as(stub), [artist('a')]);
    expect(asked).toEqual(['a', 'a']);
    expect(first.filled).toEqual([]);
    expect(second.filled).toHaveLength(1);
  });

  it('forgets a server error too', async () => {
    let calls = 0;
    const { stub, asked } = client(async (id) => {
      calls += 1;
      if (calls === 1) throw new SpotifyApiError('upstream', 503, 'server');
      return { id, name: id, images: [{ url: `https://img/${id}`, width: 300, height: 300 }] };
    });
    await fillArtistArtwork(as(stub), [artist('a')]);
    await fillArtistArtwork(as(stub), [artist('a')]);
    expect(asked).toEqual(['a', 'a']);
  });

  it('forgets being offline, which says nothing about the picture', async () => {
    let calls = 0;
    const { stub, asked } = client(async (id) => {
      calls += 1;
      if (calls === 1) throw new TypeError('Failed to fetch');
      return { id, name: id, images: [{ url: `https://img/${id}`, width: 300, height: 300 }] };
    });
    await fillArtistArtwork(as(stub), [artist('a')]);
    await fillArtistArtwork(as(stub), [artist('a')]);
    expect(asked).toEqual(['a', 'a']);
  });

  it('shares one request between calls made at the same moment', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { stub, asked } = client(async (id) => {
      await gate;
      return { id, name: id, images: [{ url: `https://img/${id}`, width: 300, height: 300 }] };
    });
    // Two surfaces mount at once and both name the same artist.
    const both = Promise.all([
      fillArtistArtwork(as(stub), [artist('a')]),
      fillArtistArtwork(as(stub), [artist('a')]),
    ]);
    release();
    const [first, second] = await both;
    expect(asked).toEqual(['a']);
    expect(first.filled.length + second.filled.length).toBe(1);
  });

  it('does nothing when nothing needs a picture', async () => {
    const { stub, asked } = client();
    const result = await fillArtistArtwork(as(stub), [
      artist('a', { artworkUrl: 'https://img/a' }),
    ]);
    expect(asked).toEqual([]);
    expect(result).toEqual({ filled: [], missed: 0, problems: [] });
  });

  it('starts asking again once the session memory is cleared', async () => {
    const { stub, asked } = client();
    await fillArtistArtwork(as(stub), [artist('a')]);
    resetArtistArtwork();
    await fillArtistArtwork(as(stub), [artist('a')]);
    expect(asked).toEqual(['a', 'a']);
  });
});

describe('topUpArtistArtwork', () => {
  it('writes nothing and asks nothing while Spotify is disconnected', async () => {
    const upserts: Entity[][] = [];
    vi.resetModules();
    vi.doMock('../spotify/session', () => ({
      spotifyConfig: () => ({ clientId: 'x', redirectUri: 'y', scopes: [] }),
      spotifySession: {
        subscribe: (run: (v: unknown) => void) => (run({ connected: false }), () => {}),
      },
    }));
    vi.doMock('../storage/repo', () => ({
      upsertEntities: async (e: Entity[]) => void upserts.push(e),
    }));
    vi.doMock('../app/state', () => ({ refreshWorld: async () => {} }));

    const { topUpArtistArtwork } = await import('../app/artwork');
    expect(await topUpArtistArtwork([artist('a')])).toBe(0);
    expect(upserts).toEqual([]);
    vi.doUnmock('../spotify/session');
    vi.doUnmock('../storage/repo');
    vi.doUnmock('../app/state');
  });
});
