import { get } from 'svelte/store';

import { denormalize } from '../domain/scales';
import type {
  Comparison,
  ContextSnapshot,
  Entity,
  EntityId,
  RatingConfidence,
  RatingContext,
} from '../domain/types';
import {
  clearQueueState,
  combineEntities,
  patchCanonicalAnnotation,
  recordComparison,
  recordRating,
  retractRating,
  revertCombine,
  setGroupPrimary,
  setQueueState,
  uncombineGroup,
  undoComparison,
  type CombineResult,
} from '../storage/repo';
import { announce, notify } from './notices';
import { annotationsById, canonical, scaleForType } from './state';

/**
 * The verbs the screens call.
 *
 * Each one performs the write, says what happened out loud for a screen reader,
 * and — where the action is reversible — hands back the way to reverse it.
 */

const DAY = 86_400_000;

export interface RateOptions {
  note?: string;
  tags?: string[];
  confidence?: RatingConfidence;
  context?: RatingContext;
  /**
   * Contextual facets judged in the same sitting. They ride on the event, so
   * one save writes one rating: adjusting a facet never records anything on
   * its own.
   */
  contextual?: ContextSnapshot | null;
}

export async function rate(
  entity: Entity,
  normalized: number,
  options: RateOptions = {},
): Promise<void> {
  const scale = get(scaleForType)(entity.type);
  const event = await recordRating({
    entityId: entity.id,
    entityType: entity.type,
    normalized,
    value: denormalize(scale, normalized),
    scaleId: scale.id,
    ...(options.confidence ? { confidence: options.confidence } : {}),
    ...(options.note ? { note: options.note } : {}),
    ...(options.tags?.length ? { tags: options.tags } : {}),
    ...(options.context ? { context: options.context } : {}),
    ...(options.contextual?.facets.length ? { contextual: options.contextual } : {}),
  });
  // A rating replaces the previous one by being newer, so undo means retracting
  // this event rather than restoring anything.
  const facets = options.contextual?.facets.length ?? 0;
  const spoken =
    facets > 0
      ? `${entity.name} rated ${denormalize(scale, normalized)} on ${scale.label}, with ${facets} context ${facets === 1 ? 'facet' : 'facets'}.`
      : `${entity.name} rated ${denormalize(scale, normalized)} on ${scale.label}.`;
  announce(spoken);
  notify(spoken, {
    action: {
      label: 'Undo',
      run: async () => {
        await retractRating(event.id);
        announce(`Rating withdrawn from ${entity.name}.`);
      },
    },
  });
}

export async function skip(entity: Entity): Promise<void> {
  await setQueueState(entity.id, entity.type, 'skipped');
  announce(`${entity.name} skipped.`);
  notify(`Skipped ${entity.name}. It is out of the queue for the rest of this pass.`, {
    action: { label: 'Undo', run: () => clearQueueState(entity.id) },
  });
}

export async function snooze(entity: Entity, days = 30): Promise<void> {
  const until = Date.now() + days * DAY;
  await setQueueState(entity.id, entity.type, 'snoozed', until);
  const when = new Date(until).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  announce(`${entity.name} snoozed until ${when}.`);
  notify(`Snoozed ${entity.name} until ${when}.`, {
    action: { label: 'Undo', run: () => clearQueueState(entity.id) },
  });
}

export async function restoreToQueue(entity: Entity): Promise<void> {
  await clearQueueState(entity.id);
  const spoken = `${entity.name} is back in the queue.`;
  announce(spoken);
  notify(spoken);
}

export async function pin(entity: Entity, kind: 'favorite' | 'avoid' | null): Promise<void> {
  const existing = get(annotationsById).get(entity.id);
  const index = get(canonical);
  const id = index.resolve(entity.id);
  await patchCanonicalAnnotation(id, index.members(id), {
    tags: existing?.tags ?? [],
    ...(kind ? { pinned: kind } : { pinned: undefined }),
  });
  const word =
    kind === 'favorite'
      ? `${entity.name} pinned as a favourite.`
      : kind === 'avoid'
        ? `${entity.name} pinned as one to avoid.`
        : `Pin removed from ${entity.name}.`;
  announce(word);
  notify(word);
}

export async function setTags(entityId: EntityId, tags: string[]): Promise<void> {
  const index = get(canonical);
  const id = index.resolve(entityId);
  await patchCanonicalAnnotation(id, index.members(id), { tags });
}

export async function setStandingNote(entityId: EntityId, note: string): Promise<void> {
  const existing = get(annotationsById).get(entityId);
  const index = get(canonical);
  const id = index.resolve(entityId);
  await patchCanonicalAnnotation(id, index.members(id), {
    tags: existing?.tags ?? [],
    ...(note.trim() ? { note: note.trim() } : { note: undefined }),
  });
}

/* -------------------------------------------------------------------------- */

export async function submitComparison(
  a: Entity,
  b: Entity,
  outcome: Comparison['outcome'],
  reason?: string,
): Promise<Comparison> {
  const comparison = await recordComparison(a.type, a.id, b.id, outcome, reason);
  const spoken =
    outcome === 'a'
      ? `${a.name} preferred over ${b.name}.`
      : outcome === 'b'
        ? `${b.name} preferred over ${a.name}.`
        : outcome === 'tie'
          ? `${a.name} and ${b.name} recorded as level.`
          : outcome === 'unfamiliar'
            ? 'Pair set aside as unfamiliar.'
            : 'Pair skipped.';
  announce(spoken);
  notify(spoken, {
    action: { label: 'Undo', run: () => undoComparison(comparison.id) },
  });
  return comparison;
}

/* -------------------------------------------------------------------------- */
/* Combining duplicates                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Declare several catalogue records to be one.
 *
 * The whole consequence is spoken out loud, because this is the one action in
 * the app that can change a number the user did not touch: where two of the
 * sources were rated, their ratings are averaged into one new entry. Undo takes
 * the group apart again and withdraws that entry, putting every source back
 * where it was.
 */
export async function combine(
  entity: Entity,
  entityIds: readonly EntityId[],
  primaryId: EntityId,
): Promise<CombineResult> {
  const scale = get(scaleForType)(entity.type);
  const result = await combineEntities({ entityIds, primaryId, scale });
  const count = result.group.memberIds.length;
  const rating =
    result.plan.rating.kind === 'averaged'
      ? ` Your ${result.plan.rating.sources.length} ratings were averaged into one new entry; the originals stay in your history.`
      : result.plan.rating.kind === 'carried'
        ? ' The one rating among them now stands for all of them.'
        : '';
  const spoken = `${count} items combined into ${entity.name}.${rating}`;
  announce(spoken);
  notify(spoken, {
    action: {
      label: 'Undo',
      run: async () => {
        await revertCombine(result);
        announce(
          result.previous
            ? `${entity.name} is back to ${result.previous.memberIds.length} combined sources.`
            : `${entity.name} separated again.`,
        );
      },
    },
  });
  return result;
}

export async function separate(groupId: string, name: string): Promise<void> {
  const plan = await uncombineGroup(groupId);
  if (!plan) return;
  const spoken =
    plan.withdrawEventIds.length > 0
      ? `${name} separated into ${plan.memberIds.length} items. The averaged entry was withdrawn, so each is back to its own rating.`
      : `${name} separated into ${plan.memberIds.length} items.`;
  announce(spoken);
  notify(spoken);
}

export async function makePrimary(groupId: string, entity: Entity): Promise<void> {
  await setGroupPrimary(groupId, entity.id);
  const spoken = `${entity.name} now represents the combined record.`;
  announce(spoken);
  notify(spoken);
}
