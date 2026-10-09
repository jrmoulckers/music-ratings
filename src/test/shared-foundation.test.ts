import { flushSync, mount, unmount, type Component } from 'svelte';
import { get } from 'svelte/store';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Route } from '../lib/app/router';
import { notices } from '../lib/app/notices';
import { closeSearch, searchOpen } from '../lib/app/search-overlay';
import { BUILTIN_SCALES } from '../lib/domain/scales';
import type { ScoreBreakdown, ScoreView } from '../lib/domain/types';
import { syncState, type SyncStatus } from '../lib/storage/autosync';
import { defaultSettings } from '../lib/storage/settings';

vi.mock('../lib/app/state', async () => {
  const { writable } = await import('svelte/store');
  const { defaultSettings } = await import('../lib/storage/settings');
  return {
    settings: writable(defaultSettings()),
    suggestions: writable([]),
  };
});

const { settings } = await import('../lib/app/state');
const Artwork = (await import('../components/Artwork.svelte')).default;
const NavRail = (await import('../components/NavRail.svelte')).default;
const ScoreMark = (await import('../components/ScoreMark.svelte')).default;
const Notices = (await import('../components/Notices.svelte')).default;

let host: HTMLDivElement;
let app: Record<string, unknown> | undefined;
const dialogMethods = {
  close: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close'),
  showModal: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal'),
};

afterAll(() => {
  for (const method of ['close', 'showModal'] as const) {
    const original = dialogMethods[method];
    if (original) Object.defineProperty(HTMLDialogElement.prototype, method, original);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, method);
  }
});

function render<Props extends Record<string, unknown>>(component: Component<Props>, props: Props) {
  app = mount(component, { target: host, props });
  flushSync();
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  settings.set(defaultSettings());
  syncState.update((value) => ({ ...value, status: 'off' }));
  closeSearch();
  notices.set([]);
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      if (!this.open) return;
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    }),
  });
});

afterEach(async () => {
  if (app) await unmount(app);
  app = undefined;
  host.remove();
  closeSearch();
  notices.set([]);
});

const route: Route = {
  name: 'compare',
  path: '/compare',
  params: {},
  query: new URLSearchParams(),
};

describe('shared navigation', () => {
  it('has three primary links, with all other sections reachable through More', () => {
    render(NavRail, { route, online: true });
    const primary = host.querySelectorAll('.rail__stops li:not(.is-secondary)');
    expect([...primary].map((item) => item.textContent?.trim())).toEqual([
      'Home',
      'Rate',
      'Library',
    ]);
    expect(host.querySelector('.rail__more')?.classList.contains('is-current')).toBe(true);
    expect(host.querySelector('dialog a[aria-current="page"]')?.getAttribute('href')).toBe(
      '/compare',
    );
    expect(host.querySelectorAll('dialog a')).toHaveLength(8);
    expect(host.querySelector('.rail__search')?.textContent?.trim()).toBe('Search /');
    host.querySelector<HTMLButtonElement>('.rail__search')?.click();
    expect(get(searchOpen)).toBe(true);
  });

  it('uses a native modal and returns focus to More when closed', () => {
    render(NavRail, { route, online: true });
    const more = host.querySelector<HTMLButtonElement>('.rail__more');
    more?.click();
    flushSync();
    expect(host.querySelector('dialog')?.open).toBe(true);
    expect(more?.getAttribute('aria-expanded')).toBe('true');
    host.querySelector<HTMLButtonElement>('[aria-label="Close menu"]')?.click();
    flushSync();
    expect(host.querySelector('dialog')?.open).toBe(false);
    expect(more?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(more);
  });

  it.each([
    ['idle', 'Sync connected'],
    ['synced', 'Synced'],
    ['pending', 'Sync queued'],
    ['conflict', 'Sync conflict'],
    ['error', 'Sync failed'],
    ['offline', 'Offline'],
  ] satisfies [SyncStatus, string][])(
    'states %s truthfully without implying a completed sync',
    (status, word) => {
      settings.update((value) => ({ ...value, syncEnabled: true }));
      syncState.update((value) => ({ ...value, status }));
      render(NavRail, { route, online: true });
      expect(host.querySelector('.rail__state')?.textContent).toContain(word);
    },
  );

  it('keeps local-only and disconnected states explicit', () => {
    render(NavRail, { route, online: false });
    expect(host.querySelector('.rail__state')?.textContent).toContain('Offline');
  });

  it('does not show a stale sync outage after sync is disabled', () => {
    syncState.update((value) => ({ ...value, status: 'offline' }));
    render(NavRail, { route, online: true });
    expect(host.querySelector('.rail__state')?.textContent).toContain('Local only');
  });
});

describe('artwork preferences', () => {
  it('honours the no-artwork option without requesting an image', () => {
    settings.update((value) => ({ ...value, artwork: 'none' }));
    render(Artwork, { name: 'Test item', src: 'https://example.test/cover.jpg' });
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('TI');
  });

  it('tries a different source after a failed image instead of retaining the failure forever', () => {
    render(Artwork, {
      name: 'Test item',
      src: 'https://example.test/full.jpg',
      thumb: 'https://example.test/thumb.jpg',
    });
    host.querySelector('img')?.dispatchEvent(new Event('error'));
    flushSync();
    expect(host.querySelector('img')).toBeNull();
    settings.update((value) => ({ ...value, artwork: 'thumbnails' }));
    flushSync();
    expect(host.querySelector('img')?.getAttribute('src')).toBe('https://example.test/thumb.jpg');
  });
});

describe('global notices', () => {
  it('announces warnings with a non-color cue and retains a working dismiss action', () => {
    notices.set([
      { id: 1, message: 'Sync failed. Retry in Data health.', tone: 'warn', timeout: 0 },
    ]);
    render(Notices, {});
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Sync failed');
    expect(host.querySelector('svg[aria-label="Warning"]')).not.toBeNull();
    host.querySelector<HTMLButtonElement>('[aria-label="Dismiss notice"]')?.click();
    flushSync();
    expect(host.querySelector('.slip')).toBeNull();
  });

  it('retains the undo action without repeating the message in another live region', () => {
    const undo = vi.fn();
    notices.set([
      {
        id: 2,
        message: 'Rating saved.',
        tone: 'plain',
        timeout: 0,
        action: { label: 'Undo', run: undo },
      },
    ]);
    render(Notices, {});
    expect(host.querySelector('[role="alert"]')).toBeNull();
    host.querySelector<HTMLButtonElement>('.btn')?.click();
    flushSync();
    expect(undo).toHaveBeenCalledOnce();
    expect(host.querySelector('.slip')).toBeNull();
  });
});

const breakdown: ScoreBreakdown = {
  entityId: 'album:local:test',
  entityType: 'album',
  explicit: 75,
  contextScore: 25,
  contextAdjusted: 50,
  effectiveExplicit: 50,
  rollup: 60,
  blended: 65,
  channels: [],
  coverage: { rated: 1, total: 4, ratio: 0.25, meetsMinimum: false },
  context: {
    score: 25,
    adjusted: 50,
    contribution: 0.5,
    enabled: true,
    coverage: { rated: 1, total: 4, ratio: 0.25, meetsMinimum: false },
    rows: [],
  },
  confidence: 0.25,
  method: 'mean',
  exclusions: [],
  computedAt: 0,
};

describe('score provenance', () => {
  it('does not use rollup coverage to qualify a context score', () => {
    const scale = BUILTIN_SCALES.find((item) => item.id === 'int-100');
    if (!scale || !breakdown.context) throw new Error('Missing context test fixture');
    render(ScoreMark, {
      breakdown: {
        ...breakdown,
        context: {
          ...breakdown.context,
          coverage: { rated: 4, total: 4, ratio: 1, meetsMinimum: true },
        },
      },
      scale,
      view: 'context',
    });
    expect(host.textContent).not.toContain('provisional');
  });
  it.each([
    ['explicit', 'your rating', '75'],
    ['context', 'context', '25'],
    ['contextAdjusted', 'context-adjusted', '50'],
    ['rollup', 'computed', '60'],
    ['blended', 'blended', '65'],
  ] satisfies [ScoreView, string, string][])(
    'reads the actual %s channel, including when its visible label is hidden',
    (view, kind, value) => {
      const scale = BUILTIN_SCALES.find((item) => item.id === 'int-100');
      if (!scale) throw new Error('Missing 100-point test scale');
      render(ScoreMark, { breakdown, scale, view, showKind: false });
      expect(host.querySelector('.mark__figure')?.textContent).toContain(value);
      expect(host.querySelector('.sr-only')?.textContent).toContain(kind);
      expect(host.querySelector('.mark__kind')).toBeNull();
      expect(
        host.querySelector('.mark__figure')?.classList.contains('mark__figure--computed'),
      ).toBe(view !== 'explicit');
      expect(host.querySelector('.sr-only')?.textContent?.includes('provisional')).toBe(
        view !== 'explicit',
      );
    },
  );
});
