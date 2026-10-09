import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AutoLoad from '../components/AutoLoad.svelte';
import SearchOverlay from '../components/SearchOverlay.svelte';
import Library from '../pages/Library.svelte';
import Home from '../pages/Home.svelte';
import Rankings from '../pages/Rankings.svelte';
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
