import { get } from 'svelte/store';

import { graph, refreshWorld, settings, updateSettings } from '../app/state';
import type { AlbumCompletion } from '../domain/listening';
import type { PlayHistory } from '../spotify/client';
import { ingestPlayHistory, type IngestResult } from './ingest';

/**
 * The one place the app turns a Spotify window into recorded listening.
 *
 * Both entry points — the periodic listening refresh and the full library
 * import — come through here, so the consent check, the observation-start date
 * and the ordering of "store the catalogue, then judge the listening" are
 * written once rather than three times.
 */

let lastResult: IngestResult | null = null;

/** What the last ingest saw. Diagnostics only; never a source of truth. */
export function lastIngest(): IngestResult | null {
  return lastResult;
}

/**
 * Fold a recently-played window into the durable log.
 *
 * Returns the completions this pass closed, if any — one per record whose final
 * missing track arrived in this very batch. Anything already recorded, or
 * completed before the app was looking, returns nothing, which is what makes
 * the moment on screen genuinely the moment.
 */
export async function recordListening(items: readonly PlayHistory[]): Promise<AlbumCompletion[]> {
  const current = get(settings);
  if (!current.listeningEnabled) return [];
  if (items.length === 0) return [];

  // The catalogue has to be stored before the listening is judged: completion
  // is a statement about an album's track list, and an album the app has not
  // seen yet has no track list to be complete against.
  await refreshWorld();

  const result = await ingestPlayHistory({
    items,
    graph: get(graph),
    completionWindowDays: current.completionWindowDays,
    recompletion: current.recompletionMode,
    recompletionCooldownDays: current.recompletionCooldownDays,
    prompts: current.completionPrompts,
    retentionDays: current.listeningRetentionDays,
  });
  lastResult = result;

  // The observation start is written on the first play actually recorded, not
  // when the setting was switched on: it is the date the evidence begins, and
  // every "since" line on the Listening surface leans on it being exactly that.
  if (result.inserted > 0 && !current.listeningObservedFrom) {
    await updateSettings({ listeningObservedFrom: Date.now() });
  }
  if (result.inserted > 0) await refreshWorld();

  return result.completions;
}
