import { clampRaw, denormalize, formatRaw, isStarScale } from './scales';
import type { RatingEvent, RatingScale } from './types';

/**
 * How a rating is said out loud.
 *
 * There are two jobs here and they are deliberately separate. `formatMark` and
 * friends in `scales.ts` produce a *fragment* — the thing printed in a margin,
 * on a chip, inside a table cell, where a bare `7` or `S` is exactly right.
 * This module produces a *phrase*: what you would say if you were reading the
 * rating aloud to someone.
 *
 * The rule that makes it worth centralising: a phrase is built from the scale
 * the judgement was actually made on, not the scale configured today. Someone
 * who rated a hundred things out of ten and then switched to tiers still gave
 * those hundred things a six out of ten, and the record has to say so.
 */

/**
 * A rating in words.
 *
 * `text` is for the eye and may carry a glyph. `spoken` is the same thing in
 * letters, for assistive technology and for anywhere a picture cannot go — it
 * is never the emoji, so a thumb is never announced as "thumbs up sign".
 */
export interface RatingWords {
  text: string;
  spoken: string;
}

/** Both readings identical, which is the case for everything but thumbs. */
function plain(value: string): RatingWords {
  return { text: value, spoken: value };
}

/**
 * Numbers written the way the reader's locale writes them.
 *
 * Decimals keep the precision the scale actually carries and lose the rest:
 * a 0.1-step scale says "4.6" and "5", not "4.6" and "5.0", because the zero
 * is a fact about the format rather than about the judgement.
 */
function number(value: number, step: number): string {
  const decimals = step < 1 ? (String(step).split('.')[1]?.length ?? 1) : 0;
  return value.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

/** True for the built-in tier list and any custom scale shaped like one. */
function isTierList(scale: RatingScale): boolean {
  return scale.kind === 'ordinal' && (scale.marks?.length ?? 0) > 0;
}

/**
 * A rating as a noun phrase: "4 stars", "6/10", "S tier", "👍".
 *
 * Takes a raw value in the scale's own units, because that is what the record
 * stores and what the reader was looking at when they chose it.
 */
export function ratingWords(scale: RatingScale, raw: number): RatingWords {
  const value = clampRaw(scale, raw);

  if (isStarScale(scale)) {
    const stars = number(value, scale.step);
    return plain(`${stars} ${value === 1 ? 'star' : 'stars'}`);
  }

  if (scale.kind === 'thumbs') {
    const up = value >= (scale.min + scale.max) / 2;
    return { text: up ? '👍' : '👎', spoken: up ? 'thumbs up' : 'thumbs down' };
  }

  if (isTierList(scale)) {
    // The mark *is* the word here — S, A, B — so it reads as a tier rather
    // than as a mysterious letter.
    return plain(`${formatRaw(scale, value)} tier`);
  }

  // Anything else with labels says its label, which is the only honest reading
  // of a scale whose positions were named by the person who made it.
  if (scale.labels?.length) {
    const label = formatRaw(scale, value).trim();
    return plain(label.length > 0 ? label : number(value, scale.step));
  }

  // Numbers read as a fraction of the top of the scale, which is how people
  // say them: six out of ten, sixty-seven out of a hundred.
  return plain(`${number(value, scale.step)}/${number(scale.max, scale.step)}`);
}

/**
 * A whole sentence: "You rated it 4 stars."
 *
 * The full stop is included because the phrase is the end of the sentence, and
 * a caller that has to remember to add one will eventually forget.
 */
export function ratedSentence(scale: RatingScale, raw: number): RatingWords {
  const words = ratingWords(scale, raw);
  return {
    text: `You rated it ${words.text}.`,
    spoken: `You rated it ${words.spoken}.`,
  };
}

/** What an unrated thing is called, so no caller invents its own wording. */
export const NOT_RATED: RatingWords = { text: 'Not rated', spoken: 'Not rated' };

/**
 * The scale a historical entry was made on.
 *
 * Deleted scales are still found: a scale can be removed from the picker
 * without the ratings made on it becoming unreadable. Only a scale that has
 * genuinely vanished from the record falls back, and it falls back to the
 * scale in force today rather than to a bare number in units nobody can name.
 */
export function scaleOfEvent(
  scales: readonly RatingScale[],
  event: Pick<RatingEvent, 'scaleId'>,
): RatingScale | undefined {
  return scales.find((scale) => scale.id === event.scaleId);
}

/**
 * A historical entry in words, on its own scale where that is still known.
 *
 * `today` is the fallback: the scale currently configured for the entity type.
 * It reads the entry's canonical `normalized` value, which never changes, so
 * the reading stays true even when the units it was made in are gone.
 */
export function eventWords(
  scales: readonly RatingScale[],
  event: Pick<RatingEvent, 'scaleId' | 'value' | 'normalized'>,
  today: RatingScale,
): RatingWords {
  const own = scaleOfEvent(scales, event);
  if (own) return ratingWords(own, event.value);
  return ratingWords(today, denormalize(today, event.normalized));
}
