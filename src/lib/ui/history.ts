import type { RatingConfidence, RatingEvent } from '../domain/types';

/**
 * What a history entry is, and what can be done to it.
 *
 * History is a record, not a list of editable rows: nothing written into it is
 * ever changed. That single rule decides everything here — which of the two
 * record-management actions an entry offers, what it is called on the page, and
 * what happens when you rate from it.
 */

/** Where an entry stands relative to the entity's rating today. */
export type EntryStanding = 'current' | 'earlier' | 'withdrawn';

/**
 * The one record action an entry offers.
 *
 * Never both. Offering "withdraw" and "delete" side by side asks the reader to
 * work out the difference between two words before they can touch either, and
 * they only ever want one of them: withdraw while the entry still counts,
 * delete once it has stopped. So delete is only reachable through withdraw,
 * which is also the order that makes deleting hard to do by accident.
 */
export type EntryAction = 'withdraw' | 'delete';

export function entryStanding(
  event: RatingEvent,
  currentEventId: string | undefined,
): EntryStanding {
  if (event.retracted) return 'withdrawn';
  return event.id === currentEventId ? 'current' : 'earlier';
}

export function entryAction(event: RatingEvent): EntryAction {
  return event.retracted ? 'delete' : 'withdraw';
}

/**
 * How the editor opens on an entry.
 *
 * From the entry you clicked — its value, its note, its confidence — and not
 * from whatever the newest rating happens to be. Someone reopening a six they
 * gave in March wants to start from the six.
 */
export interface EntrySeed {
  normalized: number;
  note?: string;
  confidence?: RatingConfidence;
}

export function seedFrom(event: RatingEvent): EntrySeed {
  return {
    normalized: event.normalized,
    ...(event.note ? { note: event.note } : {}),
    ...(event.confidence ? { confidence: event.confidence } : {}),
  };
}
