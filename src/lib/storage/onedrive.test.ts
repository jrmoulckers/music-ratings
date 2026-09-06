import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Where an account round trip comes back to.
 *
 * Microsoft matches a redirect URI character for character against a list
 * someone typed into a portal. The old configuration derived it from
 * `location.pathname`, so the address changed with whatever page you happened
 * to press Connect on — every route would have needed registering, and the one
 * page that actually finishes the exchange was not among them.
 *
 * These fence both halves: one fixed address under any deployment base, and a
 * completion that reports success on its own terms rather than on whether the
 * return path happened to survive.
 */

const handleRedirectPromise = vi.fn();
const setActiveAccount = vi.fn();
const loginRedirect = vi.fn();
let captured: { auth: Record<string, unknown> } | null = null;

vi.mock('@azure/msal-browser', () => ({
  PublicClientApplication: class {
    constructor(config: { auth: Record<string, unknown> }) {
      captured = config;
    }
    initialize = vi.fn(async () => {});
    handleRedirectPromise = handleRedirectPromise;
    setActiveAccount = setActiveAccount;
    getActiveAccount = vi.fn(() => null);
    getAllAccounts = vi.fn(() => []);
    loginRedirect = loginRedirect;
  },
}));

const CONFIG = { clientId: 'client-id', fileName: 'music-ratings.json' };

async function load(base: string) {
  vi.resetModules();
  vi.stubEnv('BASE_URL', base);
  return await import('./onedrive');
}

beforeAll(async () => {
  // Every test reloads the module to re-read the deployment base, and the first
  // load pays for transforming the whole storage graph. Pay it here, on the
  // hook's budget, so a cold run does not look like a hang.
  await import('./onedrive');
});

beforeEach(() => {
  captured = null;
  handleRedirectPromise.mockReset();
  setActiveAccount.mockReset();
  loginRedirect.mockReset();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the address Microsoft comes back to', () => {
  it('is the callback route at the site root', async () => {
    const { completeRedirect } = await load('/');
    handleRedirectPromise.mockResolvedValue(null);
    await completeRedirect(CONFIG);

    expect(captured?.auth.redirectUri).toBe('https://rank.jrmoulckers.com/callback');
  });

  it('carries the deployment base on a project subpath', async () => {
    const { completeRedirect } = await load('/music-ratings/');
    handleRedirectPromise.mockResolvedValue(null);
    await completeRedirect(CONFIG);

    expect(captured?.auth.redirectUri).toBe(`${location.origin}/music-ratings/callback`);
  });

  it('does not change with the page sign-in was started from', async () => {
    const { completeRedirect, signIn } = await load('/music-ratings/');
    handleRedirectPromise.mockResolvedValue(null);
    history.replaceState({}, '', '/music-ratings/settings');
    await signIn(CONFIG, '/settings');
    const fromSettings = captured?.auth.redirectUri;

    await completeRedirect(CONFIG);
    expect(fromSettings).toBe(`${location.origin}/music-ratings/callback`);
    expect(captured?.auth.redirectUri).toBe(fromSettings);
  });

  it('lets the callback route finish the exchange rather than bouncing back', async () => {
    const { completeRedirect } = await load('/');
    handleRedirectPromise.mockResolvedValue(null);
    await completeRedirect(CONFIG);

    expect(handleRedirectPromise).toHaveBeenCalledWith({ navigateToLoginRequestUrl: false });
  });

  it('refuses to build a client without an application id', async () => {
    const { completeRedirect, OneDriveNotConfiguredError } = await load('/');
    await expect(completeRedirect({ ...CONFIG, clientId: '' })).rejects.toBeInstanceOf(
      OneDriveNotConfiguredError,
    );
  });
});

describe('coming back from Microsoft', () => {
  it('reports the account and the page to return to', async () => {
    const { completeRedirect, signIn } = await load('/music-ratings/');
    handleRedirectPromise.mockResolvedValue(null);
    await signIn(CONFIG, '/settings');

    const account = { username: 'someone@example.com' };
    handleRedirectPromise.mockResolvedValue({ account });
    const result = await completeRedirect(CONFIG);

    expect(result).toEqual({ account: 'someone@example.com', returnTo: '/settings' });
    expect(setActiveAccount).toHaveBeenCalledWith(account);
  });

  it('still reports success when the return path did not survive', async () => {
    const { completeRedirect } = await load('/');
    handleRedirectPromise.mockResolvedValue({ account: { username: 'someone@example.com' } });

    const result = await completeRedirect(CONFIG);
    expect(result?.account).toBe('someone@example.com');
    expect(result?.returnTo).toBe(null);
  });

  it('says nothing happened when there was nothing to finish', async () => {
    const { completeRedirect } = await load('/');
    handleRedirectPromise.mockResolvedValue(null);

    expect(await completeRedirect(CONFIG)).toBe(null);
  });

  it('consumes the return path so a reload cannot replay it', async () => {
    const { completeRedirect, signIn } = await load('/');
    handleRedirectPromise.mockResolvedValue(null);
    await signIn(CONFIG, '/settings');
    handleRedirectPromise.mockResolvedValue({ account: { username: 'a@b.c' } });

    await completeRedirect(CONFIG);
    expect(await completeRedirect(CONFIG)).toEqual({ account: 'a@b.c', returnTo: null });
  });
});

/**
 * Where the backup lives, and what that costs in permission.
 *
 * The sandboxed app folder is the default precisely because it is the one
 * arrangement where this app cannot read anything else. Choosing your own folder
 * is a real trade — Graph has no way to scope a delegated grant to one folder,
 * so it necessarily means read and write over the drive — and these fence the
 * rule that the wider grant is asked for only by the mode that needs it.
 */
describe('the folder the backup lives in', () => {
  it('asks only for the sandbox when using the app folder', async () => {
    const { scopesFor } = await load('/');
    expect(scopesFor(CONFIG)).toEqual(['Files.ReadWrite.AppFolder', 'User.Read']);
    expect(scopesFor({ ...CONFIG, folderMode: 'app' })).toEqual([
      'Files.ReadWrite.AppFolder',
      'User.Read',
    ]);
  });

  it('asks for the drive only when the user named their own folder', async () => {
    const { scopesFor } = await load('/');
    expect(scopesFor({ ...CONFIG, folderMode: 'custom', customPath: 'Documents' })).toEqual([
      'Files.ReadWrite',
      'User.Read',
    ]);
  });

  it('signs in with the scopes the chosen mode needs', async () => {
    const { signIn } = await load('/');
    handleRedirectPromise.mockResolvedValue(null);

    await signIn({ ...CONFIG, folderMode: 'custom', customPath: 'Music' }, '/settings');
    expect(loginRedirect).toHaveBeenCalledWith({
      scopes: ['Files.ReadWrite', 'User.Read'],
    });
  });

  it('addresses the sandboxed app folder by default', async () => {
    const { oneDrivePaths } = await load('/');
    expect(oneDrivePaths(CONFIG)).toEqual({
      content: '/me/drive/special/approot:/music-ratings.json:/content',
      meta: '/me/drive/special/approot:/music-ratings.json',
      children: '/me/drive/special/approot/children',
    });
  });

  it('addresses a nested folder from the drive root', async () => {
    const { oneDrivePaths } = await load('/');
    expect(
      oneDrivePaths({ ...CONFIG, folderMode: 'custom', customPath: 'Documents/Music Ratings' }),
    ).toEqual({
      content: '/me/drive/root:/Documents/Music%20Ratings/music-ratings.json:/content',
      meta: '/me/drive/root:/Documents/Music%20Ratings/music-ratings.json',
      children: '/me/drive/root:/Documents/Music%20Ratings:/children',
    });
  });

  it('treats an empty custom path as the drive root', async () => {
    const { oneDrivePaths } = await load('/');
    expect(oneDrivePaths({ ...CONFIG, folderMode: 'custom', customPath: '  ' })).toEqual({
      content: '/me/drive/root:/music-ratings.json:/content',
      meta: '/me/drive/root:/music-ratings.json',
      children: '/me/drive/root/children',
    });
  });

  /**
   * A path is a destination, never a way to climb out of one. `..` is dropped
   * rather than resolved, so no amount of typing reaches a parent the user did
   * not name.
   */
  it('refuses to let a path climb out of the folder it names', async () => {
    const { oneDrivePaths } = await load('/');
    const paths = oneDrivePaths({
      ...CONFIG,
      folderMode: 'custom',
      customPath: '/../../Documents//./Music/',
    });
    expect(paths.children).toBe('/me/drive/root:/Documents/Music:/children');
  });
});
