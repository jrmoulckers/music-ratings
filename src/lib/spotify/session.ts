import { get, writable } from 'svelte/store';

import { announce, notify } from '../app/notices';
import { settings } from '../app/state';
import { refreshWorld } from '../app/state';
import {
  beginSignIn,
  forgetTokens,
  hasScopes,
  storedTokens,
  PODCAST_SCOPE,
  BASE_SCOPES,
  type SpotifyConfig,
} from './auth';
import { SpotifyApiError, SpotifyClient } from './client';
import { importLibrary, type ImportStep } from './library';

/**
 * The connection to Spotify, as the screens see it.
 *
 * One place decides whether we are connected, what scopes we hold, and how an
 * import reports itself — so no screen has to reason about tokens.
 */

export interface SpotifySession {
  connected: boolean;
  profileName: string | null;
  scopes: string[];
  expiresAt: number | null;
  missingPodcastScope: boolean;
}

export interface ImportProgress {
  running: boolean;
  steps: ImportStep[];
  backoffSeconds: number | null;
  error: string | null;
  finishedAt: number | null;
}

const PROFILE_KEY = 'music-ratings.spotify.profile';

function storedProfileName(): string | null {
  try {
    return localStorage.getItem(PROFILE_KEY);
  } catch {
    return null;
  }
}

function rememberProfileName(name: string | null): void {
  try {
    if (name) localStorage.setItem(PROFILE_KEY, name);
    else localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* Private browsing. The name is a convenience, not data. */
  }
}

export const spotifySession = writable<SpotifySession>(read());
export const importProgress = writable<ImportProgress>({
  running: false,
  steps: [],
  backoffSeconds: null,
  error: null,
  finishedAt: null,
});

function read(): SpotifySession {
  const tokens = storedTokens();
  return {
    connected: Boolean(tokens),
    profileName: tokens ? storedProfileName() : null,
    scopes: tokens?.scopes ?? [],
    expiresAt: tokens?.expiresAt ?? null,
    missingPodcastScope: Boolean(tokens) && !hasScopes(tokens, [PODCAST_SCOPE]),
  };
}

export function refreshSpotifySession(): void {
  spotifySession.set(read());
}

export function spotifyConfig(): SpotifyConfig {
  const current = get(settings);
  const wantsPodcasts =
    current.enabledTypes.includes('show') || current.enabledTypes.includes('episode');
  return {
    clientId: current.spotifyClientId,
    redirectUri: current.spotifyRedirectUri,
    ...(wantsPodcasts ? { extraScopes: [PODCAST_SCOPE] } : {}),
  };
}

export function requestedScopes(): string[] {
  const config = spotifyConfig();
  return [...BASE_SCOPES, ...(config.extraScopes ?? [])];
}

export async function connectSpotify(returnTo = '/settings'): Promise<void> {
  await beginSignIn(spotifyConfig(), returnTo);
}

export function disconnectSpotify(): void {
  forgetTokens();
  rememberProfileName(null);
  refreshSpotifySession();
  announce('Spotify disconnected.');
}

let running: AbortController | null = null;

export async function runImport(): Promise<void> {
  if (running) return;
  const controller = new AbortController();
  running = controller;
  importProgress.set({
    running: true,
    steps: [],
    backoffSeconds: null,
    error: null,
    finishedAt: null,
  });

  const client = new SpotifyClient({
    config: spotifyConfig(),
    onBackoff: (seconds) => importProgress.update((p) => ({ ...p, backoffSeconds: seconds })),
  });

  try {
    try {
      const me = await client.profile({ signal: controller.signal });
      rememberProfileName(me.display_name ?? me.id ?? null);
    } catch {
      // A name is a courtesy. Losing it must not stop the import.
    }

    const result = await importLibrary({
      client,
      enabledTypes: get(settings).enabledTypes,
      signal: controller.signal,
      onProgress: (step) =>
        importProgress.update((p) => ({
          ...p,
          backoffSeconds: null,
          steps: [...p.steps.filter((s) => s.label !== step.label), step],
        })),
    });
    await refreshWorld();
    importProgress.update((p) => ({ ...p, running: false, finishedAt: Date.now() }));
    notify(
      `Library read: ${result.entities} items and ${result.memberships} links. Partial results are kept.`,
    );
  } catch (error) {
    const message =
      error instanceof SpotifyApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'The import stopped unexpectedly.';
    importProgress.update((p) => ({ ...p, running: false, error: message }));
    notify(message, { tone: 'warn' });
  } finally {
    running = null;
    refreshSpotifySession();
  }
}

export function cancelImport(): void {
  running?.abort();
  running = null;
  importProgress.update((p) => ({ ...p, running: false }));
}
