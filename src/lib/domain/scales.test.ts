import { describe, expect, it } from 'vitest';

import {
  BUILTIN_SCALES,
  DEFAULT_SCALE_ID,
  EQUIVALENCE_BANDS,
  EQUIVALENCE_MAX_ROWS,
  RAIL_MAX_DETENTS,
  RAIL_MAX_LABELS,
  RANGE_SEPARATOR,
  ScaleError,
  clampNormalized,
  convertValue,
  denormalize,
  detentCount,
  detentIndex,
  detentValues,
  equivalenceRows,
  findScale,
  formatMark,
  formatComputedOn,
  formatNormalizedOn,
  formatRaw,
  isDenseScale,
  markIcon,
  migrateRating,
  nextGraduation,
  normalize,
  normalizedForDetent,
  railLabelBudget,
  railTicks,
  resolveScale,
  scaleResolution,
  snapRaw,
  validateCustomScale,
} from './scales';
import type { RatingScale } from './types';

const scale = (id: string): RatingScale => {
  const found = findScale(BUILTIN_SCALES, id);
  if (!found) throw new Error(`missing fixture scale ${id}`);
  return found;
};

describe('normalization', () => {
  it('keeps every built-in scale inside the canonical axis and pointing the same way', () => {
    for (const s of BUILTIN_SCALES) {
      const values = detentValues(s);
      const projected = values.map((v) => normalize(s, v));
      expect(Math.min(...projected)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...projected)).toBeLessThanOrEqual(100);
      // Strictly ascending: a higher rating is always a higher canonical value.
      for (let i = 1; i < projected.length; i += 1) {
        expect(projected[i] as number).toBeGreaterThan(projected[i - 1] as number);
      }
    }
  });

  it('reads a numeric scale as a fraction of its maximum, which is what people mean', () => {
    expect(normalize(scale('int-10'), 7)).toBe(70);
    expect(normalize(scale('decimal-10'), 7)).toBe(70);
    expect(normalize(scale('int-100'), 70)).toBe(70);
    expect(normalize(scale('stars-5'), 3.5 as number)).toBe(70);
    expect(normalize(scale('int-5'), 4)).toBe(80);
    expect(normalize(scale('stars-5'), 5)).toBe(100);
  });

  it('does not let a coarse judgement scale claim the extremes', () => {
    // A thumbs-up says "I like this", not "this is a flawless 10".
    expect(normalize(scale('thumbs'), 1)).toBe(80);
    expect(normalize(scale('thumbs'), 0)).toBe(20);
  });

  it('clamps values outside the scale rather than extrapolating', () => {
    expect(normalize(scale('int-10'), -40)).toBe(normalize(scale('int-10'), 1));
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
    expect(detentCount(scale('tiers'))).toBe(6);
  });

  it('seats a normalized value on the nearest detent', () => {
    const stars = scale('stars-5');
    expect(detentIndex(stars, 0)).toBe(0);
    expect(detentIndex(stars, 100)).toBe(4);
    expect(detentIndex(stars, 61)).toBe(2);
    expect(normalizedForDetent(stars, 4)).toBe(100);
    expect(normalizedForDetent(stars, 99)).toBe(100);
    expect(normalizedForDetent(stars, -3)).toBe(20);
  });

  it('never lets float drift push the last detent past the maximum', () => {
    const values = detentValues(scale('decimal-10'));
    expect(values[values.length - 1]).toBe(10);
  });
});

describe('rail density', () => {
  it('decides by how many detents a scale cuts, never by its name', () => {
    // Everything a hand can seat one notch at a time stays a detent rail.
    for (const id of ['stars-5', 'half-stars-5', 'int-3', 'int-5', 'int-10', 'thumbs', 'tiers']) {
      expect(isDenseScale(scale(id)), id).toBe(false);
    }
    // Everything past that is a ruler nobody can read, and gets the slider.
    expect(isDenseScale(scale('int-100'))).toBe(true);
    expect(isDenseScale(scale('decimal-10'))).toBe(true);
  });

  it('draws the line at the last count a rail can still seat', () => {
    const at = (max: number): RatingScale => ({
      id: 'probe',
      label: 'probe',
      kind: 'integer',
      builtin: false,
      min: 1,
      max,
      step: 1,
    });
    expect(detentCount(at(RAIL_MAX_DETENTS))).toBe(RAIL_MAX_DETENTS);
    expect(isDenseScale(at(RAIL_MAX_DETENTS))).toBe(false);
    expect(isDenseScale(at(RAIL_MAX_DETENTS + 1))).toBe(true);
  });
});

describe('rail graduations', () => {
  const labelled = (ticks: ReturnType<typeof railTicks>) =>
    ticks.filter((t) => t.label !== null).map((t) => t.label);

  it('prints round numbers across 1 to 100 instead of a hundred detents', () => {
    expect(labelled(railTicks(scale('int-100'), 11))).toEqual([
      '1',
      '10',
      '20',
      '30',
      '40',
      '50',
      '60',
      '70',
      '80',
      '90',
      '100',
    ]);
  });

  it('thins the graduations rather than the range when there is less room', () => {
    expect(labelled(railTicks(scale('int-100'), 6))).toEqual(['1', '20', '40', '60', '80', '100']);
    // The budget is a ceiling, so a rail this narrow steps in fifties rather
    // than printing five labels it does not have room for.
    expect(labelled(railTicks(scale('int-100'), 4))).toEqual(['1', '50', '100']);
    expect(labelled(railTicks(scale('int-100'), 2))).toEqual(['1', '100']);
  });

  it('formats decimal graduations in the scale\u2019s own precision', () => {
    expect(labelled(railTicks(scale('decimal-10'), 6))).toEqual([
      '0.0',
      '2.0',
      '4.0',
      '6.0',
      '8.0',
      '10.0',
    ]);
    // A half-step is only offered where the scale can actually land on it.
    expect(labelled(railTicks(scale('decimal-10'), 5))).toEqual([
      '0.0',
      '2.5',
      '5.0',
      '7.5',
      '10.0',
    ]);
  });

  it('never puts a mark on a value the scale cannot reach', () => {
    // Labelled or not, every mark stands on a real step: an integer rail has
    // nowhere to put 50.5.
    for (const budget of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      for (const tick of railTicks(scale('int-100'), budget)) {
        expect(Number.isInteger(tick.value), `${budget} produced ${tick.value}`).toBe(true);
      }
      for (const tick of railTicks(scale('decimal-10'), budget)) {
        expect(tick.value, `${budget} produced ${tick.value}`).toBe(
          snapRaw(scale('decimal-10'), tick.value),
        );
      }
    }
  });

  it('always prints both ends, so the reader knows what the rail spans', () => {
    for (const id of ['int-100', 'decimal-10']) {
      for (const budget of [2, 3, 5, 7, 11]) {
        const marks = labelled(railTicks(scale(id), budget));
        expect(marks[0], `${id}@${budget}`).toBe(formatRaw(scale(id), scale(id).min));
        expect(marks[marks.length - 1], `${id}@${budget}`).toBe(
          formatRaw(scale(id), scale(id).max),
        );
      }
    }
  });

  it('drops a graduation that would collide with an end rather than crowd it', () => {
    // 1 and 100 are the ends; a major at 100 must not be doubled by one at 99.
    const values = railTicks(scale('int-100'), 11).map((t) => t.value);
    expect(values).not.toContain(99);
    expect(values.filter((v) => v === 100)).toHaveLength(1);
  });

  it('places every mark along the rail in order and inside it', () => {
    for (const id of ['int-100', 'decimal-10']) {
      const ticks = railTicks(scale(id), 11);
      const ats = ticks.map((t) => t.at);
      expect(ats.at(0)).toBe(0);
      expect(ats.at(-1)).toBe(1);
      for (const t of ticks) {
        expect(t.at, `${id} ${t.value}`).toBeGreaterThanOrEqual(0);
        expect(t.at, `${id} ${t.value}`).toBeLessThanOrEqual(1);
      }
      for (let i = 1; i < ats.length; i += 1) {
        expect(ats[i] as number, `${id} at ${i}`).toBeGreaterThan(ats[i - 1] as number);
      }
    }
  });

  it('measures position against the raw scale, not the canonical axis', () => {
    // 1 on a 1..100 scale normalizes to 1, not 0. Reading position off the
    // canonical axis would slide every graduation out from under the thumb.
    const first = railTicks(scale('int-100'), 11).at(0);
    expect(first?.value).toBe(1);
    expect(first?.at).toBe(0);
    expect(normalize(scale('int-100'), 1)).not.toBe(0);
  });

  it('keeps unlabelled marks between the printed ones for orientation', () => {
    const ticks = railTicks(scale('int-100'), 11);
    expect(ticks.filter((t) => t.label === null).length).toBeGreaterThan(0);
    // A minor never sits on top of a major.
    const majors = new Set(ticks.filter((t) => t.label !== null).map((t) => t.value));
    for (const t of ticks) if (t.label === null) expect(majors.has(t.value)).toBe(false);
  });
});

describe('rail label budget', () => {
  it('prints more graduations on a wide rail than a narrow one', () => {
    const wide = railLabelBudget(1200, scale('int-100'));
    const phone = railLabelBudget(390, scale('int-100'));
    const tiny = railLabelBudget(320, scale('int-100'));
    expect(wide).toBeGreaterThan(phone);
    expect(phone).toBeGreaterThanOrEqual(tiny);
  });

  it('never asks for more graduations than a rail can carry, or fewer than two', () => {
    for (const width of [0, 40, 200, 390, 800, 1200, 4000]) {
      const budget = railLabelBudget(width, scale('int-100'));
      expect(budget, `${width}px`).toBeGreaterThanOrEqual(2);
      expect(budget, `${width}px`).toBeLessThanOrEqual(RAIL_MAX_LABELS);
    }
  });

  it('gives wide decimal labels more room each than narrow integer ones', () => {
    expect(railLabelBudget(390, scale('decimal-10'))).toBeLessThanOrEqual(
      railLabelBudget(390, scale('int-100')),
    );
  });
});

describe('snapping a raw value', () => {
  it('holds a typed value inside the scale', () => {
    expect(snapRaw(scale('int-100'), 250)).toBe(100);
    expect(snapRaw(scale('int-100'), -9)).toBe(1);
    expect(snapRaw(scale('decimal-10'), 99)).toBe(10);
    expect(snapRaw(scale('decimal-10'), -1)).toBe(0);
  });

  it('lands on a step the scale actually has', () => {
    expect(snapRaw(scale('int-100'), 36.7)).toBe(37);
    expect(snapRaw(scale('decimal-10'), 4.44)).toBe(4.4);
    expect(snapRaw(scale('decimal-10'), 4.46)).toBe(4.5);
  });

  it('does not leave float dust on a decimal step', () => {
    for (let i = 0; i <= 100; i += 1) {
      const snapped = snapRaw(scale('decimal-10'), i / 10);
      expect(String(snapped).replace('-', '').split('.')[1]?.length ?? 0).toBeLessThanOrEqual(1);
    }
  });

  it('refuses a value that is not a number', () => {
    expect(snapRaw(scale('int-100'), Number.NaN)).toBe(1);
  });
});

describe('jumping between graduations', () => {
  const ticks = railTicks(scale('int-100'), 11);

  it('moves to the next printed graduation, not a hidden fraction', () => {
    expect(nextGraduation(ticks, 1, 1)).toBe(10);
    expect(nextGraduation(ticks, 10, 1)).toBe(20);
    expect(nextGraduation(ticks, 44, 1)).toBe(50);
    expect(nextGraduation(ticks, 44, -1)).toBe(40);
    expect(nextGraduation(ticks, 100, -1)).toBe(90);
  });

  it('stops at the ends instead of wrapping', () => {
    expect(nextGraduation(ticks, 100, 1)).toBeNull();
    expect(nextGraduation(ticks, 1, -1)).toBeNull();
  });
});

describe('migration between scales', () => {
  it('preserves the canonical value exactly', () => {
    const original = { normalized: 62.5 };
    const migrated = migrateRating(original, scale('tiers'));
    expect(migrated.normalized).toBe(62.5);
    expect(migrated.scaleId).toBe('tiers');
  });

  it('survives a round trip from stars to tiers and back within one detent', () => {
    const stars = scale('stars-5');
    const tiers = scale('tiers');
    for (const value of detentValues(stars)) {
      const asStars = { normalized: normalize(stars, value) };
      const asTiers = migrateRating(asStars, tiers);
      const back = migrateRating(asTiers, stars);
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
    expect(formatRaw(scale('tiers'), 5)).toBe('S');
    expect(formatRaw(scale('tiers'), 0)).toBe('F');
    expect(formatNormalizedOn(scale('tiers'), 100)).toBe('S');
    expect(formatNormalizedOn(scale('tiers'), 0)).toBe('F');
  });

  it('prints stars with a star mark and decimals with one place', () => {
    expect(formatMark(scale('stars-5'), 4)).toBe('4★');
    expect(formatMark(scale('half-stars-5'), 3.5)).toBe('3.5★');
    expect(formatRaw(scale('decimal-10'), 7.25)).toBe('7.3');
  });

  it('spells thumbs as words and names an icon to draw them with', () => {
    const thumbs = scale('thumbs');
    // No arrows: an arrow is a direction, not a verdict.
    expect(formatNormalizedOn(thumbs, 100)).toBe('Up');
    expect(formatNormalizedOn(thumbs, 0)).toBe('Down');
    expect(formatMark(thumbs, 1)).toBe('Up');
    expect(formatMark(thumbs, 0)).toBe('Down');
    expect(markIcon(thumbs, 1)).toBe('thumb-up');
    expect(markIcon(thumbs, 0)).toBe('thumb-down');
    // Out of range still lands on a real end of the scale.
    expect(markIcon(thumbs, 9)).toBe('thumb-up');
    expect(markIcon(thumbs, -4)).toBe('thumb-down');
  });

  it('names no icon for scales that spell their marks', () => {
    for (const s of BUILTIN_SCALES) {
      if (s.id === 'thumbs') continue;
      for (const value of detentValues(s)) expect(markIcon(s, value)).toBeUndefined();
    }
  });
});

describe('cross-scale equivalence', () => {
  const ten = scale('int-10');
  const hundred = scale('int-100');
  const stars = scale('stars-5');
  const halves = scale('half-stars-5');
  const decimal = scale('decimal-10');
  const tiers = scale('tiers');

  it('treats the same judgement on different numeric scales as the same value', () => {
    // The bug this guards: "7 out of 10" used to become "6.7 out of 10" when a
    // user switched between the integer and decimal ten-point scales.
    const same = [
      [ten, 7],
      [decimal, 7],
      [hundred, 70],
      [halves, 3.5],
    ] as const;
    const values = same.map(([s, v]) => normalize(s, v));
    for (const v of values) expect(v).toBe(70);
  });

  it('lands the five-star scale exactly on the tier letters', () => {
    const expected = ['D', 'C', 'B', 'A', 'S'];
    const got = detentValues(stars).map((v) => formatNormalizedOn(tiers, normalize(stars, v)));
    expect(got).toEqual(expected);
  });

  it('reads the ten-point scale onto tiers without a jump or a gap', () => {
    const got = detentValues(ten).map((v) => formatNormalizedOn(tiers, normalize(ten, v)));
    expect(got).toEqual(['F', 'D', 'D', 'C', 'C', 'B', 'B', 'A', 'A', 'S']);
  });

  it('keeps every conversion monotonic: a better rating never converts to a worse one', () => {
    for (const from of BUILTIN_SCALES) {
      for (const to of BUILTIN_SCALES) {
        let previous = -Infinity;
        for (const value of detentValues(from)) {
          const converted = convertValue(from, value, to);
          expect(converted).toBeGreaterThanOrEqual(previous);
          previous = converted;
        }
      }
    }
  });

  it('round-trips every detent of every scale through every other scale of equal or finer grain', () => {
    for (const from of BUILTIN_SCALES) {
      for (const to of BUILTIN_SCALES) {
        // Converting into a coarser scale legitimately loses detail; only the
        // journey through an equally or more precise scale must come back.
        if (detentCount(to) < detentCount(from)) continue;
        for (const value of detentValues(from)) {
          const there = convertValue(from, value, to);
          const back = convertValue(to, there, from);
          expect(back).toBeCloseTo(value, 6);
        }
      }
    }
  });

  it('tabulates equivalences for display without inventing positions', () => {
    const rows = equivalenceRows(tiers, [stars, ten]);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.label)).toEqual(['F', 'D', 'C', 'B', 'A', 'S']);
    expect(rows.every((r) => !r.banded)).toBe(true);
    expect(rows[5]?.on.map((c) => c.label)).toEqual(['5★', '10']);
    expect(rows[0]?.on.map((c) => c.label)).toEqual(['1★', '1']);
  });

  it('bands a hundred-point scale into ranges instead of a hundred rows', () => {
    const rows = equivalenceRows(hundred, [stars, tiers]);
    expect(rows).toHaveLength(EQUIVALENCE_BANDS);
    expect(rows.every((r) => r.banded)).toBe(true);
    expect(rows[0]?.label).toBe(`1${RANGE_SEPARATOR}10`);
    expect(rows[9]?.label).toBe(`91${RANGE_SEPARATOR}100`);
    // Bands tile the scale exactly: nothing sampled away, nothing counted twice.
    expect(rows.map((r) => [r.from, r.to])).toEqual([
      [1, 10],
      [11, 20],
      [21, 30],
      [31, 40],
      [41, 50],
      [51, 60],
      [61, 70],
      [71, 80],
      [81, 90],
      [91, 100],
    ]);
  });

  it('bands the decimal scale on the round boundaries a reader expects', () => {
    const rows = equivalenceRows(decimal, [ten]);
    expect(rows).toHaveLength(EQUIVALENCE_BANDS);
    expect(rows[0]?.label).toBe(`0.0${RANGE_SEPARATOR}1.0`);
    expect(rows[1]?.label).toBe(`1.1${RANGE_SEPARATOR}2.0`);
    expect(rows[9]?.label).toBe(`9.1${RANGE_SEPARATOR}10.0`);
    expect(rows.at(-1)?.to).toBe(decimal.max);
  });

  it('collapses a cell to one value when both ends of a band read alike', () => {
    const rows = equivalenceRows(hundred, [stars, decimal]);
    const first = rows[0];
    // 1 through 10 are all one star, so the star column says so once...
    expect(first?.on[0]).toMatchObject({ label: '1★', ranged: false });
    // ...but the decimal scale genuinely moves across the band, so it ranges.
    expect(first?.on[1]).toMatchObject({
      label: `0.1${RANGE_SEPARATOR}1.0`,
      ranged: true,
    });
  });

  it('enumerates every detent of a scale coarse enough to read', () => {
    for (const s of [ten, stars, halves, tiers, scale('thumbs')]) {
      expect(detentCount(s)).toBeLessThanOrEqual(EQUIVALENCE_MAX_ROWS);
      expect(equivalenceRows(s, [hundred])).toHaveLength(detentCount(s));
    }
  });

  it('hands the view an icon to draw wherever a thumb is the reading', () => {
    const rows = equivalenceRows(scale('thumbs'), [hundred]);
    expect(rows.map((r) => r.head.ends[0]?.icon)).toEqual(['thumb-down', 'thumb-up']);
    expect(rows.map((r) => r.label)).toEqual(['Down', 'Up']);
    // Read the other way, a whole band of the hundred-point scale is one thumb.
    const banded = equivalenceRows(hundred, [scale('thumbs')]);
    expect(banded[0]?.on[0]).toMatchObject({ label: 'Down', ranged: false });
    expect(banded[0]?.on[0]?.ends[0]?.icon).toBe('thumb-down');
    expect(banded.at(-1)?.on[0]?.ends[0]?.icon).toBe('thumb-up');
  });
});

describe('computed scores', () => {
  it('keeps a decimal on coarse numeric scales so a close order stays readable', () => {
    // Three distinct rollups that all round to the same detent on a 1..10 scale.
    const ten = scale('int-10');
    const printed = [55.6, 58.0, 61.1].map((n) => formatComputedOn(ten, n));
    expect(printed).toEqual(['5.6', '5.8', '6.1']);
    expect(new Set(printed).size).toBe(3);
  });

  it('does not invent precision on a scale that already has plenty', () => {
    expect(formatComputedOn(scale('int-100'), 62.4)).toBe('62');
    expect(formatComputedOn(scale('int-100'), 62.4)).not.toContain('.');
  });

  it('rounds to a real label on ordinal scales, which have no fractions', () => {
    expect(formatComputedOn(scale('tiers'), 62.5)).toBe(formatNormalizedOn(scale('tiers'), 62.5));
    expect(formatComputedOn(scale('thumbs'), 90)).toBe('Up');
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
