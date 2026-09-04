import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';

import type { SpotifyTokens } from './auth';

/**
 * What the session says the current sign-in can do.
 *
 * Deliberately imported for real, with no mocks. The switch that decides
 * whether the browser player is wanted lives in `app/state`, and this module
 * now reads it as it is evaluated — so an import cycle here would not be a
 * failed assertion, it would be a blank app on boot. Importing it is the test.
 *
 * The behaviour underneath: `streaming` is only ever requested once the browser
 * player is switched on, so flipping that switch changes what an existing token
 * is missing. Reading it once at startup left the app offering a device the
 * sign-in could not drive, and hiding the sentence that said so until a reload.
 */

const { settings } = await import('../app/state');
const { spotifySession, refreshSpotifySession } = await import('./session');

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

function wantBrowserPlayer(on: boolean): void {
  settings.update((current) => ({ ...current, browserPlayer: on }));
}

beforeEach(() => {
  localStorage.clear();
  wantBrowserPlayer(false);
  refreshSpotifySession();
});

describe('what the current sign-in is missing', () => {
  it('follows the browser-player switch without waiting for a reload', () => {
    signIn(['user-read-playback-state', 'user-modify-playback-state']);
    refreshSpotifySession();
    expect(get(spotifySession).missingStreamingScope).toBe(false);

    // No refresh call here on purpose: moving the switch is the whole event.
    wantBrowserPlayer(true);
    expect(get(spotifySession).missingStreamingScope).toBe(true);

    wantBrowserPlayer(false);
    expect(get(spotifySession).missingStreamingScope).toBe(false);
  });

  it('asks for nothing more once streaming has been granted', () => {
    signIn(['user-read-playback-state', 'streaming']);
    refreshSpotifySession();

    wantBrowserPlayer(true);
    expect(get(spotifySession).missingStreamingScope).toBe(false);
  });

  it('asks nothing of a browser that has never connected Spotify', () => {
    wantBrowserPlayer(true);
    const session = get(spotifySession);
    expect(session.connected).toBe(false);
    // Nothing is "missing" from a sign-in that does not exist; the app asks the
    // person to connect, which is a different sentence in a different place.
    expect(session.missingStreamingScope).toBe(false);
  });
});
