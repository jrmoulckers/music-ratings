import { clampRaw, formatRaw, snapRaw } from '../domain/scales';
import type { RatingScale } from '../domain/types';

/**
 * The draft, for scales that are composed rather than chosen.
 *
 * A five-star rating is one press: the press *is* the decision. A rating out of
 * a hundred is not — it is dragged, typed, nudged, second-guessed and only then
 * given. So the dense controls hold a draft, and these are the rules that
 * govern it, kept out of the components so the compact row and the full rail
 * cannot drift apart on what a nudge or a typed number means.
 *
 * The one rule everything else follows from: a slider with nothing in it rests
 * in the middle because it must rest somewhere, and that resting position is
 * never a value. Stepping off it would record a five out of ten that nobody
 * chose, so there is nothing to step from until the reader says where to start.
 */

/** What +/- lands on, or null when there is nothing yet to step from. */
export function steppedFrom(
  scale: RatingScale,
  held: number | null,
  direction: 1 | -1,
): number | null {
  if (held === null) return null;
  return snapRaw(scale, held + direction * scale.step);
}

export type Settled =
  /** Nothing was typed; whatever was there stands. */
  | { kind: 'unchanged' }
  /** Legal, and snapped to something the scale can hold. */
  | { kind: 'value'; value: number }
  /** Out of range, so it was brought back in and the reader is told. */
  | { kind: 'clamped'; value: number; complaint: string }
  /** Not a number at all. */
  | { kind: 'rejected'; complaint: string };

/**
 * Reads typed text into a draft value.
 *
 * Never saves, never silently accepts nonsense, and never treats an empty field
 * as an instruction to unrate — leaving a box alone is not an opinion.
 */
export function settleTyped(scale: RatingScale, text: string | null): Settled {
  if (text === null || text.trim() === '') return { kind: 'unchanged' };
  const parsed = Number(text);
  const range = `${formatRaw(scale, scale.min)} and ${formatRaw(scale, scale.max)}`;
  if (!Number.isFinite(parsed)) {
    return { kind: 'rejected', complaint: `Enter a number between ${range}.` };
  }
  const snapped = snapRaw(scale, parsed);
  if (parsed < scale.min || parsed > scale.max) {
    return {
      kind: 'clamped',
      value: snapped,
      complaint: `This scale runs from ${range}, so that became ${formatRaw(scale, snapped)}.`,
    };
  }
  return { kind: 'value', value: snapped };
}

/** Whether a draft is worth saving: it exists, and it says something new. */
export function canSaveDraft(draft: number | null, seated: number | null): boolean {
  return draft !== null && draft !== seated;
}

/** Where an unrated control rests. Furniture, never a value. */
export function restingValue(scale: RatingScale): number {
  return snapRaw(scale, clampRaw(scale, (scale.min + scale.max) / 2));
}
