import { get, writable } from 'svelte/store';

import { notify } from '../app/notices';
import { accessToken } from '../spotify/client';
import { spotifyConfig } from '../spotify/session';

/**
 * This browser as a Spotify device.
 *
 * Entirely opt-in and entirely lazy: the SDK script is not in the bundle, is
 * not fetched on load, and is never fetched at all for the listener who only
 * wants to control the speaker in the next room. It needs Spotify Premium and
 * the `streaming` permission, and it will not play until the listener has
 * touched the page — browsers do not let a script make noise unasked.
 */

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';

export type BrowserPlayerStatus =
  'off' | 'loading' | 'connecting' | 'ready' | 'unavailable' | 'error';

export interface BrowserPlayerState {
  status: BrowserPlayerStatus;
  /** The Spotify device id for this browser, once Spotify has issued one. */
  deviceId: string | null;
  error: string | null;
}

export const browserPlayer = writable<BrowserPlayerState>({
  status: 'off',
  deviceId: null,
  error: null,
});

/* -------------------------------------------------------------------------- */
/* Loading the script                                                         */
/* -------------------------------------------------------------------------- */

interface SdkPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, handler: (payload: unknown) => void): boolean;
  removeListener(event: string): boolean;
  activateElement?: () => Promise<void>;
}

interface SdkNamespace {
  Player: new (options: {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
  }) => SdkPlayer;
}

declare global {
  interface Window {
    Spotify?: SdkNamespace;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

let loading: Promise<SdkNamespace> | null = null;

function loadSdk(): Promise<SdkNamespace> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('The browser player needs a browser.'));
  }
  if (window.Spotify) return Promise.resolve(window.Spotify);
  if (loading) return loading;

  loading = new Promise<SdkNamespace>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Spotify’s player script did not load. Check your connection or blockers.'));
    }, 15_000);

    window.onSpotifyWebPlaybackSDKReady = () => {
      clearTimeout(timeout);
      if (window.Spotify) resolve(window.Spotify);
      else reject(new Error('Spotify’s player script loaded but produced no player.'));
    };

    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timeout);
      loading = null;
      reject(new Error('Spotify’s player script could not be fetched.'));
    };
    document.head.append(script);
  }).catch((error: Error) => {
    loading = null;
    throw error;
  });

  return loading;
}

/* -------------------------------------------------------------------------- */
/* The player                                                                 */
/* -------------------------------------------------------------------------- */

let player: SdkPlayer | null = null;

function deviceName(): string {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const browser = /Firefox/.test(agent)
    ? 'Firefox'
    : /Edg\//.test(agent)
      ? 'Edge'
      : /Chrome/.test(agent)
        ? 'Chrome'
        : /Safari/.test(agent)
          ? 'Safari'
          : 'this browser';
  return `Music Ratings (${browser})`;
}

/**
 * Turn this browser into a Spotify device.
 *
 * Safe to call twice: an existing connection is reused rather than stacked, so
 * a listener who presses the button again does not end up with two devices of
 * the same name in their picker.
 */
export async function startBrowserPlayer(): Promise<string | null> {
  const state = get(browserPlayer);
  if (state.status === 'ready' && state.deviceId) return state.deviceId;
  if (state.status === 'loading' || state.status === 'connecting') return null;

  browserPlayer.set({ status: 'loading', deviceId: null, error: null });
  try {
    const sdk = await loadSdk();
    browserPlayer.update((s) => ({ ...s, status: 'connecting' }));

    const config = spotifyConfig();
    const instance = new sdk.Player({
      name: deviceName(),
      getOAuthToken: (cb) => {
        void accessToken(config)
          .then(cb)
          .catch(() => {
            browserPlayer.set({
              status: 'error',
              deviceId: null,
              error: 'Your Spotify sign-in expired. Connect again to use the browser player.',
            });
          });
      },
      volume: 0.6,
    });

    const settled = new Promise<string>((resolve, reject) => {
      instance.addListener('ready', (payload) => {
        const id = (payload as { device_id?: string }).device_id ?? null;
        if (id) resolve(id);
      });
      instance.addListener('not_ready', () => {
        browserPlayer.update((s) => ({ ...s, status: 'unavailable' }));
      });
      instance.addListener('initialization_error', (payload) => {
        reject(new Error(messageOf(payload, 'This browser cannot host a Spotify player.')));
      });
      instance.addListener('authentication_error', (payload) => {
        reject(
          new Error(
            messageOf(
              payload,
              'Spotify would not accept the sign-in. Reconnect to grant playback permission.',
            ),
          ),
        );
      });
      instance.addListener('account_error', () => {
        reject(new Error('Playing in the browser needs Spotify Premium.'));
      });
      instance.addListener('playback_error', (payload) => {
        // Not fatal: one track failed, the device is still alive.
        notify(messageOf(payload, 'Spotify could not play that here.'), { tone: 'warn' });
      });
      setTimeout(() => reject(new Error('Spotify’s player did not become ready.')), 20_000);
    });

    const connected = await instance.connect();
    if (!connected) throw new Error('Spotify refused to connect this browser as a device.');
    player = instance;

    const deviceId = await settled;
    browserPlayer.set({ status: 'ready', deviceId, error: null });
    return deviceId;
  } catch (error) {
    stopBrowserPlayer();
    const message = error instanceof Error ? error.message : 'The browser player could not start.';
    browserPlayer.set({ status: 'error', deviceId: null, error: message });
    return null;
  }
}

function messageOf(payload: unknown, fallback: string): string {
  const message = (payload as { message?: string } | null)?.message;
  return typeof message === 'string' && message ? message : fallback;
}

/** Disconnect and forget the device. Spotify drops it from the picker shortly after. */
export function stopBrowserPlayer(): void {
  if (player) {
    for (const event of [
      'ready',
      'not_ready',
      'initialization_error',
      'authentication_error',
      'account_error',
      'playback_error',
    ]) {
      player.removeListener(event);
    }
    player.disconnect();
    player = null;
  }
  browserPlayer.set({ status: 'off', deviceId: null, error: null });
}

/**
 * Satisfy the browser's autoplay rule.
 *
 * Called from a real click before transferring playback here; without it, iOS
 * and Safari accept the transfer and then stay silent.
 */
export async function unlockBrowserPlayer(): Promise<void> {
  try {
    await player?.activateElement?.();
  } catch {
    /* Not every SDK build exposes it, and failure only costs a tap. */
  }
}
