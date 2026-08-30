import { beforeEach, describe, expect, it } from 'vitest';

import { computeRankings } from './elo';
import { ContainmentGraph } from './graph';
import { indexCurrentRatings } from './ratings';
import { defaultRollupConfigByType } from './rollup';
import {
  DEFAULT_SUGGESTION_WEIGHTS,
  EMPTY_SIGNALS,
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

  it('demotes a skipped item without banishing it', () => {
    const plain = scoreSuggestions(input({ entities: [track], signals: played }));
    const skipped = scoreSuggestions(
      input({
        entities: [track],
        signals: played,
        queueStates: [
          { id: track.id, entityType: 'track', kind: 'skipped', at: T0 - DAY, updatedAt: T0 },
        ],
      }),
    );
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.score).toBeLessThan(plain[0]!.score);
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
