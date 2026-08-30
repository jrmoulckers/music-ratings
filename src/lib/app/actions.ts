import { get } from 'svelte/store';

import { denormalize } from '../domain/scales';
import type { Comparison, Entity, EntityId, RatingConfidence } from '../domain/types';
import {
  clearQueueState,
  patchAnnotation,
  recordComparison,
  recordRating,
  retractRating,
  setQueueState,
  undoComparison,
} from '../storage/repo';
import { announce, notify } from './notices';
import { annotationsById, scaleForType } from './state';

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
  context?: 'queue' | 'detail' | 'duel' | 'import' | 'bulk';
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
  });
  // A rating replaces the previous one by being newer, so undo means retracting
  // this event rather than restoring anything.
  const spoken = `${entity.name} rated ${denormalize(scale, normalized)} on ${scale.label}.`;
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
  notify(`Skipped ${entity.name}. It will come back later, further down.`, {
    action: { label: 'Undo', run: () => clearQueueState(entity.id) },
  });
}

export async function snooze(entity: Entity, days = 30): Promise<void> {
  await setQueueState(entity.id, entity.type, 'snoozed', Date.now() + days * DAY);
  announce(`${entity.name} snoozed for ${days} days.`);
  notify(`Snoozed ${entity.name} for ${days} days.`, {
    action: { label: 'Undo', run: () => clearQueueState(entity.id) },
  });
}

export async function markUnfamiliar(entity: Entity): Promise<void> {
  await setQueueState(entity.id, entity.type, 'unfamiliar');
  announce(`${entity.name} marked as not familiar.`);
  notify(`Marked ${entity.name} as one you do not know yet.`, {
    action: { label: 'Undo', run: () => clearQueueState(entity.id) },
  });
}

export async function pin(entity: Entity, kind: 'favorite' | 'avoid' | null): Promise<void> {
  const existing = get(annotationsById).get(entity.id);
  await patchAnnotation(entity.id, {
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
  await patchAnnotation(entityId, { tags });
}

export async function setStandingNote(entityId: EntityId, note: string): Promise<void> {
  const existing = get(annotationsById).get(entityId);
  await patchAnnotation(entityId, {
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
