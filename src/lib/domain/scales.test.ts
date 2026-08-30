import { describe, expect, it } from 'vitest';

import {
  BUILTIN_SCALES,
  DEFAULT_SCALE_ID,
  ScaleError,
  clampNormalized,
  denormalize,
  detentCount,
  detentIndex,
  detentValues,
  findScale,
  formatMark,
  formatComputedOn,
  formatNormalizedOn,
  formatRaw,
  migrateRating,
  normalize,
  normalizedForDetent,
  resolveScale,
  scaleResolution,
  validateCustomScale,
} from './scales';
import type { RatingScale } from './types';

const scale = (id: string): RatingScale => {
  const found = findScale(BUILTIN_SCALES, id);
  if (!found) throw new Error(`missing fixture scale ${id}`);
  return found;
};

describe('normalization', () => {
  it('maps every built-in scale onto the same 0..100 axis', () => {
    for (const s of BUILTIN_SCALES) {
      expect(normalize(s, s.min)).toBe(0);
      expect(normalize(s, s.max)).toBe(100);
    }
  });

  it('places the midpoint of a symmetric scale at 50', () => {
    expect(normalize(scale('int-5'), 3)).toBe(50);
    expect(normalize(scale('stars-5'), 3)).toBe(50);
    expect(normalize(scale('decimal-10'), 5)).toBe(50);
  });

  it('clamps values outside the scale rather than extrapolating', () => {
    expect(normalize(scale('int-10'), -40)).toBe(0);
    expect(normalize(scale('int-10'), 1000)).toBe(100);
    expect(clampNormalized(Number.NaN)).toBe(0);
    expect(clampNormalized(120)).toBe(100);
  });

  it('round-trips through denormalize for every detent', () => {
    for (const s of BUILTIN_SCALES) {
      for (const value of detentValues(s)) {
        expect(denormalize(s, normalize(s, value))).toBeCloseTo(value, 6);
      }
    }
  });

  it('rejects a scale whose bounds are inverted', () => {
    const broken: RatingScale = {
      id: 'broken',
      kind: 'integer',
      label: 'broken',
      min: 5,
      max: 1,
      step: 1,
      builtin: false,
    };
    expect(() => normalize(broken, 3)).toThrow(ScaleError);
  });
});

describe('detents', () => {
  it('counts detents from the step, not the range', () => {
    expect(detentCount(scale('int-5'))).toBe(5);
    expect(detentCount(scale('half-stars-5'))).toBe(10);
    expect(detentCount(scale('decimal-10'))).toBe(101);
    expect(detentCount(scale('thumbs'))).toBe(2);
  });

  it('uses the label count for ordinal scales', () => {
    expect(detentCount(scale('grades'))).toBe(11);
  });

  it('seats a normalized value on the nearest detent', () => {
    const stars = scale('stars-5');
    expect(detentIndex(stars, 0)).toBe(0);
    expect(detentIndex(stars, 100)).toBe(4);
    expect(detentIndex(stars, 51)).toBe(2);
    expect(normalizedForDetent(stars, 4)).toBe(100);
    expect(normalizedForDetent(stars, 99)).toBe(100);
    expect(normalizedForDetent(stars, -3)).toBe(0);
  });

  it('never lets float drift push the last detent past the maximum', () => {
    const values = detentValues(scale('decimal-10'));
    expect(values[values.length - 1]).toBe(10);
  });
});

describe('migration between scales', () => {
  it('preserves the canonical value exactly', () => {
    const original = { normalized: 62.5 };
    const migrated = migrateRating(original, scale('grades'));
    expect(migrated.normalized).toBe(62.5);
    expect(migrated.scaleId).toBe('grades');
  });

  it('survives a round trip from stars to grades and back within one detent', () => {
    const stars = scale('stars-5');
    const grades = scale('grades');
    for (const value of detentValues(stars)) {
      const asStars = { normalized: normalize(stars, value) };
      const asGrades = migrateRating(asStars, grades);
      const back = migrateRating(asGrades, stars);
      expect(Math.abs(back.value - value)).toBeLessThanOrEqual(stars.step);
      // The canonical history never moves, whatever the display scale does.
      expect(back.normalized).toBe(asStars.normalized);
    }
  });

  it('collapses gracefully onto a coarser scale without losing history', () => {
    const hundred = scale('int-100');
    const thumbs = scale('thumbs');
    const original = { normalized: normalize(hundred, 73) };
    const asThumbs = migrateRating(original, thumbs);
    expect(asThumbs.value).toBe(1);
    expect(asThumbs.normalized).toBeCloseTo(original.normalized, 6);
    // Going back reads the preserved canonical value, not the collapsed one.
    expect(migrateRating(asThumbs, hundred).value).toBe(73);
  });
});

describe('formatting', () => {
  it('prints ordinal labels rather than numbers', () => {
    expect(formatRaw(scale('grades'), 10)).toBe('A+');
    expect(formatRaw(scale('grades'), 0)).toBe('E');
    expect(formatNormalizedOn(scale('grades'), 100)).toBe('A+');
    expect(formatNormalizedOn(scale('grades'), 0)).toBe('E');
  });

  it('prints stars with a star mark and decimals with one place', () => {
    expect(formatMark(scale('stars-5'), 4)).toBe('4★');
    expect(formatMark(scale('half-stars-5'), 3.5)).toBe('3.5★');
    expect(formatRaw(scale('decimal-10'), 7.25)).toBe('7.3');
  });

  it('prints thumbs as arrows', () => {
    expect(formatNormalizedOn(scale('thumbs'), 100)).toBe('↑');
    expect(formatNormalizedOn(scale('thumbs'), 0)).toBe('↓');
  });
});

describe('computed scores', () => {
  it('keeps a decimal on coarse numeric scales so a close order stays readable', () => {
    // Three distinct rollups that all round to 6 on a 1..10 scale.
    const ten = scale('int-10');
    const printed = [55.6, 58.0, 61.1].map((n) => formatComputedOn(ten, n));
    expect(printed).toEqual(['6.0', '6.2', '6.5']);
    expect(new Set(printed).size).toBe(3);
  });

  it('does not invent precision on a scale that already has plenty', () => {
    expect(formatComputedOn(scale('int-100'), 62.4)).toBe('63');
    expect(formatComputedOn(scale('int-100'), 62.4)).not.toContain('.');
  });

  it('rounds to a real label on ordinal scales, which have no fractions', () => {
    expect(formatComputedOn(scale('grades'), 62.5)).toBe(formatNormalizedOn(scale('grades'), 62.5));
    expect(formatComputedOn(scale('thumbs'), 90)).toBe('↑');
  });

  it('never prints outside the scale', () => {
    for (const s of BUILTIN_SCALES) {
      expect(formatComputedOn(s, 0)).toBe(formatComputedOn(s, -20));
      expect(formatComputedOn(s, 100)).toBe(formatComputedOn(s, 140));
    }
  });
});

describe('resolution and validation', () => {
  it('reports coarse scales as lower resolution', () => {
    expect(scaleResolution(scale('thumbs'))).toBeLessThan(scaleResolution(scale('int-5')));
    expect(scaleResolution(scale('int-5'))).toBeLessThan(scaleResolution(scale('int-100')));
  });

  it('falls back to the default scale when an id is unknown', () => {
    expect(resolveScale(BUILTIN_SCALES, 'nope').id).toBe(DEFAULT_SCALE_ID);
  });

  it('never resolves a deleted scale', () => {
    const deleted: RatingScale[] = [{ ...scale('int-10'), deleted: 1 }];
    expect(findScale(deleted, 'int-10')).toBeUndefined();
  });

  it('validates custom scales', () => {
    expect(
      validateCustomScale({
        label: 'Tiers',
        kind: 'ordinal',
        min: 0,
        max: 3,
        step: 1,
        labels: ['D', 'C', 'B', 'A'],
      }),
    ).toBeNull();
    expect(validateCustomScale({ label: '', kind: 'integer', min: 0, max: 3, step: 1 })).toMatch(
      /name/i,
    );
    expect(validateCustomScale({ label: 'x', kind: 'integer', min: 3, max: 3, step: 1 })).toMatch(
      /above/i,
    );
    expect(validateCustomScale({ label: 'x', kind: 'integer', min: 0, max: 10, step: 3 })).toMatch(
      /divide evenly/i,
    );
    expect(
      validateCustomScale({ label: 'x', kind: 'ordinal', min: 0, max: 2, step: 1, labels: ['a'] }),
    ).toMatch(/exactly 3 labels/i);
  });
});
