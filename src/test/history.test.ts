import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';

import RatePanel from '../components/RatePanel.svelte';
import { currentRating, indexCurrentRatings } from '../lib/domain/ratings';
import type { Entity, RatingEvent } from '../lib/domain/types';
import { entryAction, entryStanding, seedFrom } from '../lib/ui/history';

/**
 * The record, and what it lets you do to it.
 *
 * Two rules are worth proving over and over: an entry opens on its own value
 * rather than the newest one, and nothing in the record is ever rewritten. The
 * rest — which of the two record actions a row shows, what withdrawing the
 * live entry reveals — falls out of those.
 */

function event(over: Partial<RatingEvent> = {}): RatingEvent {
  return {
    id: 'e1',
    entityId: 'demo:track:1',
    entityType: 'track',
    at: 1_700_000_000_000,
    value: 6,
    scaleId: 'int-10',
    normalized: 60,
    confidence: 'medium',
    updatedAt: 1_700_000_000_000,
    ...over,
  };
}

describe('an entry in the record', () => {
  it('offers withdraw while it still counts, and never delete beside it', () => {
    expect(entryAction(event())).toBe('withdraw');
  });

  it('offers delete only once it has been withdrawn', () => {
    expect(entryAction(event({ retracted: 1_700_000_100_000 }))).toBe('delete');
  });

  it('says which entry is the rating in force', () => {
    const older = event({ id: 'old', at: 1_000, normalized: 40 });
    const newer = event({ id: 'new', at: 2_000, normalized: 80 });
    const current = indexCurrentRatings([older, newer]).get('demo:track:1')?.eventId;

    expect(entryStanding(newer, current)).toBe('current');
    expect(entryStanding(older, current)).toBe('earlier');
  });

  it('calls a withdrawn entry withdrawn, whatever its date', () => {
    const gone = event({ id: 'gone', at: 9_999, retracted: 10_000 });
    const live = event({ id: 'live', at: 1_000 });
    const current = indexCurrentRatings([gone, live]).get('demo:track:1')?.eventId;

    expect(current).toBe('live');
    expect(entryStanding(gone, current)).toBe('withdrawn');
  });

  it('hands the editor its own value, note and confidence', () => {
    const seed = seedFrom(
      event({ normalized: 60, note: 'the ending saves it', confidence: 'high' }),
    );
    expect(seed).toEqual({ normalized: 60, note: 'the ending saves it', confidence: 'high' });
  });

  it('leaves out a note that was never written rather than seeding an empty one', () => {
    expect(seedFrom(event())).toEqual({ normalized: 60, confidence: 'medium' });
  });

  it('hands back the context answers that entry was saved with', () => {
    const seed = seedFrom(
      event({
        contextual: {
          v: 1,
          facets: [{ facetId: 'innovation', value: 10, scaleId: 'int-10', normalized: 100 }],
          weights: { innovation: 1 },
          contribution: 0.2,
          applicable: 4,
        },
      }),
    );
    expect(seed.contextual?.facets[0]?.facetId).toBe('innovation');
    expect(seed.contextual?.contribution).toBe(0.2);
  });

  it('copies those answers, so editing a draft cannot reach into the record', () => {
    const source = event({
      contextual: {
        v: 1,
        facets: [{ facetId: 'innovation', value: 10, scaleId: 'int-10', normalized: 100 }],
        weights: { innovation: 1 },
        contribution: 0.2,
        applicable: 4,
      },
    });
    const seed = seedFrom(source);
    seed.contextual!.facets[0]!.normalized = 10;
    expect(source.contextual?.facets[0]?.normalized).toBe(100);
  });

  it('carries no context at all from an entry that recorded none', () => {
    expect(seedFrom(event()).contextual).toBeUndefined();
  });
});

describe('withdrawing', () => {
  it('hands the rating back to the entry before it', () => {
    const march = event({ id: 'march', at: 1_000, normalized: 40 });
    const june = event({ id: 'june', at: 2_000, normalized: 90 });

    expect(currentRating([march, june])?.eventId).toBe('june');
    // Withdrawal is a mark on the event, not a removal of it.
    const withdrawn = { ...june, retracted: 3_000 };
    expect(currentRating([march, withdrawn])?.eventId).toBe('march');
  });

  it('changes nothing about the current rating when an older entry goes', () => {
    const march = event({ id: 'march', at: 1_000, normalized: 40, retracted: 3_000 });
    const june = event({ id: 'june', at: 2_000, normalized: 90 });
    expect(currentRating([march, june])?.eventId).toBe('june');
  });

  it('leaves an entity with no rating at all once every entry is withdrawn', () => {
    const only = event({ id: 'only', retracted: 5_000 });
    expect(currentRating([only])).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The editor, opened from an entry                                           */
/* -------------------------------------------------------------------------- */

let host: HTMLDivElement | null = null;

let app: any = null;

afterEach(() => {
  if (app) void unmount(app, { outro: false });
  host?.remove();
  app = null;
  host = null;
});

const track: Entity = {
  id: 'demo:track:1',
  type: 'track',
  provider: 'local',
  providerId: 'track-1',
  name: 'Slow Wire',
  provenance: { provider: 'local', via: 'demo', fetchedAt: 0 },
  createdAt: 0,
  updatedAt: 0,
};

function open(seed: ReturnType<typeof seedFrom>, aboutSaving?: string) {
  host = document.createElement('div');
  document.body.appendChild(host);
  app = mount(RatePanel, {
    target: host,
    props: { entity: track, inline: true, shortcuts: false, seed, aboutSaving },
  });
  flushSync();
  return host;
}

describe('rating again from an entry', () => {
  /** The confidence control is three buttons, so read the pressed one. */
  function pressedConfidence(root: HTMLElement): string | undefined {
    return root
      .querySelector<HTMLButtonElement>('fieldset button[aria-pressed="true"]')
      ?.textContent?.trim();
  }

  it('opens on the entry’s own note and confidence', () => {
    const seeded = open(
      seedFrom(event({ normalized: 60, note: 'the ending saves it', confidence: 'high' })),
    );
    const note = seeded.querySelector<HTMLTextAreaElement>('textarea');
    expect(note?.value).toBe('the ending saves it');
    expect(pressedConfidence(seeded)).toBe('Certain');
  });

  it('opens blank on an entry that carried neither', () => {
    const seeded = open(seedFrom(event()));
    expect(seeded.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('');
    expect(pressedConfidence(seeded)).toBe('Fairly sure');
  });

  it('says what saving will do instead of talking about the last rating', () => {
    const seeded = open(
      seedFrom(event()),
      'Filled in from this entry, made 3 June. Saving writes a new entry.',
    );
    const said = seeded.querySelector('.panel__prior')?.textContent ?? '';
    expect(said).toContain('Saving writes a new entry');
    expect(said).not.toContain('You last rated this');
  });
});
