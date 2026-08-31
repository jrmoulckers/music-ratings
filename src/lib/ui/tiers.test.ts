import { describe, expect, it } from 'vitest';

import { BUILTIN_SCALES, findScale } from '../domain/scales';
import type { RatingScale } from '../domain/types';
import { TIER_COLORS, TIER_INK, isTierScale, tierColor, tierPalette } from './tiers';

const scale = (id: string): RatingScale => {
  const found = findScale(BUILTIN_SCALES, id);
  if (!found) throw new Error(`missing fixture scale ${id}`);
  return found;
};

/** WCAG relative luminance, so the contrast claim is measured and not asserted. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return (
    0.2126 * (linear[0] as number) + 0.7152 * (linear[1] as number) + 0.0722 * (linear[2] as number)
  );
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('tier colours', () => {
  it('uses the palette everybody already knows', () => {
    expect(TIER_COLORS).toEqual({
      S: '#ff7f7f',
      A: '#ffbf7f',
      B: '#ffdf7f',
      C: '#ffff7f',
      D: '#bfff7f',
      F: '#7fff7f',
    });
  });

  it('maps the built-in tier scale in its own order, lowest detent first', () => {
    // The domain stores tiers ascending — F, D, C, B, A, S — so the first
    // detent is the green one and the last is the red one. Reading this list
    // backwards is the single mistake this test exists to catch.
    expect(tierPalette(scale('tiers'))).toEqual([
      '#7fff7f', // F
      '#bfff7f', // D
      '#ffff7f', // C
      '#ffdf7f', // B
      '#ffbf7f', // A
      '#ff7f7f', // S
    ]);
  });

  it('lands S on red and F on green, whichever way it is asked', () => {
    const palette = tierPalette(scale('tiers'));
    const labels = scale('tiers').labels;
    expect(palette?.[labels?.indexOf('S') ?? -1]).toBe('#ff7f7f');
    expect(palette?.[labels?.indexOf('F') ?? -1]).toBe('#7fff7f');
    expect(tierColor('S')).toBe('#ff7f7f');
    expect(tierColor('f')).toBe('#7fff7f');
    expect(tierColor(' b ')).toBe('#ffdf7f');
    expect(tierColor('E')).toBeNull();
  });

  it('recognises a tier list however it is ordered, and nothing else', () => {
    expect(isTierScale(scale('tiers'))).toBe(true);
    const descending: RatingScale = {
      id: 'tiers-down',
      kind: 'ordinal',
      label: 'Tiers, top first',
      min: 0,
      max: 5,
      step: 1,
      builtin: false,
      labels: ['S', 'A', 'B', 'C', 'D', 'F'],
    };
    expect(isTierScale(descending)).toBe(true);
    expect(tierPalette(descending)).toEqual([
      '#ff7f7f',
      '#ffbf7f',
      '#ffdf7f',
      '#ffff7f',
      '#bfff7f',
      '#7fff7f',
    ]);
  });

  it('leaves every other scale uncoloured', () => {
    for (const s of BUILTIN_SCALES) {
      if (s.id === 'tiers') continue;
      expect(tierPalette(s)).toBeNull();
      expect(isTierScale(s)).toBe(false);
    }
    const sixLabels: RatingScale = {
      id: 'grades',
      kind: 'ordinal',
      label: 'Six grades',
      min: 0,
      max: 5,
      step: 1,
      builtin: false,
      labels: ['Awful', 'Poor', 'Fair', 'Good', 'Great', 'Best'],
    };
    expect(tierPalette(sixLabels)).toBeNull();
  });

  it('keeps its own dark ink legible on every tier, in either theme', () => {
    for (const hex of Object.values(TIER_COLORS)) {
      expect(contrast(TIER_INK, hex)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
