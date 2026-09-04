import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ONEDRIVE_CLIENT_ID,
  SPOTIFY_CLIENT_ID,
  resolveOneDriveClientId,
  resolveSpotifyClientId,
} from '../lib/config';
import { hydrateSettings, normalizeFolderPath, defaultSettings } from '../lib/storage/settings';

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * Who the app signs in as.
 *
 * The change these fence is the difference between "sign in" and "first,
 * register two developer applications". The build ships an identity, so an empty
 * setting is the ordinary case rather than a missing answer — and a user who
 * wants to ask as themselves must still be able to, without their choice being
 * quietly overwritten by the build's.
 */

describe('which application the app signs in as', () => {
  it('ships an identity for both providers', () => {
    expect(SPOTIFY_CLIENT_ID).not.toBe('');
    expect(ONEDRIVE_CLIENT_ID).not.toBe('');
  });

  it('uses the built-in identity when nothing was configured', () => {
    expect(resolveSpotifyClientId('')).toBe(SPOTIFY_CLIENT_ID);
    expect(resolveSpotifyClientId(undefined)).toBe(SPOTIFY_CLIENT_ID);
    expect(resolveOneDriveClientId('')).toBe(ONEDRIVE_CLIENT_ID);
    expect(resolveOneDriveClientId(undefined)).toBe(ONEDRIVE_CLIENT_ID);
  });

  it("lets the user's own registration win", () => {
    expect(resolveSpotifyClientId('mine')).toBe('mine');
    expect(resolveOneDriveClientId('mine')).toBe('mine');
  });

  it('treats whitespace as no answer at all', () => {
    expect(resolveSpotifyClientId('   ')).toBe(SPOTIFY_CLIENT_ID);
    expect(resolveOneDriveClientId('\t')).toBe(ONEDRIVE_CLIENT_ID);
  });

  /**
   * CI passes an unset repository variable through as an empty string, so an
   * empty build variable has to mean "not supplied" rather than "no identity".
   * Reading it as the latter would switch sign-in off for everyone on the next
   * deploy, silently and with nothing in the diff to explain it.
   */
  it('keeps its identity when the build variable is set but empty', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', '');
    vi.stubEnv('VITE_ONEDRIVE_CLIENT_ID', '   ');
    const reloaded = await import('../lib/config');

    expect(reloaded.SPOTIFY_CLIENT_ID).toBe(SPOTIFY_CLIENT_ID);
    expect(reloaded.ONEDRIVE_CLIENT_ID).toBe(ONEDRIVE_CLIENT_ID);
    expect(reloaded.HAS_BUILT_IN_SPOTIFY).toBe(true);
    expect(reloaded.HAS_BUILT_IN_ONEDRIVE).toBe(true);
    vi.unstubAllEnvs();
  });

  it('takes a build variable that actually names an application', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', 'from-ci');
    const reloaded = await import('../lib/config');

    expect(reloaded.SPOTIFY_CLIENT_ID).toBe('from-ci');
    // A user's own ID still outranks the build's.
    expect(reloaded.resolveSpotifyClientId('mine')).toBe('mine');
    vi.unstubAllEnvs();
  });

  /**
   * The override must default to empty rather than to a copy of the built-in
   * value. Seeding it would freeze the device on whatever the ID was the day
   * setup ran, and a later change to the shipped identity would never reach it.
   */
  it('starts with no override stored', () => {
    const fresh = defaultSettings();
    expect(fresh.spotifyClientId).toBe('');
    expect(fresh.onedriveClientId).toBe('');
  });

  it('keeps an override a returning user already had', () => {
    const stored = hydrateSettings({ spotifyClientId: 'theirs', onedriveClientId: 'theirs-too' });
    expect(resolveSpotifyClientId(stored.spotifyClientId)).toBe('theirs');
    expect(resolveOneDriveClientId(stored.onedriveClientId)).toBe('theirs-too');
  });
});

describe('the folder a backup is written to', () => {
  it('defaults to the sandboxed app folder', () => {
    const fresh = defaultSettings();
    expect(fresh.onedriveFolderMode).toBe('app');
    expect(fresh.onedriveCustomPath).toBe('');
  });

  it('only accepts a folder mode it understands', () => {
    expect(hydrateSettings({ onedriveFolderMode: 'custom' }).onedriveFolderMode).toBe('custom');
    // Anything unrecognised falls back to the sandbox, never to the wider grant.
    expect(
      hydrateSettings({ onedriveFolderMode: 'anything else' as never }).onedriveFolderMode,
    ).toBe('app');
    expect(hydrateSettings({}).onedriveFolderMode).toBe('app');
  });

  it('reduces a typed path to plain folder names', () => {
    expect(normalizeFolderPath('Documents/Music')).toBe('Documents/Music');
    expect(normalizeFolderPath('/Documents//Music/')).toBe('Documents/Music');
    expect(normalizeFolderPath('  Documents \\ Music  ')).toBe('Documents/Music');
    expect(normalizeFolderPath('')).toBe('');
    expect(normalizeFolderPath(undefined)).toBe('');
    expect(normalizeFolderPath(42)).toBe('');
  });

  it('drops segments that would climb out of the named folder', () => {
    expect(normalizeFolderPath('../../secrets')).toBe('secrets');
    expect(normalizeFolderPath('./Documents/../Music')).toBe('Documents/Music');
  });

  it('replaces characters OneDrive refuses in a name', () => {
    expect(normalizeFolderPath('Mu:si*c?')).toBe('Mu-si-c-');
    expect(normalizeFolderPath('a<b>c|d"e')).toBe('a-b-c-d-e');
  });
});
