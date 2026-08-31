import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  RECENT_LIMIT,
  clearRecentSearches,
  forgetSearch,
  recentSearches,
  reloadRecentSearches,
  rememberSearch,
  searchKey,
} from './recent-searches';

/**
 * The last few things you looked for.
 *
 * Two rules carry the whole feature: it records what you asked for, never what
 * you typed on the way there, and it stays small. The rest — the newest
 * spelling winning, malformed storage being ignored rather than trusted — is
 * what keeps it from becoming annoying.
 */

const KEY = 'music-ratings.recent-searches';

beforeEach(() => {
  localStorage.clear();
  reloadRecentSearches();
});

describe('keeping recent searches', () => {
  it('lists the newest first', () => {
    rememberSearch('Alanis');
    rememberSearch('Dolly Parton');
    expect(get(recentSearches)).toEqual(['Dolly Parton', 'Alanis']);
  });

  it('moves a repeated search back to the top rather than duplicating it', () => {
    rememberSearch('Alanis');
    rememberSearch('Dolly Parton');
    rememberSearch('Alanis');
    expect(get(recentSearches)).toEqual(['Alanis', 'Dolly Parton']);
  });

  it('treats case and stray whitespace as the same search, keeping the newest spelling', () => {
    rememberSearch('jolene');
    rememberSearch('  JoLeNe  ');
    expect(get(recentSearches)).toEqual(['JoLeNe']);
  });

  it('collapses runs of whitespace for comparison', () => {
    expect(searchKey('  Jagged   Little  Pill ')).toBe('jagged little pill');
  });

  it('keeps no more than the limit', () => {
    for (let i = 0; i < RECENT_LIMIT + 5; i += 1) rememberSearch(`query ${i}`);
    const kept = get(recentSearches);
    expect(kept).toHaveLength(RECENT_LIMIT);
    expect(kept[0]).toBe(`query ${RECENT_LIMIT + 4}`);
  });

  it('ignores blank and whitespace-only searches', () => {
    rememberSearch('');
    rememberSearch('   ');
    rememberSearch('\n\t');
    expect(get(recentSearches)).toEqual([]);
  });

  it('truncates an unreasonably long query instead of storing it whole', () => {
    rememberSearch('x'.repeat(500));
    expect(get(recentSearches)[0]).toHaveLength(120);
  });
});

describe('forgetting them', () => {
  it('removes one without touching the others', () => {
    rememberSearch('Alanis');
    rememberSearch('Dolly Parton');
    forgetSearch('alanis');
    expect(get(recentSearches)).toEqual(['Dolly Parton']);
  });

  it('removes all of them', () => {
    rememberSearch('Alanis');
    rememberSearch('Dolly Parton');
    clearRecentSearches();
    expect(get(recentSearches)).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe('surviving what is on disk', () => {
  it('persists across a reload', () => {
    rememberSearch('Alanis');
    reloadRecentSearches();
    expect(get(recentSearches)).toEqual(['Alanis']);
  });

  it('ignores storage that is not JSON', () => {
    localStorage.setItem(KEY, '{not json');
    reloadRecentSearches();
    expect(get(recentSearches)).toEqual([]);
  });

  it('ignores storage that is the wrong shape', () => {
    localStorage.setItem(KEY, JSON.stringify({ terms: ['Alanis'] }));
    reloadRecentSearches();
    expect(get(recentSearches)).toEqual([]);
  });

  it('drops entries that are not usable strings and keeps the rest', () => {
    localStorage.setItem(KEY, JSON.stringify(['Alanis', 42, null, '  ', 'Dolly']));
    reloadRecentSearches();
    expect(get(recentSearches)).toEqual(['Alanis', 'Dolly']);
  });

  it('caps an over-long stored list', () => {
    const many = Array.from({ length: 50 }, (_, i) => `q${i}`);
    localStorage.setItem(KEY, JSON.stringify(many));
    reloadRecentSearches();
    expect(get(recentSearches)).toHaveLength(RECENT_LIMIT);
  });

  it('de-duplicates a stored list that repeats a term in another casing', () => {
    localStorage.setItem(KEY, JSON.stringify(['Alanis', 'ALANIS', 'Dolly']));
    reloadRecentSearches();
    expect(get(recentSearches)).toEqual(['Alanis', 'Dolly']);
  });
});
