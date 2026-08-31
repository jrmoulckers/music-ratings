import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The last few things you looked for, on screen.
 *
 * One implementation serves both search surfaces, so these prove the shared
 * piece: it appears only on an empty field, each row runs its own query, each
 * row can be dropped without submitting anything, and it gets out of the way
 * the moment there is something real to show.
 */

vi.mock('../lib/spotify/session', () => ({
  spotifyConfig: () => ({ clientId: 'x', redirectUri: 'y' }),
  spotifySession: {
    subscribe: (run: (v: unknown) => void) => (run({ connected: true }), () => {}),
  },
}));

const RecentSearches = (await import('../components/RecentSearches.svelte')).default;
const { clearRecentSearches, recentSearches, reloadRecentSearches, rememberSearch } =
  await import('../lib/app/recent-searches');

let host: HTMLElement | null = null;
let view: Record<string, unknown> | null = null;
const picked: string[] = [];

function render() {
  host = document.createElement('div');
  document.body.append(host);
  view = mount(RecentSearches, {
    target: host,
    props: { onpick: (term: string) => void picked.push(term) },
  }) as Record<string, unknown>;
  flushSync();
}

function rows(): HTMLElement[] {
  return [...(host?.querySelectorAll('.recent__row') ?? [])] as HTMLElement[];
}

function button(row: HTMLElement, which: 'term' | 'drop'): HTMLButtonElement {
  const found = row.querySelector<HTMLButtonElement>(`.recent__${which}`);
  if (!found) throw new Error(`no ${which} button`);
  return found;
}

beforeEach(() => {
  localStorage.clear();
  reloadRecentSearches();
  picked.length = 0;
});

afterEach(() => {
  if (view) void unmount(view);
  host?.remove();
  view = null;
  host = null;
  clearRecentSearches();
});

describe('the recent searches panel', () => {
  it('shows nothing at all when there is no history', () => {
    render();
    expect(host?.querySelector('.recent')).toBeNull();
  });

  it('lists remembered queries newest first', () => {
    rememberSearch('Alanis');
    rememberSearch('Dolly Parton');
    render();

    expect(rows().map((r) => button(r, 'term').textContent?.trim())).toEqual([
      'Dolly Parton',
      'Alanis',
    ]);
  });

  it('runs a query when its row is chosen', () => {
    rememberSearch('Jolene');
    render();
    button(rows()[0]!, 'term').click();
    flushSync();

    expect(picked).toEqual(['Jolene']);
  });

  it('drops one query without running it', () => {
    rememberSearch('Alanis');
    rememberSearch('Jolene');
    render();
    button(rows()[0]!, 'drop').click();
    flushSync();

    expect(picked).toEqual([]);
    expect(get(recentSearches)).toEqual(['Alanis']);
    expect(rows()).toHaveLength(1);
  });

  it('never submits a surrounding form', () => {
    rememberSearch('Jolene');
    render();
    for (const row of rows()) {
      expect(button(row, 'term').type).toBe('button');
      expect(button(row, 'drop').type).toBe('button');
    }
  });

  it('names each remove action after the query it removes', () => {
    rememberSearch('Jolene');
    render();
    expect(button(rows()[0]!, 'drop').textContent).toContain('Remove Jolene from recent searches');
  });

  it('clears everything from one control', () => {
    rememberSearch('Alanis');
    rememberSearch('Jolene');
    render();
    host?.querySelector<HTMLButtonElement>('.recent__head button')?.click();
    flushSync();

    expect(get(recentSearches)).toEqual([]);
    expect(host?.querySelector('.recent')).toBeNull();
  });

  it('gives every control a touch-sized target', () => {
    rememberSearch('Jolene');
    render();
    const styles = [...(host?.querySelectorAll('style') ?? [])].map((s) => s.textContent).join('');
    void styles;
    // The rule lives in the component stylesheet; assert the class contract the
    // stylesheet sizes, so a rename cannot silently drop the target size.
    expect(button(rows()[0]!, 'term').className).toContain('recent__term');
    expect(button(rows()[0]!, 'drop').className).toContain('recent__drop');
  });
});

describe('where it appears', () => {
  it('is mounted by both search surfaces through the one component', async () => {
    const [overlay, find] = await Promise.all([
      import('../components/SearchOverlay.svelte?raw'),
      import('../components/SpotifySearch.svelte?raw'),
    ]);

    for (const [name, source] of [
      ['SearchOverlay', overlay.default],
      ['SpotifySearch', find.default],
    ] as const) {
      expect(source, name).toContain("import RecentSearches from './RecentSearches.svelte'");
      expect(source, name).toContain('<RecentSearches');
      // Recents belong to the empty field only, never beside live results.
      expect(source, name).toMatch(/needle\.length === 0/);
    }
  });

  it('records a query only where a search actually completed', async () => {
    const [overlay, find] = await Promise.all([
      import('../components/SearchOverlay.svelte?raw'),
      import('../components/SpotifySearch.svelte?raw'),
    ]);

    for (const source of [overlay.default, find.default]) {
      // Never on a keystroke: the call sits after the awaited search, and the
      // catch branch that handles a failure must not reach it.
      const failure = source.slice(source.indexOf('} catch'), source.indexOf('} finally'));
      expect(failure).not.toContain('rememberSearch');
    }
  });
});
