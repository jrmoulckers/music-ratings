import { describe, expect, it } from 'vitest';

import {
  canContain,
  canExpand,
  contentsHeading,
  expectedChildType,
  expectedOwnerType,
  groupParents,
  relationHeading,
  scoreGist,
  trimContext,
} from './relations';
import { ENTITY_TYPES, type EntityId, type EntityType, type ScoreBreakdown } from './types';

/**
 * The vocabulary a detail page is allowed to use.
 *
 * These fence the two mistakes the old page made: asking a track what was
 * inside it, and putting the record a track is from in the same flat list as
 * the eleventh playlist someone added it to.
 */

const LEAVES: EntityType[] = ['track', 'episode', 'chapter'];
const CONTAINERS: EntityType[] = ['artist', 'album', 'playlist', 'show', 'audiobook'];

describe('what can hold something', () => {
  it('knows every kind one way or the other', () => {
    for (const type of ENTITY_TYPES) expect(typeof canContain(type)).toBe('boolean');
  });

  it('treats tracks, episodes and chapters as leaves', () => {
    for (const type of LEAVES) expect(canContain(type)).toBe(false);
  });

  it('treats artists, releases, playlists, shows and audiobooks as containers', () => {
    for (const type of CONTAINERS) expect(canContain(type)).toBe(true);
  });

  it('offers a Spotify expansion only for the kinds Spotify will expand', () => {
    for (const type of LEAVES) expect(canExpand(type)).toBe(false);
    for (const type of CONTAINERS) expect(canExpand(type)).toBe(true);
  });
});

describe('naming a section of contents', () => {
  it('calls a release’s tracks a tracklist', () => {
    expect(contentsHeading('album', 'track')).toBe('Tracklist');
  });

  it('calls a playlist’s tracks tracks', () => {
    expect(contentsHeading('playlist', 'track')).toBe('Tracks');
  });

  it('calls an artist’s albums releases, because the app calls them releases', () => {
    expect(contentsHeading('artist', 'album')).toBe('Releases');
  });

  it('names episodes and chapters after what they are', () => {
    expect(contentsHeading('show', 'episode')).toBe('Episodes');
    expect(contentsHeading('audiobook', 'chapter')).toBe('Chapters');
  });

  it('falls back to the plain plural rather than to a generic word', () => {
    expect(contentsHeading('artist', 'track')).toBe('Tracks');
    expect(contentsHeading('playlist', 'artist')).toBe('Artists');
  });

  it('never produces an empty or lowercase heading for any pairing', () => {
    for (const parent of ENTITY_TYPES) {
      for (const child of ENTITY_TYPES) {
        const heading = contentsHeading(parent, child);
        expect(heading.length).toBeGreaterThan(0);
        expect(heading[0]).toBe(heading[0]?.toUpperCase());
      }
    }
  });
});

describe('naming an owning relationship', () => {
  it('says what the edge actually means', () => {
    expect(relationHeading('album')).toBe('Appears on');
    expect(relationHeading('artist')).toBe('By');
    expect(relationHeading('show')).toBe('From');
    expect(relationHeading('audiobook')).toBe('From');
    expect(relationHeading('playlist')).toBe('In playlists');
  });

  it('has a plain fallback rather than a wrong word', () => {
    expect(relationHeading('track')).toBe('Related to');
  });
});

describe('grouping owners', () => {
  const edge = (parentId: string, parentType: EntityType) => ({
    parentId: parentId as EntityId,
    parentType,
  });

  it('puts the record a track is from before the artist and the playlists', () => {
    const groups = groupParents([
      edge('playlist:spotify:p1', 'playlist'),
      edge('artist:spotify:a1', 'artist'),
      edge('album:spotify:r1', 'album'),
    ]);
    expect(groups.map((g) => g.type)).toEqual(['album', 'artist', 'playlist']);
    expect(groups.map((g) => g.heading)).toEqual(['Appears on', 'By', 'In playlists']);
  });

  it('collapses a membership recorded twice into one relationship', () => {
    const groups = groupParents([
      edge('album:spotify:r1', 'album'),
      edge('album:spotify:r1', 'album'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.ids).toEqual(['album:spotify:r1']);
  });

  it('keeps several owners of the same kind together in the order given', () => {
    const groups = groupParents([
      edge('artist:spotify:a1', 'artist'),
      edge('artist:spotify:a2', 'artist'),
    ]);
    expect(groups[0]?.ids).toEqual(['artist:spotify:a1', 'artist:spotify:a2']);
  });

  it('has nothing to say about a thing with no owners', () => {
    expect(groupParents([])).toEqual([]);
  });
});

describe('what a leaf is missing', () => {
  it('knows the kind that ought to own each leaf', () => {
    expect(expectedOwnerType('track')).toBe('album');
    expect(expectedOwnerType('episode')).toBe('show');
    expect(expectedOwnerType('chapter')).toBe('audiobook');
  });

  it('has no opinion about what owns a container', () => {
    for (const type of CONTAINERS) expect(expectedOwnerType(type)).toBeNull();
  });

  it('knows the kind each container is expected to hold', () => {
    expect(expectedChildType('artist')).toBe('album');
    expect(expectedChildType('album')).toBe('track');
    expect(expectedChildType('playlist')).toBe('track');
    expect(expectedChildType('show')).toBe('episode');
    expect(expectedChildType('audiobook')).toBe('chapter');
  });
});

describe('the one line above the working', () => {
  const channel = (name: string, value: number | null, appliedWeight: number) => ({
    channel: name as ScoreBreakdown['channels'][number]['channel'],
    value,
    requestedWeight: appliedWeight,
    appliedWeight,
    detail: '',
  });
  const breakdown = (channels: ReturnType<typeof channel>[]) =>
    ({ channels }) as unknown as ScoreBreakdown;

  it('names the channel carrying most of the weight', () => {
    expect(
      scoreGist(breakdown([channel('explicit', 70, 0.6), channel('directChildren', 50, 0.4)])),
    ).toBe('Mostly your own rating.');
  });

  it('says so plainly when only one channel had anything to say', () => {
    expect(scoreGist(breakdown([channel('directChildren', 50, 1)]))).toBe(
      'From the ratings of what it contains alone.',
    );
  });

  it('does not pretend there is evidence when there is none', () => {
    expect(scoreGist(breakdown([channel('explicit', null, 0)]))).toBe(
      'Nothing to compute a score from yet.',
    );
  });

  it('says nothing at all without a breakdown', () => {
    expect(scoreGist(undefined)).toBeNull();
  });
});

describe('taking out what the page already said', () => {
  it('keeps a subtitle nothing matches', () => {
    expect(trimContext('Kestrel Harbour · Rain Ledger', [])).toBe('Kestrel Harbour · Rain Ledger');
    expect(trimContext('Kestrel Harbour', ['Vela Quinn'])).toBe('Kestrel Harbour');
  });

  it('drops only the pieces the page is standing in', () => {
    expect(trimContext('Kestrel Harbour · Rain Ledger', ['Kestrel Harbour'])).toBe('Rain Ledger');
    expect(trimContext('Kestrel Harbour · Rain Ledger', ['Rain Ledger'])).toBe('Kestrel Harbour');
  });

  it('returns nothing when the page has said all of it', () => {
    expect(trimContext('Kestrel Harbour · Rain Ledger', ['Rain Ledger', 'Kestrel Harbour'])).toBe(
      null,
    );
  });

  it('ignores case and stray spacing', () => {
    expect(trimContext('  Kestrel Harbour  ·  Rain Ledger ', ['kestrel harbour'])).toBe(
      'Rain Ledger',
    );
  });

  it('splits on the separators subtitles are actually built with', () => {
    expect(trimContext('Ada, Bo — Cy', ['Bo'])).toBe('Ada · Cy');
  });

  it('leaves an untouched subtitle exactly as written', () => {
    expect(trimContext('Ada, Bo — Cy', ['Nobody'])).toBe('Ada, Bo — Cy');
  });

  it('has nothing to say about an absent subtitle', () => {
    expect(trimContext(undefined, ['Rain Ledger'])).toBe(null);
    expect(trimContext('   ', ['Rain Ledger'])).toBe(null);
  });

  it('is not confused by an empty name in the list', () => {
    expect(trimContext('Kestrel Harbour', ['', '  '])).toBe('Kestrel Harbour');
  });

  it('keeps a piece that merely contains a known name', () => {
    expect(trimContext('Kestrel Harbour Live', ['Kestrel Harbour'])).toBe('Kestrel Harbour Live');
  });
});
