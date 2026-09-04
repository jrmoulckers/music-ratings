import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SpotifyTokens } from '../spotify/auth';

/**
 * Becoming a Spotify device, and refusing to pretend when it cannot.
 *
 * The `streaming` permission is only asked for once the listener switches the
 * browser player on, so every existing sign-in is short of it the first time.
 * Spotify's answer to that is a bare "Invalid token scopes." — three words that
 * name no permission, no app and nothing to do about it. It was reaching the
 * screen verbatim, twice over.
 *
 * These pin the corrected behaviour from both ends: the token is checked here
 * before Spotify is troubled at all, and if Spotify still objects on scope
 * grounds the objection is translated rather than repeated.
 */

vi.mock('../app/notices', () => ({ notify: () => undefined }));

vi.mock('../spotify/client', () => ({
  accessToken: async () => 'access-token',
}));

vi.mock('../spotify/session', () => ({
  spotifyConfig: () => ({ clientId: 'cid', redirectUri: 'https://rank.example/callback' }),
}));

const { browserPlayer, startBrowserPlayer, stopBrowserPlayer, STREAMING_PERMISSION_MESSAGE } =
  await import('./sdk');

const TOKEN_KEY = 'music-ratings:spotify-token';

function signIn(scopes: string[]): void {
  const tokens: SpotifyTokens = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: Date.now() + 3_600_000,
    scopes,
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

/** Stands in for the script at sdk.scdn.co, which no test should ever fetch. */
class FakePlayer {
  static last: FakePlayer | null = null;
  static emitOnConnect: { event: string; payload: unknown } | null = null;

  private readonly listeners = new Map<string, (payload: unknown) => void>();

  constructor(
    readonly options: { name: string; getOAuthToken: (cb: (t: string) => void) => void },
  ) {
    FakePlayer.last = this;
  }

  async connect(): Promise<boolean> {
    const next = FakePlayer.emitOnConnect;
    if (next) queueMicrotask(() => this.emit(next.event, next.payload));
    return true;
  }

  disconnect(): void {}

  addListener(event: string, handler: (payload: unknown) => void): boolean {
    this.listeners.set(event, handler);
    return true;
  }

  removeListener(event: string): boolean {
    return this.listeners.delete(event);
  }

  emit(event: string, payload: unknown): void {
    this.listeners.get(event)?.(payload);
  }
}

function installSdk(): void {
  window.Spotify = { Player: FakePlayer } as unknown as typeof window.Spotify;
}

beforeEach(() => {
  vi.useFakeTimers();
  stopBrowserPlayer();
  localStorage.clear();
  FakePlayer.last = null;
  FakePlayer.emitOnConnect = null;
  delete window.Spotify;
  for (const script of document.querySelectorAll('script')) script.remove();
});

afterEach(() => {
  stopBrowserPlayer();
  vi.useRealTimers();
  delete window.Spotify;
});

describe('the browser as a Spotify device', () => {
  it('will not start on a sign-in that cannot stream, and says what is missing', async () => {
    signIn(['user-read-playback-state', 'user-modify-playback-state']);

    const deviceId = await startBrowserPlayer();

    expect(deviceId).toBeNull();
    const state = get(browserPlayer);
    expect(state.status).toBe('needs-permission');
    expect(state.error).toBe(STREAMING_PERMISSION_MESSAGE);
    expect(state.error).not.toMatch(/invalid token scopes/i);
    // The permission is on this device. Fetching Spotify's player only to be
    // told so would be a slow way to learn it.
    expect(document.querySelector('script[src*="sdk.scdn.co"]')).toBeNull();
  });

  it('will not start when nobody is signed in at all', async () => {
    expect(await startBrowserPlayer()).toBeNull();
    expect(get(browserPlayer).status).toBe('needs-permission');
    expect(document.querySelector('script[src*="sdk.scdn.co"]')).toBeNull();
  });

  it('starts, and reports its device id, once streaming is granted', async () => {
    signIn(['user-read-playback-state', 'streaming']);
    installSdk();
    FakePlayer.emitOnConnect = { event: 'ready', payload: { device_id: 'device-1' } };

    const deviceId = await startBrowserPlayer();

    expect(deviceId).toBe('device-1');
    expect(get(browserPlayer)).toMatchObject({ status: 'ready', deviceId: 'device-1' });
  });

  it('translates a scope complaint from Spotify instead of repeating it', async () => {
    // A token that claims the scope but is refused anyway — a stale grant, or a
    // client id whose dashboard entry has since changed.
    signIn(['streaming']);
    installSdk();
    FakePlayer.emitOnConnect = {
      event: 'authentication_error',
      payload: { message: 'Invalid token scopes.' },
    };

    const deviceId = await startBrowserPlayer();

    expect(deviceId).toBeNull();
    const state = get(browserPlayer);
    expect(state.status).toBe('needs-permission');
    expect(state.error).toBe(STREAMING_PERMISSION_MESSAGE);
  });

  it('keeps other refusals in Spotify’s own words', async () => {
    signIn(['streaming']);
    installSdk();
    FakePlayer.emitOnConnect = {
      event: 'account_error',
      payload: { message: 'Not a premium account' },
    };

    expect(await startBrowserPlayer()).toBeNull();
    const state = get(browserPlayer);
    expect(state.status).toBe('error');
    expect(state.error).toMatch(/Premium/i);
  });
});
