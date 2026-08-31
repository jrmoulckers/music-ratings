import { completionSpan } from '../domain/completion';
import type { AlbumCompletion, ListeningCoverage } from '../domain/listening';
import { RECENTLY_PLAYED_WINDOW } from '../domain/listening';
import type { ListeningRange } from '../domain/listening-stats';
import { dateAndTime, fullDate, plural } from '../ui/format';

/**
 * How this app is allowed to talk about listening.
 *
 * Every line here exists to keep a true statement true. Spotify hands back the
 * latest fifty plays; it does not publish how you compare to anyone else, and
 * it does not hand over a lifetime history. So the app says what it saw, since
 * when, and nothing more.
 *
 * The rule this file enforces: a number is either a count of what was observed
 * or a share of what was observed. There is no third kind. Anything phrased as
 * a standing among other listeners would be a fabrication, because the data to
 * support it does not exist at the source.
 */

/** The standing provenance line. Shown wherever observed numbers are. */
export function observedSince(from: number | null | undefined): string {
  if (!from) return 'Based on listening observed by this app.';
  return `Based on listening observed by this app since ${fullDate(from)}.`;
}

export const CONFIRMED_BY = 'Confirmed from Spotify recently played';

/** Why these numbers cannot be a lifetime total, in one sentence. */
export const WINDOW_CAVEAT = `Spotify returns only the latest ${RECENTLY_PLAYED_WINDOW} plays per refresh, so anything played while this app was closed for a while was never visible to it.`;

/** The note that has to sit beside any share, so it is not misread. */
export const NO_PERCENTILE =
  'Spotify does not publish how your listening compares with anyone else, so this app cannot and does not show a listener percentile.';

/**
 * A share of observed listening, with its own arithmetic attached.
 *
 * The denominator travels with the number on purpose: "18%" alone invites the
 * reader to imagine it means something about the world, and "18% — 214 of
 * 1,190 observed plays" cannot be misread that way.
 */
export function share(part: number, whole: number, unit = 'observed plays'): string {
  if (whole <= 0) return `no ${unit} yet`;
  const pct = Math.round((part / whole) * 100);
  return `${pct}% — ${part.toLocaleString()} of ${whole.toLocaleString()} ${unit}`;
}

/**
 * Breadth as a count first.
 *
 * The house style prefers "34 of 52 tracks" to "65% of tracks", so the count
 * leads and the ratio follows it in brackets for anyone scanning for one.
 */
export function breadth(heard: number, known: number, noun = 'known tracks'): string {
  if (known <= 0) return `no ${noun} on record`;
  return `${heard} of ${known} ${noun} (${Math.round((heard / known) * 100)}%)`;
}

/** Estimated listening time, always labelled as an estimate at the call site. */
export function estimatedTime(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 90) return plural(minutes, 'minute');
  const hours = minutes / 60;
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} hours`;
}

export const ESTIMATED_TIME_NOTE =
  'Estimated from track lengths. Spotify does not say how much of a track was heard, so this is the length of what was played, not time spent listening.';

/**
 * A stretch of calendar time, not an amount of music.
 *
 * How long a record took to finish is wall-clock elapsed time, and reading it
 * as a duration of listening — "372 hours" — states something false about how
 * long someone sat there. It rolls up to the unit a person would actually use.
 */
export function elapsedSpan(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return plural(Math.max(1, minutes), 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 36) return plural(hours, 'hour');
  const days = Math.round(hours / 24);
  if (days < 14) return plural(days, 'day');
  const weeks = Math.round(days / 7);
  if (weeks < 9) return plural(weeks, 'week');
  return plural(Math.round(days / 30), 'month');
}

/* -------------------------------------------------------------------------- */
/* Completion                                                                 */
/* -------------------------------------------------------------------------- */

/** How a completion describes its own shape. Plain, never triumphal. */
export function completionSpanLine(completion: AlbumCompletion): string {
  switch (completionSpan(completion)) {
    case 'sitting':
      return `In one sitting on ${dateAndTime(completion.startAt)}.`;
    case 'day':
      return `Across one day, finishing ${dateAndTime(completion.endAt)}.`;
    case 'span': {
      const days = Math.max(1, Math.round((completion.endAt - completion.startAt) / 86_400_000));
      return `Over ${plural(days, 'day')}, finishing ${dateAndTime(completion.endAt)}.`;
    }
  }
}

export function heardAllLine(completion: AlbumCompletion): string {
  return `All ${completion.trackCount} tracks heard`;
}

export function ordinalLine(completion: AlbumCompletion): string | null {
  if (completion.ordinal <= 1) return null;
  const words = ['', '', 'second', 'third', 'fourth', 'fifth'];
  const word = words[completion.ordinal];
  return word
    ? `Your ${word} time through this record.`
    : `Time ${completion.ordinal} through this record.`;
}

/* -------------------------------------------------------------------------- */
/* Coverage                                                                   */
/* -------------------------------------------------------------------------- */

export interface CoverageNote {
  tone: 'plain' | 'warn';
  text: string;
}

/**
 * What the app is willing to claim about how well it was watching.
 *
 * A gap is stated as a gap. The alternative — quietly presenting a log with
 * holes in it as a record of listening — is the exact dishonesty this feature
 * is built to avoid.
 */
export function coverageNotes(coverage: ListeningCoverage, now = Date.now()): CoverageNote[] {
  const notes: CoverageNote[] = [];
  if (coverage.lastFetchAt) {
    const minutes = Math.round((now - coverage.lastFetchAt) / 60_000);
    notes.push({
      tone: 'plain',
      text:
        minutes < 2
          ? 'Last read from Spotify just now.'
          : `Last read from Spotify ${plural(minutes, 'minute')} ago.`,
    });
  } else {
    notes.push({ tone: 'plain', text: 'Nothing has been read from Spotify yet.' });
  }
  if (coverage.gaps.length > 0) {
    const first = coverage.gaps[0];
    notes.push({
      tone: 'warn',
      text: `${plural(coverage.gaps.length, 'gap')} in what was observed. The most recent runs from ${fullDate(first?.after ?? 0)} to ${fullDate(first?.before ?? 0)}: more than ${RECENTLY_PLAYED_WINDOW} plays happened before this app looked again, so some were never visible.`,
    });
  }
  if (coverage.saturatedFetches > 0 && coverage.gaps.length === 0) {
    notes.push({
      tone: 'plain',
      text: `${plural(coverage.saturatedFetches, 'read')} came back full, so plays may have rolled out of the window unseen.`,
    });
  }
  return notes;
}

/* -------------------------------------------------------------------------- */
/* Ranges                                                                     */
/* -------------------------------------------------------------------------- */

/** What a chosen range actually covers, given when observation started. */
export function rangeCaveat(
  range: ListeningRange,
  observedFrom: number | null | undefined,
  from: number,
): string | null {
  if (range === 'all' || !observedFrom) return null;
  if (observedFrom <= from) return null;
  return `This app has only been watching since ${fullDate(observedFrom)}, so this covers less than the full period.`;
}
