import { flushSync, mount, settled, unmount } from 'svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AutoLoad from '../components/AutoLoad.svelte';
import SearchOverlay from '../components/SearchOverlay.svelte';
import Library from '../pages/Library.svelte';
import Home from '../pages/Home.svelte';
import Rankings from '../pages/Rankings.svelte';
import EntityPage from '../pages/Entity.svelte';
import SearchNavigationHarness from './SearchNavigationHarness.svelte';
import { navigate, route, startRouter } from '../lib/app/router';
import { closeSearch, searchOpen } from '../lib/app/search-overlay';
import { settings, world } from '../lib/app/state';
import { makeEntity, rate } from './fixtures';

vi.mock('../lib/app/pwa', () => ({
  pwa: {
    subscribe: (run: (value: { installable: boolean }) => void) => {
      run({ installable: false });
      return () => {};
    },
  },
  installApp: vi.fn(),
}));

let host: HTMLDivElement;
let app: ReturnType<typeof mount> | null = null;
const initialSettings = get(settings);
const initialWorld = get(world);

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  settings.set({ ...initialSettings, enabledTypes: ['track', 'album'], syncEnabled: false });
  world.set({ ...initialWorld, entities: [], ratings: [], memberships: [], comparisons: [] });
});

afterEach(async () => {
  if (app) await unmount(app, { outro: false });
  host.remove();
  app = null;
  settings.set(initialSettings);
  world.set(initialWorld);
  closeSearch();
  vi.unstubAllGlobals();
});

describe('concise core surfaces', () => {
  it('does not promise offline sync when sync is disabled', () => {
    app = mount(Home, { target: host, props: { online: false } });
    flushSync();
    expect(host.textContent).toContain('Offline · saved on this device. Sync is off.');
    expect(host.textContent).not.toContain('sent when you reconnect');
  });

  it('offers real setup, never a fabricated catalogue, in an empty library', () => {
    app = mount(Library, { target: host, props: { query: new URLSearchParams() } });
    flushSync();
    expect(host.textContent).toContain('add an item by hand');
    expect(host.textContent).not.toContain('demo catalogue');
  });

  it('calls a filtered library empty state a filter result, not an empty library', () => {
    const track = makeEntity('track', 'unrated');
    world.set({ ...get(world), entities: [track] });
    app = mount(Library, { target: host, props: { query: new URLSearchParams('rated=1') } });
    flushSync();
    expect(host.textContent).toContain('No matches');
    expect(host.querySelector('.slip')).toBeNull();
  });

  it('keeps advanced ranking filters closed but available', () => {
    const album = makeEntity('album', 'rated');
    world.set({ ...get(world), entities: [album], ratings: [rate(album, 80)] });
    app = mount(Rankings, { target: host, props: { query: new URLSearchParams() } });
    flushSync();
    const filters = [...host.querySelectorAll('details')].find((details) =>
      details.querySelector('summary')?.textContent?.includes('More filters'),
    );
    expect(filters?.open).toBe(false);
    expect(filters?.querySelectorAll('input[type="range"]')).toHaveLength(2);
    const explicit = filters?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    explicit!.checked = true;
    explicit!.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(filters?.querySelector('summary')?.textContent).toContain('active');
    expect(host.querySelector('.slip')).not.toBeNull();
  });

  it('keeps search focus inside the modal and restores its opener', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    app = mount(SearchOverlay, { target: host });
    flushSync();
    await Promise.resolve();
    const input = host.querySelector<HTMLInputElement>('#overlay-search')!;
    expect(document.activeElement).toBe(input);
    const close = host.querySelector<HTMLButtonElement>('.panel__bar button')!;
    Object.defineProperty(input, 'offsetParent', { value: host });
    Object.defineProperty(close, 'offsetParent', { value: host });
    close.focus();
    close.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(input);
    await unmount(app, { outro: false });
    app = null;
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('dismisses disconnected search and focuses Settings when connecting Spotify', async () => {
    vi.stubGlobal('scrollTo', vi.fn());
    navigate('/');
    const stopRouter = startRouter();
    try {
      app = mount(SearchNavigationHarness, { target: host });
      flushSync();
      const opener = host.querySelector<HTMLButtonElement>('main button')!;
      opener.focus();
      opener.click();
      flushSync();
      await Promise.resolve();
      const input = host.querySelector<HTMLInputElement>('#overlay-search')!;
      input.value = 'a track';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
      const connect = host.querySelector<HTMLAnchorElement>('.panel__group a')!;
      connect.focus();
      connect.click();
      flushSync();
      await settled();
      flushSync();

      expect(get(route).name).toBe('settings');
      expect(get(searchOpen)).toBe(false);
      expect(host.querySelector('[aria-modal="true"]')).toBeNull();
      expect(host.querySelector('main h1')?.textContent).toBe('Settings');
      await vi.waitFor(() => expect(document.activeElement).toBe(host.querySelector('main')));
    } finally {
      stopRouter();
    }
  });

  it.each([false, true])(
    'respects explanation defaults (%s) without opening editing controls',
    (open) => {
      settings.update((current) => ({ ...current, showExplanations: open }));
      const track = makeEntity('track', 'explanation');
      world.set({ ...get(world), entities: [track], ratings: [rate(track, 80)] });
      app = mount(EntityPage, {
        target: host,
        props: { params: { type: 'track', provider: 'local', id: track.providerId } },
      });
      flushSync();
      const disclosure = (label: string) =>
        [...host.querySelectorAll('details')].find(
          (details) => details.querySelector('summary')?.textContent?.trim() === label,
        );
      expect(disclosure('How this score was reached')?.open).toBe(open);
      expect(disclosure('Details')?.open).toBe(open);
      expect(disclosure('Note & confidence')?.open).toBe(false);
      expect(disclosure('Notes & tags')?.open).toBe(false);
      expect(disclosure('Rating history · 1 entries')?.open).toBe(false);
    },
  );

  it.each([false, true])('respects explanation defaults (%s) in library score help', (open) => {
    settings.update((current) => ({ ...current, showExplanations: open }));
    app = mount(Library, { target: host, props: { query: new URLSearchParams() } });
    flushSync();
    expect(host.querySelector<HTMLDetailsElement>('.scale-note')?.open).toBe(open);
  });

  it('lets keyboard users load a list even without scrolling', () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    const onload = vi.fn();
    app = mount(AutoLoad, {
      target: host,
      props: { hasMore: true, count: 20, noun: 'tracks', onload },
    });
    flushSync();
    const button = host.querySelector<HTMLButtonElement>('button')!;
    expect(button.textContent).toContain('More tracks');
    button.click();
    flushSync();
    button.click();
    expect(onload).toHaveBeenCalledTimes(1);
  });
});
