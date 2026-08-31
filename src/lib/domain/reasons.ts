import type { EntityType } from './types';

/**
 * The words the app uses for things, and for why it is asking about them.
 *
 * Every sentence the queue says about an item is built here. Keeping them in
 * one file is not tidiness: a reason is a claim about the user's own data, and
 * claims that are assembled ad hoc at four call sites drift into saying things
 * that are not true — like calling a release "0% rated" when what is meant is
 * that you have not rated anything on it yet.
 *
 * Rules these follow:
 *  - Say the state, not the arithmetic.
 *  - Name the child by what it actually is, never by assumption.
 *  - One sentence, one full stop.
 */

const DAY = 86_400_000;

/* -------------------------------------------------------------------------- */
/* Nouns                                                                      */
/* -------------------------------------------------------------------------- */

const TYPE_NOUNS: Record<EntityType, [string, string]> = {
  artist: ['artist', 'artists'],
  album: ['release', 'releases'],
  track: ['track', 'tracks'],
  playlist: ['playlist', 'playlists'],
  show: ['show', 'shows'],
  episode: ['episode', 'episodes'],
  audiobook: ['audiobook', 'audiobooks'],
  chapter: ['chapter', 'chapters'],
};

/** The word for a kind of thing, lowercase because most uses sit in a sentence. */
export function typeNoun(type: EntityType, plural = false): string {
  const pair = TYPE_NOUNS[type];
  return plural ? pair[1] : pair[0];
}

/**
 * What to call the things inside something.
 *
 * Taken from the children that are actually recorded, never from what the
 * parent's kind usually contains. An artist in a partial import may hold only
 * releases; saying "tracks" there would describe a containment the data does
 * not have. Mixed contents have no honest single noun, so they get a plain one.
 */
export function containedNoun(childTypes: readonly EntityType[], plural = true): string {
  const distinct = [...new Set(childTypes)];
  if (distinct.length === 1) return typeNoun(distinct[0] as EntityType, plural);
  return plural ? 'items' : 'item';
}

/* -------------------------------------------------------------------------- */
/* Times                                                                      */
/* -------------------------------------------------------------------------- */

/** Coarse elapsed time, for things that are interesting at the scale of days. */
export function relativeDays(ms: number): string {
  const days = Math.round(ms / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  const months = Math.round(days / 30);
  if (months < 24) return `${months} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

/**
 * A play within the hour is the whole reason this queue exists, so it is worth
 * saying in minutes rather than rounding it away to "today".
 */
export function relativePlay(ms: number): string {
  if (ms < 60_000) return 'just now';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return relativeDays(ms);
}

/* -------------------------------------------------------------------------- */
/* Reasons                                                                    */
/* -------------------------------------------------------------------------- */

export type ListeningTerm = 'short' | 'medium' | 'long';

/** How the user would describe the window, not how Spotify names it. */
export const TERM_PHRASE: Record<ListeningTerm, string> = {
  short: 'your last four weeks',
  medium: 'your last six months',
  long: 'your all-time listening',
};

/** `Played 2 hours ago.` */
export function playedReason(ageMs: number): string {
  return `Played ${relativePlay(ageMs)}.`;
}

/** `#3 in your all-time listening.` — a position, so no space after the hash. */
export function topReason(term: ListeningTerm, rank: number): string {
  return `#${rank} in ${TERM_PHRASE[term]}.`;
}

/** `Saved 3 months ago.` */
export function savedReason(ageMs?: number): string {
  return ageMs === undefined ? 'Saved to your library.' : `Saved ${relativeDays(ageMs)}.`;
}

/** `You rated Kestrel Harbour but not this track.` */
export function unratedChildReason(parentName: string, childType: EntityType): string {
  return `You rated ${parentName} but not this ${typeNoun(childType)}.`;
}

/**
 * How much of a parent you have judged.
 *
 * Never a percentage. "0% rated" is arithmetic about an empty set dressed up as
 * a fact about the music, and it is the reason this file exists.
 */
export function coverageReason(
  parentName: string,
  childTypes: readonly EntityType[],
  rated: number,
  total: number,
): string {
  if (!Number.isFinite(total) || total <= 0) {
    return `Rate this to improve ${possessive(parentName)} score.`;
  }
  const many = containedNoun(childTypes, total !== 1);
  if (rated <= 0) return `No ${many} from ${parentName} rated yet.`;
  return `${rated} of ${total} ${many} rated in ${parentName}.`;
}

/** `Kestrel Harbour’s score` — and `Bruce Willis’ score` when it already ends in s. */
function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}’` : `${name}’s`;
}

/** `Last rated 3 months ago.` */
export function staleReason(ageMs: number): string {
  return `Last rated ${relativeDays(ageMs)}. Still right?`;
}

/** `Never compared with anything.` / `Compared twice so far.` */
export function comparisonReason(comparisons: number): string {
  if (comparisons <= 0) return 'Never compared with anything.';
  if (comparisons === 1) return 'Compared once so far.';
  if (comparisons === 2) return 'Compared twice so far.';
  return `Compared ${comparisons} times so far.`;
}

/** `You pinned this.` */
export function pinnedReason(): string {
  return 'You pinned this.';
}
