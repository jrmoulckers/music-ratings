import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { storeTokens } from './auth';
import { SpotifyClient } from './client';

const fetchMock = vi.fn();
const client = new SpotifyClient({
  config: { clientId: 'test', redirectUri: 'http://127.0.0.1/callback' },
});

beforeEach(() => {
  storeTokens({
    accessToken: 'test',
    refreshToken: 'test',
    expiresAt: Date.now() + 60_000,
    scopes: ['playlist-modify-private'],
  });
  fetchMock
    .mockReset()
    .mockImplementation(async () => new Response(JSON.stringify({ snapshot_id: 'new' })));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('playlist write endpoints', () => {
  it('creates a private playlist for the current user using the current API', async () => {
    await client.createRankedPlaylist('My Top 25 Songs');
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.spotify.com/v1/me/playlists');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toMatchObject({ name: 'My Top 25 Songs', public: false });
  });
  it('uses PUT for replacement, POST for append, and sends URIs in the body', async () => {
    await client.replacePlaylistItems('list', ['spotify:track:a']);
    await client.appendPlaylistItems('list', ['spotify:track:b']);
    expect(
      fetchMock.mock.calls.map(([url, options]) => [url, options.method, JSON.parse(options.body)]),
    ).toEqual([
      ['https://api.spotify.com/v1/playlists/list/items', 'PUT', { uris: ['spotify:track:a'] }],
      ['https://api.spotify.com/v1/playlists/list/items', 'POST', { uris: ['spotify:track:b'] }],
    ]);
  });
  it('allows clearing, rejects oversized batches and empty appends', async () => {
    await client.replacePlaylistItems('list', []);
    expect(() => client.replacePlaylistItems('list', Array(101).fill('spotify:track:a'))).toThrow();
    expect(() => client.appendPlaylistItems('list', [])).toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(['create', 'append'] as const)(
    'does not replay ambiguous %s failures',
    async (operation) => {
      fetchMock.mockResolvedValue(new Response('', { status: 503 }));
      await expect(
        operation === 'create'
          ? client.createRankedPlaylist('Top 10')
          : client.appendPlaylistItems('list', ['spotify:track:a']),
      ).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});
