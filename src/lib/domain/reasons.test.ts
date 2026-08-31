import { describe, expect, it } from 'vitest';

import {
  comparisonReason,
  containedNoun,
  coverageReason,
  playedReason,
  pinnedReason,
  relativeDays,
  relativePlay,
  savedReason,
  staleReason,
  TERM_PHRASE,
  topReason,
  typeNoun,
  unratedChildReason,
} from './reasons';
import { ENTITY_TYPES, type EntityType } from './types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('type nouns', () => {
  it('names every kind of thing in both numbers', () => {
    for (const type of ENTITY_TYPES) {
      expect(typeNoun(type)).toMatch(/^[a-z]+$/);
      expect(typeNoun(type, true)).toBe(`${typeNoun(type)}s`);
    }
  });

  it('calls an album a release, because that is what the app calls it', () => {
    expect(typeNoun('album')).toBe('release');
    expect(typeNoun('album', true)).toBe('releases');
  });
});

describe('contained nouns', () => {
  it('takes the word from the children that actually exist', () => {
    expect(containedNoun(['track'])).toBe('tracks');
    expect(containedNoun(['album'])).toBe('releases');
    expect(containedNoun(['episode'])).toBe('episodes');
    expect(containedNoun(['chapter'])).toBe('chapters');
    expect(containedNoun(['track'], false)).toBe('track');
  });

  it('refuses to pick a side when the contents are mixed', () => {
    expect(containedNoun(['album', 'track'])).toBe('items');
    expect(containedNoun(['album', 'track'], false)).toBe('item');
  });

  it('has no word for nothing, so it says items', () => {
    expect(containedNoun([])).toBe('items');
  });
});

describe('elapsed time', () => {
  it('says a recent play in the unit it happened in', () => {
    expect(relativePlay(10_000)).toBe('just now');
    expect(relativePlay(MINUTE)).toBe('1 minute ago');
    expect(relativePlay(5 * MINUTE)).toBe('5 minutes ago');
    expect(relativePlay(2 * HOUR)).toBe('2 hours ago');
    expect(relativePlay(HOUR)).toBe('1 hour ago');
  });

  it('falls back to days once a play is yesterday', () => {
    expect(relativePlay(DAY)).toBe('yesterday');
    expect(relativePlay(3 * DAY)).toBe('3 days ago');
  });

  it('coarsens as things get older', () => {
    expect(relativeDays(0)).toBe('today');
    expect(relativeDays(DAY)).toBe('yesterday');
    expect(relativeDays(5 * DAY)).toBe('5 days ago');
    expect(relativeDays(21 * DAY)).toBe('3 weeks ago');
    expect(relativeDays(90 * DAY)).toBe('3 months ago');
    expect(relativeDays(800 * DAY)).toBe('2 years ago');
  });
});

describe('play and listening reasons', () => {
  it('states the play as a time, not as a category', () => {
    expect(playedReason(2 * HOUR)).toBe('Played 2 hours ago.');
    expect(playedReason(30_000)).toBe('Played just now.');
  });

  it('writes a ranking position with no space after the hash', () => {
    expect(topReason('long', 3)).toBe('#3 in your all-time listening.');
    expect(topReason('short', 1)).toBe('#1 in your last four weeks.');
    expect(topReason('medium', 8)).toBe('#8 in your last six months.');
  });

  it('phrases every window in the user’s terms', () => {
    expect(TERM_PHRASE.short).toBe('your last four weeks');
    expect(TERM_PHRASE.medium).toBe('your last six months');
    expect(TERM_PHRASE.long).toBe('your all-time listening');
  });

  it('dates a save when it knows the date and does not guess when it does not', () => {
    expect(savedReason(90 * DAY)).toBe('Saved 3 months ago.');
    expect(savedReason()).toBe('Saved to your library.');
  });
});

describe('coverage reasons', () => {
  it('never says a parent is a percentage', () => {
    const zero = coverageReason('Kestrel Harbour', ['track'], 0, 12);
    const partial = coverageReason('Kestrel Harbour', ['track'], 3, 12);
    for (const line of [zero, partial]) {
      expect(line).not.toMatch(/%/);
      expect(line).not.toMatch(/0% rated/);
    }
  });

  it('says nothing is rated rather than nought per cent', () => {
    expect(coverageReason('Kestrel Harbour', ['track'], 0, 12)).toBe(
      'No tracks from Kestrel Harbour rated yet.',
    );
  });

  it('counts what has been done out of what there is', () => {
    expect(coverageReason('Kestrel Harbour', ['track'], 3, 12)).toBe(
      '3 of 12 tracks rated in Kestrel Harbour.',
    );
    expect(coverageReason('Kestrel Harbour', ['track'], 1, 1)).toBe(
      '1 of 1 track rated in Kestrel Harbour.',
    );
  });

  it('uses the right child noun for every kind of parent', () => {
    expect(coverageReason('Marisol Vega', ['album'], 0, 4)).toBe(
      'No releases from Marisol Vega rated yet.',
    );
    expect(coverageReason('Night Drive', ['track'], 2, 20)).toBe(
      '2 of 20 tracks rated in Night Drive.',
    );
    expect(coverageReason('The Long Way', ['episode'], 0, 30)).toBe(
      'No episodes from The Long Way rated yet.',
    );
    expect(coverageReason('A History', ['chapter'], 4, 18)).toBe(
      '4 of 18 chapters rated in A History.',
    );
  });

  it('says something useful when it does not know the total', () => {
    expect(coverageReason('Kestrel Harbour', ['track'], 0, 0)).toBe(
      'Rate this to improve Kestrel Harbour’s score.',
    );
    expect(coverageReason('Kestrel Harbour', ['track'], 0, Number.NaN)).toBe(
      'Rate this to improve Kestrel Harbour’s score.',
    );
  });

  it('does not double the s on a name that already ends in one', () => {
    expect(coverageReason('Wildes', ['track'], 0, 0)).toBe('Rate this to improve Wildes’ score.');
  });
});

describe('other reasons', () => {
  it('names the child by its own kind, not the parent’s usual contents', () => {
    expect(unratedChildReason('Kestrel Harbour', 'track')).toBe(
      'You rated Kestrel Harbour but not this track.',
    );
    expect(unratedChildReason('Marisol Vega', 'album')).toBe(
      'You rated Marisol Vega but not this release.',
    );
    expect(unratedChildReason('The Long Way', 'episode')).toBe(
      'You rated The Long Way but not this episode.',
    );
  });

  it('asks whether an old rating still holds', () => {
    expect(staleReason(90 * DAY)).toBe('Last rated 3 months ago. Still right?');
  });

  it('counts comparisons in words for the small numbers', () => {
    expect(comparisonReason(0)).toBe('Never compared with anything.');
    expect(comparisonReason(1)).toBe('Compared once so far.');
    expect(comparisonReason(2)).toBe('Compared twice so far.');
    expect(comparisonReason(5)).toBe('Compared 5 times so far.');
  });

  it('credits the pin to the person who made it', () => {
    expect(pinnedReason()).toBe('You pinned this.');
  });
});

describe('every reason is one plain sentence', () => {
  const lines = [
    playedReason(2 * HOUR),
    topReason('long', 3),
    savedReason(90 * DAY),
    savedReason(),
    unratedChildReason('Kestrel Harbour', 'track'),
    coverageReason('Kestrel Harbour', ['track'], 0, 12),
    coverageReason('Kestrel Harbour', ['track'], 3, 12),
    coverageReason('Kestrel Harbour', ['track'], 0, 0),
    comparisonReason(0),
    comparisonReason(4),
    pinnedReason(),
  ];

  it('ends with a full stop', () => {
    for (const line of lines) expect(line.endsWith('.')).toBe(true);
  });

  it('never uses the robotic phrasings that were replaced', () => {
    const all = [...lines, staleReason(90 * DAY)].join(' ');
    expect(all).not.toMatch(/Number \d/);
    expect(all).not.toMatch(/only \d+% rated/);
    expect(all).not.toMatch(/\bNaN\b/);
    expect(all).not.toMatch(/undefined/);
  });
});

describe('coverage of the type table', () => {
  it('has a noun for every entity type the app knows about', () => {
    const types: readonly EntityType[] = ENTITY_TYPES;
    for (const type of types) {
      expect(typeNoun(type)).toBeTruthy();
      expect(containedNoun([type])).toBeTruthy();
      expect(unratedChildReason('X', type)).toContain(typeNoun(type));
    }
  });
});
