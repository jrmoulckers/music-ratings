import { get } from 'svelte/store';
import { fillArtistArtwork } from '../spotify/artwork';
import { SpotifyClient } from '../spotify/client';
import { spotifyConfig, spotifySession } from '../spotify/session';
import type { Entity } from '../domain/types';
import { upsertEntities } from '../storage/repo';
import { refreshWorld } from './state';

/**
 * Completing artist records for whatever is on screen.
 *
 * The rule is that the app asks about the artists the person is actually
 * looking at, a few at a time, and never sweeps the whole library in the
 * background: a collection of six hundred artists would be six hundred requests
 * spent on pictures nobody asked to see. Everything else is handled by
 * `fillArtistArtwork`, which does the bounding and the de-duplication.
 */

let running = false;

/**
 * Fills in missing artist pictures for `candidates`, then rebuilds the world
 * once so every surface showing that artist picks the picture up.
 *
 * Never throws: a missing picture is not a failure worth interrupting anyone
 * for. Returns how many were completed, which is what tests assert on.
 */
export async function topUpArtistArtwork(candidates: readonly Entity[]): Promise<number> {
  if (running || candidates.length === 0) return 0;
  if (!get(spotifySession).connected) return 0;

  running = true;
  try {
    const client = new SpotifyClient({ config: spotifyConfig() });
    const { filled } = await fillArtistArtwork(client, candidates);
    if (filled.length === 0) return 0;
    await upsertEntities(filled);
    await refreshWorld();
    return filled.length;
  } catch {
    // Offline, revoked, misconfigured: the artists stay exactly as they were.
    return 0;
  } finally {
    running = false;
  }
}
