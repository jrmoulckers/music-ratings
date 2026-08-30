/**
 * Spotify sign-in: Authorization Code with PKCE, entirely in the browser.
 *
 * There is no client secret anywhere in this codebase and there is no server to
 * hold one. PKCE exists precisely so a public client can prove it started the
 * exchange it is finishing.
 */

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const STORAGE_KEY = 'music-ratings:spotify-token';
const VERIFIER_KEY = 'music-ratings:spotify-verifier';
const RETURN_KEY = 'music-ratings:spotify-return';
const STATE_KEY = 'music-ratings:spotify-state';

/**
 * Read-only, and no more than the app actually uses. Playback scopes are
 * deliberately absent: this app never plays anything.
 */
export const BASE_SCOPES = [
  'user-read-private',
  'user-top-read',
  'user-read-recently-played',
  'user-library-read',
  'playlist-read-private',
  'playlist-read-collaborative',
] as const;

/** Only requested when the user enables shows or episodes. */
export const PODCAST_SCOPE = 'user-read-playback-position';

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}

export class SpotifyAuthError extends Error {
  constructor(
    message: string,
    readonly kind: 'denied' | 'expired' | 'config' | 'network' | 'state' = 'network',
  ) {
    super(message);
    this.name = 'SpotifyAuthError';
  }
}

/* -------------------------------------------------------------------------- */
/* PKCE primitives                                                            */
/* -------------------------------------------------------------------------- */

const VERIFIER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

export function randomVerifier(length = 96): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += VERIFIER_ALPHABET[byte % VERIFIER_ALPHABET.length];
  return out;
}

export function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(digest);
}

/* -------------------------------------------------------------------------- */
/* Token storage                                                              */
/* -------------------------------------------------------------------------- */

export function storedTokens(): SpotifyTokens | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SpotifyTokens;
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function storeTokens(tokens: SpotifyTokens): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

export function forgetTokens(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(VERIFIER_KEY);
  localStorage.removeItem(STATE_KEY);
}

export function hasScopes(tokens: SpotifyTokens | null, required: readonly string[]): boolean {
  if (!tokens) return false;
  const granted = new Set(tokens.scopes);
  return required.every((scope) => granted.has(scope));
}

/* -------------------------------------------------------------------------- */
/* The flow                                                                   */
/* -------------------------------------------------------------------------- */

export interface SpotifyConfig {
  clientId: string;
  redirectUri: string;
  /** Extra scopes for optional entity types the user switched on. */
  extraScopes?: readonly string[];
}

export async function beginSignIn(config: SpotifyConfig, returnTo: string): Promise<void> {
  if (!config.clientId) {
    throw new SpotifyAuthError(
      'Add your Spotify client ID in Settings before connecting.',
      'config',
    );
  }
  const verifier = randomVerifier();
  const state = randomVerifier(24);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(RETURN_KEY, returnTo);

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    code_challenge_method: 'S256',
    code_challenge: await challengeFor(verifier),
    state,
    scope: [...BASE_SCOPES, ...(config.extraScopes ?? [])].join(' '),
  });
  location.assign(`${AUTH_URL}?${params.toString()}`);
}

export interface CallbackResult {
  tokens: SpotifyTokens;
  returnTo: string;
}

/** Runs on the redirect back. Returns null when this is not a callback load. */
export async function completeSignIn(config: SpotifyConfig): Promise<CallbackResult | null> {
  const params = new URLSearchParams(location.search);
  const error = params.get('error');
  const code = params.get('code');
  if (!error && !code) return null;

  const returnTo = sessionStorage.getItem(RETURN_KEY) ?? '/';
  sessionStorage.removeItem(RETURN_KEY);

  if (error) {
    sessionStorage.removeItem(VERIFIER_KEY);
    throw new SpotifyAuthError(
      error === 'access_denied'
        ? 'Spotify sign-in was cancelled. Nothing was connected.'
        : `Spotify refused the sign-in (${error}).`,
      'denied',
    );
  }

  const expectedState = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  if (!expectedState || params.get('state') !== expectedState) {
    throw new SpotifyAuthError(
      'That sign-in did not match the request this app started. Try connecting again.',
      'state',
    );
  }

  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  if (!verifier) {
    throw new SpotifyAuthError(
      'This browser lost the sign-in it started. Try connecting again.',
      'state',
    );
  }

  const tokens = await exchange({
    grant_type: 'authorization_code',
    code: code as string,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: verifier,
  });
  storeTokens(tokens);
  return { tokens, returnTo };
}

/**
 * Spotify may or may not hand back a new refresh token. When it does not, the
 * old one stays valid, so overwriting it with `undefined` would sign the user
 * out for no reason.
 */
export async function refresh(
  config: SpotifyConfig,
  tokens: SpotifyTokens,
): Promise<SpotifyTokens> {
  const next = await exchange(
    {
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: config.clientId,
    },
    tokens,
  );
  storeTokens(next);
  return next;
}

async function exchange(
  body: Record<string, string>,
  previous?: SpotifyTokens,
): Promise<SpotifyTokens> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
  } catch {
    throw new SpotifyAuthError(
      'Could not reach Spotify. Check your connection and try again.',
      'network',
    );
  }

  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    // A refresh token lasts six months; after that the user must sign in again.
    if (payload.error === 'invalid_grant') {
      forgetTokens();
      throw new SpotifyAuthError(
        'Your Spotify sign-in expired. Connect again to refresh your library.',
        'expired',
      );
    }
    if (payload.error === 'invalid_client') {
      throw new SpotifyAuthError(
        'Spotify did not recognise that client ID. Check it in Settings, and make sure the redirect URI matches the dashboard exactly.',
        'config',
      );
    }
    throw new SpotifyAuthError(
      payload.error_description ?? `Spotify refused the token request (${response.status}).`,
      'network',
    );
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? previous?.refreshToken ?? '',
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000 - 60_000,
    scopes: payload.scope ? payload.scope.split(' ') : (previous?.scopes ?? [...BASE_SCOPES]),
  };
}

export function describeAuthError(error: unknown): string {
  if (error instanceof SpotifyAuthError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong talking to Spotify.';
}
