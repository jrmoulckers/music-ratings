import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpotifyApiError, SpotifyClient } from './client';
import { searchCatalogue, searchTypesFor } from './library';
import { mapPlaylistItems } from './mappers';
import type { SpotifyConfig } from './auth';

/**
 * These cover the request Spotify actually receives, not just the shape of our
 * own helpers. Catalogue search shipped broken because nothing here asserted
 * the outgoing URL: `/search` answers with plural keys but only accepts
 * singular `type` values, and it rejects the `market=from_token` form outright.
 * Both faults are invisible from the response-mapping side.
 */

const config: SpotifyConfig = {
  clientId: 'test-client',
  redirectUri: 'http://127.0.0.1:5173/callback',
};

const TOKEN_KEY = 'music-ratings:spotify-token';

let fetchMock: ReturnType<typeof vi.fn>;

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    clone() {
      return this;
    },
  } as unknown as Response;
}

function respondWith(body: unknown, init: { status?: number } = {}) {
  fetchMock.mockResolvedValue(response(body, init.status ?? 200));
}

function requestedUrl(): URL {
  expect(fetchMock).toHaveBeenCalled();
  return new URL(String(fetchMock.mock.calls[0]?.[0]));
}

function requestedUrls(): string[] {
  return fetchMock.mock.calls.map((call) => new URL(String(call[0])).pathname);
}

beforeEach(() => {
  localStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3_600_000,
      scopes: ['user-read-private'],
    }),
  );
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('searchTypesFor', () => {
  it('uses the singular names /search accepts, never the plural response keys', () => {
    expect(searchTypesFor(['artist', 'album', 'track', 'playlist'])).toEqual([
      'artist',
      'album',
      'track',
      'playlist',
    ]);
  });

  it('searches audiobooks for chapters, since chapters are not separately indexed', () => {
    expect(searchTypesFor(['chapter'])).toEqual(['audiobook']);
  });

  it('collapses audiobook and chapter onto one type rather than repeating it', () => {
    expect(searchTypesFor(['audiobook', 'chapter'])).toEqual(['audiobook']);
  });

  it('covers every enabled type without inventing one', () => {
    expect(searchTypesFor(['show', 'episode'])).toEqual(['show', 'episode']);
    expect(searchTypesFor([])).toEqual([]);
  });
});

describe('SpotifyClient.search', () => {
  it('sends singular types, so Spotify does not reject the whole request', async () => {
    respondWith({ artists: { items: [] } });
    const client = new SpotifyClient({ config });
    await client.search('nightbus', ['artist', 'album'], 20);

    const url = requestedUrl();
    expect(url.pathname).toBe('/v1/search');
    expect(url.searchParams.get('type')).toBe('artist,album');
    expect(url.searchParams.get('q')).toBe('nightbus');
  });

  it('omits market by default, letting the user token supply the country', async () => {
    respondWith({ artists: { items: [] } });
    await new SpotifyClient({ config }).search('nightbus', ['artist'], 20);

    // `from_token` is no longer accepted and fails with "Invalid market code".
    expect(requestedUrl().searchParams.has('market')).toBe(false);
  });

  it('still honours an explicit market when one is chosen', async () => {
    respondWith({ artists: { items: [] } });
    await new SpotifyClient({ config, market: 'GB' }).search('nightbus', ['artist'], 20);

    expect(requestedUrl().searchParams.get('market')).toBe('GB');
  });

  it("passes Spotify's own explanation through instead of a bare status", async () => {
    respondWith({ error: { status: 400, message: 'Invalid market code' } }, { status: 400 });

    await expect(new SpotifyClient({ config }).search('x', ['artist'], 20)).rejects.toThrow(
      /400: Invalid market code/,
    );
  });

  it('reports a bare status when Spotify explains nothing', async () => {
    respondWith({}, { status: 400 });
    const failure = new SpotifyClient({ config }).search('x', ['artist'], 20);

    await expect(failure).rejects.toBeInstanceOf(SpotifyApiError);
    await expect(failure).rejects.toThrow(/Spotify returned 400\./);
  });
});

describe('February 2026 development-mode API changes', () => {
  it('asks for at most ten search results, the new maximum', async () => {
    respondWith({ artists: { items: [] } });
    await searchCatalogue(new SpotifyClient({ config }), 'marvin gaye', ['artist', 'album']);

    // Spotify cut the search page size from 50 to 10 and refuses anything
    // larger with "Invalid limit", which reads as an empty catalogue.
    expect(requestedUrl().searchParams.get('limit')).toBe('10');
  });

  it('clamps a caller that asks for the old page size', async () => {
    respondWith({ artists: { items: [] } });
    await new SpotifyClient({ config }).search('marvin gaye', ['artist'], 50);

    expect(requestedUrl().searchParams.get('limit')).toBe('10');
  });

  it('never asks for fewer than one result', async () => {
    respondWith({ artists: { items: [] } });
    await new SpotifyClient({ config }).search('marvin gaye', ['artist'], 0);

    expect(requestedUrl().searchParams.get('limit')).toBe('1');
  });

  it('reads playlist contents from /items, which replaced /tracks', async () => {
    respondWith({ items: [], next: null });
    await new SpotifyClient({ config }).playlistTracks('p1');

    expect(requestedUrl().pathname).toBe('/v1/playlists/p1/items');
  });

  it('falls back to /tracks when an extended-quota app has no /items', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ error: { message: 'Not found' } }, 404))
      .mockResolvedValueOnce(response({ items: [], next: null }, 200));

    await new SpotifyClient({ config }).playlistTracks('p1');

    expect(requestedUrls()).toEqual(['/v1/playlists/p1/items', '/v1/playlists/p1/tracks']);
  });

  it('treats a withheld playlist as empty rather than as a failure', async () => {
    // Spotify now returns only metadata for playlists the user does not own.
    respondWith({ error: { message: 'Insufficient client scope' } }, { status: 403 });

    await expect(new SpotifyClient({ config }).playlistTracks('p1')).resolves.toEqual([]);
  });

  it('asks for ten albums per artist page, the ceiling the schema sets', async () => {
    respondWith({ items: [], next: null });
    await new SpotifyClient({ config }).artistAlbums('ar1');

    const url = requestedUrl();
    expect(url.pathname).toBe('/v1/artists/ar1/albums');
    expect(url.searchParams.get('limit')).toBe('10');
  });

  it('still pages saved tracks fifty at a time, where fifty is allowed', async () => {
    respondWith({ items: [], next: null });
    await new SpotifyClient({ config }).savedTracks();

    expect(requestedUrl().searchParams.get('limit')).toBe('50');
  });

  it('maps playlist items under the new `item` key', async () => {
    const result = mapPlaylistItems({ id: 'p1', name: 'Evening', items: { total: 1 } }, [
      { item: { id: 't1', name: 'Inner City Blues' }, added_at: '2026-01-02T00:00:00Z' },
    ]);

    expect(result.entities.map((e) => e.name)).toContain('Inner City Blues');
    expect(result.entities[0]?.totalChildren).toBe(1);
  });

  it('still maps the legacy `track` key for extended-quota apps', async () => {
    const result = mapPlaylistItems({ id: 'p1', name: 'Evening', tracks: { total: 1 } }, [
      { track: { id: 't1', name: 'Inner City Blues' } },
    ]);

    expect(result.entities.map((e) => e.name)).toContain('Inner City Blues');
    expect(result.entities[0]?.totalChildren).toBe(1);
  });

  it('keeps positions truthful when an item has no readable track', async () => {
    const result = mapPlaylistItems({ id: 'p1', name: 'Evening' }, [
      { item: null },
      { item: { id: 't2', name: 'Right On' } },
    ]);

    const edge = result.memberships.find((m) => m.parentType === 'playlist');
    expect(edge?.position).toBe(1);
  });
});

describe('searchCatalogue', () => {
  it('asks for the singular types matching the enabled entity types', async () => {
    respondWith({ artists: { items: [] }, albums: { items: [] } });
    await searchCatalogue(new SpotifyClient({ config }), 'kestrel', ['artist', 'album']);

    expect(requestedUrl().searchParams.get('type')).toBe('artist,album');
  });

  it('maps the plural response keys back into domain entities', async () => {
    respondWith({
      artists: {
        items: [{ id: 'a1', name: 'Kestrel Harbour', images: [], genres: [], popularity: 40 }],
      },
    });
    const result = await searchCatalogue(new SpotifyClient({ config }), 'kestrel', ['artist']);

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]?.name).toBe('Kestrel Harbour');
    expect(result.entities[0]?.type).toBe('artist');
  });

  it('does not reach the network when nothing is enabled', async () => {
    await searchCatalogue(new SpotifyClient({ config }), 'kestrel', []);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not reach the network for a blank query', async () => {
    await searchCatalogue(new SpotifyClient({ config }), '   ', ['artist']);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
