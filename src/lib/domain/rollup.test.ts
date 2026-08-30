import { beforeEach, describe, expect, it } from 'vitest';

import { computeRankings } from './elo';
import { ContainmentGraph, walkDescendants } from './graph';
import { indexCurrentRatings } from './ratings';
import {
  DEFAULT_ROLLUP_WEIGHTS,
  aggregate,
  computeScore,
  defaultRollupConfigByType,
  renormaliseWeights,
  trimmedMean,
  weightedMedian,
} from './rollup';
import { compare, link, makeEntity, rate, resetFixtureCounters, T0 } from '../../test/fixtures';
import type { Comparison, Entity, Membership, RatingEvent, RollupChannel } from './types';

beforeEach(resetFixtureCounters);

interface World {
  entities: Entity[];
  memberships: Membership[];
  ratings: RatingEvent[];
  comparisons: Comparison[];
}

function build(world: Partial<World>) {
  const entities = world.entities ?? [];
  const memberships = world.memberships ?? [];
  const ratings = world.ratings ?? [];
  const comparisons = world.comparisons ?? [];
  const graph = new ContainmentGraph(entities, memberships);
  const rankings = new Map([
    ['album', computeRankings(comparisons, 'album')],
    ['artist', computeRankings(comparisons, 'artist')],
    ['track', computeRankings(comparisons, 'track')],
  ] as const);
  return {
    graph,
    explicit: indexCurrentRatings(ratings),
    rankings,
    config: defaultRollupConfigByType(),
    now: T0,
  };
}

function channel(breakdown: ReturnType<typeof computeScore>, name: RollupChannel) {
  const found = breakdown.channels.find((c) => c.channel === name);
  if (!found) throw new Error(`missing channel ${name}`);
  return found;
}

/* -------------------------------------------------------------------------- */

describe('aggregators', () => {
  const samples = [10, 20, 30, 40, 500].map((value) => ({ value, weight: 1 }));

  it('computes a weighted mean', () => {
    expect(
      aggregate(
        [
          { value: 10, weight: 1 },
          { value: 30, weight: 3 },
        ],
        'mean',
        {
          bayesianPriorMean: 50,
          bayesianPriorWeight: 1,
        },
      ),
    ).toBe(25);
  });

  it('computes a weighted median that ignores outliers', () => {
    expect(weightedMedian(samples)).toBe(30);
  });

  it('trims the extremes before averaging', () => {
    expect(trimmedMean(samples)).toBe(30);
  });

  it('pulls a small sample toward the prior', () => {
    const bayes = aggregate([{ value: 100, weight: 1 }], 'bayesian', {
      bayesianPriorMean: 50,
      bayesianPriorWeight: 3,
    });
    expect(bayes).toBeCloseTo(62.5, 6);
  });

  it('returns null when there is nothing to aggregate', () => {
    expect(weightedMedian([])).toBeNull();
    expect(trimmedMean([])).toBeNull();
    expect(aggregate([], 'mean', { bayesianPriorMean: 50, bayesianPriorWeight: 1 })).toBeNull();
  });
});

describe('weight renormalisation', () => {
  it('leaves a full set of channels alone', () => {
    const applied = renormaliseWeights(
      DEFAULT_ROLLUP_WEIGHTS,
      new Set<RollupChannel>(['explicit', 'directChildren', 'descendants', 'comparison']),
    );
    expect(applied.explicit).toBeCloseTo(0.5, 6);
    expect(Object.values(applied).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it('grows the remaining channels when evidence is missing', () => {
    const applied = renormaliseWeights(
      DEFAULT_ROLLUP_WEIGHTS,
      new Set<RollupChannel>(['directChildren', 'descendants']),
    );
    expect(applied.explicit).toBe(0);
    expect(applied.directChildren).toBeCloseTo(0.75, 6);
    expect(applied.descendants).toBeCloseTo(0.25, 6);
    expect(applied.directChildren + applied.descendants).toBeCloseTo(1, 6);
  });

  it('falls back to equal shares when every available channel is weighted zero', () => {
    const applied = renormaliseWeights(
      { explicit: 0, directChildren: 0, descendants: 0, comparison: 0 },
      new Set<RollupChannel>(['explicit', 'comparison']),
    );
    expect(applied.explicit).toBeCloseTo(0.5, 6);
    expect(applied.comparison).toBeCloseTo(0.5, 6);
  });

  it('returns all zeros when there is no evidence at all', () => {
    const applied = renormaliseWeights(DEFAULT_ROLLUP_WEIGHTS, new Set<RollupChannel>());
    expect(Object.values(applied).every((v) => v === 0)).toBe(true);
  });

  it('treats a negative configured weight as zero', () => {
    const applied = renormaliseWeights(
      { ...DEFAULT_ROLLUP_WEIGHTS, descendants: -5 },
      new Set<RollupChannel>(['directChildren', 'descendants']),
    );
    expect(applied.descendants).toBe(0);
    expect(applied.directChildren).toBeCloseTo(1, 6);
  });
});

/* -------------------------------------------------------------------------- */

describe('explicit ratings are never overwritten', () => {
  it('keeps the explicit value beside the computed one', () => {
    const album = makeEntity('album', 'al');
    const t1 = makeEntity('track', 't1');
    const t2 = makeEntity('track', 't2');
    const input = build({
      entities: [album, t1, t2],
      memberships: [link(album, t1, { position: 0 }), link(album, t2, { position: 1 })],
      ratings: [rate(album, 90), rate(t1, 10), rate(t2, 10)],
    });
    const score = computeScore(input, album.id);
    expect(score.explicit).toBe(90);
    expect(score.rollup).toBeLessThan(90);
    expect(score.rollup).toBeGreaterThan(10);
    expect(score.blended).not.toBe(score.rollup);
  });

  it('reports the newest live rating as the explicit value', () => {
    const album = makeEntity('album', 'al');
    const input = build({
      entities: [album],
      ratings: [rate(album, 20, { at: T0 }), rate(album, 80, { at: T0 + 1000 })],
    });
    expect(computeScore(input, album.id).explicit).toBe(80);
  });

  it('ignores a retracted rating', () => {
    const album = makeEntity('album', 'al');
    const input = build({
      entities: [album],
      ratings: [
        rate(album, 20, { at: T0 }),
        rate(album, 80, { at: T0 + 1000, retracted: T0 + 2000 }),
      ],
    });
    expect(computeScore(input, album.id).explicit).toBe(20);
  });
});

describe('double-count prevention', () => {
  it('counts a track once when it sits on two releases of the same artist', () => {
    const artist = makeEntity('artist', 'ar');
    const album = makeEntity('album', 'al');
    const comp = makeEntity('album', 'comp', { albumKind: 'compilation' });
    const track = makeEntity('track', 't1');
    const other = makeEntity('track', 't2');

    const input = build({
      entities: [artist, album, comp, track, other],
      memberships: [
        link(artist, album),
        link(artist, comp),
        link(album, track, { position: 0 }),
        link(album, other, { position: 1 }),
        link(comp, track, { position: 0 }),
      ],
      ratings: [rate(track, 100), rate(other, 0)],
    });

    const walk = walkDescendants(input.graph, artist.id);
    const trackHits = walk.hits.filter((h) => h.entityId === track.id);
    expect(trackHits).toHaveLength(1);
    expect(walk.duplicatePaths).toBe(1);

    const score = computeScore(input, artist.id);
    const descendants = channel(score, 'descendants');
    expect(descendants.sampleSize).toBe(2);
    expect(score.exclusions.some((e) => e.code === 'duplicate-path')).toBe(true);
  });

  it('never counts the root as one of its own descendants', () => {
    const a = makeEntity('playlist', 'p1');
    const b = makeEntity('track', 't1');
    const input = build({
      entities: [a, b],
      // A malformed cycle should not hang or self-count.
      memberships: [link(a, b), { ...link(b, a), parentType: 'track', childType: 'playlist' }],
      ratings: [rate(a, 90), rate(b, 10)],
    });
    const walk = walkDescendants(input.graph, a.id);
    expect(walk.hits.map((h) => h.entityId)).toEqual([b.id]);
  });

  it('excludes items the user folded into another record', () => {
    const album = makeEntity('album', 'al');
    const t1 = makeEntity('track', 't1');
    const dupe = makeEntity('track', 't1-remaster');
    const input = {
      ...build({
        entities: [album, t1, dupe],
        memberships: [link(album, t1), link(album, dupe)],
        ratings: [rate(t1, 80), rate(dupe, 20)],
      }),
      annotations: new Map([
        [dupe.id, { id: dupe.id, tags: [], duplicateOf: t1.id, updatedAt: T0 }],
      ]),
    };
    const score = computeScore(input, album.id);
    expect(channel(score, 'directChildren').value).toBe(80);
    expect(score.exclusions.some((e) => e.code === 'marked-duplicate')).toBe(true);
  });
});

describe('fair weighting of prolific parents', () => {
  it('stops one long release from dominating an artist score', () => {
    const artist = makeEntity('artist', 'ar');
    const long = makeEntity('album', 'long');
    const short = makeEntity('album', 'short');
    const entities: Entity[] = [artist, long, short];
    const memberships: Membership[] = [link(artist, long), link(artist, short)];
    const ratings: RatingEvent[] = [];

    for (let i = 0; i < 30; i += 1) {
      const t = makeEntity('track', `long-${i}`);
      entities.push(t);
      memberships.push(link(long, t, { position: i }));
      ratings.push(rate(t, 20));
    }
    for (let i = 0; i < 3; i += 1) {
      const t = makeEntity('track', `short-${i}`);
      entities.push(t);
      memberships.push(link(short, t, { position: i }));
      ratings.push(rate(t, 100));
    }

    const grouped = build({ entities, memberships, ratings });
    const groupedValue = channel(computeScore(grouped, artist.id), 'descendants').value!;

    const ungrouped = build({ entities, memberships, ratings });
    for (const key of Object.keys(ungrouped.config) as (keyof typeof ungrouped.config)[]) {
      ungrouped.config[key].groupChildrenByRelease = false;
    }
    const ungroupedValue = channel(computeScore(ungrouped, artist.id), 'descendants').value!;

    // Ungrouped, the 30 weak tracks bury the 3 strong ones.
    expect(ungroupedValue).toBeLessThan(30);
    // Grouped, the short release gets a real voice.
    expect(groupedValue).toBeGreaterThan(ungroupedValue + 15);
  });

  it('splits credit for a track shared by two artists', () => {
    const a1 = makeEntity('artist', 'a1');
    const a2 = makeEntity('artist', 'a2');
    const shared = makeEntity('track', 'shared');
    const solo = makeEntity('track', 'solo');
    const input = build({
      entities: [a1, a2, shared, solo],
      memberships: [
        link(a1, shared, { share: 0.5 }),
        link(a2, shared, { share: 0.5 }),
        link(a1, solo, { share: 1 }),
      ],
      ratings: [rate(shared, 100), rate(solo, 0)],
    });
    // Solo track carries twice the weight of the half-credited collaboration.
    expect(channel(computeScore(input, a1.id), 'directChildren').value).toBeCloseTo(100 / 3, 4);
  });
});

describe('coverage and confidence', () => {
  it('reports coverage honestly and flags a thin rollup', () => {
    const album = makeEntity('album', 'al');
    const entities: Entity[] = [album];
    const memberships: Membership[] = [];
    for (let i = 0; i < 10; i += 1) {
      const t = makeEntity('track', `t${i}`);
      entities.push(t);
      memberships.push(link(album, t, { position: i }));
    }
    const input = build({
      entities,
      memberships,
      ratings: [rate(entities[1]!.id, 80)],
    });
    const score = computeScore(input, album.id);
    expect(score.coverage).toMatchObject({ rated: 1, total: 10 });
    expect(score.coverage.ratio).toBeCloseTo(0.1, 6);
    expect(score.coverage.meetsMinimum).toBe(false);
    expect(score.exclusions.some((e) => e.code === 'below-coverage')).toBe(true);
    expect(score.exclusions.find((e) => e.code === 'unrated')?.count).toBe(9);
  });

  it('treats a childless entity as fully covered rather than uncovered', () => {
    const track = makeEntity('track', 't');
    const input = build({ entities: [track], ratings: [rate(track, 50)] });
    const score = computeScore(input, track.id);
    expect(score.coverage).toEqual({ rated: 0, total: 0, ratio: 0, meetsMinimum: true });
  });

  it('raises confidence as evidence accumulates', () => {
    const bare = build({
      entities: [makeEntity('album', 'bare')],
      ratings: [rate(makeEntity('album', 'bare'), 50, { confidence: 'low' })],
    });
    const bareScore = computeScore(bare, makeEntity('album', 'bare').id);

    const album = makeEntity('album', 'rich');
    const entities: Entity[] = [album];
    const memberships: Membership[] = [];
    const ratings: RatingEvent[] = [rate(album, 50, { confidence: 'high' })];
    for (let i = 0; i < 8; i += 1) {
      const t = makeEntity('track', `rt${i}`);
      entities.push(t);
      memberships.push(link(album, t, { position: i }));
      ratings.push(rate(t, 60, { confidence: 'high' }));
    }
    const richScore = computeScore(build({ entities, memberships, ratings }), album.id);
    expect(richScore.confidence).toBeGreaterThan(bareScore.confidence);
  });

  it('reports zero confidence and a null rollup with no evidence at all', () => {
    const album = makeEntity('album', 'empty');
    const score = computeScore(build({ entities: [album] }), album.id);
    expect(score.rollup).toBeNull();
    expect(score.explicit).toBeNull();
    expect(score.blended).toBeNull();
    expect(score.confidence).toBe(0);
  });
});

describe('comparison channel', () => {
  it('feeds ranking into the rollup without touching the explicit rating', () => {
    const a = makeEntity('album', 'a');
    const b = makeEntity('album', 'b');
    const input = build({
      entities: [a, b],
      ratings: [rate(a, 50), rate(b, 50)],
      comparisons: [compare(a, b, 'a'), compare(a, b, 'a'), compare(a, b, 'a')],
    });
    const scoreA = computeScore(input, a.id);
    const scoreB = computeScore(input, b.id);
    expect(scoreA.explicit).toBe(50);
    expect(scoreB.explicit).toBe(50);
    expect(scoreA.rollup!).toBeGreaterThan(scoreB.rollup!);
    expect(channel(scoreA, 'comparison').sampleSize).toBe(3);
  });

  it('leaves the comparison channel empty when nothing was compared', () => {
    const a = makeEntity('album', 'a');
    const score = computeScore(build({ entities: [a], ratings: [rate(a, 50)] }), a.id);
    expect(channel(score, 'comparison').value).toBeNull();
    expect(channel(score, 'comparison').appliedWeight).toBe(0);
  });
});

describe('explanation', () => {
  it('always returns every channel with a readable detail', () => {
    const album = makeEntity('album', 'al');
    const score = computeScore(build({ entities: [album], ratings: [rate(album, 70)] }), album.id);
    expect(score.channels).toHaveLength(4);
    for (const c of score.channels) expect(c.detail.length).toBeGreaterThan(5);
  });

  it('names the contributors behind a child channel', () => {
    const album = makeEntity('album', 'al');
    const t1 = makeEntity('track', 't1', { name: 'Opening Figure' });
    const input = build({
      entities: [album, t1],
      memberships: [link(album, t1)],
      ratings: [rate(t1, 88)],
    });
    const contributors = channel(computeScore(input, album.id), 'directChildren').contributors!;
    expect(contributors[0]).toMatchObject({ name: 'Opening Figure', normalized: 88 });
  });

  it('applied weights always sum to one when there is any evidence', () => {
    const album = makeEntity('album', 'al');
    const t1 = makeEntity('track', 't1');
    const input = build({
      entities: [album, t1],
      memberships: [link(album, t1)],
      ratings: [rate(t1, 40)],
    });
    const score = computeScore(input, album.id);
    const total = score.channels.reduce((acc, c) => acc + c.appliedWeight, 0);
    expect(total).toBeCloseTo(1, 6);
  });
});

describe('recency decay', () => {
  it('is off by default and can be switched on per type', () => {
    const album = makeEntity('album', 'al');
    const older = makeEntity('track', 'older');
    const newer = makeEntity('track', 'newer');
    const world = {
      entities: [album, older, newer],
      memberships: [link(album, older), link(album, newer)],
      ratings: [rate(older, 100, { at: T0 - 365 * 86_400_000 }), rate(newer, 0, { at: T0 })],
    };

    const noDecay = build(world);
    expect(channel(computeScore(noDecay, album.id), 'directChildren').value).toBeCloseTo(50, 4);

    const decayed = build(world);
    decayed.config.album.recencyHalfLifeDays = 90;
    const value = channel(computeScore(decayed, album.id), 'directChildren').value!;
    expect(value).toBeLessThan(20);
  });
});
