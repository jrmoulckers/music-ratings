import type { Entity, EntityId } from './types';

/**
 * Telling apart records that look the same.
 *
 * Searching for Let It Bleed returns two rows with the same title, the same
 * artist and the same sleeve. They are not a bug: Spotify carries separate ids
 * for the 1969 master, the anniversary remaster and per-market editions, and
 * each is a real record that can hold its own rating. What was a bug is showing
 * them as if they were the same thing.
 *
 * So nothing is merged and nothing is hidden. Rows that would otherwise be
 * indistinguishable get the smallest fact that separates them — and rows that
 * are already distinct get nothing, because a year on every line is noise.
 */

/** What the eye actually compares: kind, title and the line under it. */
function visibleIdentity(entity: Entity): string {
  return [
    entity.type,
    entity.name.trim().toLowerCase(),
    (entity.subtitle ?? '').trim().toLowerCase(),
  ].join('\u0000');
}

/**
 * A title with edition wording removed, for finding candidates to combine.
 *
 * Not used for display. This is the looser comparison a "these are the same
 * record" workflow needs, kept here so the two notions of sameness live
 * together and cannot drift apart.
 */
export function normalizedTitle(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /[([][^)\]]*\b(deluxe|remaster(ed)?|edition|anniversary|expanded|version|mono|stereo|bonus)\b[^)\]]*[)\]]/g,
      '',
    )
    .replace(/\s*-\s*\d{4}\s+remaster(ed)?\s*$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const KIND_WORDS: Record<string, string> = {
  single: 'Single',
  compilation: 'Compilation',
};

/** Facts that might separate two otherwise identical rows, best first. */
function facts(entity: Entity): string[] {
  const out: string[] = [];
  const year = entity.releaseDate?.slice(0, 4);
  if (year && /^\d{4}$/.test(year)) out.push(year);
  const kind = entity.albumKind ? KIND_WORDS[entity.albumKind] : undefined;
  if (kind) out.push(kind);
  if (entity.totalChildren && entity.totalChildren > 0)
    out.push(`${entity.totalChildren} track${entity.totalChildren === 1 ? '' : 's'}`);
  return out;
}

/**
 * A short label per entity, for the ones that need one.
 *
 * Only entities sharing their whole visible identity with another in the same
 * list get an entry. The label is the shortest combination of facts that is
 * unique within its group; when the catalogue genuinely offers nothing to tell
 * them apart, the provider's own id is used rather than leaving two rows the
 * user cannot choose between.
 */
export function editionMarks(entities: readonly Entity[]): Map<EntityId, string> {
  const groups = new Map<string, Entity[]>();
  for (const entity of entities) {
    const key = visibleIdentity(entity);
    const found = groups.get(key);
    if (found) found.push(entity);
    else groups.set(key, [entity]);
  }

  const marks = new Map<EntityId, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const options = group.map((entity) => facts(entity));

    // Take one fact at a time, stopping as soon as the group is separated.
    let depth = 0;
    const width = Math.max(...options.map((f) => f.length));
    let labels = group.map(() => '');
    while (depth < width) {
      labels = options.map((f) => f.slice(0, depth + 1).join(' · '));
      depth += 1;
      if (new Set(labels).size === group.length) break;
    }

    const unique = new Set(labels).size === group.length;
    group.forEach((entity, i) => {
      const label = labels[i] ?? '';
      // A last resort, and deliberately dull: enough of the catalogue id to
      // choose by, never presented as if it meant something.
      const fallback = `id ${entity.providerId.slice(0, 6)}`;
      marks.set(entity.id, unique && label ? label : label ? `${label} · ${fallback}` : fallback);
    });
  }
  return marks;
}
