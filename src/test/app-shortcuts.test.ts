import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AppState from '../lib/app/state';
import type * as AppSync from '../lib/app/sync';
import type * as LibraryRevision from '../lib/storage/library-revision';
import { closeSearch, searchOpen } from '../lib/app/search-overlay';

vi.mock('../lib/app/state', async (importOriginal) => ({
  ...(await importOriginal<typeof AppState>()),
  startStateSync: () => () => {},
}));
vi.mock('../lib/app/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof AppSync>()),
  startSyncController: () => () => {},
}));
vi.mock('../lib/listening/watch', () => ({ watchListening: () => () => {} }));
vi.mock('../lib/app/pwa', async () => {
  const { writable } = await import('svelte/store');
  return {
    pwa: writable({
      updateReady: false,
      offlineReady: false,
      installable: false,
      installed: false,
    }),
    installApp: async () => false,
    reloadForUpdate: async () => {},
    dismissUpdate: () => {},
  };
});
vi.mock('../lib/storage/library-revision', async (importOriginal) => ({
  ...(await importOriginal<typeof LibraryRevision>()),
  watchLibraryReset: () => () => {},
}));

const App = (await import('../App.svelte')).default;
const { ready } = await import('../lib/app/state');
let host: HTMLDivElement;
let app: ReturnType<typeof mount>;

beforeEach(() => {
  ready.set(false);
  closeSearch();
  host = document.createElement('div');
  document.body.append(host);
  app = mount(App, { target: host });
  flushSync();
});

afterEach(async () => {
  await unmount(app);
  host.remove();
  closeSearch();
});

describe('search shortcuts with native navigation', () => {
  it.each([{ key: '/' }, { key: 'k', ctrlKey: true }, { key: 'K', metaKey: true }])(
    'keeps Search closed while More is modal ($key)',
    (shortcut) => {
      host.querySelector<HTMLButtonElement>('.rail__more')?.click();
      flushSync();
      const dialog = host.querySelector<HTMLDialogElement>('dialog');
      expect(dialog?.open).toBe(true);

      window.dispatchEvent(new KeyboardEvent('keydown', { ...shortcut, cancelable: true }));
      flushSync();
      expect(get(searchOpen)).toBe(false);
      expect(dialog?.open).toBe(true);
      expect(host.querySelector('[role="dialog"][aria-label="Find music"]')).toBeNull();
    },
  );

  it('allows the shortcut again after More is closed', () => {
    host.querySelector<HTMLButtonElement>('.rail__more')?.click();
    flushSync();
    host.querySelector<HTMLButtonElement>('[aria-label="Close menu"]')?.click();
    flushSync();
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true }),
    );
    flushSync();
    expect(get(searchOpen)).toBe(true);
    expect(host.querySelector<HTMLDialogElement>('dialog')?.open).toBe(false);
  });
});
