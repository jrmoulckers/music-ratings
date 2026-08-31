import type { RatingScale } from '../domain/types';

/**
 * The tier list, in the colours a tier list is.
 *
 * S red through F green is not a palette anyone invented for this app — it is
 * the one everybody has already seen a thousand times, and a tier list drawn in
 * the house accent would be a tier list nobody recognises. So the six hexes
 * live here, once, and every control that draws a tier reads them from here.
 *
 * They are the only colours in the product that are not the accent, and they
 * are allowed because they carry meaning that the shape cannot.
 */
export const TIER_COLORS = {
  S: '#ff7f7f',
  A: '#ffbf7f',
  B: '#ffdf7f',
  C: '#ffff7f',
  D: '#bfff7f',
  F: '#7fff7f',
} as const;

export type TierLabel = keyof typeof TIER_COLORS;

/**
 * Every tier colour is a pale pastel, so the ink on them is dark in both
 * themes. Flipping it to the page's own ink would put white on `#ffff7f` in
 * dark mode and lose the label entirely.
 */
export const TIER_INK = '#17171b';
/** Enough of a hairline to hold the swatch against a dark page. */
export const TIER_EDGE = 'rgb(0 0 0 / 0.35)';

const TIER_ORDER = Object.keys(TIER_COLORS) as TierLabel[];

function tierMarks(scale: RatingScale): string[] | null {
  const marks = scale.marks?.length ? scale.marks : scale.labels;
  if (!marks || marks.length !== TIER_ORDER.length) return null;
  const upper = marks.map((mark) => mark.trim().toUpperCase());
  const seen = new Set(upper);
  if (seen.size !== TIER_ORDER.length) return null;
  return TIER_ORDER.every((tier) => seen.has(tier)) ? upper : null;
}

/** The colour a named tier is drawn in, or null when the name is not a tier. */
export function tierColor(label: string): string | null {
  const key = label.trim().toUpperCase();
  return key in TIER_COLORS ? TIER_COLORS[key as TierLabel] : null;
}

/** Whether this scale is a tier list — S to F, in any order. */
export function isTierScale(scale: RatingScale): boolean {
  return tierMarks(scale) !== null;
}

/**
 * The tier colours in the scale's own detent order, lowest detent first.
 *
 * The domain stores tiers ascending — F, D, C, B, A, S — so index 0 is the
 * green one and index 5 is the red one. Mapping by name rather than by
 * position is what keeps that from being read backwards.
 */
export function tierPalette(scale: RatingScale): string[] | null {
  const marks = tierMarks(scale);
  if (!marks) return null;
  return marks.map((mark) => TIER_COLORS[mark as TierLabel]);
}
