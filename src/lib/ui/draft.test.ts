import { describe, expect, it } from 'vitest';

import { BUILTIN_SCALES, findScale, normalize } from '../domain/scales';
import type { RatingScale } from '../domain/types';
import { canSaveDraft, restingValue, settleTyped, steppedFrom } from './draft';

const scale = (id: string): RatingScale => {
  const found = findScale(BUILTIN_SCALES, id);
  if (!found) throw new Error(`missing fixture scale ${id}`);
  return found;
};

const decimal = scale('decimal-10');
const hundred = scale('int-100');

describe('the resting position', () => {
  it('stands a fresh control in the middle, because it has to stand somewhere', () => {
    expect(restingValue(decimal)).toBe(5);
    expect(restingValue(hundred)).toBe(51);
    expect(restingValue(scale('int-10'))).toBe(6);
  });

  it('is never a value anyone can step off', () => {
    // This is the whole bug: + on an unrated 0.0–10.0 control used to read the
    // resting 5.0 and record 5.1 as if the reader had chosen it.
    expect(steppedFrom(decimal, null, 1)).toBeNull();
    expect(steppedFrom(decimal, null, -1)).toBeNull();
    expect(steppedFrom(hundred, null, 1)).toBeNull();
    expect(canSaveDraft(null, null)).toBe(false);
  });
});

describe('stepping', () => {
  it('starts from the value that is actually there', () => {
    expect(steppedFrom(decimal, 5, 1)).toBe(5.1);
    expect(steppedFrom(decimal, 5, -1)).toBe(4.9);
    expect(steppedFrom(hundred, 73, 1)).toBe(74);
    expect(steppedFrom(hundred, 73, -1)).toBe(72);
  });

  it('moves one raw step of the scale, not one of anything else', () => {
    expect(steppedFrom(decimal, 7.3, 1)).toBe(7.4);
    expect(steppedFrom(scale('int-10'), 7, 1)).toBe(8);
  });

  it('walks a tenth at a time without collecting float dust', () => {
    let at = 0;
    for (let i = 0; i < 100; i += 1) {
      at = steppedFrom(decimal, at, 1) as number;
      // Every value on the way is one the scale can hold and print exactly.
      expect(at).toBe(Number(at.toFixed(1)));
    }
    expect(at).toBe(10);
    for (let i = 0; i < 100; i += 1) at = steppedFrom(decimal, at, -1) as number;
    expect(at).toBe(0);
  });

  it('stops at the ends rather than running past them', () => {
    expect(steppedFrom(decimal, 10, 1)).toBe(10);
    expect(steppedFrom(decimal, 0, -1)).toBe(0);
    expect(steppedFrom(hundred, 100, 1)).toBe(100);
    expect(steppedFrom(hundred, 1, -1)).toBe(1);
  });
});

describe('typing', () => {
  it('leaves an untouched or emptied box alone rather than reading it as an opinion', () => {
    expect(settleTyped(decimal, null)).toEqual({ kind: 'unchanged' });
    expect(settleTyped(decimal, '')).toEqual({ kind: 'unchanged' });
    expect(settleTyped(decimal, '   ')).toEqual({ kind: 'unchanged' });
  });

  it('snaps a legal number to something the scale can hold', () => {
    expect(settleTyped(decimal, '7.34')).toEqual({ kind: 'value', value: 7.3 });
    expect(settleTyped(hundred, '42')).toEqual({ kind: 'value', value: 42 });
  });

  it('brings an out-of-range number back and says what it did', () => {
    const high = settleTyped(decimal, '14');
    expect(high.kind).toBe('clamped');
    if (high.kind !== 'clamped') throw new Error('expected clamping');
    expect(high.value).toBe(10);
    expect(high.complaint).toBe('This scale runs from 0.0 and 10.0, so that became 10.0.');

    const low = settleTyped(hundred, '-8');
    expect(low.kind).toBe('clamped');
    if (low.kind !== 'clamped') throw new Error('expected clamping');
    expect(low.value).toBe(1);
  });

  it('refuses nonsense out loud instead of swallowing it', () => {
    const bad = settleTyped(decimal, 'seven');
    expect(bad.kind).toBe('rejected');
    if (bad.kind !== 'rejected') throw new Error('expected rejection');
    expect(bad.complaint).toBe('Enter a number between 0.0 and 10.0.');
  });
});

describe('saving', () => {
  it('has nothing to save until a draft exists', () => {
    expect(canSaveDraft(null, null)).toBe(false);
    expect(canSaveDraft(null, 7)).toBe(false);
  });

  it('has nothing to save when the draft says what is already recorded', () => {
    expect(canSaveDraft(7, 7)).toBe(false);
    expect(canSaveDraft(7.1, 7)).toBe(true);
  });

  it('saves a first rating as readily as a changed one', () => {
    expect(canSaveDraft(5.1, null)).toBe(true);
  });

  it('sends the canonical value, so the record does not depend on the scale drawn', () => {
    expect(normalize(decimal, 5.1)).toBeCloseTo(51, 6);
    expect(normalize(hundred, 73)).toBeCloseTo(73, 6);
  });
});
