/**
 * The application identities this build signs in as.
 *
 * Both values are public, and deliberately so. These are OAuth *public clients*
 * — Spotify via Authorization Code with PKCE, Microsoft via MSAL's
 * single-page-application flow — and neither has a client secret, because
 * neither can keep one. What actually guards them is PKCE plus the redirect-URI
 * allowlist held by the provider, so an ID sitting in a public repository grants
 * a stranger nothing they could not already ask for.
 *
 * Shipping them is the whole difference between "sign in" and "first, go and
 * register two developer applications". Everyone still signs in with their own
 * account, reads their own library, and writes to their own OneDrive; the client
 * ID only says which application is doing the asking.
 *
 * Two escape hatches, in this order of precedence:
 *
 * 1. A user who would rather ask as themselves puts their own ID in Settings.
 *    That override always wins — see `resolveSpotifyClientId` and friends.
 * 2. A deployer who would rather not use these sets the matching `VITE_`
 *    variable at build time.
 *
 * An empty `VITE_` value means "not supplied" rather than "no identity". CI
 * passes an unset repository variable through as an empty string, and an empty
 * string that switched sign-in off for everyone would be a very quiet way to
 * break the app. Shipping no identity at all is done by emptying the constants
 * below, which is deliberate and visible in a diff.
 */

/**
 * Spotify. In development mode Spotify authorises a small fixed number of
 * accounts, each added by hand in the dashboard, so this covers the people
 * listed there and nobody else. Anyone turned away can register their own app
 * and paste its ID into Settings.
 */
const BUILT_IN_SPOTIFY_CLIENT_ID = '53f6a5ae01404152ac906a34ea46d533';

export const SPOTIFY_CLIENT_ID = (
  import.meta.env.VITE_SPOTIFY_CLIENT_ID?.trim() || BUILT_IN_SPOTIFY_CLIENT_ID
).trim();

/**
 * Microsoft. Registered for any organisational directory *and* personal
 * Microsoft accounts, so an ordinary consumer OneDrive can sign in without an
 * administrator being involved.
 */
const BUILT_IN_ONEDRIVE_CLIENT_ID = '11fee807-4dbe-43d0-82a2-0bd8cc471207';

export const ONEDRIVE_CLIENT_ID = (
  import.meta.env.VITE_ONEDRIVE_CLIENT_ID?.trim() || BUILT_IN_ONEDRIVE_CLIENT_ID
).trim();

/**
 * The user's own ID if they gave one, otherwise this build's.
 *
 * Kept as one function per provider rather than one shared helper so that the
 * fallback is visible at each call site: an empty override is not a
 * configuration error, it is the ordinary case.
 */
export function resolveSpotifyClientId(override: string | undefined): string {
  return (override ?? '').trim() || SPOTIFY_CLIENT_ID;
}

export function resolveOneDriveClientId(override: string | undefined): string {
  return (override ?? '').trim() || ONEDRIVE_CLIENT_ID;
}

/** Whether this build can offer sign-in without the user configuring anything. */
export const HAS_BUILT_IN_SPOTIFY = SPOTIFY_CLIENT_ID.length > 0;
export const HAS_BUILT_IN_ONEDRIVE = ONEDRIVE_CLIENT_ID.length > 0;
