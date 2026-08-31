import type { RatingScale, ScaleKind } from './types';

/**
 * Every configured scale projects onto a single canonical 0..100 axis. Nothing
 * downstream — rollups, rankings, insights, lists — ever sees a raw value, so a
 * user can change scale without losing a single judgement.
 *
 * The projection is chosen so that scales agree with each other:
 *
 * - **Numeric scales** project by *fraction of the maximum*. "4 out of 5" and
 *   "8 out of 10" and "80 out of 100" and "4 stars" are all 80, because that is
 *   what a person means when they say them. Endpoint-stretching would have made
 *   1/10 and 1/5 both the rock bottom of the axis, which is false.
 * - **Judgement scales** (thumbs, tiers, custom labelled scales) carry explicit
 *   `anchors`, because their positions do not mean fractions. A thumbs-up says
 *   "I like this", not "this is perfect", so it lands at 80 rather than 100.
 *
 * The result is that every scale converts to every other scale sensibly, in
 * both directions, and round-trips back to where it started.
 */

export const NORMALIZED_MIN = 0;
export const NORMALIZED_MAX = 100;

/**
 * Rows the equivalence table will enumerate one detent at a time before it
 * bands them into ranges instead, and how many bands it collapses to.
 */
export const EQUIVALENCE_MAX_ROWS = 16;
export const EQUIVALENCE_BANDS = 10;

/** Prints between the two ends of a range, e.g. `1 — 100`. */
export const RANGE_SEPARATOR = ' — ';

/**
 * Detents a rail will seat one at a time before it stops being a rail.
 *
 * A detent is something you hit with a thumb. Past this many there is no room
 * to hit any of them and no room to print what they are: a 1–100 scale drawn
 * detent-by-detent is a ruler with a hundred numbers jammed together, which is
 * not a control. Denser scales get the precision instrument instead — a track
 * with graduations at round intervals, and an exact value you can type.
 */
export const RAIL_MAX_DETENTS = 16;

/** Most graduations a track will ever label, however wide it gets. */
export const RAIL_MAX_LABELS = 11;

/** Graduations to assume before a track has been measured. */
export const RAIL_DEFAULT_LABELS = 7;

/** One graduation on a precision track. */
export interface RailTick {
  /** The value on the scale this graduation stands at. */
  value: number;
  /** Where it sits along the track: 0 at the low end, 1 at the high end. */
  at: number;
  /** What it prints, or null for an unlabelled mark that only aids orientation. */
  label: string | null;
}

/** One position on a scale: its text, plus an icon key when it is drawn. */
export interface ScaleReading {
  text: string;
  icon?: string;
}

/** A cell of the equivalence table: one position, or a range between two. */
export interface EquivalenceReading {
  /** The whole cell as text — `3★`, or `0.1 — 1.0`. Also its accessible name. */
  label: string;
  /** One end for a single position, two for a range. */
  ends: ScaleReading[];
  ranged: boolean;
}

export interface EquivalenceRow {
  key: string;
  /** Lowest raw value in the row. Kept for callers keying on a single value. */
  value: number;
  from: number;
  to: number;
  /** Midpoint of the row on the canonical axis. */
  normalized: number;
  /** True when this row stands for a range rather than one detent. */
  banded: boolean;
  /** Text of the row heading. */
  label: string;
  head: EquivalenceReading;
  on: EquivalenceReading[];
}

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
    // Drawn, not spelled: an arrow is a direction, a thumb is a verdict. The
    // words in `labels` carry the meaning wherever an icon cannot be drawn.
    markIcons: ['thumb-down', 'thumb-up'],
    // A thumb is a coarse signal, not a verdict on perfection: "I like this"
    // sits well up the axis without claiming the top of it.
    anchors: [20, 80],
    builtin: true,
  },
  {
    id: 'tiers',
    kind: 'ordinal',
    label: 'Tier list (S–F)',
    min: 0,
    max: 5,
    step: 1,
    labels: ['F', 'D', 'C', 'B', 'A', 'S'],
    marks: ['F', 'D', 'C', 'B', 'A', 'S'],
    // Spaced the way tiers are actually used rather than evenly: C sits just
    // below the middle because "average" is not 40%, and the gap up to S is
    // wide because S is meant to be earned. Reads 1–5 stars as D/C/B/A/S and
    // 1–10 as F/D/D/C/C/B/B/A/A/S.
    anchors: [0, 22, 45, 65, 84, 100],
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

/** The nearest value this scale can actually hold. */
export function snapRaw(scale: RatingScale, value: number): number {
  assertUsable(scale);
  if (!Number.isFinite(value)) return scale.min;
  return clampRaw(scale, roundToStep(scale, value));
}

/**
 * Whether this scale has more positions than a rail can seat.
 *
 * Asked of the scale's own density, never of its id, so a custom 0–200 scale
 * gets the same treatment as the built-in 1–100 one.
 */
export function isDenseScale(scale: RatingScale): boolean {
  return detentCount(scale) > RAIL_MAX_DETENTS;
}

/** Intervals a graduated scale is allowed to count in, before scaling by ten. */
const NICE_INTERVALS = [1, 2, 2.5, 5];

/**
 * The coarsest round interval that is no finer than `want` and still lands on
 * values the scale can hold. Labelling 2.5 on a whole-number scale would name a
 * value that does not exist there, so such an interval is passed over.
 */
function niceInterval(want: number, step: number): number {
  const floor = Math.max(want, step);
  for (let power = -6; power <= 9; power += 1) {
    const magnitude = 10 ** power;
    for (const n of NICE_INTERVALS) {
      const candidate = round6(n * magnitude);
      if (candidate < floor - 1e-9) continue;
      const multiples = candidate / step;
      if (Math.abs(multiples - Math.round(multiples)) > 1e-6) continue;
      return candidate;
    }
  }
  return step;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * The graduations to draw on a precision track, given how many labels fit.
 *
 * Both ends are always labelled, because the ends of a scale are the two facts
 * a reader most needs. Between them the marks land on round numbers rather than
 * on the low end plus an offset, so 1–100 reads 1, 10, 20 … 100 and not 1, 12,
 * 23. A round mark that would crowd an end is dropped rather than overprinted.
 *
 * Each gap also carries one unlabelled mark at its midpoint: enough to judge
 * where 15 falls between 10 and 20, and never enough to become noise.
 */
export function railTicks(scale: RatingScale, maxLabels: number): RailTick[] {
  assertUsable(scale);
  const lo = scale.min;
  const hi = scale.max;
  const span = hi - lo;
  if (span <= 0) return [];

  const budget = Math.max(2, Math.min(Math.floor(maxLabels) || 2, RAIL_MAX_LABELS));
  const interval = niceInterval(span / (budget - 1), scale.step);
  const crowd = interval * 0.5;

  const majors: number[] = [lo];
  const first = Math.ceil(round6(lo / interval)) * interval;
  for (let v = round6(first); v < hi - 1e-9; v = round6(v + interval)) {
    if (v > lo + crowd && v < hi - crowd) majors.push(v);
  }
  majors.push(hi);

  const at = (value: number) => (value - lo) / span;
  const ticks: RailTick[] = [];
  for (let i = 0; i < majors.length; i += 1) {
    const value = majors[i] as number;
    ticks.push({ value, at: at(value), label: formatRaw(scale, value) });
    const next = majors[i + 1];
    if (next === undefined) continue;
    // An unlabelled mark halfway helps the eye divide the gap, but it still has
    // to stand on a value this scale can reach — an integer rail drawing a mark
    // at 50.5 is describing a place that does not exist. Snap it, and drop it
    // if snapping lands it on a printed graduation.
    const mid = snapRaw(scale, (value + next) / 2);
    if (mid <= value || mid >= next) continue;
    ticks.push({ value: mid, at: at(mid), label: null });
  }
  return ticks;
}

/**
 * How many graduations a track of this width can label without them colliding.
 *
 * Driven by the width of the scale's own longest reading, so `0.0 to 10.0` gets
 * fewer labels than `1 to 100` in the same space rather than the same number
 * squeezed tighter.
 */
export function railLabelBudget(widthPx: number, scale: RatingScale): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return RAIL_DEFAULT_LABELS;
  const chars = Math.max(formatRaw(scale, scale.min).length, formatRaw(scale, scale.max).length);
  // Roughly the label's own width at the rail's type size, plus breathing room.
  const perLabel = chars * 8 + 22;
  return Math.max(2, Math.min(RAIL_MAX_LABELS, Math.floor(widthPx / perLabel)));
}

/**
 * The next labelled graduation past `from`, for a page-sized jump.
 *
 * Null at either end. A jump that cannot move should do nothing, rather than
 * commit the value that is already seated.
 */
export function nextGraduation(
  ticks: readonly RailTick[],
  from: number,
  direction: 1 | -1,
): number | null {
  const labelled = ticks.filter((t) => t.label !== null).map((t) => t.value);
  if (direction === 1) {
    for (const value of labelled) if (value > from + 1e-9) return value;
    return null;
  }
  for (let i = labelled.length - 1; i >= 0; i -= 1) {
    const value = labelled[i] as number;
    if (value < from - 1e-9) return value;
  }
  return null;
}

/**
 * Where each detent of this scale sits on the canonical axis.
 *
 * Explicit anchors win. Labelled scales without anchors are ordinal, so their
 * positions spread evenly. Everything else is numeric and projects by fraction
 * of the maximum, which is the rule that keeps scales agreeing with each other.
 */
export function scaleAnchors(scale: RatingScale): number[] {
  const values = detentValues(scale);
  const declared = scale.anchors;
  if (declared && declared.length === values.length) {
    return declared.map((a) => clampNormalized(a));
  }
  if (scale.labels?.length === values.length && values.length > 1) {
    return values.map((_, i) => (i / (values.length - 1)) * NORMALIZED_MAX);
  }
  if (usesFractionOfMax(scale)) {
    return values.map((v) => clampNormalized((v / scale.max) * NORMALIZED_MAX));
  }
  return values.map((v) =>
    clampNormalized(((v - scale.min) / (scale.max - scale.min)) * NORMALIZED_MAX),
  );
}

/**
 * A scale reads as "n out of max" when it starts at or above zero and counts
 * up to a positive maximum. Custom scales that run through negative numbers
 * have no such reading and fall back to stretching between their endpoints.
 */
function usesFractionOfMax(scale: RatingScale): boolean {
  return scale.min >= 0 && scale.max > 0 && !scale.labels?.length;
}

/** Whether this scale needs the piecewise anchor projection rather than a formula. */
function isAnchored(scale: RatingScale): boolean {
  return Boolean(scale.anchors?.length) || Boolean(scale.labels?.length);
}

/** Piecewise-linear interpolation through a strictly ascending table. */
function interpolate(from: number[], to: number[], value: number): number {
  const n = from.length;
  if (n === 0) return value;
  if (n === 1) return to[0] as number;
  if (value <= (from[0] as number)) return to[0] as number;
  if (value >= (from[n - 1] as number)) return to[n - 1] as number;
  for (let i = 1; i < n; i += 1) {
    const hi = from[i] as number;
    if (value <= hi) {
      const lo = from[i - 1] as number;
      const span = hi - lo;
      const t = span === 0 ? 0 : (value - lo) / span;
      const a = to[i - 1] as number;
      const b = to[i] as number;
      return a + t * (b - a);
    }
  }
  return to[n - 1] as number;
}

/** Raw scale value → canonical 0..100. */
export function normalize(scale: RatingScale, value: number): number {
  assertUsable(scale);
  const clamped = clampRaw(scale, value);
  if (isAnchored(scale)) {
    return clampNormalized(interpolate(detentValues(scale), scaleAnchors(scale), clamped));
  }
  if (usesFractionOfMax(scale)) {
    return clampNormalized((clamped / scale.max) * NORMALIZED_MAX);
  }
  return clampNormalized(((clamped - scale.min) / (scale.max - scale.min)) * NORMALIZED_MAX);
}

/** Canonical 0..100 → raw value, unsnapped. The continuous inverse of `normalize`. */
function projectRaw(scale: RatingScale, normalized: number): number {
  const n = clampNormalized(normalized);
  if (isAnchored(scale)) {
    return interpolate(scaleAnchors(scale), detentValues(scale), n);
  }
  if (usesFractionOfMax(scale)) {
    return (n / NORMALIZED_MAX) * scale.max;
  }
  return scale.min + (n / NORMALIZED_MAX) * (scale.max - scale.min);
}

/** Canonical 0..100 → nearest raw value on this scale. */
export function denormalize(scale: RatingScale, normalized: number): number {
  assertUsable(scale);
  return clampRaw(scale, roundToStep(scale, projectRaw(scale, normalized)));
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
    return scale.marks[markIndex(scale, value, scale.marks.length)] ?? formatRaw(scale, value);
  }
  if (scale.kind === 'stars' || scale.kind === 'half-stars') {
    return `${formatRaw(scale, value)}★`;
  }
  return formatRaw(scale, value);
}

function markIndex(scale: RatingScale, value: number, length: number): number {
  return Math.min(
    length - 1,
    Math.max(0, Math.round((clampRaw(scale, value) - scale.min) / scale.step)),
  );
}

/**
 * The icon key for a drawn mark, if this scale has one at that position.
 *
 * Returns a plain string rather than a UI type: the domain names the picture,
 * the view layer owns the drawing.
 */
export function markIcon(scale: RatingScale, value: number): string | undefined {
  if (!scale.markIcons?.length) return undefined;
  return scale.markIcons[markIndex(scale, value, scale.markIcons.length)];
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
  const raw = projectRaw(scale, normalized);
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
 * stars to tiers and back without losing anything beyond one detent of
 * display rounding.
 */
export function migrateRating(from: { normalized: number }, to: RatingScale): MigratedRating {
  const value = denormalize(to, from.normalized);
  return { value, scaleId: to.id, normalized: clampNormalized(from.normalized) };
}

/** The same judgement, expressed on another scale. */
export function convertValue(from: RatingScale, value: number, to: RatingScale): number {
  return denormalize(to, normalize(from, value));
}

/**
 * How every position on `scale` reads on each of `others`. Drives the
 * equivalence table in settings, so the conversion rules are inspectable
 * rather than something a user has to take on trust.
 *
 * A hundred-point scale has a hundred detents, and printing one row each says
 * nothing a reader could not infer: 1 through 10 are all one star. Scales finer
 * than `EQUIVALENCE_MAX_ROWS` are therefore banded into contiguous ranges, and
 * every reading — the band's own heading and each scale it is read against —
 * collapses to a single value when both ends agree and prints as a range when
 * they do not. Nothing is sampled away: the bands tile the scale exactly, so
 * the table still accounts for every position.
 *
 * This is a presentation decision about an explanatory table. Rating controls
 * enumerate every detent, because there you are choosing one.
 */
export function equivalenceRows(
  scale: RatingScale,
  others: readonly RatingScale[],
): EquivalenceRow[] {
  const values = detentValues(scale);
  const spans =
    values.length > EQUIVALENCE_MAX_ROWS
      ? bandSpans(values.length, EQUIVALENCE_BANDS)
      : values.map((_, index): [number, number] => [index, index]);

  return spans.map(([lo, hi]) => {
    const from = values[lo] ?? scale.min;
    const to = values[hi] ?? scale.max;
    const fromNormalized = normalize(scale, from);
    const toNormalized = normalize(scale, to);
    const head = reading(readAt(scale, from), readAt(scale, to));
    return {
      key: `${from}:${to}`,
      value: from,
      from,
      to,
      normalized: (fromNormalized + toNormalized) / 2,
      banded: hi > lo,
      label: head.label,
      head,
      on: others.map((other) =>
        reading(
          readAt(other, denormalize(other, fromNormalized)),
          readAt(other, denormalize(other, toNormalized)),
        ),
      ),
    };
  });
}

function readAt(scale: RatingScale, value: number): ScaleReading {
  const icon = markIcon(scale, value);
  const text = formatMark(scale, value);
  return icon ? { text, icon } : { text };
}

function reading(low: ScaleReading, high: ScaleReading): EquivalenceReading {
  if (low.text === high.text && low.icon === high.icon) {
    return { label: low.text, ends: [low], ranged: false };
  }
  return { label: `${low.text}${RANGE_SEPARATOR}${high.text}`, ends: [low, high], ranged: true };
}

/**
 * `count` detents split into `bands` contiguous groups, as evenly as they
 * divide. The remainder goes to the earliest bands, which is what lands
 * 0.0–10.0 on the round `0.1 — 1.0`, `1.1 — 2.0` boundaries a reader expects.
 */
function bandSpans(count: number, bands: number): [number, number][] {
  const size = Math.floor(count / bands);
  let remainder = count % bands;
  const spans: [number, number][] = [];
  let start = 0;
  for (let i = 0; i < bands && start < count; i += 1) {
    const length = size + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    spans.push([start, start + length - 1]);
    start += length;
  }
  return spans;
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
