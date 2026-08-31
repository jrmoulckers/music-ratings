import { flushSync, mount, unmount } from 'svelte';
import { get, writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clampStep,
  clearOnboardingDraft,
  isOnboardingReturn,
  onboardingResumePath,
  patchOnboardingDraft,
  readOnboardingDraft,
  saveOnboardingDraft,
} from '../lib/app/onboarding';
import { safeInAppPath } from '../lib/app/router';

/**
 * The front door's state machine.
 *
 * Setup asks three questions, and connecting Spotify answers one of them by
 * leaving the app entirely. The thing that kept going wrong is the temptation
 * to call that trip "finished": the flag that means *setup is over* was being
 * set before questions two and three were ever asked, so the user was dropped
 * into the app having never chosen what to rate or on what scale.
 *
 * These prove the corrected rule from both ends. Only the last page can end
 * setup, the trip through Spotify comes back into the middle of it with the
 * answers so far intact, and a destination that has been outside this origin
 * cannot be used to leave it.
 */

const connectCalls: string[] = [];
const spotifySession = writable({ connected: false, profileName: null as string | null });

vi.mock('../lib/spotify/session', () => ({
  get spotifySession() {
    return spotifySession;
  },
  connectSpotify: async (returnTo: string) => void connectCalls.push(returnTo),
  refreshSpotifySession: () => undefined,
  runImport: async () => void 0,
  spotifyConfig: () => ({ clientId: 'cid', redirectUri: 'http://localhost/callback' }),
}));

type SignInResult = { tokens: unknown; returnTo: string } | null;
const signIn = vi.fn(async (): Promise<SignInResult> => null);

vi.mock('../lib/spotify/auth', () => ({
  completeSignIn: () => signIn(),
  describeAuthError: (error: unknown) =>
    error instanceof Error ? error.message : 'Sign-in failed.',
}));

vi.mock('../lib/storage/onedrive', () => ({
  completeRedirect: async () => null,
}));

vi.mock('../lib/app/sync', () => ({
  oneDriveConfig: () => ({ clientId: '', redirectUri: '' }),
  startSyncIfEnabled: async () => undefined,
}));

const Onboarding = (await import('../pages/Onboarding.svelte')).default;
const Callback = (await import('../pages/Callback.svelte')).default;
const { settings, updateSettings, loadAll } = await import('../lib/app/state');
const { navigate, startRouter } = await import('../lib/app/router');

let stopRouter: (() => void) | null = null;

let host: HTMLDivElement | null = null;
let app: unknown = null;

function render(component: unknown) {
  host = document.createElement('div');
  document.body.appendChild(host);
  app = mount(component as never, { target: host });
  flushSync();
  return host;
}

function text(): string {
  return host?.textContent?.replace(/\s+/g, ' ') ?? '';
}

function click(name: RegExp): void {
  const found = [...(host?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) =>
    name.test((b.textContent ?? '').replace(/\s+/g, ' ').trim()),
  );
  if (!found) throw new Error(`no control called ${name}`);
  found.click();
  flushSync();
}

/** Wait for the page's own promises to settle, including storage round trips. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  }
}

beforeEach(async () => {
  connectCalls.length = 0;
  signIn.mockReset();
  signIn.mockResolvedValue(null);
  spotifySession.set({ connected: false, profileName: null });
  sessionStorage.clear();
  await loadAll();
  await updateSettings({ onboarded: false, spotifyClientId: '', enabledTypes: ['artist'] });
  navigate('/start', { replace: true });
  stopRouter = startRouter();
});

afterEach(() => {
  stopRouter?.();
  stopRouter = null;
  if (app) unmount(app as never, { outro: false });
  app = null;
  host?.remove();
  host = null;
});

describe('the setup draft', () => {
  it('survives a round trip and comes back exactly as it went', () => {
    saveOnboardingDraft({
      step: 1,
      types: ['artist', 'album'],
      scaleId: 'stars-5',
      clientId: 'abc',
      connecting: true,
      spotifyConnected: false,
    });
    expect(readOnboardingDraft()).toEqual({
      step: 1,
      types: ['artist', 'album'],
      scaleId: 'stars-5',
      clientId: 'abc',
      connecting: true,
      spotifyConnected: false,
    });
  });

  it('treats anything it cannot fully understand as absent', () => {
    sessionStorage.setItem('music-ratings:onboarding', 'not json at all');
    expect(readOnboardingDraft()).toBeNull();

    sessionStorage.setItem('music-ratings:onboarding', JSON.stringify({ v: 99, step: 2 }));
    expect(readOnboardingDraft()).toBeNull();

    sessionStorage.setItem('music-ratings:onboarding', JSON.stringify('a string'));
    expect(readOnboardingDraft()).toBeNull();
  });

  it('drops entity types it has never heard of rather than carrying them in', () => {
    sessionStorage.setItem(
      'music-ratings:onboarding',
      JSON.stringify({ v: 1, step: 1, types: ['artist', 'sandwich', 42] }),
    );
    expect(readOnboardingDraft()?.types).toEqual(['artist']);
  });

  it('clamps a step to a page that exists', () => {
    expect(clampStep(-4)).toBe(0);
    expect(clampStep(99)).toBe(2);
    expect(clampStep('1')).toBe(1);
    expect(clampStep('nonsense')).toBe(0);
    expect(clampStep(undefined)).toBe(0);
    expect(onboardingResumePath(99)).toBe('/start?step=2');
  });

  it('patches without needing to be read first, and clears completely', () => {
    patchOnboardingDraft({ scaleId: 'tiers' });
    expect(readOnboardingDraft()?.scaleId).toBe('tiers');
    patchOnboardingDraft({ connecting: true });
    expect(readOnboardingDraft()).toMatchObject({ scaleId: 'tiers', connecting: true });
    clearOnboardingDraft();
    expect(readOnboardingDraft()).toBeNull();
  });

  it('decides a return belongs to setup from the trip, not from the flag', () => {
    expect(isOnboardingReturn('/start?step=1')).toBe(true);
    expect(isOnboardingReturn('/settings')).toBe(false);
    expect(isOnboardingReturn('/now-playing')).toBe(false);

    // A failed exchange consumes the return target; the draft answers instead.
    patchOnboardingDraft({ connecting: true });
    expect(isOnboardingReturn('')).toBe(true);
    patchOnboardingDraft({ connecting: false });
    expect(isOnboardingReturn('')).toBe(false);
  });

  it('does not let a stale setup draft claim a Settings reconnect', () => {
    patchOnboardingDraft({ connecting: true });
    expect(isOnboardingReturn('/settings')).toBe(false);
  });
});

describe('a destination that came back from somewhere else', () => {
  it('keeps paths this app actually routes', () => {
    expect(safeInAppPath('/settings')).toBe('/settings');
    expect(safeInAppPath('/start?step=1')).toBe('/start?step=1');
    expect(safeInAppPath('/now-playing')).toBe('/now-playing');
  });

  it('refuses anything that would leave the app', () => {
    expect(safeInAppPath('//evil.example.com/steal')).toBe('/');
    expect(safeInAppPath('https://evil.example.com')).toBe('/');
    expect(safeInAppPath('javascript:alert(1)')).toBe('/');
    expect(safeInAppPath('/\\evil.example.com')).toBe('/');
    expect(safeInAppPath('')).toBe('/');
    expect(safeInAppPath(null)).toBe('/');
    expect(safeInAppPath(undefined, '/settings')).toBe('/settings');
  });

  it('refuses a path with no route rather than showing a dead end', () => {
    expect(safeInAppPath('/not-a-page-here', '/start?step=1')).toBe('/start?step=1');
  });
});

describe('choosing Spotify at the front door', () => {
  it('does not decide setup is finished', async () => {
    render(Onboarding);
    const input = host!.querySelector('input.input') as HTMLInputElement;
    input.value = 'client-abc';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    click(/Connect and authorise/);
    await settle();

    expect(get(settings).onboarded).toBe(false);
    expect(get(settings).spotifyClientId).toBe('client-abc');
  });

  it('leaves with a continuation that comes back into the middle of setup', async () => {
    render(Onboarding);
    const input = host!.querySelector('input.input') as HTMLInputElement;
    input.value = 'client-abc';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    click(/Connect and authorise/);
    await settle();

    expect(connectCalls).toEqual(['/start?step=1']);
    expect(readOnboardingDraft()).toMatchObject({
      step: 1,
      connecting: true,
      clientId: 'client-abc',
    });
  });

  it('will not start a sign-in with no client ID to sign in with', async () => {
    render(Onboarding);
    click(/Connect and authorise/);
    await settle();
    expect(connectCalls).toEqual([]);
    expect(get(settings).onboarded).toBe(false);
  });
});

describe('coming back from Spotify', () => {
  it('resumes setup on page two with the answers so far intact', async () => {
    saveOnboardingDraft({
      step: 1,
      types: ['album', 'track'],
      scaleId: 'tiers',
      clientId: 'client-abc',
      connecting: true,
      spotifyConnected: false,
    });
    signIn.mockResolvedValue({ tokens: {}, returnTo: '/start?step=1' });
    spotifySession.set({ connected: true, profileName: 'Jane' });

    render(Callback);
    await settle();

    expect(get(settings).onboarded).toBe(false);
    expect(location.pathname + location.search).toBe('/start?step=1');
    expect(readOnboardingDraft()).toMatchObject({
      step: 1,
      types: ['album', 'track'],
      scaleId: 'tiers',
      connecting: false,
      spotifyConnected: true,
    });
  });

  it('shows page two, with the connection confirmed and the answers restored', async () => {
    saveOnboardingDraft({
      step: 1,
      types: ['album', 'track'],
      scaleId: 'tiers',
      clientId: 'client-abc',
      connecting: false,
      spotifyConnected: true,
    });
    spotifySession.set({ connected: true, profileName: 'Jane' });
    navigate('/start?step=1', { replace: true });

    render(Onboarding);
    expect(text()).toContain('What do you want to rate?');
    expect(text()).toContain('Spotify connected as Jane');

    const checked = [...host!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].filter(
      (b) => b.checked,
    );
    expect(checked).toHaveLength(2);
  });

  it('sends a Settings reconnect back to Settings, still onboarded', async () => {
    await updateSettings({ onboarded: true });
    signIn.mockResolvedValue({ tokens: {}, returnTo: '/settings' });

    render(Callback);
    await settle();

    expect(get(settings).onboarded).toBe(true);
    expect(location.pathname).toBe('/settings');
    expect(readOnboardingDraft()).toBeNull();
  });

  it('sends a Now Playing reconnect back to Now Playing', async () => {
    await updateSettings({ onboarded: true });
    signIn.mockResolvedValue({ tokens: {}, returnTo: '/now-playing' });

    render(Callback);
    await settle();

    expect(get(settings).onboarded).toBe(true);
    expect(location.pathname).toBe('/now-playing');
  });

  it('will not follow a continuation that points off this origin', async () => {
    await updateSettings({ onboarded: true });
    signIn.mockResolvedValue({ tokens: {}, returnTo: '//evil.example.com/take-my-tokens' });

    render(Callback);
    await settle();

    expect(location.host).toBe('localhost:3000');
    expect(location.pathname).toBe('/settings');
  });

  it('cannot be used to skip the rest of setup', async () => {
    saveOnboardingDraft({
      step: 1,
      types: [],
      scaleId: '',
      clientId: '',
      connecting: true,
      spotifyConnected: false,
    });
    // A tampered continuation aiming straight at the app.
    signIn.mockResolvedValue({ tokens: {}, returnTo: '/rankings' });

    render(Callback);
    await settle();

    // Still not onboarded, so the app's own guard sends them back to setup.
    expect(get(settings).onboarded).toBe(false);
  });

  it('offers to carry on with setup when Spotify refuses', async () => {
    saveOnboardingDraft({
      step: 1,
      types: ['artist'],
      scaleId: 'stars-5',
      clientId: 'client-abc',
      connecting: true,
      spotifyConnected: false,
    });
    signIn.mockRejectedValue(new Error('Spotify sign-in was cancelled. Nothing was connected.'));

    render(Callback);
    await settle();

    expect(text()).toContain('cancelled');
    expect(text()).toContain('Carry on without Spotify');
    expect(text()).not.toContain('Back to settings');

    click(/Carry on without Spotify/);
    expect(location.pathname + location.search).toBe('/start?step=1');
    // The answers already given are still there to come back to.
    expect(readOnboardingDraft()).toMatchObject({ types: ['artist'], connecting: false });
  });

  it('offers Settings when the failed connection had nothing to do with setup', async () => {
    await updateSettings({ onboarded: true });
    signIn.mockRejectedValue(new Error('Spotify refused the sign-in (server_error).'));

    render(Callback);
    await settle();

    expect(text()).toContain('Back to settings');
    expect(text()).not.toContain('Carry on without Spotify');
  });

  it('sends a refresh of the callback with nothing to finish back to setup', async () => {
    saveOnboardingDraft({
      step: 2,
      types: ['artist'],
      scaleId: 'stars-5',
      clientId: '',
      connecting: false,
      spotifyConnected: true,
    });
    signIn.mockResolvedValue(null);

    render(Callback);
    await settle();

    expect(location.pathname + location.search).toBe('/start?step=2');
    expect(get(settings).onboarded).toBe(false);
  });
});

describe('walking the three pages', () => {
  it('only ends setup at the end, and clears the draft when it does', async () => {
    navigate('/start', { replace: true });
    render(Onboarding);

    expect(text()).toContain('Connect your music');
    click(/Set up without Spotify/);
    expect(get(settings).onboarded).toBe(false);
    expect(text()).toContain('What do you want to rate?');

    const album = [...host!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
      (b) => /release/i.test(b.closest('li')?.textContent ?? ''),
    )!;
    album.click();
    flushSync();

    click(/Continue/);
    expect(get(settings).onboarded).toBe(false);
    expect(text()).toContain('Pick a scale');

    const tiers = [...host!.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(
      (r) => r.value === 'tiers',
    )!;
    tiers.click();
    flushSync();

    click(/Start rating/);
    await settle();

    expect(get(settings).onboarded).toBe(true);
    expect(get(settings).defaultScaleId).toBe('tiers');
    expect(get(settings).enabledTypes).toContain('album');
    expect(readOnboardingDraft()).toBeNull();
    expect(location.pathname).toBe('/');
  });

  it('walks backwards through the browser, not just the buttons', async () => {
    navigate('/start', { replace: true });
    render(Onboarding);

    click(/Set up without Spotify/);
    expect(text()).toContain('What do you want to rate?');
    click(/Continue/);
    expect(text()).toContain('Pick a scale');

    history.back();
    await new Promise((r) => setTimeout(r, 50));
    flushSync();
    expect(text()).toContain('What do you want to rate?');
  });

  it('clamps a step someone typed into the address bar', () => {
    navigate('/start?step=98', { replace: true });
    render(Onboarding);
    expect(text()).toContain('Pick a scale');
  });
});
