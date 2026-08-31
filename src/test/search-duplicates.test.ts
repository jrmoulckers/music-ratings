import { flushSync, mount, unmount } from 'svelte';
import { readable, writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContainmentGraph } from '../lib/domain/graph';
import type { Entity, EntityId } from '../lib/domain/types';

/**
 * Two rows for one album.
 *
 * The report was two identical Let It Bleed rows in the library. They were not
 * one record stored twice: the canonical id carries the provider id, so that
 * cannot happen. They were the 1969 master and a later remaster — two real
 * records, each ratable, shown as if they were the same thing.
 *
 * These pin the answer: both stay, both are told apart by the smallest fact
 * that separates them, and each row still opens and rates its own record.
 */

const PROVENANCE = { provider: 'spotify', via: 'test', fetchedAt: 0 } as const;

function album(providerId: string, extra: Partial<Entity> = {}): Entity {
  return {
    id: `album:spotify:${providerId}` as EntityId,
    type: 'album',
    provider: 'spotify',
    providerId,
    name: 'Let It Bleed',
    subtitle: 'The Rolling Stones',
    createdAt: 0,
    updatedAt: 0,
    provenance: PROVENANCE,
    ...extra,
  };
}

const ORIGINAL = album('lb69', { releaseDate: '1969-12-05', totalChildren: 9 });
const REMASTER = album('lb19', { releaseDate: '2019-11-01', totalChildren: 18 });
const OTHER = album('sf71', { name: 'Sticky Fingers', releaseDate: '1971-04-23' });

const graph = writable(new ContainmentGraph([ORIGINAL, REMASTER, OTHER], []));

vi.mock('../lib/app/state', () => ({
  get graph() {
    return graph;
  },
  settings: readable({ enabledTypes: ['album', 'track', 'artist'], scales: {} }),
  explicitRatings: readable(new Map()),
  entityLabelCap: (type: string) => type,
  scaleForType: readable(() => ({ id: 'hundred', kind: 'numeric', min: 1, max: 100, step: 1 })),
}));
vi.mock('../lib/app/actions', () => ({ rate: async () => {} }));
vi.mock('../lib/app/artwork', () => ({ topUpArtistArtwork: async () => {} }));
vi.mock('../lib/app/notices', () => ({ notify: () => {} }));
vi.mock('../lib/app/search-overlay', () => ({ closeSearch: () => {} }));
vi.mock('../lib/spotify/client', () => ({ SpotifyClient: class {} }));
vi.mock('../lib/spotify/artwork', () => ({ artistNeedsArtwork: () => false }));
vi.mock('../lib/spotify/library', () => ({
  searchCatalogue: async () => ({ entities: [], memberships: [], hits: [] }),
}));
vi.mock('../lib/spotify/session', () => ({
  spotifyConfig: () => null,
  spotifySession: readable({ connected: false }),
}));
vi.mock('../lib/storage/repo', () => ({
  upsertEntities: async () => {},
  saveMemberships: async () => {},
}));

const SearchOverlay = (await import('../components/SearchOverlay.svelte')).default;

let host: HTMLDivElement | null = null;
let app: ReturnType<typeof mount> | null = null;

function render(query: string): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  app = mount(SearchOverlay, { target: host });
  flushSync();
  const field = host.querySelector<HTMLInputElement>('input');
  if (!field) throw new Error('no search field');
  field.value = query;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

/** Rows of the local library section, which is the one the report came from. */
function rows(): HTMLElement[] {
  return [...(host?.querySelectorAll('.row') ?? [])] as HTMLElement[];
}

function textOf(row: HTMLElement): string {
  return (row.textContent ?? '').replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  if (app) void unmount(app, { outro: false });
  host?.remove();
  app = null;
  host = null;
});

describe('two editions of the same release', () => {
  it('keeps both rows rather than hiding one', () => {
    render('let it bleed');
    expect(rows()).toHaveLength(2);
  });

  it('tells them apart with the smallest fact that separates them', () => {
    render('let it bleed');
    const text = rows().map(textOf);
    expect(text.some((t) => t.includes('1969'))).toBe(true);
    expect(text.some((t) => t.includes('2019'))).toBe(true);
    expect(text[0]).not.toBe(text[1]);
  });

  it('keeps the artist line and adds to it rather than replacing it', () => {
    render('let it bleed');
    for (const row of rows()) expect(textOf(row)).toContain('The Rolling Stones');
  });

  it('leaves a row alone when nothing looks like it', () => {
    render('sticky');
    const [only] = rows();
    expect(rows()).toHaveLength(1);
    expect(textOf(only!)).not.toContain('1971');
  });

  it('opens the record the row actually names', () => {
    render('let it bleed');
    const second = rows()[1]!;
    const wanted = textOf(second).includes('1969') ? '1969' : '2019';
    second.click();
    flushSync();

    const seat = host?.querySelector('.seat');
    expect(seat).not.toBeNull();
    // The chosen record has to stay identifiable, or picking between two
    // editions only moves the ambiguity one screen along.
    expect((seat?.textContent ?? '').replace(/\s+/g, ' ')).toContain(wanted);
  });

  it('rates the chosen edition and no other', () => {
    render('let it bleed');
    rows()[0]!.click();
    flushSync();
    const controls = host?.querySelectorAll('[data-rating-control]') ?? [];
    expect(controls.length).toBe(1);
  });
});
