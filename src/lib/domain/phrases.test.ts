import { describe, expect, it } from 'vitest';

import { NOT_RATED, eventWords, ratedSentence, ratingWords, scaleOfEvent } from './phrases';
import { BUILTIN_SCALES, findScale, normalize } from './scales';
import type { RatingEvent, RatingScale } from './types';

function scale(id: string): RatingScale {
  const found = findScale(BUILTIN_SCALES, id);
  if (!found) throw new Error(`no scale ${id}`);
  return found;
}

function event(over: Partial<RatingEvent> & Pick<RatingEvent, 'scaleId' | 'value'>): RatingEvent {
  const on = BUILTIN_SCALES.find((s) => s.id === over.scaleId);
  return {
    id: 'e1',
    entityId: 'track:1',
    entityType: 'track',
    at: 1,
    normalized: on ? normalize(on, over.value) : 50,
    confidence: 'medium',
    ...over,
  } as RatingEvent;
}

describe('a rating said out loud', () => {
  it('reads a hundred-point rating as a fraction of a hundred', () => {
    expect(ratingWords(scale('int-100'), 67).text).toBe('67/100');
  });

  it('reads a ten-point rating as a fraction of ten', () => {
    expect(ratingWords(scale('int-10'), 6).text).toBe('6/10');
  });

  it('reads the small integer scales the same way', () => {
    expect(ratingWords(scale('int-5'), 3).text).toBe('3/5');
    expect(ratingWords(scale('int-3'), 2).text).toBe('2/3');
  });

  it('keeps the decimal precision the scale actually carries', () => {
    expect(ratingWords(scale('decimal-10'), 4.6).text).toBe('4.6/10');
  });

  it('drops a trailing zero that carries no information', () => {
    expect(ratingWords(scale('decimal-10'), 5).text).toBe('5/10');
  });

  it('names stars as stars', () => {
    expect(ratingWords(scale('stars-5'), 4).text).toBe('4 stars');
  });

  it('says one star in the singular', () => {
    expect(ratingWords(scale('stars-5'), 1).text).toBe('1 star');
    expect(ratingWords(scale('half-stars-5'), 1).text).toBe('1 star');
  });

  it('says half stars with their half', () => {
    expect(ratingWords(scale('half-stars-5'), 4.5).text).toBe('4.5 stars');
  });

  it('draws a thumb but never announces the picture', () => {
    const up = ratingWords(scale('thumbs'), 1);
    expect(up.text).toBe('👍');
    expect(up.spoken).toBe('thumbs up');

    const down = ratingWords(scale('thumbs'), 0);
    expect(down.text).toBe('👎');
    expect(down.spoken).toBe('thumbs down');
  });

  it('says a tier is a tier', () => {
    expect(ratingWords(scale('tiers'), 5).text).toBe('S tier');
    expect(ratingWords(scale('tiers'), 0).text).toBe('F tier');
  });

  it('uses a custom scale’s own words', () => {
    const custom: RatingScale = {
      id: 'mood',
      kind: 'ordinal',
      label: 'Mood',
      min: 0,
      max: 2,
      step: 1,
      labels: ['Skip it', 'Fine', 'Play it again'],
      builtin: false,
    };
    expect(ratingWords(custom, 2).text).toBe('Play it again');
    expect(ratingWords(custom, 0).text).toBe('Skip it');
  });

  it('falls back to the number when a custom label is blank', () => {
    const custom: RatingScale = {
      id: 'gappy',
      kind: 'ordinal',
      label: 'Gappy',
      min: 0,
      max: 2,
      step: 1,
      labels: ['', 'Fine', 'Great'],
      builtin: false,
    };
    expect(ratingWords(custom, 0).text).toBe('0');
  });

  it('clamps a value that is off the end of its scale', () => {
    expect(ratingWords(scale('int-10'), 99).text).toBe('10/10');
    expect(ratingWords(scale('int-10'), -4).text).toBe('1/10');
  });

  it('reads the bottom of a scale that starts at zero', () => {
    expect(ratingWords(scale('decimal-10'), 0).text).toBe('0/10');
  });

  it('has one name for the absence of a rating', () => {
    expect(NOT_RATED.text).toBe('Not rated');
    expect(NOT_RATED.spoken).toBe('Not rated');
  });
});

describe('a rating said as a sentence', () => {
  it('finishes its own sentence', () => {
    expect(ratedSentence(scale('stars-5'), 4).text).toBe('You rated it 4 stars.');
    expect(ratedSentence(scale('int-100'), 67).text).toBe('You rated it 67/100.');
    expect(ratedSentence(scale('tiers'), 5).text).toBe('You rated it S tier.');
  });

  it('spells the thumb out for a screen reader', () => {
    const said = ratedSentence(scale('thumbs'), 1);
    expect(said.text).toBe('You rated it 👍.');
    expect(said.spoken).toBe('You rated it thumbs up.');
  });
});

describe('a rating made before the scale changed', () => {
  const today = scale('tiers');

  it('is said on the scale it was made on', () => {
    const words = eventWords(BUILTIN_SCALES, event({ scaleId: 'int-10', value: 6 }), today);
    expect(words.text).toBe('6/10');
  });

  it('is still said on that scale after the scale is deleted from the picker', () => {
    const retired: RatingScale = {
      id: 'mood',
      kind: 'ordinal',
      label: 'Mood',
      min: 0,
      max: 2,
      step: 1,
      labels: ['Skip it', 'Fine', 'Play it again'],
      builtin: false,
      deleted: 1,
    };
    const scales = [...BUILTIN_SCALES, retired];
    const words = eventWords(scales, { scaleId: 'mood', value: 2, normalized: 100 }, today);
    expect(words.text).toBe('Play it again');
  });

  it('falls back to today’s scale when its own has vanished entirely', () => {
    const words = eventWords(
      BUILTIN_SCALES,
      { scaleId: 'gone-for-good', value: 3, normalized: 100 },
      today,
    );
    expect(words.text).toBe('S tier');
  });

  it('finds a deleted scale but not a missing one', () => {
    expect(scaleOfEvent(BUILTIN_SCALES, { scaleId: 'int-10' })?.id).toBe('int-10');
    expect(scaleOfEvent(BUILTIN_SCALES, { scaleId: 'nope' })).toBeUndefined();
  });
});
