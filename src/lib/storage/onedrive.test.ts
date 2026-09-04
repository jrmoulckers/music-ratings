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
