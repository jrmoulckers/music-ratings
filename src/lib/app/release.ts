import { get } from 'svelte/store';

import { expandEntity } from '../spotify/library';
import { SpotifyClient } from '../spotify/client';
import { spotifyConfig, spotifySession } from '../spotify/session';
import { saveMemberships, upsertEntities } from '../storage/repo';
import type { Entity } from '../domain/types';
import type { ContainmentGraph } from '../domain/graph';
import { refreshWorld } from './state';

/**
 * The whole record, or an honest account of why not.
 *
 * A release arrives in this app by whatever door happened to open first: two
 * tracks heard last Tuesday, one found in a search, one saved years ago. That
 * is a fine way to *discover* a record and a terrible way to *show* one — a
 * thirteen-track album rendered as the two tracks you happen to have played
 * looks like a bug, and worse, listening through it track by track would then
 * silently skip eleven of them.
 *
 * So every surface that shows a release whole goes through here first. It asks
 * Spotify for the album and its full, paginated track list, files them, and
 * remembers that it has. Nothing else is allowed to decide a release is
 * complete on its own evidence.
 */

/** What a caller needs to know before drawing a track list. */
export type ReleaseFill =
  /** The stored set matches what Spotify says the record contains. */
  | { status: 'complete'; known: number; total: number | null }
  /** Everything known is stored, but Spotify could not be asked. */
  | { status: 'incomplete'; known: number; total: number | null; reason: string };

/** Releases proven whole this session. Cleared only by a reload. */
const settled = new Set<string>();

/** One request per release, however many surfaces ask at once. */
const inFlight = new Map<string, Promise<ReleaseFill>>();

/** How many tracks of this release are already filed. */
export function knownTrackCount(graph: ContainmentGraph, entity: Entity): number {
  return graph.childrenOfType(entity.id, 'track').length;
}

/**
 * Whether the stored set can be trusted as the whole record.
 *
 * `totalChildren` comes from Spotify's own `total_tracks` and is the only
 * authority worth having. Without it — a release that reached us through a
 * playback event, say — any non-empty set has to be treated as unproven, which
 * is why the first visit to such a release still asks.
 */
export function releaseLooksComplete(entity: Entity, known: number): boolean {
  const total = entity.totalChildren;
  if (total === undefined || total <= 0) return false;
  return known >= total;
}

/**
 * Ensure a release's full track list is stored, then report what is there.
 *
 * Never throws: a caller drawing a track list wants a state to render, not an
 * exception to catch. A release proven complete once is not asked about again,
 * and a release two surfaces ask for at the same moment is fetched once.
 */
export async function ensureRelease(entity: Entity, graph: ContainmentGraph): Promise<ReleaseFill> {
  const known = knownTrackCount(graph, entity);
  const total = entity.totalChildren ?? null;

  if (entity.type !== 'album') return { status: 'complete', known, total };

  if (settled.has(entity.id) || releaseLooksComplete(entity, known)) {
    settled.add(entity.id);
    return { status: 'complete', known, total };
  }

  if (entity.provider !== 'spotify' || !get(spotifySession).connected) {
    return {
      status: 'incomplete',
      known,
      total,
      reason: 'Connect Spotify to load the rest of this release.',
    };
  }

  const running = inFlight.get(entity.id);
  if (running) return running;

  const work = fetchRelease(entity, known, total);
  inFlight.set(entity.id, work);
  try {
    return await work;
  } finally {
    inFlight.delete(entity.id);
  }
}

async function fetchRelease(
  entity: Entity,
  known: number,
  total: number | null,
): Promise<ReleaseFill> {
  try {
    const client = new SpotifyClient({ config: spotifyConfig() });
    const result = await expandEntity(client, entity);
    const tracks = result.entities.filter((e) => e.type === 'track').length;
    if (result.entities.length > 0) {
      await upsertEntities(result.entities);
      await saveMemberships(result.memberships);
      await refreshWorld();
    }

    // Spotify's own answer replaces the count we came in with. A release whose
    // list is genuinely shorter than `total_tracks` — an edition with an
    // unavailable track — must not be re-fetched on every visit, so what
    // Spotify just returned is taken as the whole of it.
    settled.add(entity.id);
    return { status: 'complete', known: Math.max(known, tracks), total };
  } catch (error) {
    return {
      status: 'incomplete',
      known,
      total,
      reason: error instanceof Error ? error.message : 'Spotify could not be reached.',
    };
  }
}

/** Ask again after a failure, ignoring anything remembered about this release. */
export async function retryRelease(entity: Entity, graph: ContainmentGraph): Promise<ReleaseFill> {
  settled.delete(entity.id);
  return ensureRelease(entity, graph);
}

/** Test seam. Nothing in the app clears this. */
export function resetReleaseCache(): void {
  settled.clear();
  inFlight.clear();
}
