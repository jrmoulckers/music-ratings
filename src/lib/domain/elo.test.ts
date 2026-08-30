import { beforeEach, describe, expect, it } from 'vitest';

import {
  ELO_SEED,
  computeRankings,
  deviationFor,
  expectedScore,
  kFactor,
  rankingConfidence,
  rankingToNormalized,
  selectPairs,
  sortComparisons,
} from './elo';
import { compare, makeEntity, resetFixtureCounters } from '../../test/fixtures';
import type { Comparison } from './types';

const a = makeEntity('album', 'a');
const b = makeEntity('album', 'b');
const c = makeEntity('album', 'c');

beforeEach(resetFixtureCounters);

describe('elo mechanics', () => {
  it('gives equal ratings an even expectation', () => {
    expect(expectedScore(ELO_SEED, ELO_SEED)).toBe(0.5);
    expect(expectedScore(ELO_SEED + 400, ELO_SEED)).toBeCloseTo(10 / 11, 6);
  });

  it('lowers K and deviation as evidence accumulates', () => {
    expect(kFactor(0)).toBeGreaterThan(kFactor(20));
    expect(kFactor(20)).toBeGreaterThan(kFactor(100));
    expect(deviationFor(0)).toBeGreaterThan(deviationFor(10));
    expect(deviationFor(10)).toBeGreaterThan(deviationFor(200));
  });

  it('maps the seed rating to the middle of the canonical axis', () => {
    expect(rankingToNormalized(ELO_SEED)).toBeCloseTo(50, 6);
    expect(rankingToNormalized(ELO_SEED + 400)).toBeGreaterThan(80);
    expect(rankingToNormalized(ELO_SEED - 400)).toBeLessThan(20);
  });
});

describe('replaying the comparison log', () => {
  it('moves the winner up and the loser down', () => {
    const table = computeRankings([compare(a, b, 'a')]);
    expect(table.get(a.id)!.rating).toBeGreaterThan(ELO_SEED);
    expect(table.get(b.id)!.rating).toBeLessThan(ELO_SEED);
    expect(table.get(a.id)!.wins).toBe(1);
    expect(table.get(b.id)!.losses).toBe(1);
  });

  it('leaves ratings untouched on a tie between equals', () => {
    const table = computeRankings([compare(a, b, 'tie')]);
    expect(table.get(a.id)!.rating).toBeCloseTo(ELO_SEED, 6);
    expect(table.get(b.id)!.rating).toBeCloseTo(ELO_SEED, 6);
    expect(table.get(a.id)!.draws).toBe(1);
  });

  it('ignores skipped and unfamiliar answers entirely', () => {
    const table = computeRankings([compare(a, b, 'skip'), compare(a, b, 'unfamiliar')]);
    expect(table.size).toBe(0);
  });

  it('ignores tombstoned comparisons, so undo simply works', () => {
    const kept = compare(a, b, 'a');
    const undone = { ...compare(a, b, 'b'), deleted: 1 };
    const table = computeRankings([kept, undone]);
    expect(table.get(a.id)!.comparisons).toBe(1);
    expect(table.get(a.id)!.rating).toBeGreaterThan(ELO_SEED);
  });

  it('is order-independent given the same timestamps', () => {
    const log = [compare(a, b, 'a'), compare(b, c, 'b'), compare(a, c, 'a')];
    const forward = computeRankings(log);
    const backward = computeRankings([...log].reverse());
    for (const id of [a.id, b.id, c.id]) {
      expect(backward.get(id)!.rating).toBeCloseTo(forward.get(id)!.rating, 9);
    }
  });

  it('sorts deterministically when timestamps collide', () => {
    const x: Comparison = { ...compare(a, b, 'a'), at: 5, id: 'zzz' };
    const y: Comparison = { ...compare(b, c, 'b'), at: 5, id: 'aaa' };
    expect(sortComparisons([x, y]).map((k) => k.id)).toEqual(['aaa', 'zzz']);
  });

  it('keeps types apart when asked', () => {
    const track = makeEntity('track', 't1');
    const track2 = makeEntity('track', 't2');
    const log = [compare(a, b, 'a'), compare(track, track2, 'a')];
    expect(computeRankings(log, 'album').size).toBe(2);
    expect(computeRankings(log, 'track').size).toBe(2);
    expect(computeRankings(log).size).toBe(4);
  });

  it('ranks a consistent winner above a consistent loser', () => {
    const log = [
      compare(a, b, 'a'),
      compare(a, c, 'a'),
      compare(b, c, 'a'),
      compare(a, b, 'a'),
      compare(a, c, 'a'),
    ];
    const table = computeRankings(log);
    expect(table.get(a.id)!.rating).toBeGreaterThan(table.get(b.id)!.rating);
    expect(table.get(b.id)!.rating).toBeGreaterThan(table.get(c.id)!.rating);
  });

  it('never rates an item against itself', () => {
    const table = computeRankings([compare(a, a, 'a')]);
    expect(table.size).toBe(0);
  });
});

describe('ranking confidence', () => {
  it('is zero without comparisons and rises with them', () => {
    expect(rankingConfidence(undefined)).toBe(0);
    const few = computeRankings([compare(a, b, 'a')]).get(a.id);
    const many = computeRankings(
      Array.from({ length: 20 }, (_, i) => compare(a, b, i % 2 === 0 ? 'a' : 'b')),
    ).get(a.id);
    expect(rankingConfidence(many)).toBeGreaterThan(rankingConfidence(few));
  });
});

describe('pair selection', () => {
  it('prefers pairs whose scores sit close together', () => {
    const pairs = selectPairs(
      [
        { entityId: a.id, estimate: 70 },
        { entityId: b.id, estimate: 71 },
        { entityId: c.id, estimate: 20 },
      ],
      [],
      { limit: 1 },
    );
    expect(pairs).toHaveLength(1);
    expect([pairs[0]!.aId, pairs[0]!.bId].sort()).toEqual([a.id, b.id].sort());
  });

  it('does not re-ask a pair that was answered recently', () => {
    const history = [{ ...compare(a, b, 'a'), at: 1_000_000 }];
    const pairs = selectPairs(
      [
        { entityId: a.id, estimate: 70 },
        { entityId: b.id, estimate: 71 },
      ],
      history,
      { limit: 1, now: 1_000_000 + 1000, avoidRepeatWithinMs: 86_400_000 },
    );
    expect(pairs).toHaveLength(0);
  });

  it('returns nothing when there is not enough to compare', () => {
    expect(selectPairs([{ entityId: a.id, estimate: 50 }], [])).toEqual([]);
    expect(selectPairs([], [])).toEqual([]);
  });

  it('never puts the same item on both sides of a batch', () => {
    const pairs = selectPairs(
      [
        { entityId: a.id, estimate: 50 },
        { entityId: b.id, estimate: 50 },
        { entityId: c.id, estimate: 50 },
      ],
      [],
      { limit: 3 },
    );
    const used = pairs.flatMap((p) => [p.aId, p.bId]);
    expect(new Set(used).size).toBe(used.length);
  });

  it('always explains why a pair was chosen', () => {
    const pairs = selectPairs(
      [
        { entityId: a.id, estimate: 50 },
        { entityId: b.id, estimate: 51 },
      ],
      [],
    );
    expect(pairs[0]!.reason.length).toBeGreaterThan(10);
  });

  it('is deterministic across runs', () => {
    const candidates = [
      { entityId: a.id, estimate: 50 },
      { entityId: b.id, estimate: 50 },
      { entityId: c.id, estimate: 50 },
    ];
    const first = selectPairs(candidates, [], { limit: 1, now: 0 });
    const second = selectPairs(candidates, [], { limit: 1, now: 0 });
    expect(second).toEqual(first);
  });
});
