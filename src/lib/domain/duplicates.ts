import type { Entity, EntityId, EntityType } from './types';

/**
 * Finding the same record twice.
 *
 * Conservative on purpose. This module suggests; it never merges, and it never
 * scores anything highly enough to imply that it should be merged without being
 * looked at. Its job is to save the user the work of remembering that "Kid A"
 * and "Kid A (2016 Reissue)" are both in their library, and then to get out of
 * the way — the judgement about whether a live take is "the same song" is the
 * user's, and it is a judgement, not a lookup.
 *
 * Everything here is pure and cheap: one pass of string normalisation per
 * entity, bucketed by a coarse key so a library of ten thousand tracks is
 * compared in linear time rather than quadratic.
 */

/* -------------------------------------------------------------------------- */
/* Normalising a title                                                        */
/* -------------------------------------------------------------------------- */

/** A parenthetical or trailing qualifier, classified. */
export type MarkerKind =
  | 'edition' // remaster, reissue, anniversary, deluxe, mono, expanded
  | 'performance' // live, acoustic, demo, session, unplugged
  | 'rework' // remix, edit, version, instrumental, karaoke, cover
  | 'credit' // feat., with
  | 'other';

export interface TitleParts {
  /** The title with qualifiers, punctuation, case and accents taken off. */
  base: string;
  /** Every qualifier found, normalised, in the order they appeared. */
  markers: string[];
  kinds: MarkerKind[];
}

const EDITION_WORDS = [
  'remaster',
  'remastered',
  'remasterd',
  'reissue',
  'anniversary',
  'deluxe',
  'expanded',
  'edition',
  'mono',
  'stereo',
  'bonus',
  'special',
  'super',
  'collector',
  'digital',
  'explicit',
  'clean',
];

const PERFORMANCE_WORDS = [
  'live',
  'acoustic',
  'demo',
  'session',
  'sessions',
  'unplugged',
  'concert',
  'rehearsal',
];

const REWORK_WORDS = [
  'remix',
  'mix',
  'edit',
  'version',
  'instrumental',
  'karaoke',
  'cover',
  'reprise',
  'interlude',
  'radio',
  'extended',
  'dub',
];

const CREDIT_WORDS = ['feat', 'featuring', 'with', 'ft'];

/** Everything that is punctuation as far as a title is concerned. */
const PUNCTUATION = /[\u2018\u2019\u201c\u201d'"`´.,!?;:/\\[\]{}<>@#$%^&*_+=|~]/g;

/** A trailing qualifier after a dash, which is how Spotify writes most of them. */
const TRAILING = /\s[-\u2013\u2014]\s+(.+)$/;

/** Anything in brackets. */
const BRACKETED = /[([]([^)\]]*)[)\]]/g;

function strip(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(PUNCTUATION, ' ')
    .replace(/[-\u2013\u2014]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function classify(marker: string): MarkerKind {
  const words = marker.split(' ');
  const has = (list: readonly string[]) => words.some((word) => list.includes(word));
  if (has(PERFORMANCE_WORDS)) return 'performance';
  if (has(REWORK_WORDS)) return 'rework';
  if (has(EDITION_WORDS)) return 'edition';
  if (has(CREDIT_WORDS)) return 'credit';
  // A bare year — "(2011)" — reads as a reissue marker, not a new performance.
  if (/^(19|20)\d{2}$/.test(marker)) return 'edition';
  return 'other';
}

/**
 * Split a title into the thing itself and whatever was said about this copy of
 * it. `Everything In Its Right Place - 2016 Remaster` and
 * `Everything in Its Right Place` share a base; only one carries a marker.
 *
 * A qualifier is only taken off when it is recognisably one. "Song (Part 2)"
 * keeps its part number, because dropping it would make part two the same
 * recording as part one — and being wrong in that direction is how a detector
 * ends up averaging two ratings of two different things.
 */
export function titleParts(name: string): TitleParts {
  const markers: string[] = [];
  let rest = name.replace(BRACKETED, (_all, inner: string) => {
    const marker = strip(inner);
    if (!marker) return ' ';
    if (classify(marker) === 'other') return ` ${inner} `;
    markers.push(marker);
    return ' ';
  });

  const trailing = TRAILING.exec(rest);
  if (trailing?.[1]) {
    const marker = strip(trailing[1]);
    if (marker && classify(marker) !== 'other') {
      markers.push(marker);
      rest = rest.slice(0, trailing.index);
    }
  }

  let base = strip(rest);
  if (base.startsWith('the ')) base = base.slice(4);
  return { base, markers, kinds: markers.map(classify) };
}

/** The coarse bucket key two records must share before they are compared at all. */
export function candidateKey(entity: Entity): string {
  const { base } = titleParts(entity.name);
  return `${entity.type}|${base.slice(0, 24)}`;
}

/* -------------------------------------------------------------------------- */
/* Comparing two records                                                      */
/* -------------------------------------------------------------------------- */

/** What the app thinks two records are to each other. Never a decision. */
export type DuplicateVerdict =
  'same-recording' | 'reissue' | 'appearance' | 'different-version' | 'unrelated';

export interface DuplicateCandidate {
  entityId: EntityId;
  entityType: EntityType;
  verdict: DuplicateVerdict;
  /** 0..1. Sorting only — it is never a threshold for acting. */
  score: number;
  /** Each fact that pushed the verdict, in the words the user will read. */
  evidence: string[];
  /** What is not known, stated plainly. Empty when there is nothing to warn about. */
  uncertainty: string[];
  /** Whether combining these is the obvious reading of the evidence. */
  suggested: boolean;
}

/** True when two rows describe the same provider object, not two editions. */
export function sameProviderIdentity(a: Entity, b: Entity): boolean {
  return (
    a.type === b.type &&
    a.provider === b.provider &&
    a.providerId.length > 0 &&
    a.providerId === b.providerId
  );
}

export const VERDICT_LABEL: Record<DuplicateVerdict, string> = {
  'same-recording': 'Same recording',
  reissue: 'Reissue or remaster',
  appearance: 'Same track, another release',
  'different-version': 'A different version',
  unrelated: 'Probably unrelated',
};

export const VERDICT_MEANING: Record<DuplicateVerdict, string> = {
  'same-recording': 'Same title, same credit, and nothing about either copy says otherwise.',
  reissue: 'The same record issued again — a remaster, an anniversary edition, a re-press.',
  appearance:
    'The same recording reached you through a different release, such as a compilation or a single.',
  'different-version':
    'A live take, a remix, an acoustic reading or a cover. These are different performances, and combining them would average judgements of two different things.',
  unrelated: 'Not enough in common to treat these as the same record.',
};

interface Compared {
  verdict: DuplicateVerdict;
  score: number;
  evidence: string[];
  uncertainty: string[];
}

function artistIdentity(entity: Entity): string {
  if (entity.artistIds?.length) return [...entity.artistIds].sort().join('+');
  return strip(entity.subtitle ?? '');
}

function releaseYear(entity: Entity): string {
  return entity.releaseDate ? entity.releaseDate.slice(0, 4) : '';
}

function markerSummary(parts: TitleParts): string {
  return parts.markers.join(' · ');
}

function durationGap(a: Entity, b: Entity): number | null {
  if (!a.durationMs || !b.durationMs) return null;
  return Math.abs(a.durationMs - b.durationMs);
}

const SAME_RECORDING_MS = 2_000;
const REISSUE_MS = 15_000;

/**
 * Compare two records of the same type.
 *
 * The rules are stated rather than learned, and each one that fired is handed
 * back so the user reads the same reasoning the app used.
 */
export function compareEntities(subject: Entity, other: Entity): Compared {
  const evidence: string[] = [];
  const uncertainty: string[] = [];

  if (
    subject.type !== other.type ||
    subject.id === other.id ||
    sameProviderIdentity(subject, other)
  ) {
    return { verdict: 'unrelated', score: 0, evidence, uncertainty };
  }

  const a = titleParts(subject.name);
  const b = titleParts(other.name);
  if (!a.base || a.base !== b.base) {
    return { verdict: 'unrelated', score: 0, evidence, uncertainty };
  }
  evidence.push(`Both are titled “${subject.name === other.name ? subject.name : a.base}”.`);

  const sameArtist = artistIdentity(subject) === artistIdentity(other);
  if (sameArtist && artistIdentity(subject)) {
    evidence.push(
      subject.subtitle && subject.subtitle === other.subtitle
        ? `Both are credited to ${subject.subtitle}.`
        : 'Both carry the same credit.',
    );
  } else if (!sameArtist) {
    const named = [subject.subtitle, other.subtitle].filter(Boolean);
    return {
      verdict: 'different-version',
      score: 0.25,
      evidence: [
        ...evidence,
        named.length === 2
          ? `Credited to different artists: ${named[0]} and ${named[1]}.`
          : 'The two carry different credits.',
      ],
      uncertainty: ['A shared title under a different credit is usually a cover, not a duplicate.'],
    };
  }

  const kinds = new Set([...a.kinds, ...b.kinds]);
  const gap = durationGap(subject, other);
  const bothMarkers = [markerSummary(a), markerSummary(b)].filter(Boolean);

  if (kinds.has('performance') || kinds.has('rework')) {
    const which = bothMarkers.join(' / ');
    return {
      verdict: 'different-version',
      score: 0.3,
      evidence: [
        ...evidence,
        which ? `One of them is marked: ${which}.` : 'One is marked as a different version.',
      ],
      uncertainty: [
        'Live takes, remixes and acoustic readings are different performances. Combining them would average two judgements of two different things.',
      ],
    };
  }

  if (gap !== null && gap > REISSUE_MS) {
    return {
      verdict: 'different-version',
      score: 0.2,
      evidence: [...evidence, `They run ${Math.round(gap / 1000)} seconds apart.`],
      uncertainty: ['A gap that size usually means a different take or a different edit.'],
    };
  }

  if (gap === null && subject.type === 'track') {
    uncertainty.push('One of them has no length recorded, so length could not be checked.');
  } else if (gap !== null) {
    evidence.push(
      gap <= SAME_RECORDING_MS
        ? 'They run to within two seconds of each other.'
        : `They run ${Math.round(gap / 1000)} seconds apart, which a remaster can account for.`,
    );
  }

  const years = [releaseYear(subject), releaseYear(other)].filter(Boolean);
  const differentYears = years.length === 2 && years[0] !== years[1];
  const editionMarker = kinds.has('edition');

  if (editionMarker || differentYears) {
    if (differentYears) evidence.push(`Released in ${years[0]} and ${years[1]}.`);
    if (bothMarkers.length > 0) evidence.push(`Marked: ${bothMarkers.join(' / ')}.`);
    const score = editionMarker && gap !== null && gap <= REISSUE_MS ? 0.86 : 0.72;
    return {
      verdict: 'reissue',
      score,
      evidence,
      uncertainty: [
        ...uncertainty,
        'A reissue can be remixed as well as remastered. If you rated them differently on purpose, keep them apart.',
      ],
    };
  }

  if (subject.type === 'album' || subject.type === 'playlist') {
    const counts = [subject.totalChildren, other.totalChildren].filter(
      (n): n is number => typeof n === 'number',
    );
    if (counts.length === 2 && counts[0] !== counts[1]) {
      evidence.push(`One holds ${counts[0]} items, the other ${counts[1]}.`);
      return {
        verdict: 'reissue',
        score: 0.6,
        evidence,
        uncertainty: [
          ...uncertainty,
          'Different track counts usually mean bonus material rather than a different record — but check.',
        ],
      };
    }
  }

  if (subject.type === 'track') {
    const subjectParents = new Set(subject.parentIds ?? []);
    const otherParents = new Set(other.parentIds ?? []);
    const shared = [...otherParents].some((id) => subjectParents.has(id));
    if (subjectParents.size > 0 && otherParents.size > 0 && !shared) {
      evidence.push('The two reached you through different releases.');
      return {
        verdict: 'appearance',
        score: 0.8,
        evidence,
        uncertainty: [
          ...uncertainty,
          'Same song, different release. Combining folds the compilation copy into the album copy.',
        ],
      };
    }
  }

  return { verdict: 'same-recording', score: 0.94, evidence, uncertainty };
}

/* -------------------------------------------------------------------------- */
/* Finding candidates                                                         */
/* -------------------------------------------------------------------------- */

export interface CandidateInput {
  subject: Entity;
  /** The pool to look in. Only entities of the subject's type are considered. */
  entities: readonly Entity[];
  /** Ids already folded into the subject's group, which are not candidates. */
  exclude?: ReadonlySet<EntityId>;
  /** Narrow the pool by a search term the user typed. */
  search?: string;
  limit?: number;
}

/**
 * Candidates for one item, best first.
 *
 * Nothing below `unrelated` is returned, and a "different version" is returned
 * *labelled as one* rather than hidden: the user is the one who knows whether
 * their live album is the same record to them, and a detector that silently
 * withheld the option would be making that call for them.
 */
export function findDuplicateCandidates(input: CandidateInput): DuplicateCandidate[] {
  const limit = input.limit ?? 12;
  const needle = input.search?.trim().toLowerCase() ?? '';
  const subjectParts = titleParts(input.subject.name);
  const out: DuplicateCandidate[] = [];

  for (const entity of input.entities) {
    if (entity.deleted) continue;
    if (entity.id === input.subject.id) continue;
    if (entity.type !== input.subject.type) continue;
    // Multiple search/import rows for one Spotify object are an ingestion
    // duplicate, not a judgement call the user should have to combine.
    if (sameProviderIdentity(input.subject, entity)) continue;
    if (input.exclude?.has(entity.id)) continue;

    if (needle) {
      const haystack = `${entity.name} ${entity.subtitle ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) continue;
    } else if (titleParts(entity.name).base !== subjectParts.base) {
      // Without a search term, only same-title records are offered. Everything
      // else would be a list of the library with the subject removed.
      continue;
    }

    const compared = compareEntities(input.subject, entity);
    if (compared.verdict === 'unrelated' && !needle) continue;
    out.push({
      entityId: entity.id,
      entityType: entity.type,
      verdict: compared.verdict,
      score: compared.score,
      evidence: compared.evidence,
      uncertainty: compared.uncertainty,
      suggested: compared.verdict === 'same-recording' || compared.verdict === 'reissue',
    });
  }

  out.sort((x, y) => (y.score !== x.score ? y.score - x.score : x.entityId < y.entityId ? -1 : 1));
  return out.slice(0, limit);
}

export interface DuplicateCluster {
  entityIds: EntityId[];
  verdict: DuplicateVerdict;
  detail: string;
}

/**
 * A whole-library sweep, for the data-health view.
 *
 * Bucketed by normalised title so the comparison stays linear in the size of
 * the library; only records sharing a bucket are ever compared with each other.
 */
export function findDuplicateClusters(
  entities: readonly Entity[],
  options: { limit?: number; exclude?: ReadonlySet<EntityId> } = {},
): DuplicateCluster[] {
  const limit = options.limit ?? 20;
  const buckets = new Map<string, Entity[]>();
  for (const entity of entities) {
    if (entity.deleted) continue;
    if (options.exclude?.has(entity.id)) continue;
    const key = candidateKey(entity);
    const bucket = buckets.get(key);
    if (!bucket) buckets.set(key, [entity]);
    else if (!bucket.some((existing) => sameProviderIdentity(existing, entity)))
      bucket.push(entity);
  }

  const clusters: DuplicateCluster[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const sorted = [...bucket].sort((a, b) => (a.id < b.id ? -1 : 1));
    const subject = sorted[0] as Entity;
    const matches = sorted.slice(1).map((other) => compareEntities(subject, other));
    const related = matches.filter((m) => m.verdict !== 'unrelated');
    if (related.length === 0) continue;
    const verdict = (related.find((m) => m.verdict !== 'different-version')?.verdict ??
      'different-version') as DuplicateVerdict;
    clusters.push({
      entityIds: sorted.map((e) => e.id),
      verdict,
      detail: related[0]?.evidence.join(' ') ?? '',
    });
  }

  clusters.sort((a, b) => (a.entityIds[0] as string).localeCompare(b.entityIds[0] as string));
  return clusters.slice(0, limit);
}
