import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpotifyApiError, SpotifyClient } from './client';
import {
  clearSignals,
  importListening,
  readSignals,
  searchCatalogue,
  searchTypesFor,
  writeSignals,
} from './library';
import { mapPlaylistItems } from './mappers';
import { listEntities } from '../storage/repo';
import { LISTENING_STALE_MS, listeningIsStale } from './session';
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
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
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

  /**
   * Searching for a track used to answer with a screenful of artists.
   *
   * Mapping a track pulls in its release and everyone credited on both, and all
   * of that landed in `entities` ahead of the track itself. `hits` names only
   * what Spotify was asked about, and takes one of each kind in turn so no
   * single lane pushes the others below the fold.
   */
  const CROWDED = {
    artists: {
      items: [
        { id: 'a1', name: 'Kestrel Harbour', images: [], genres: [], popularity: 40 },
        { id: 'a2', name: 'Kestrel Harbour Trio', images: [], genres: [], popularity: 20 },
      ],
    },
    albums: {
      items: [
        {
          id: 'al1',
          name: 'Low Tide',
          images: [],
          total_tracks: 9,
          artists: [{ id: 'a9', name: 'Session Player' }],
        },
      ],
    },
    tracks: {
      items: [
        {
          id: 't1',
          name: 'Kestrel',
          duration_ms: 200_000,
          track_number: 3,
          artists: [{ id: 'a8', name: 'Guest Vocalist' }],
          album: { id: 'al7', name: 'Another Record', images: [], artists: [] },
        },
      ],
    },
  };

  it('names only what Spotify was asked about as a result', async () => {
    respondWith(CROWDED);
    const result = await searchCatalogue(new SpotifyClient({ config }), 'kestrel', [
      'artist',
      'album',
      'track',
    ]);

    expect(result.hits).toEqual([
      'artist:spotify:a1',
      'album:spotify:al1',
      'track:spotify:t1',
      'artist:spotify:a2',
    ]);
  });

  it('still carries the referenced records so a result can be adopted whole', async () => {
    respondWith(CROWDED);
    const result = await searchCatalogue(new SpotifyClient({ config }), 'kestrel', [
      'artist',
      'album',
      'track',
    ]);

    const ids = result.entities.map((e) => e.id);
    expect(ids).toContain('album:spotify:al7');
    expect(ids).toContain('artist:spotify:a8');
    expect(result.entities.length).toBeGreaterThan(result.hits.length);
  });

  it('leads with a real answer rather than an artist nobody searched for', async () => {
    respondWith(CROWDED);
    const result = await searchCatalogue(new SpotifyClient({ config }), 'kestrel', [
      'artist',
      'album',
      'track',
    ]);

    expect(result.hits.slice(0, 3)).not.toContain('artist:spotify:a8');
    expect(result.hits.slice(0, 3)).not.toContain('artist:spotify:a9');
  });

  it('spends a result slot once when the same record comes back twice', async () => {
    // Spotify can repeat a release across a paged answer, and a track's own
    // album can arrive again as an album hit. Either way the row is one row —
    // and collapsing happens before the balancing, so the duplicate does not
    // push a real answer off the list.
    respondWith({
      albums: {
        items: [
          { id: 'al1', name: 'Low Tide', images: [], total_tracks: 9, artists: [] },
          { id: 'al1', name: 'Low Tide', images: [], total_tracks: 9, artists: [] },
          { id: 'al2', name: 'High Water', images: [], total_tracks: 7, artists: [] },
        ],
      },
    });
    const result = await searchCatalogue(new SpotifyClient({ config }), 'tide', ['album']);
    expect(result.hits).toEqual(['album:spotify:al1', 'album:spotify:al2']);
    expect(new Set(result.hits).size).toBe(result.hits.length);
    expect(result.entities.filter((e) => e.id === 'album:spotify:al1')).toHaveLength(1);
  });

  it('keeps two editions of one title as two results', async () => {
    respondWith({
      albums: {
        items: [
          { id: 'lb69', name: 'Let It Bleed', images: [], total_tracks: 9, artists: [] },
          { id: 'lb19', name: 'Let It Bleed', images: [], total_tracks: 18, artists: [] },
        ],
      },
    });
    const result = await searchCatalogue(new SpotifyClient({ config }), 'let it bleed', ['album']);
    expect(result.hits).toHaveLength(2);
  });

  it('answers with an empty hit list when nothing was found', async () => {
    respondWith({ artists: { items: [] } });
    const result = await searchCatalogue(new SpotifyClient({ config }), 'kestrel', ['artist']);
    expect(result.hits).toEqual([]);
  });
});

describe('importListening', () => {
  /**
   * The queue's ordering is only as fresh as this call. A full import is far
   * too expensive to run every time the queue opens, so this reads one endpoint
   * and must leave everything the import knows and it does not exactly alone.
   */

  const play = (id: string, playedAt: string) => ({
    played_at: playedAt,
    track: {
      id,
      name: `Track ${id}`,
      artists: [{ id: 'ar1', name: 'Kestrel Harbour' }],
      album: { id: 'al1', name: 'Low Tide', images: [], artists: [] },
      duration_ms: 200_000,
    },
  });

  beforeEach(async () => {
    await clearSignals();
  });

  it('reads only the recently-played window', async () => {
    respondWith({ items: [play('t1', '2026-02-01T10:00:00Z')] });
    await importListening({ client: new SpotifyClient({ config }) });

    expect(requestedUrls()).toEqual(['/v1/me/player/recently-played']);
  });

  it('keeps the top and saved signals a library import gathered', async () => {
    await writeSignals({
      recentlyPlayed: [{ entityId: 'track:spotify:old', at: 1, index: 0 }],
      top: [{ entityId: 'artist:spotify:ar1', term: 'short', rank: 0, of: 50 }],
      saved: [{ entityId: 'track:spotify:saved', savedAt: 2 }],
      fetchedAt: 1000,
    });

    respondWith({ items: [play('t1', '2026-02-01T10:00:00Z')] });
    await importListening({ client: new SpotifyClient({ config }) });

    const stored = await readSignals();
    expect(stored?.top).toHaveLength(1);
    expect(stored?.saved).toHaveLength(1);
    // The old window is replaced, not merged: Spotify's fifty plays are the
    // whole truth it will tell us, and stale entries would outlive the source.
    expect(stored?.recentlyPlayed.map((p) => p.entityId)).toEqual(['track:spotify:t1']);
    expect(stored?.fetchedAt).toBe(1000);
  });

  it('records when listening was read without claiming a library import ran', async () => {
    respondWith({ items: [play('t1', '2026-02-01T10:00:00Z')] });
    const before = Date.now();
    const report = await importListening({ client: new SpotifyClient({ config }) });

    const stored = await readSignals();
    expect(stored?.listeningFetchedAt).toBeGreaterThanOrEqual(before);
    expect(stored?.listeningFetchedAt).toBe(report.fetchedAt);
  });

  it('keeps the play log intact so repeats can be collapsed downstream', async () => {
    respondWith({
      items: [
        play('t1', '2026-02-01T10:00:00Z'),
        play('t1', '2026-02-01T09:00:00Z'),
        play('t2', '2026-02-01T08:00:00Z'),
      ],
    });
    const report = await importListening({ client: new SpotifyClient({ config }) });

    expect(report.plays).toBe(2);
    const stored = await readSignals();
    expect(stored?.recentlyPlayed).toHaveLength(3);
    expect(stored?.recentlyPlayed.map((p) => p.index)).toEqual([0, 1, 2]);
  });

  it('stores the tracks it returns, so they can be rated straight away', async () => {
    respondWith({ items: [play('t1', '2026-02-01T10:00:00Z')] });
    await importListening({ client: new SpotifyClient({ config }) });

    const stored = await listEntities();
    expect(stored.map((e) => e.id)).toContain('track:spotify:t1');
    expect(stored.map((e) => e.id)).toContain('artist:spotify:ar1');
  });

  it('ignores an item whose track Spotify withheld', async () => {
    respondWith({
      items: [
        { played_at: '2026-02-01T10:00:00Z', track: null },
        play('t1', '2026-02-01T09:00:00Z'),
      ],
    });
    const report = await importListening({ client: new SpotifyClient({ config }) });

    expect(report.plays).toBe(1);
  });
});

describe('listeningIsStale', () => {
  const now = 1_800_000_000_000;

  it('treats a window that was never read as stale', () => {
    expect(listeningIsStale(null, now)).toBe(true);
    expect(listeningIsStale(undefined, now)).toBe(true);
  });

  it('holds a window read within the last few minutes', () => {
    expect(listeningIsStale(now - LISTENING_STALE_MS + 1000, now)).toBe(false);
  });

  it('re-reads once the window is older than the threshold', () => {
    expect(listeningIsStale(now - LISTENING_STALE_MS, now)).toBe(true);
    expect(listeningIsStale(now - 3600_000, now)).toBe(true);
  });
});
