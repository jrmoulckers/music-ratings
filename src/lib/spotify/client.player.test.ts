import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SpotifyConfig } from './auth';
import { SpotifyApiError, SpotifyClient } from './client';

/**
 * The player endpoints, checked at the wire.
 *
 * Every fault these guard against is invisible from the response side: a
 * command sent as GET, a body that should have been a query parameter, a `204`
 * read as a parse failure, or a refusal reason thrown away so the screen shows
 * "Spotify returned 403" instead of "that needs Premium".
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

function call(index = 0) {
  const [url, init] = fetchMock.mock.calls[index] ?? [];
  return {
    url: new URL(String(url)),
    method: (init as RequestInit | undefined)?.method,
    body: (init as RequestInit | undefined)?.body
      ? JSON.parse(String((init as RequestInit).body))
      : undefined,
  };
}

beforeEach(() => {
  localStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3_600_000,
      scopes: ['user-modify-playback-state'],
    }),
  );
  fetchMock = vi.fn().mockResolvedValue(response(undefined, 204));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function client() {
  return new SpotifyClient({ config, market: 'GB' });
}

describe('reading playback', () => {
  it('asks for episodes as well as tracks, in the listener’s market', async () => {
    fetchMock.mockResolvedValue(response({ is_playing: true }));
    await client().playbackState();
    const { url, method } = call();
    expect(url.pathname).toBe('/v1/me/player');
    expect(method).toBeUndefined();
    expect(url.searchParams.get('additional_types')).toBe('track,episode');
    expect(url.searchParams.get('market')).toBe('GB');
  });

  it('reads 204 as "nothing is playing", not as a broken response', async () => {
    fetchMock.mockResolvedValue(response(undefined, 204));
    await expect(client().playbackState()).resolves.toBeUndefined();
  });

  it('unwraps the device list, and copes when Spotify omits it', async () => {
    fetchMock.mockResolvedValue(response({ devices: [{ id: 'd1', name: 'Kitchen' }] }));
    expect(await client().devices()).toHaveLength(1);
    fetchMock.mockResolvedValue(response({}));
    expect(await client().devices()).toEqual([]);
  });

  it('reads the queue, and treats an empty answer as an empty queue', async () => {
    fetchMock.mockResolvedValue(response({ queue: [{ id: 't1' }] }));
    expect((await client().queue()).queue).toHaveLength(1);
    fetchMock.mockResolvedValue(response(undefined, 204));
    expect(await client().queue()).toEqual({ currently_playing: null, queue: [] });
  });
});

describe('commands', () => {
  it('transfers playback with the device in the body, as Spotify requires', async () => {
    await client().transferPlayback('d1', true);
    const { url, method, body } = call();
    expect(method).toBe('PUT');
    expect(url.pathname).toBe('/v1/me/player');
    expect(body).toEqual({ device_ids: ['d1'], play: true });
  });

  it('resumes with an empty body when told nothing in particular to play', async () => {
    await client().play();
    const { url, method, body } = call();
    expect(method).toBe('PUT');
    expect(url.pathname).toBe('/v1/me/player/play');
    expect(body).toEqual({});
  });

  it('starts a release at a track, sending context and offset together', async () => {
    await client().play({
      contextUri: 'spotify:album:al1',
      offset: { position: 4 },
      positionMs: 1_500,
      deviceId: 'd1',
    });
    const { url, body } = call();
    expect(url.searchParams.get('device_id')).toBe('d1');
    expect(body).toEqual({
      context_uri: 'spotify:album:al1',
      offset: { position: 4 },
      position_ms: 1_500,
    });
  });

  it('plays loose tracks by URI, without a context', async () => {
    await client().play({ uris: ['spotify:track:t1', 'spotify:track:t2'] });
    expect(call().body).toEqual({ uris: ['spotify:track:t1', 'spotify:track:t2'] });
  });

  it('pauses with PUT and skips with POST, the way the API is shaped', async () => {
    const c = client();
    await c.pause();
    expect(call(0)).toMatchObject({ method: 'PUT' });
    expect(call(0).url.pathname).toBe('/v1/me/player/pause');
    await c.next();
    expect(call(1)).toMatchObject({ method: 'POST' });
    expect(call(1).url.pathname).toBe('/v1/me/player/next');
    await c.previous();
    expect(call(2)).toMatchObject({ method: 'POST' });
    expect(call(2).url.pathname).toBe('/v1/me/player/previous');
  });

  it('sends seek, volume, shuffle and repeat as query parameters, not as bodies', async () => {
    const c = client();
    await c.seek(42_500);
    expect(call(0).url.searchParams.get('position_ms')).toBe('42500');
    expect(call(0).body).toBeUndefined();

    await c.setVolume(35);
    expect(call(1).url.searchParams.get('volume_percent')).toBe('35');

    await c.setShuffle(true);
    expect(call(2).url.searchParams.get('state')).toBe('true');

    await c.setRepeat('track');
    expect(call(3).url.searchParams.get('state')).toBe('track');
  });

  it('clamps values Spotify would reject outright', async () => {
    const c = client();
    await c.seek(-10);
    expect(call(0).url.searchParams.get('position_ms')).toBe('0');
    await c.setVolume(180);
    expect(call(1).url.searchParams.get('volume_percent')).toBe('100');
    await c.setVolume(-4);
    expect(call(2).url.searchParams.get('volume_percent')).toBe('0');
  });

  it('queues a URI with POST and encodes it properly', async () => {
    await client().addToQueue('spotify:track:t1', 'd1');
    const { url, method } = call();
    expect(method).toBe('POST');
    expect(url.pathname).toBe('/v1/me/player/queue');
    expect(url.searchParams.get('uri')).toBe('spotify:track:t1');
    expect(url.searchParams.get('device_id')).toBe('d1');
  });

  it('omits the device entirely when none was chosen', async () => {
    await client().pause();
    expect(call().url.searchParams.has('device_id')).toBe(false);
  });
});

describe('refusals', () => {
  async function refusal(status: number, reason: string) {
    fetchMock.mockResolvedValue(
      response({ error: { status, message: 'Refused', reason } }, status),
    );
    try {
      await client().next();
      throw new Error('should have refused');
    } catch (error) {
      return error as SpotifyApiError;
    }
  }

  it('names a missing device instead of showing a bare 404', async () => {
    const error = await refusal(404, 'NO_ACTIVE_DEVICE');
    expect(error).toBeInstanceOf(SpotifyApiError);
    expect(error.kind).toBe('no-device');
    expect(error.message).toMatch(/Open Spotify on a device/);
  });

  it('says plainly that playback needs Premium', async () => {
    const error = await refusal(403, 'PREMIUM_REQUIRED');
    expect(error.kind).toBe('premium');
    expect(error.message).toMatch(/Premium/);
  });

  it('passes through the small refusals as restrictions, not failures', async () => {
    expect((await refusal(403, 'NO_NEXT_TRACK')).kind).toBe('restricted');
    expect((await refusal(403, 'ALREADY_PAUSED')).kind).toBe('restricted');
    expect((await refusal(403, 'REMOTE_CONTROL_DISALLOW')).kind).toBe('restricted');
  });

  it('keeps the reason on the error for anything it does not recognise', async () => {
    const error = await refusal(403, 'SOMETHING_NEW');
    expect(error.kind).toBe('forbidden');
    expect(error.reason).toBe('SOMETHING_NEW');
  });

  it('waits the time Spotify asks for, then retries', async () => {
    const headers = new Headers({ 'Retry-After': '0' });
    fetchMock
      .mockResolvedValueOnce({
        ...response({}, 429),
        status: 429,
        ok: false,
        headers,
        clone() {
          return this;
        },
        json: async () => ({}),
        text: async () => '',
      } as unknown as Response)
      .mockResolvedValue(response(undefined, 204));
    await client().pause();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
