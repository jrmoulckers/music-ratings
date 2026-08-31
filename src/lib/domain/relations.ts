import type { EntityId, EntityType, ScoreBreakdown } from './types';
import { typeNoun } from './reasons';

/**
 * What a page may say about a thing's relationships.
 *
 * A detail page used to ask one question of everything — "what's inside?" — and
 * a track has no inside. The answer was an empty state and a button offering to
 * load contents Spotify will never return, which is a page inventing a hole in
 * the data to apologise for.
 *
 * So the vocabulary is decided from the kind of thing and the kind of edge, and
 * a leaf is never asked the container's question at all.
 */

/** Kinds that can hold other things. Everything else is a leaf. */
const CONTAINERS: ReadonlySet<EntityType> = new Set<EntityType>([
  'artist',
  'album',
  'playlist',
  'show',
  'audiobook',
]);

export function canContain(type: EntityType): boolean {
  return CONTAINERS.has(type);
}

/**
 * A subtitle with the context you are already standing in taken out.
 *
 * Entity subtitles carry their whole lineage — "Kestrel Harbour · Rain Ledger" —
 * which is worth reading in search and worthless ten rows deep in Rain Ledger's
 * own tracklist. Naming the same artist on every line is noise the eye has to
 * skip past to reach what actually differs.
 *
 * Shared by the hero and by every row on the page so the two can never disagree
 * about what has already been said. Returns null when nothing survives.
 */
export function trimContext(subtitle: string | undefined, known: readonly string[]): string | null {
  const text = subtitle?.trim();
  if (!text) return null;
  const drop = new Set(
    known.map((name) => name.trim().toLowerCase()).filter((name) => name.length > 0),
  );
  if (drop.size === 0) return text;
  const pieces = text
    .split(/[,·—–]/)
    .map((piece) => piece.trim())
    .filter(Boolean);
  const kept = pieces.filter((piece) => !drop.has(piece.toLowerCase()));
  if (kept.length === pieces.length) return text;
  return kept.length > 0 ? kept.join(' · ') : null;
}

/**
 * Whether Spotify will actually expand this kind on request.
 *
 * Deliberately the same set `expandEntity` switches on: an offer to load
 * contents that resolves to nothing is worse than no offer.
 */
export function canExpand(type: EntityType): boolean {
  return CONTAINERS.has(type);
}

/** What a container is expected to hold, for headings written before the data arrives. */
export function expectedChildType(type: EntityType): EntityType {
  switch (type) {
    case 'artist':
      return 'album';
    case 'show':
      return 'episode';
    case 'audiobook':
      return 'chapter';
    default:
      return 'track';
  }
}

/** What owns a leaf, for the one line a leaf with no known owner should say. */
export function expectedOwnerType(type: EntityType): EntityType | null {
  switch (type) {
    case 'track':
      return 'album';
    case 'episode':
      return 'show';
    case 'chapter':
      return 'audiobook';
    default:
      return null;
  }
}

/** The word a section of contents goes under, given both ends of the edge. */
export function contentsHeading(parentType: EntityType, childType: EntityType): string {
  if (parentType === 'album' && childType === 'track') return 'Tracklist';
  if (parentType === 'show' && childType === 'episode') return 'Episodes';
  if (parentType === 'audiobook' && childType === 'chapter') return 'Chapters';
  if (parentType === 'artist' && childType === 'album') return 'Releases';
  const word = typeNoun(childType, true);
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * The word an owning relationship goes under.
 *
 * Read from the parent's kind, because "appears on" and "by" are not the same
 * claim and a flat list of links makes the reader work out which is which.
 */
export function relationHeading(parentType: EntityType): string {
  switch (parentType) {
    case 'album':
      return 'Appears on';
    case 'artist':
      return 'By';
    case 'playlist':
      return 'In playlists';
    case 'show':
    case 'audiobook':
      return 'From';
    default:
      return 'Related to';
  }
}

/** Owners first, then the lists something merely got put on. */
const PARENT_ORDER: readonly EntityType[] = [
  'album',
  'show',
  'audiobook',
  'artist',
  'playlist',
  'track',
  'episode',
  'chapter',
];

export interface ParentGroup {
  type: EntityType;
  heading: string;
  ids: EntityId[];
}

/**
 * Owning relationships, grouped by kind rather than dumped in one list.
 *
 * Ten links under "Belongs to" is a page refusing to say which of them is the
 * record this track is from. Duplicate edges — the same parent reached twice —
 * collapse, because a membership recorded twice is not two relationships.
 */
export function groupParents(
  edges: readonly { parentId: EntityId; parentType: EntityType }[],
): ParentGroup[] {
  const byType = new Map<EntityType, EntityId[]>();
  const seen = new Set<EntityId>();
  for (const edge of edges) {
    if (seen.has(edge.parentId)) continue;
    seen.add(edge.parentId);
    const list = byType.get(edge.parentType);
    if (list) list.push(edge.parentId);
    else byType.set(edge.parentType, [edge.parentId]);
  }
  return [...byType.entries()]
    .map(([type, ids]) => ({ type, heading: relationHeading(type), ids }))
    .sort((a, b) => rank(a.type) - rank(b.type));
}

function rank(type: EntityType): number {
  const index = PARENT_ORDER.indexOf(type);
  return index === -1 ? PARENT_ORDER.length : index;
}

const CHANNEL_GIST: Record<string, string> = {
  explicit: 'your own rating',
  directChildren: 'the ratings of what it contains',
  descendants: 'ratings further down',
  comparison: 'its head-to-head record',
};

/**
 * One line naming where a computed score mostly came from.
 *
 * The full working is a disclosure away; this is the sentence that makes
 * opening it optional rather than obligatory.
 */
export function scoreGist(breakdown: ScoreBreakdown | undefined): string | null {
  if (!breakdown) return null;
  const used = breakdown.channels.filter((c) => c.value !== null && c.appliedWeight > 0);
  if (used.length === 0) return 'Nothing to compute a score from yet.';
  const top = used.reduce((best, c) => (c.appliedWeight > best.appliedWeight ? c : best));
  const gist = CHANNEL_GIST[top.channel] ?? 'the evidence recorded';
  return used.length === 1 ? `From ${gist} alone.` : `Mostly ${gist}.`;
}
