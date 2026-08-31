import { describe, expect, it } from 'vitest';

import { ENTITY_MEANING, entityLabelCap } from './state';
import { ENTITY_SUPPORT } from '../spotify/capabilities';
import { ENTITY_TYPES } from '../domain/types';

/**
 * Settings asks the user to choose which kinds of thing they rate, which only
 * works if each one says plainly what it is. These pin the wording that was
 * agreed, and the separation that keeps it readable: a definition says what the
 * thing is, and a Spotify limitation is kept apart from it.
 */

describe('entity descriptions', () => {
  it('describes every kind', () => {
    for (const type of ENTITY_TYPES) {
      expect(ENTITY_MEANING[type], type).toBeTruthy();
    }
  });

  it('uses the agreed wording for the three core kinds', () => {
    expect(ENTITY_MEANING.artist).toBe(
      'The people or groups who make the music. Example: Radiohead.',
    );
    expect(ENTITY_MEANING.album).toBe(
      'Albums, EPs, singles, compilations, and deluxe editions. A single can be both a release and the track inside it.',
    );
    expect(ENTITY_MEANING.track).toBe(
      'Individual songs or recordings. Example: one song from an album.',
    );
  });

  it('stays plain', () => {
    // Wording that reads as affected rather than informative.
    const affected =
      /performers and creators themselves|anything published as a package|for instance|the catalogue/i;
    for (const type of ENTITY_TYPES) {
      expect(ENTITY_MEANING[type], type).not.toMatch(affected);
    }
  });

  it('keeps each description to a couple of short sentences', () => {
    for (const type of ENTITY_TYPES) {
      expect(ENTITY_MEANING[type]!.length, type).toBeLessThanOrEqual(130);
    }
  });

  it('never states a Spotify limitation as part of a definition', () => {
    for (const type of ENTITY_TYPES) {
      expect(ENTITY_MEANING[type], type).not.toMatch(/spotify/i);
    }
  });

  it('leaves the three core kinds without a limitation note', () => {
    // Artists, releases and tracks are fully supported; a note here would read
    // as a caveat on something that has none.
    expect(ENTITY_SUPPORT.artist.note).toBeUndefined();
    expect(ENTITY_SUPPORT.album.note).toBeUndefined();
    expect(ENTITY_SUPPORT.track.note).toBeUndefined();
  });

  it('keeps limitation notes short', () => {
    for (const type of ENTITY_TYPES) {
      const note = ENTITY_SUPPORT[type].note;
      if (note) expect(note.length, type).toBeLessThanOrEqual(160);
    }
  });

  it('capitalises every displayed label', () => {
    for (const type of ENTITY_TYPES) {
      for (const plural of [false, true]) {
        const label = entityLabelCap(type, plural);
        expect(label[0], `${type}/${plural}`).toBe(label[0]!.toUpperCase());
      }
    }
  });
});
