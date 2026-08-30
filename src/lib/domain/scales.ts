import type { RatingScale, ScaleKind } from './types';

/**
 * Every configured scale projects onto a single canonical 0..100 axis. Nothing
 * downstream — rollups, rankings, insights, lists — ever sees a raw value, so a
 * user can change scale without losing a single judgement.
 */

export const NORMALIZED_MIN = 0;
export const NORMALIZED_MAX = 100;

export const BUILTIN_SCALES: readonly RatingScale[] = [
  { id: 'stars-5', kind: 'stars', label: '5 stars', min: 1, max: 5, step: 1, builtin: true },
  {
    id: 'half-stars-5',
    kind: 'half-stars',
    label: '5 stars, half steps',
    min: 0.5,
    max: 5,
    step: 0.5,
    builtin: true,
  },
  { id: 'int-3', kind: 'integer', label: '1 to 3', min: 1, max: 3, step: 1, builtin: true },
  { id: 'int-5', kind: 'integer', label: '1 to 5', min: 1, max: 5, step: 1, builtin: true },
  { id: 'int-10', kind: 'integer', label: '1 to 10', min: 1, max: 10, step: 1, builtin: true },
  { id: 'int-100', kind: 'integer', label: '1 to 100', min: 1, max: 100, step: 1, builtin: true },
  {
    id: 'decimal-10',
    kind: 'decimal',
    label: '0.0 to 10.0',
    min: 0,
    max: 10,
    step: 0.1,
    builtin: true,
  },
  {
    id: 'thumbs',
    kind: 'thumbs',
    label: 'Thumbs',
    min: 0,
    max: 1,
    step: 1,
    labels: ['Down', 'Up'],
    marks: ['↓', '↑'],
    builtin: true,
  },
  {
    id: 'grades',
    kind: 'ordinal',
    label: 'Letter grades',
    min: 0,
    max: 10,
    step: 1,
    labels: ['E', 'D', 'C−', 'C', 'C+', 'B−', 'B', 'B+', 'A−', 'A', 'A+'],
    marks: ['E', 'D', 'C−', 'C', 'C+', 'B−', 'B', 'B+', 'A−', 'A', 'A+'],
    builtin: true,
  },
];

export const DEFAULT_SCALE_ID = 'int-10';

export function findScale(scales: readonly RatingScale[], id: string): RatingScale | undefined {
  return scales.find((s) => s.id === id && !s.deleted);
}

export function resolveScale(scales: readonly RatingScale[], id: string): RatingScale {
  return (
    findScale(scales, id) ??
    findScale(scales, DEFAULT_SCALE_ID) ??
    (BUILTIN_SCALES[4] as RatingScale)
  );
}

export class ScaleError extends Error {}

function assertUsable(scale: RatingScale): void {
  if (!(scale.max > scale.min)) {
    throw new ScaleError(`Scale "${scale.id}" needs max greater than min.`);
  }
  if (!(scale.step > 0)) {
    throw new ScaleError(`Scale "${scale.id}" needs a positive step.`);
  }
}

export function clampNormalized(value: number): number {
  if (!Number.isFinite(value)) return NORMALIZED_MIN;
  return Math.min(NORMALIZED_MAX, Math.max(NORMALIZED_MIN, value));
}

function roundToStep(scale: RatingScale, value: number): number {
  const steps = Math.round((value - scale.min) / scale.step);
  const raw = scale.min + steps * scale.step;
  return Math.round(raw * 1e6) / 1e6;
}

/** Number of detents on the rail for this scale. Always at least two. */
export function detentCount(scale: RatingScale): number {
  assertUsable(scale);
  if (scale.labels?.length) return scale.labels.length;
  return Math.max(2, Math.round((scale.max - scale.min) / scale.step) + 1);
}

/** Raw values of every detent, lowest first. */
export function detentValues(scale: RatingScale): number[] {
  const n = detentCount(scale);
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) out.push(roundToStep(scale, scale.min + i * scale.step));
  // Guard against float drift pushing the last detent past `max`.
  out[n - 1] = scale.max;
  return out;
}

export function clampRaw(scale: RatingScale, value: number): number {
  assertUsable(scale);
  if (!Number.isFinite(value)) return scale.min;
  return Math.min(scale.max, Math.max(scale.min, value));
}

/** Raw scale value → canonical 0..100. */
export function normalize(scale: RatingScale, value: number): number {
  assertUsable(scale);
  const clamped = clampRaw(scale, value);
  return clampNormalized(((clamped - scale.min) / (scale.max - scale.min)) * NORMALIZED_MAX);
}

/** Canonical 0..100 → nearest raw value on this scale. */
export function denormalize(scale: RatingScale, normalized: number): number {
  assertUsable(scale);
  const n = clampNormalized(normalized);
  const raw = scale.min + (n / NORMALIZED_MAX) * (scale.max - scale.min);
  return clampRaw(scale, roundToStep(scale, raw));
}

/** Index of the detent a normalized value seats on. */
export function detentIndex(scale: RatingScale, normalized: number): number {
  const values = detentValues(scale);
  const raw = denormalize(scale, normalized);
  let best = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const delta = Math.abs((values[i] as number) - raw);
    if (delta < bestDelta - 1e-9) {
      best = i;
      bestDelta = delta;
    }
  }
  return best;
}

export function normalizedForDetent(scale: RatingScale, index: number): number {
  const values = detentValues(scale);
  const clamped = Math.min(values.length - 1, Math.max(0, Math.round(index)));
  return normalize(scale, values[clamped] as number);
}

/** How a raw value is printed. Ordinal scales print their label, not the number. */
export function formatRaw(scale: RatingScale, value: number): string {
  const clamped = clampRaw(scale, value);
  if (scale.labels?.length) {
    const idx = Math.min(
      scale.labels.length - 1,
      Math.max(0, Math.round((clamped - scale.min) / scale.step)),
    );
    return scale.labels[idx] ?? String(clamped);
  }
  const decimals = scale.step < 1 ? (String(scale.step).split('.')[1]?.length ?? 1) : 0;
  return clamped.toFixed(decimals);
}

/** The short mark printed in the margin. Falls back to the formatted value. */
export function formatMark(scale: RatingScale, value: number): string {
  if (scale.marks?.length) {
    const idx = Math.min(
      scale.marks.length - 1,
      Math.max(0, Math.round((clampRaw(scale, value) - scale.min) / scale.step)),
    );
    return scale.marks[idx] ?? formatRaw(scale, value);
  }
  if (scale.kind === 'stars' || scale.kind === 'half-stars') {
    return `${formatRaw(scale, value)}★`;
  }
  return formatRaw(scale, value);
}

/** How a canonical value reads on a given scale, e.g. `7` or `B+` or `3.5★`. */
export function formatNormalizedOn(scale: RatingScale, normalized: number): string {
  return formatMark(scale, denormalize(scale, normalized));
}

/**
 * A *computed* score expressed on a scale.
 *
 * A rollup is not a rating: it is a continuous quantity, and rounding it to the
 * nearest detent throws away the ordering that makes a list a list. Numeric
 * scales therefore keep one decimal when the scale is coarse enough for that to
 * carry information. Labelled scales have no fractions to show, so they round.
 */
export function formatComputedOn(scale: RatingScale, normalized: number): string {
  assertUsable(scale);
  if (scale.labels?.length) return formatNormalizedOn(scale, normalized);
  // Deliberately *not* `denormalize`, which seats a value on the nearest detent.
  // A rollup lives between detents, and that is exactly the part worth showing.
  const n = clampNormalized(normalized);
  const raw = scale.min + (n / NORMALIZED_MAX) * (scale.max - scale.min);
  if (scale.max - scale.min >= 50) return String(Math.round(raw));
  return (Math.round(raw * 10) / 10).toFixed(1);
}

export interface MigratedRating {
  value: number;
  scaleId: string;
  normalized: number;
}

/**
 * Re-express a historical rating on a different scale.
 *
 * Migration never touches `normalized` — the canonical value *is* the history.
 * Only the presentation value and its scale id move, so a user can switch from
 * stars to letter grades and back without losing anything beyond one detent of
 * display rounding.
 */
export function migrateRating(from: { normalized: number }, to: RatingScale): MigratedRating {
  const value = denormalize(to, from.normalized);
  return { value, scaleId: to.id, normalized: clampNormalized(from.normalized) };
}

/**
 * A scale is "coarse" when it has few detents. Coarse scales carry less
 * information, which the confidence model accounts for.
 */
export function scaleResolution(scale: RatingScale): number {
  const n = detentCount(scale);
  if (n <= 2) return 0.35;
  if (n <= 3) return 0.55;
  if (n <= 5) return 0.75;
  if (n <= 11) return 0.9;
  return 1;
}

/**
 * A one-line description of what a scale asks of you: how many positions it
 * offers and what its ends mean. Used wherever a scale is offered for choosing.
 */
export function describeScale(scale: RatingScale): string {
  const steps = detentCount(scale);
  const labels = scale.labels;
  const ends =
    labels && labels.length === steps && steps > 1
      ? `${labels[0]} to ${labels[steps - 1]}`
      : `${formatRaw(scale, scale.min)} to ${formatRaw(scale, scale.max)}`;
  return `${steps} position${steps === 1 ? '' : 's'}, ${ends}`;
}

export function validateCustomScale(input: {
  label: string;
  kind: ScaleKind;
  min: number;
  max: number;
  step: number;
  labels?: string[];
}): string | null {
  if (!input.label.trim()) return 'Give the scale a name.';
  if (!Number.isFinite(input.min) || !Number.isFinite(input.max)) return 'Bounds must be numbers.';
  if (input.max <= input.min) return 'The high end must be above the low end.';
  if (!Number.isFinite(input.step) || input.step <= 0) return 'Step must be greater than zero.';
  const steps = (input.max - input.min) / input.step;
  if (Math.abs(steps - Math.round(steps)) > 1e-6) {
    return 'The range must divide evenly by the step.';
  }
  if (Math.round(steps) + 1 > 201) return 'That is more than 201 detents; use a coarser step.';
  if (input.kind === 'ordinal') {
    const expected = Math.round(steps) + 1;
    if (!input.labels || input.labels.length !== expected) {
      return `An ordinal scale needs exactly ${expected} labels.`;
    }
    if (input.labels.some((l) => !l.trim())) return 'Every ordinal label needs text.';
  }
  return null;
}
