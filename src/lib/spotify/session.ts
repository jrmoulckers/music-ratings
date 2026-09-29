import { get, writable } from 'svelte/store';

import { announce, notify } from '../app/notices';
import { refreshWorld, settings, updateSettings } from '../app/state';
import { resolveSpotifyClientId } from '../config';
import {
  beginSignIn,
  forgetTokens,
  hasScopes,
  storedTokens,
  PODCAST_SCOPE,
  PLAYBACK_SCOPES,
  STREAMING_SCOPE,
  BASE_SCOPES,
  type SpotifyConfig,
} from './auth';
import { SpotifyApiError, SpotifyClient } from './client';
import {
  clearSignals,
  importLibrary,
  importListening,
  readSignals,
  type ImportStep,
} from './library';
import { recordListening } from '../listening/record';
import { resetPlayback } from '../playback/store';

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
  /**
   * Connected before this app could control playback. Everything else keeps
   * working; only the player needs a reconnect, and saying so beats a 403.
   */
  missingPlaybackScopes: boolean;
  /** Browser player is switched on, but the sign-in predates that choice. */
  missingStreamingScope: boolean;
}

export interface ImportProgress {
  running: boolean;
  steps: ImportStep[];
  backoffSeconds: number | null;
  error: string | null;
  finishedAt: number | null;
}

const PROFILE_KEY = 'music-ratings.spotify.profile';
const PROFILE_ID_KEY = 'music-ratings.spotify.profile-id';

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
  const connected = Boolean(tokens);
  let wantsBrowserPlayer = false;
  try {
    wantsBrowserPlayer = get(settings).browserPlayer === true;
  } catch {
    /* Settings not loaded yet. Assume the modest answer. */
  }
  return {
    connected,
    profileName: tokens ? storedProfileName() : null,
    scopes: tokens?.scopes ?? [],
    expiresAt: tokens?.expiresAt ?? null,
    missingPodcastScope: connected && !hasScopes(tokens, [PODCAST_SCOPE]),
    missingPlaybackScopes: connected && !hasScopes(tokens, PLAYBACK_SCOPES),
    missingStreamingScope: connected && wantsBrowserPlayer && !hasScopes(tokens, [STREAMING_SCOPE]),
  };
}

export function refreshSpotifySession(): void {
  spotifySession.set(read());
}

/**
 * Turning the browser player on changes what a token has to carry, so the
 * session is re-read whenever that switch moves. Without this, the sentence
 * asking for a reconnect only appeared after a reload, and until then the app
 * kept offering a device the current sign-in cannot drive.
 */
let wantedBrowserPlayer = get(settings).browserPlayer === true;
settings.subscribe((current) => {
  const wants = current.browserPlayer === true;
  if (wants === wantedBrowserPlayer) return;
  wantedBrowserPlayer = wants;
  refreshSpotifySession();
});

export function spotifyConfig(): SpotifyConfig {
  const current = get(settings);
  const wantsPodcasts =
    current.enabledTypes.includes('show') || current.enabledTypes.includes('episode');
  const extra = [
    ...(wantsPodcasts ? [PODCAST_SCOPE] : []),
    ...(current.browserPlayer ? [STREAMING_SCOPE] : []),
  ];
  return {
    clientId: resolveSpotifyClientId(current.spotifyClientId),
    redirectUri: current.spotifyRedirectUri,
    ...(extra.length ? { extraScopes: extra } : {}),
  };
}

export function requestedScopes(): string[] {
  const config = spotifyConfig();
  return [...BASE_SCOPES, ...(config.extraScopes ?? [])];
}

export async function connectSpotify(returnTo = '/settings'): Promise<void> {
  await beginSignIn(spotifyConfig(), returnTo);
}

/** Keep the ratings and play log, but stop presenting another account's signals. */
export async function prepareSpotifyAccount(): Promise<void> {
  let me;
  try {
    me = await new SpotifyClient({ config: spotifyConfig() }).profile();
  } catch (error) {
    await disconnectSpotify();
    throw error;
  }
  const previous = localStorage.getItem(PROFILE_ID_KEY);
  if (previous !== me.id) {
    cancelImport();
    await waitForSpotifyActivity();
    await clearSignals();
    await refreshWorld();
    await updateSettings({ preferredDeviceId: '' });
    resetPlayback();
  }
  localStorage.setItem(PROFILE_ID_KEY, me.id);
  rememberProfileName(me.display_name ?? me.id);
  refreshSpotifySession();
}

export async function disconnectSpotify(): Promise<void> {
  forgetTokens();
  rememberProfileName(null);
  localStorage.removeItem(PROFILE_ID_KEY);
  refreshSpotifySession();
  cancelImport();
  await waitForSpotifyActivity();
  await clearSignals();
  await refreshWorld();
  resetPlayback();
  announce('Spotify disconnected.');
}

let running: AbortController | null = null;
let importTask: Promise<void> | null = null;

export function runImport(): Promise<void> {
  if (importTask) return importTask;
  importTask = performImport().finally(() => {
    importTask = null;
  });
  return importTask;
}

async function performImport(): Promise<void> {
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
    await recordListening(result.recent);
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
}

export async function waitForSpotifyActivity(): Promise<void> {
  await Promise.all([importTask, listeningRun]);
}

/* -------------------------------------------------------------------------- */
/* Listening                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How long the recently-played window stays believable.
 *
 * Short, because the queue's promise is that the thing you just finished is at
 * the top — and a five-minute-old answer to "what did you just play" is already
 * a different answer.
 */
export const LISTENING_STALE_MS = 5 * 60_000;

export interface ListeningStatus {
  running: boolean;
  fetchedAt: number | null;
  error: string | null;
}

export const listeningStatus = writable<ListeningStatus>({
  running: false,
  fetchedAt: null,
  error: null,
});

let listeningRun: Promise<void> | null = null;

export function noteListeningFetchedAt(at: number | null | undefined): void {
  listeningStatus.update((s) =>
    s.fetchedAt === (at ?? null) ? s : { ...s, fetchedAt: at ?? null },
  );
}

/**
 * Re-read the recently-played window.
 *
 * Overlapping calls share one request: entering the page, the auto-refresh and
 * the button can all fire at once and only one of them should reach Spotify.
 */
export async function refreshListening(): Promise<void> {
  if (listeningRun) return listeningRun;
  if (!get(spotifySession).connected) return;

  const task = (async () => {
    listeningStatus.update((s) => ({ ...s, running: true, error: null }));
    try {
      const client = new SpotifyClient({ config: spotifyConfig() });
      const report = await importListening({ client });
      await refreshWorld();
      await recordListening(report.items);
      listeningStatus.set({ running: false, fetchedAt: report.fetchedAt, error: null });
    } catch (error) {
      const message =
        error instanceof SpotifyApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Spotify would not say what you have been playing.';
      listeningStatus.update((s) => ({ ...s, running: false, error: message }));
    } finally {
      listeningRun = null;
      refreshSpotifySession();
    }
  })();

  listeningRun = task;
  return task;
}

/** True when the stored window is old enough to be worth re-reading. */
export function listeningIsStale(fetchedAt: number | null | undefined, now = Date.now()): boolean {
  if (!fetchedAt) return true;
  return now - fetchedAt >= LISTENING_STALE_MS;
}

/**
 * Called when the queue opens. Never awaited by the page: the queue renders
 * from what is already stored and re-sorts itself if a fresher answer arrives.
 */
export function refreshListeningIfStale(): void {
  if (listeningRun || !get(spotifySession).connected) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  void (async () => {
    const stored = await readSignals();
    if (!listeningIsStale(stored?.listeningFetchedAt)) {
      noteListeningFetchedAt(stored?.listeningFetchedAt ?? null);
      return;
    }
    await refreshListening();
  })();
}
