import { beforeEach, describe, expect, it } from 'vitest';

import { computeRankings } from './elo';
import { ContainmentGraph } from './graph';
import { indexCurrentRatings } from './ratings';
import { defaultRollupConfigByType } from './rollup';
import {
  DEFAULT_SUGGESTION_WEIGHTS,
  EMPTY_SIGNALS,
  SKIP_COOLDOWN_MS,
  TIER_INFERRED,
  TIER_JUST_PLAYED,
  collapsePlays,
  emptySuggestionWeights,
  scoreSuggestions,
  suggestionSourceLabel,
  type ListeningSignals,
  type SuggestionInput,
} from './suggestions';
import { link, makeEntity, rate, resetFixtureCounters, T0 } from '../../test/fixtures';
import {
  ENTITY_TYPES,
  type Entity,
  type Membership,
  type QueueState,
  type RatingEvent,
} from './types';

beforeEach(resetFixtureCounters);

const DAY = 86_400_000;

function input(world: {
  entities?: Entity[];
  memberships?: Membership[];
  ratings?: RatingEvent[];
  signals?: Partial<ListeningSignals>;
  queueStates?: QueueState[];
  overrides?: Partial<SuggestionInput>;
}): SuggestionInput {
  const graph = new ContainmentGraph(world.entities ?? [], world.memberships ?? []);
  return {
    graph,
    explicit: indexCurrentRatings(world.ratings ?? []),
    scores: new Map(),
    rankings: new Map(),
    signals: { ...EMPTY_SIGNALS, ...world.signals },
    weights: DEFAULT_SUGGESTION_WEIGHTS,
    queueStates: new Map((world.queueStates ?? []).map((q) => [q.id, q])),
    enabledTypes: [...ENTITY_TYPES],
    rollupConfig: defaultRollupConfigByType(),
    staleAfterDays: 180,
    now: T0,
    ...world.overrides,
  } as SuggestionInput;
}

describe('suggestion sourcing', () => {
  it('surfaces something you just played and have never rated', () => {
    const track = makeEntity('track', 't1');
    const out = scoreSuggestions(
      input({
        entities: [track],
        signals: {
          recentlyPlayed: [{ entityId: track.id, at: T0 - 3600_000, index: 0 }],
        },
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.entityId).toBe(track.id);
    expect(out[0]!.reasons[0]!.source).toBe('recentlyPlayed');
    expect(out[0]!.reasons[0]!.detail).toMatch(/played/i);
  });

  it('puts anything you actually played ahead of anything merely inferred', () => {
    // The inferred item is deliberately stacked with every other reason the
    // engine has, so it wins on raw score. It must still come second.
    const played = makeEntity('track', 'played');
    const inferredAlbum = makeEntity('album', 'inferred-album');
    const inferred = makeEntity('track', 'inferred');
    const rated = makeEntity('album', 'rated');

    const out = scoreSuggestions(
      input({
        entities: [played, inferredAlbum, inferred, rated],
        memberships: [link(inferredAlbum, inferred), link(rated, inferred)],
        ratings: [rate(rated, 90, { at: T0 - 400 * DAY })],
        signals: {
          // One play, at the very bottom of the window and ten days stale, so
          // its own score is as weak as a play can be.
          recentlyPlayed: [{ entityId: played.id, at: T0 - 30 * DAY, index: 49 }],
          top: [
            { entityId: inferred.id, term: 'short', rank: 0, of: 50 },
            { entityId: inferred.id, term: 'medium', rank: 0, of: 50 },
            { entityId: inferred.id, term: 'long', rank: 0, of: 50 },
          ],
          saved: [{ entityId: inferred.id, savedAt: T0 - DAY }],
        },
        overrides: { pinnedIds: new Set([inferred.id]) },
      }),
    );

    const playedRow = out.find((s) => s.entityId === played.id);
    const inferredRow = out.find((s) => s.entityId === inferred.id);
    expect(playedRow).toBeDefined();
    expect(inferredRow).toBeDefined();
    // The inference really does score higher…
    expect(inferredRow!.score).toBeGreaterThan(playedRow!.score);
    // …and still loses, because a real play sits in a band above it.
    expect(playedRow!.tier).toBe(TIER_JUST_PLAYED);
    expect(inferredRow!.tier).toBe(TIER_INFERRED);
    expect(out[0]!.entityId).toBe(played.id);
  });

  it('orders plays among themselves by how recent and prominent they were', () => {
    const older = makeEntity('track', 'older');
    const newer = makeEntity('track', 'newer');
    const out = scoreSuggestions(
      input({
        entities: [older, newer],
        signals: {
          recentlyPlayed: [
            { entityId: newer.id, at: T0 - 3600_000, index: 0 },
            { entityId: older.id, at: T0 - 20 * DAY, index: 40 },
          ],
        },
      }),
    );
    expect(out.map((s) => s.entityId)).toEqual([newer.id, older.id]);
    expect(out.every((s) => s.tier === TIER_JUST_PLAYED)).toBe(true);
  });

  it('never suggests something with no reason at all', () => {
    const track = makeEntity('track', 't1');
    expect(scoreSuggestions(input({ entities: [track] }))).toEqual([]);
  });

  it('ranks an item with several reasons above an item with one', () => {
    const many = makeEntity('track', 'many');
    const one = makeEntity('track', 'one');
    const out = scoreSuggestions(
      input({
        entities: [many, one],
        signals: {
          recentlyPlayed: [
            { entityId: many.id, at: T0 - 1000, index: 0 },
            { entityId: one.id, at: T0 - 1000, index: 1 },
          ],
          top: [{ entityId: many.id, term: 'short', rank: 0, of: 20 }],
          saved: [{ entityId: many.id, savedAt: T0 - DAY }],
        },
      }),
    );
    expect(out[0]!.entityId).toBe(many.id);
    expect(out[0]!.reasons.length).toBeGreaterThan(out[1]!.reasons.length);
  });

  it('weights a higher chart position above a lower one', () => {
    const first = makeEntity('artist', 'first');
    const last = makeEntity('artist', 'last');
    const out = scoreSuggestions(
      input({
        entities: [first, last],
        signals: {
          top: [
            { entityId: first.id, term: 'short', rank: 0, of: 50 },
            { entityId: last.id, term: 'short', rank: 49, of: 50 },
          ],
        },
      }),
    );
    expect(out[0]!.entityId).toBe(first.id);
  });

  it('proposes unrated tracks on an album you already rated', () => {
    const album = makeEntity('album', 'al');
    const rated = makeEntity('track', 'rated');
    const unrated = makeEntity('track', 'unrated');
    const out = scoreSuggestions(
      input({
        entities: [album, rated, unrated],
        memberships: [link(album, rated), link(album, unrated)],
        ratings: [rate(album, 85), rate(rated, 80)],
      }),
    );
    const ids = out.map((s) => s.entityId);
    expect(ids).toContain(unrated.id);
    expect(ids).not.toContain(rated.id);
    const reason = out.find((s) => s.entityId === unrated.id)!.reasons[0]!;
    expect(reason.source).toBe('unratedChild');
  });

  it('resurfaces a stale rating but not a fresh one', () => {
    const old = makeEntity('album', 'old');
    const fresh = makeEntity('album', 'fresh');
    const out = scoreSuggestions(
      input({
        entities: [old, fresh],
        ratings: [rate(old, 70, { at: T0 - 400 * DAY }), rate(fresh, 70, { at: T0 - DAY })],
      }),
    );
    expect(out.map((s) => s.entityId)).toEqual([old.id]);
    expect(out[0]!.reasons[0]!.source).toBe('staleRating');
  });

  it('asks for more comparisons where the ranking is still uncertain', () => {
    const a = makeEntity('album', 'a');
    const b = makeEntity('album', 'b');
    const rankings = new Map([['album', computeRankings([])]] as const);
    const table = rankings.get('album')!;
    table.set(a.id, {
      entityId: a.id,
      entityType: 'album',
      rating: 1500,
      deviation: 300,
      comparisons: 1,
      wins: 1,
      losses: 0,
      draws: 0,
    });
    const out = scoreSuggestions(
      input({
        entities: [a, b],
        ratings: [rate(a, 70), rate(b, 70)],
        overrides: { rankings },
      }),
    );
    const found = out.find((s) => s.entityId === a.id);
    expect(found?.reasons.some((r) => r.source === 'lowConfidenceRank')).toBe(true);
  });

  it('honours a pin as its own reason', () => {
    const pinned = makeEntity('album', 'p');
    const out = scoreSuggestions(
      input({ entities: [pinned], overrides: { pinnedIds: new Set([pinned.id]) } }),
    );
    expect(out[0]!.reasons.map((r) => r.source)).toContain('pinned');
  });
});

describe('queue states', () => {
  const track = makeEntity('track', 't1');
  const played: Partial<ListeningSignals> = {
    recentlyPlayed: [{ entityId: track.id, at: T0 - 1000, index: 0 }],
  };

  it('hides a snoozed item until its time comes', () => {
    const snoozed = scoreSuggestions(
      input({
        entities: [track],
        signals: played,
        queueStates: [
          {
            id: track.id,
            entityType: 'track',
            kind: 'snoozed',
            until: T0 + DAY,
            at: T0,
            updatedAt: T0,
          },
        ],
      }),
    );
    expect(snoozed).toEqual([]);

    const expired = scoreSuggestions(
      input({
        entities: [track],
        signals: played,
        queueStates: [
          {
            id: track.id,
            entityType: 'track',
            kind: 'snoozed',
            until: T0 - DAY,
            at: T0,
            updatedAt: T0,
          },
        ],
      }),
    );
    expect(expired).toHaveLength(1);
  });

  it('respects "not familiar" for a long while, then lets it back', () => {
    const hidden = scoreSuggestions(
      input({
        entities: [track],
        signals: played,
        queueStates: [
          {
            id: track.id,
            entityType: 'track',
            kind: 'unfamiliar',
            at: T0 - 10 * DAY,
            updatedAt: T0,
          },
        ],
      }),
    );
    expect(hidden).toEqual([]);

    const returned = scoreSuggestions(
      input({
        entities: [track],
        signals: played,
        queueStates: [
          {
            id: track.id,
            entityType: 'track',
            kind: 'unfamiliar',
            at: T0 - 200 * DAY,
            updatedAt: T0,
          },
        ],
      }),
    );
    expect(returned).toHaveLength(1);
  });

  it('takes a skipped item out of the queue rather than demoting it', () => {
    const plain = scoreSuggestions(input({ entities: [track], signals: played }));
    expect(plain).toHaveLength(1);

    const skipped = scoreSuggestions(
      input({
        entities: [track],
        signals: played,
        queueStates: [
          { id: track.id, entityType: 'track', kind: 'skipped', at: T0 - 1000, updatedAt: T0 },
        ],
      }),
    );
    expect(skipped).toEqual([]);
  });

  it('lets a skip lapse once the cooldown has run out', () => {
    // The play sits behind both skips, so only the cooldown is under test here.
    const longAgo: Partial<ListeningSignals> = {
      recentlyPlayed: [{ entityId: track.id, at: T0 - 2 * DAY, index: 0 }],
    };

    const stillHeld = scoreSuggestions(
      input({
        entities: [track],
        signals: longAgo,
        queueStates: [
          {
            id: track.id,
            entityType: 'track',
            kind: 'skipped',
            at: T0 - SKIP_COOLDOWN_MS + 1000,
            updatedAt: T0,
          },
        ],
      }),
    );
    expect(stillHeld).toEqual([]);

    const lapsed = scoreSuggestions(
      input({
        entities: [track],
        signals: longAgo,
        queueStates: [
          {
            id: track.id,
            entityType: 'track',
            kind: 'skipped',
            at: T0 - SKIP_COOLDOWN_MS - 1000,
            updatedAt: T0,
          },
        ],
      }),
    );
    expect(lapsed).toHaveLength(1);
  });

  it('brings a skipped item back the moment you play it again', () => {
    const skippedAt = T0 - 3600_000;
    const state: QueueState = {
      id: track.id,
      entityType: 'track',
      kind: 'skipped',
      at: skippedAt,
      updatedAt: skippedAt,
    };

    // The stored play is older than the skip, so the skip still stands.
    expect(
      scoreSuggestions(
        input({
          entities: [track],
          signals: { recentlyPlayed: [{ entityId: track.id, at: skippedAt - 1000, index: 0 }] },
          queueStates: [state],
        }),
      ),
    ).toEqual([]);

    // A fresh play arrives after the skip. Pressing play outranks the dismissal.
    const revived = scoreSuggestions(
      input({
        entities: [track],
        signals: { recentlyPlayed: [{ entityId: track.id, at: skippedAt + 60_000, index: 0 }] },
        queueStates: [state],
      }),
    );
    expect(revived).toHaveLength(1);
    expect(revived[0]!.tier).toBe(TIER_JUST_PLAYED);
  });

  it('keeps skip, snooze and not-familiar as three different things', () => {
    const day = (kind: QueueState['kind'], until?: number): QueueState => ({
      id: track.id,
      entityType: 'track',
      kind,
      at: T0 - DAY,
      updatedAt: T0 - DAY,
      ...(until !== undefined ? { until } : {}),
    });
    const seen = (state: QueueState) =>
      scoreSuggestions(input({ entities: [track], signals: played, queueStates: [state] })).length;

    // A day later: the skip has lapsed, the month-long snooze and the
    // ninety-day not-familiar have not.
    expect(seen(day('skipped'))).toBe(1);
    expect(seen(day('snoozed', T0 + 29 * DAY))).toBe(0);
    expect(seen(day('unfamiliar'))).toBe(0);
  });
});

describe('what you just played', () => {
  it('orders by the newest play, whatever else an older item has going for it', () => {
    const older = makeEntity('track', 'older');
    const newer = makeEntity('track', 'newer');

    const out = scoreSuggestions(
      input({
        entities: [older, newer],
        signals: {
          // The older play is stacked with every other reason the engine has,
          // and sits higher in Spotify's own window. The clock still wins.
          recentlyPlayed: [
            { entityId: older.id, at: T0 - 2 * 3600_000, index: 0 },
            { entityId: newer.id, at: T0 - 60_000, index: 40 },
          ],
          top: [
            { entityId: older.id, term: 'short', rank: 0, of: 50 },
            { entityId: older.id, term: 'medium', rank: 0, of: 50 },
            { entityId: older.id, term: 'long', rank: 0, of: 50 },
          ],
          saved: [{ entityId: older.id, savedAt: T0 - DAY }],
        },
        overrides: { pinnedIds: new Set([older.id]) },
      }),
    );

    expect(out.map((s) => s.entityId)).toEqual([newer.id, older.id]);
    expect(out[0]!.score).toBeLessThan(out[1]!.score);
    expect(out[0]!.lastPlayedAt).toBe(T0 - 60_000);
  });

  it('collapses repeated plays of one track onto its most recent', () => {
    const track = makeEntity('track', 'repeat');
    const out = scoreSuggestions(
      input({
        entities: [track],
        signals: {
          recentlyPlayed: [
            { entityId: track.id, at: T0 - 90_000, index: 0 },
            { entityId: track.id, at: T0 - 40 * 60_000, index: 1 },
            { entityId: track.id, at: T0 - 3 * DAY, index: 2 },
          ],
        },
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.lastPlayedAt).toBe(T0 - 90_000);
    expect(out[0]!.reasons[0]!.detail).toBe('You played this 2 minutes ago.');
  });

  it('collapses even when the newest play is not the first in the window', () => {
    const track = makeEntity('track', 'out-of-order');
    const collapsed = collapsePlays([
      { entityId: track.id, at: T0 - 5 * DAY, index: 0 },
      { entityId: track.id, at: T0 - 1000, index: 7 },
      { entityId: track.id, at: T0 - 2 * DAY, index: 3 },
    ]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]!.at).toBe(T0 - 1000);
    expect(collapsed[0]!.index).toBe(7);
  });

  it('keeps inferred suggestions behind every play, however recent', () => {
    const played = makeEntity('track', 'played');
    const saved = makeEntity('track', 'saved-only');
    const out = scoreSuggestions(
      input({
        entities: [played, saved],
        signals: {
          recentlyPlayed: [{ entityId: played.id, at: T0 - 20 * DAY, index: 49 }],
          saved: [{ entityId: saved.id, savedAt: T0 - 1000 }],
        },
      }),
    );
    expect(out.map((s) => s.entityId)).toEqual([played.id, saved.id]);
    expect(out[0]!.tier).toBe(TIER_JUST_PLAYED);
    expect(out[1]!.tier).toBe(TIER_INFERRED);
    expect(out[1]!.lastPlayedAt).toBeUndefined();
  });

  it('says how long ago in units you can act on', () => {
    const track = makeEntity('track', 'clock');
    const said = (ago: number) =>
      scoreSuggestions(
        input({
          entities: [track],
          signals: { recentlyPlayed: [{ entityId: track.id, at: T0 - ago, index: 0 }] },
        }),
      )[0]!.reasons[0]!.detail;

    expect(said(20_000)).toBe('You played this just now.');
    expect(said(60_000)).toBe('You played this 1 minute ago.');
    expect(said(25 * 60_000)).toBe('You played this 25 minutes ago.');
    expect(said(3 * 3600_000)).toBe('You played this 3 hours ago.');
    expect(said(2 * DAY)).toBe('You played this 2 days ago.');
  });
});

describe('determinism and configuration', () => {
  it('returns identical output for identical input', () => {
    const world = {
      entities: [makeEntity('track', 'a'), makeEntity('track', 'b')],
      signals: {
        recentlyPlayed: [
          { entityId: makeEntity('track', 'a').id, at: T0 - 1000, index: 0 },
          { entityId: makeEntity('track', 'b').id, at: T0 - 1000, index: 1 },
        ],
      },
    };
    expect(scoreSuggestions(input(world))).toEqual(scoreSuggestions(input(world)));
  });

  it('drops types the user has switched off', () => {
    const track = makeEntity('track', 't1');
    const out = scoreSuggestions(
      input({
        entities: [track],
        signals: { recentlyPlayed: [{ entityId: track.id, at: T0, index: 0 }] },
        overrides: { enabledTypes: ['album'] },
      }),
    );
    expect(out).toEqual([]);
  });

  it('produces nothing when every source is weighted to zero', () => {
    const track = makeEntity('track', 't1');
    const out = scoreSuggestions(
      input({
        entities: [track],
        signals: { recentlyPlayed: [{ entityId: track.id, at: T0, index: 0 }] },
        overrides: { weights: emptySuggestionWeights() },
      }),
    );
    expect(out).toEqual([]);
  });

  it('labels every source in plain language', () => {
    for (const source of Object.keys(DEFAULT_SUGGESTION_WEIGHTS)) {
      const label = suggestionSourceLabel(source as keyof typeof DEFAULT_SUGGESTION_WEIGHTS);
      expect(label.length).toBeGreaterThan(3);
      expect(label).not.toMatch(/[A-Z]{2,}/);
    }
  });
});
