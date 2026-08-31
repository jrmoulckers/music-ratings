import { beforeEach, describe, expect, it } from 'vitest';

import {
  BUILTIN_FACETS,
  DEFAULT_CONTEXT_CONTRIBUTION,
  MAX_CONTEXT_CONTRIBUTION,
  adjustedRating,
  clampContribution,
  contextRows,
  contributionFor,
  copySnapshot,
  coverageOf,
  defaultFacets,
  effectiveExplicit,
  explainContext,
  facetsForType,
  judgementsById,
  makeSnapshot,
  scoreFromRows,
  validateJudgement,
  type ContextConfig,
} from './context';
import { computeRankings } from './elo';
import { ContainmentGraph } from './graph';
import { buildRankedList } from './lists';
import { indexCurrentRatings, SCORE_VIEW_LABEL } from './ratings';
import { computeScore, defaultRollupConfigByType } from './rollup';
import { link, makeEntity, rate, resetFixtureCounters, T0 } from '../../test/fixtures';
import { SCORE_VIEWS } from './types';
import type { ContextSnapshot, EntityType, FacetConfig, RatingEvent } from './types';

beforeEach(resetFixtureCounters);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function config(overrides: Partial<ContextConfig> = {}): ContextConfig {
  return {
    enabled: true,
    contribution: DEFAULT_CONTEXT_CONTRIBUTION,
    facets: defaultFacets(),
    ...overrides,
  };
}

/** A snapshot written straight, so a test can state exactly what was judged. */
function snapshot(
  facets: Record<string, number>,
  overrides: Partial<ContextSnapshot> = {},
): ContextSnapshot {
  const entries = Object.entries(facets);
  return {
    v: 1,
    facets: entries.map(([facetId, normalized]) => ({
      facetId,
      value: normalized / 10,
      scaleId: 'int-10',
      normalized,
    })),
    weights: Object.fromEntries(entries.map(([id]) => [id, 1])),
    contribution: DEFAULT_CONTEXT_CONTRIBUTION,
    applicable: entries.length,
    ...overrides,
  };
}

function weighted(facets: readonly FacetConfig[], weights: Record<string, number>): FacetConfig[] {
  return facets.map((f) => (weights[f.id] === undefined ? f : { ...f, weight: weights[f.id]! }));
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

describe('facet configuration', () => {
  it('offers a restrained set per type, never every facet on everything', () => {
    for (const type of ['artist', 'album', 'track', 'playlist'] as EntityType[]) {
      const offered = facetsForType(defaultFacets(), type);
      expect(offered.length).toBeGreaterThanOrEqual(3);
      expect(offered.length).toBeLessThanOrEqual(5);
    }
  });

  it('keeps type-specific facets on their own types', () => {
    const ids = (type: EntityType) => facetsForType(defaultFacets(), type).map((f) => f.id);
    expect(ids('playlist')).toContain('curation');
    expect(ids('album')).not.toContain('curation');
    expect(ids('artist')).toContain('consistency');
    expect(ids('track')).not.toContain('consistency');
    expect(ids('audiobook')).toContain('narration');
    expect(ids('album')).not.toContain('narration');
  });

  it('gives every built-in a stable id, a label and a plain description', () => {
    const ids = new Set<string>();
    for (const facet of BUILTIN_FACETS) {
      expect(facet.id).toMatch(/^[a-z][a-z-]*$/);
      expect(ids.has(facet.id)).toBe(false);
      ids.add(facet.id);
      expect(facet.label.length).toBeGreaterThan(0);
      expect(facet.description.endsWith('.')).toBe(true);
      expect(facet.types.length).toBeGreaterThan(0);
    }
  });

  it('marks era questions as temporal so the editor can print the release year', () => {
    const temporal = BUILTIN_FACETS.filter((f) => f.temporal).map((f) => f.id);
    expect(temporal).toEqual(['innovation', 'influence']);
  });

  it('drops disabled facets from what is offered', () => {
    const facets = defaultFacets().map((f) => (f.id === 'craft' ? { ...f, enabled: false } : f));
    expect(facetsForType(facets, 'album').map((f) => f.id)).not.toContain('craft');
  });

  it('caps the contribution at half, so context can never outvote you', () => {
    expect(clampContribution(0.9)).toBe(MAX_CONTEXT_CONTRIBUTION);
    expect(clampContribution(-1)).toBe(0);
    expect(clampContribution(Number.NaN)).toBe(0);
    expect(MAX_CONTEXT_CONTRIBUTION).toBe(0.5);
  });

  it('reports no contribution at all while the feature is switched off', () => {
    expect(contributionFor(config({ enabled: false }), 'album')).toBe(0);
    expect(contributionFor(config(), 'album')).toBe(DEFAULT_CONTEXT_CONTRIBUTION);
  });

  it('lets one type override the global contribution', () => {
    const c = config({ contribution: 0.2, byType: { artist: 0.5, track: 0 } });
    expect(contributionFor(c, 'artist')).toBe(0.5);
    expect(contributionFor(c, 'track')).toBe(0);
    expect(contributionFor(c, 'album')).toBe(0.2);
  });
});

/* -------------------------------------------------------------------------- */
/* The weighted mean                                                          */
/* -------------------------------------------------------------------------- */

describe('context score', () => {
  it('renormalises weights over only the facets that were rated', () => {
    const rows = contextRows(snapshot({ enjoyment: 70, craft: 90 }), config(), 'album');
    expect(rows.map((r) => r.facetId)).toEqual(['enjoyment', 'craft']);
    expect(rows.every((r) => r.appliedWeight === 0.5)).toBe(true);
    expect(scoreFromRows(rows)).toBe(80);
  });

  it('honours unequal weights', () => {
    const c = config({ facets: weighted(defaultFacets(), { enjoyment: 3, craft: 1 }) });
    const rows = contextRows(snapshot({ enjoyment: 100, craft: 0 }), c, 'album');
    expect(rows.find((r) => r.facetId === 'enjoyment')?.appliedWeight).toBeCloseTo(0.75, 9);
    expect(scoreFromRows(rows)).toBe(75);
  });

  it('falls back to equal shares when every applicable weight is zero', () => {
    const c = config({ facets: weighted(defaultFacets(), { enjoyment: 0, craft: 0 }) });
    const rows = contextRows(snapshot({ enjoyment: 60, craft: 80 }), c, 'album');
    expect(scoreFromRows(rows)).toBe(70);
  });

  it('treats a negative weight as no weight rather than as a subtraction', () => {
    const c = config({ facets: weighted(defaultFacets(), { enjoyment: -5, craft: 1 }) });
    const rows = contextRows(snapshot({ enjoyment: 0, craft: 90 }), c, 'album');
    expect(scoreFromRows(rows)).toBe(90);
  });

  it('has no score at all when nothing was rated', () => {
    expect(contextRows(null, config(), 'album')).toEqual([]);
    expect(scoreFromRows([])).toBeNull();
    expect(
      explainContext({ snapshot: null, direct: 70, config: config(), type: 'album' }),
    ).toBeNull();
  });

  it('reports coverage as rated of applicable', () => {
    const explained = explainContext({
      snapshot: snapshot({ enjoyment: 70, craft: 80, innovation: 90 }),
      direct: 70,
      config: config(),
      type: 'album',
    });
    expect(explained?.coverage).toMatchObject({ rated: 3, total: 5 });
    expect(explained?.coverage.ratio).toBeCloseTo(0.6, 9);
  });

  it('counts coverage honestly when a facet is rated on a type it no longer suits', () => {
    const rows = contextRows(snapshot({ enjoyment: 70, curation: 90 }), config(), 'album');
    expect(rows.find((r) => r.facetId === 'curation')?.orphaned).toBe(true);
    expect(coverageOf(rows, 5).rated).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Facets that changed underneath a saved rating                              */
/* -------------------------------------------------------------------------- */

describe('facets that changed after the fact', () => {
  it('keeps a deleted facet visible but out of the arithmetic', () => {
    const c = config({ facets: defaultFacets().filter((f) => f.id !== 'craft') });
    const rows = contextRows(snapshot({ enjoyment: 50, craft: 100 }), c, 'album');
    const craft = rows.find((r) => r.facetId === 'craft');
    expect(craft?.orphaned).toBe(true);
    expect(craft?.label).toBe('Craft (removed)');
    expect(craft?.normalized).toBe(100);
    expect(scoreFromRows(rows)).toBe(50);
  });

  it('keeps a switched-off facet out of the arithmetic too', () => {
    const c = config({
      facets: defaultFacets().map((f) => (f.id === 'craft' ? { ...f, enabled: false } : f)),
    });
    const rows = contextRows(snapshot({ enjoyment: 50, craft: 100 }), c, 'album');
    expect(rows.find((r) => r.facetId === 'craft')?.orphaned).toBe(true);
    expect(scoreFromRows(rows)).toBe(50);
  });

  it('follows a rename, because the id is what history points at', () => {
    const c = config({
      facets: defaultFacets().map((f) =>
        f.id === 'innovation' ? { ...f, label: 'Ahead of its time' } : f,
      ),
    });
    const rows = contextRows(snapshot({ innovation: 95 }), c, 'album');
    expect(rows[0]?.label).toBe('Ahead of its time');
    expect(rows[0]?.normalized).toBe(95);
  });

  it('scores a user-made facet exactly like a built-in one', () => {
    const custom: FacetConfig = {
      id: 'sleeve',
      label: 'Sleeve',
      description: 'How good the cover is.',
      types: ['album'],
      weight: 1,
      enabled: true,
      builtin: false,
      order: 20,
    };
    const c = config({ facets: [...defaultFacets(), custom] });
    const rows = contextRows(snapshot({ enjoyment: 60, sleeve: 100 }), c, 'album');
    expect(rows.some((r) => r.orphaned)).toBe(false);
    expect(scoreFromRows(rows)).toBe(80);
  });

  it('names an unrecognisable facet id rather than showing a bare key', () => {
    const rows = contextRows(snapshot({ 'lost-idea': 40 }), config(), 'album');
    expect(rows[0]?.label).toBe('Lost idea (removed)');
  });

  it('scores with today\u2019s weights and preserves what it was saved with', () => {
    const saved = snapshot({ enjoyment: 100, craft: 0 }, { weights: { enjoyment: 1, craft: 1 } });
    const c = config({ facets: weighted(defaultFacets(), { enjoyment: 3, craft: 1 }) });
    const explained = explainContext({ snapshot: saved, direct: 70, config: c, type: 'album' });
    expect(explained?.score).toBe(75);
    expect(explained?.savedWith).toEqual({ enjoyment: 1, craft: 1 });
  });

  it('says nothing about saved weights when they still match', () => {
    const saved = snapshot({ enjoyment: 100, craft: 0 });
    const explained = explainContext({
      snapshot: saved,
      direct: 70,
      config: config(),
      type: 'album',
    });
    expect(explained?.savedWith).toBeUndefined();
  });

  it('never mutates the snapshot it was handed', () => {
    const saved = snapshot({ enjoyment: 70, craft: 90 });
    const before = JSON.stringify(saved);
    explainContext({ snapshot: saved, direct: 50, config: config(), type: 'album' });
    expect(JSON.stringify(saved)).toBe(before);
  });
});

/* -------------------------------------------------------------------------- */
/* The blend                                                                  */
/* -------------------------------------------------------------------------- */

describe('context-adjusted rating', () => {
  it('leaves the rating alone at nought per cent', () => {
    expect(adjustedRating(70, 92, 0)).toBeNull();
  });

  it('moves the rating a fifth of the way at twenty per cent', () => {
    expect(adjustedRating(70, 92, 0.2)).toBeCloseTo(74.4, 9);
  });

  it('meets in the middle at fifty per cent', () => {
    expect(adjustedRating(70, 92, 0.5)).toBe(81);
  });

  it('never lets a contribution above the cap through', () => {
    expect(adjustedRating(0, 100, 5)).toBe(MAX_CONTEXT_CONTRIBUTION * 100);
  });

  it('has no adjusted value without a direct rating', () => {
    expect(adjustedRating(null, 90, 0.5)).toBeNull();
  });

  it('has no adjusted value without a context score', () => {
    expect(adjustedRating(70, null, 0.5)).toBeNull();
  });

  it('falls back to the direct rating when there is nothing to adjust', () => {
    expect(effectiveExplicit(70, null)).toBe(70);
    expect(effectiveExplicit(70, 74.4)).toBe(74.4);
    expect(effectiveExplicit(null, null)).toBeNull();
  });

  it('records facets but changes nothing while the contribution is off', () => {
    const explained = explainContext({
      snapshot: snapshot({ enjoyment: 100, craft: 100 }),
      direct: 40,
      config: config({ enabled: false }),
      type: 'album',
    });
    expect(explained?.score).toBe(100);
    expect(explained?.adjusted).toBeNull();
    expect(explained?.enabled).toBe(false);
    expect(effectiveExplicit(40, explained?.adjusted ?? null)).toBe(40);
  });
});

/* -------------------------------------------------------------------------- */
/* The case this feature exists for                                           */
/* -------------------------------------------------------------------------- */

describe('a personal rating alongside a historical one', () => {
  /**
   * The case in the brief: a foundational record you admire more than you
   * reach for. The personal rating stays 7.0 and is never rewritten; the
   * context score says what the record did; turning on a fifth of context
   * moves the result by a stated, checkable amount.
   */
  const funk = makeEntity('album', 'foundational', { name: 'Foundational', releaseDate: '1970' });

  const judged = snapshot({
    enjoyment: 70,
    craft: 90,
    innovation: 100,
    influence: 100,
    'staying-power': 80,
  });

  it('keeps your rating at seven and scores the context separately', () => {
    const explained = explainContext({
      snapshot: judged,
      direct: 70,
      config: config({ contribution: 0.2 }),
      type: 'album',
    });
    expect(explained?.score).toBe(88);
    expect(explained?.adjusted).toBeCloseTo(73.6, 9);
    expect(explained?.coverage).toMatchObject({ rated: 5, total: 5 });
  });

  it('shows exactly what each contribution does to the result', () => {
    const at = (contribution: number) =>
      explainContext({
        snapshot: judged,
        direct: 70,
        config: config({ contribution }),
        type: 'album',
      })?.adjusted;
    expect(at(0)).toBeNull();
    expect(at(0.2)).toBeCloseTo(73.6, 9);
    expect(at(0.5)).toBe(79);
  });

  it('feeds the rollup the adjusted value once, and only through your rating', () => {
    const rating = rate(funk, 70, { contextual: judged });
    const graph = new ContainmentGraph([funk], []);
    const input = {
      graph,
      explicit: indexCurrentRatings([rating]),
      rankings: new Map([['album' as const, computeRankings([], 'album')]]),
      config: defaultRollupConfigByType(),
      context: config({ contribution: 0.2 }),
      now: T0,
    };
    const score = computeScore(input, funk.id);

    expect(score.explicit).toBe(70);
    expect(score.contextScore).toBe(88);
    expect(score.contextAdjusted).toBeCloseTo(73.6, 9);
    expect(score.effectiveExplicit).toBeCloseTo(73.6, 9);

    const explicitChannel = score.channels.find((c) => c.channel === 'explicit');
    expect(explicitChannel?.value).toBeCloseTo(73.6, 9);
    // Context is not a channel. It reaches the score through your rating or not
    // at all, so it can never be counted twice.
    expect(score.channels.map((c) => c.channel)).toEqual([
      'explicit',
      'directChildren',
      'descendants',
      'comparison',
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* Nothing changes for anyone who never uses it                               */
/* -------------------------------------------------------------------------- */

describe('migration', () => {
  const artist = makeEntity('artist', 'a1');
  const album = makeEntity('album', 'al1');
  const t1 = makeEntity('track', 't1');
  const t2 = makeEntity('track', 't2');
  const memberships = [link(artist, album), link(album, t1), link(album, t2)];

  function scoreWith(ratings: RatingEvent[], context?: ContextConfig) {
    const graph = new ContainmentGraph([artist, album, t1, t2], memberships);
    return computeScore(
      {
        graph,
        explicit: indexCurrentRatings(ratings),
        rankings: new Map([['album' as const, computeRankings([], 'album')]]),
        config: defaultRollupConfigByType(),
        ...(context ? { context } : {}),
        now: T0,
      },
      album.id,
    );
  }

  const plain = [rate(album, 60), rate(t1, 80), rate(t2, 40)];

  it('leaves a rating with no context bit for bit as it was', () => {
    const before = scoreWith(plain);
    const after = scoreWith(plain, config());
    expect(after.explicit).toBe(before.explicit);
    expect(after.rollup).toBe(before.rollup);
    expect(after.blended).toBe(before.blended);
    expect(after.contextScore).toBeNull();
    expect(after.contextAdjusted).toBeNull();
    expect(after.effectiveExplicit).toBe(before.explicit);
    expect(after.context).toBeUndefined();
  });

  it('leaves scores alone when facets exist but the contribution is off', () => {
    const withFacets = [
      rate(album, 60, { contextual: snapshot({ enjoyment: 100, craft: 100 }) }),
      rate(t1, 80),
      rate(t2, 40),
    ];
    const before = scoreWith(plain);
    const after = scoreWith(withFacets, config({ enabled: false }));
    expect(after.explicit).toBe(before.explicit);
    expect(after.rollup).toBe(before.rollup);
    expect(after.blended).toBe(before.blended);
    expect(after.contextScore).toBe(100);
    expect(after.contextAdjusted).toBeNull();
    expect(after.effectiveExplicit).toBe(60);
  });

  it('lets a child carry its adjusted value up to its parent, once', () => {
    const withFacets = [
      rate(t1, 80, { contextual: snapshot({ enjoyment: 100, craft: 100 }) }),
      rate(t2, 40),
    ];
    const off = scoreWith(withFacets, config({ enabled: false }));
    const on = scoreWith(withFacets, config({ contribution: 0.5 }));
    const direct = (b: ReturnType<typeof scoreWith>) =>
      b.channels.find((c) => c.channel === 'directChildren')?.value;
    // t1 rises from 80 to 90 and t2 stays at 40, so the pair's mean moves 5.
    expect(direct(off)).toBe(60);
    expect(direct(on)).toBe(65);
  });
});

/* -------------------------------------------------------------------------- */
/* Saving and editing                                                         */
/* -------------------------------------------------------------------------- */

describe('snapshots', () => {
  it('is null when no facet was rated, so no empty payload is stored', () => {
    expect(makeSnapshot([], config(), 'album')).toBeNull();
  });

  it('records the weights and contribution in force at the time', () => {
    const c = config({ contribution: 0.3, facets: weighted(defaultFacets(), { enjoyment: 2 }) });
    const made = makeSnapshot(
      [{ facetId: 'enjoyment', value: 7, scaleId: 'int-10', normalized: 70 }],
      c,
      'album',
    );
    expect(made).toMatchObject({
      v: 1,
      weights: { enjoyment: 2 },
      contribution: 0.3,
      applicable: 5,
    });
  });

  it('records no contribution when the feature is off', () => {
    const made = makeSnapshot(
      [{ facetId: 'enjoyment', value: 7, scaleId: 'int-10', normalized: 70 }],
      config({ enabled: false, contribution: 0.4 }),
      'album',
    );
    expect(made?.contribution).toBe(0);
  });

  it('trims an evidence note and drops an empty one', () => {
    const made = makeSnapshot(
      [
        { facetId: 'enjoyment', value: 7, scaleId: 'int-10', normalized: 70, note: '  first  ' },
        { facetId: 'craft', value: 8, scaleId: 'int-10', normalized: 80, note: '   ' },
      ],
      config(),
      'album',
    );
    expect(made?.facets[0]?.note).toBe('first');
    expect(made?.facets[1]?.note).toBeUndefined();
  });

  it('copies deeply, so abandoning a draft leaves no trace', () => {
    const original = snapshot({ enjoyment: 70 });
    const copy = copySnapshot(original);
    copy!.facets[0]!.normalized = 10;
    copy!.weights.enjoyment = 9;
    expect(original.facets[0]?.normalized).toBe(70);
    expect(original.weights.enjoyment).toBe(1);
    expect(copySnapshot(null)).toBeNull();
  });

  it('keys judgements for an editor and skips anything unreadable', () => {
    const broken = snapshot({ enjoyment: 70 });
    broken.facets.push({
      facetId: 'craft',
      value: Number.NaN,
      scaleId: 'int-10',
      normalized: Number.NaN,
    });
    const map = judgementsById(broken);
    expect([...map.keys()]).toEqual(['enjoyment']);
  });

  it('refuses a judgement it cannot record, and says why', () => {
    expect(validateJudgement({ facetId: '', value: 1, scaleId: 'int-10', normalized: 10 })).toMatch(
      /no facet/,
    );
    expect(
      validateJudgement({
        facetId: 'enjoyment',
        value: 1,
        scaleId: 'int-10',
        normalized: Number.NaN,
      }),
    ).toMatch(/no value/);
    expect(
      validateJudgement({ facetId: 'enjoyment', value: 1, scaleId: 'int-10', normalized: 140 }),
    ).toMatch(/outside/);
    expect(
      validateJudgement({ facetId: 'enjoyment', value: 1, scaleId: '', normalized: 40 }),
    ).toMatch(/which scale/);
    expect(
      validateJudgement({ facetId: 'enjoyment', value: 7, scaleId: 'int-10', normalized: 70 }),
    ).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Ranking views                                                              */
/* -------------------------------------------------------------------------- */

describe('ranking by context', () => {
  /** One album judged in context, one rated flat, one never rated at all. */
  function world() {
    const judged = makeEntity('album', 'judged');
    const flat = makeEntity('album', 'flat');
    const unrated = makeEntity('album', 'unrated');
    const ratings = [
      rate(judged, 70, { contextual: snapshot({ enjoyment: 70, innovation: 100 }) }),
      rate(flat, 90),
    ];
    const graph = new ContainmentGraph([judged, flat, unrated], []);
    const scores = new Map(
      [judged, flat, unrated].map((entity) => [
        entity.id,
        computeScore(
          {
            graph,
            explicit: indexCurrentRatings(ratings),
            rankings: new Map([['album' as const, computeRankings([], 'album')]]),
            config: defaultRollupConfigByType(),
            context: config({ contribution: 0.2 }),
            now: T0,
          },
          entity.id,
        ),
      ]),
    );
    return { graph, scores, explicit: indexCurrentRatings(ratings), judged, flat, unrated };
  }

  it('ranks only what has context in the context view, and by the context score', () => {
    const { graph, scores, explicit, judged } = world();
    const list = buildRankedList(
      { graph, scores, explicit },
      { type: 'album', view: 'context', direction: 'top' },
    );
    expect(list.rows.map((r) => r.entityId)).toEqual([judged.id]);
    expect(list.rows[0]?.score).toBe(85);
    expect(list.dropped.map((d) => d.reason)).toContain(
      'You have not answered any context questions for it',
    );
  });

  it('keeps a flat rating in the adjusted view rather than dropping it', () => {
    const { graph, scores, explicit, judged, flat } = world();
    const list = buildRankedList(
      { graph, scores, explicit },
      { type: 'album', view: 'contextAdjusted', direction: 'top' },
    );
    // Flat stays at 90; the judged one is pulled up from 70 to 73.
    expect(list.rows.map((r) => r.entityId)).toEqual([flat.id, judged.id]);
    expect(list.rows[1]?.score).toBeCloseTo(73, 9);
  });

  it('leaves your own rating untouched in its own view', () => {
    const { graph, scores, explicit, judged } = world();
    const list = buildRankedList(
      { graph, scores, explicit },
      { type: 'album', view: 'explicit', direction: 'top' },
    );
    expect(list.rows.find((r) => r.entityId === judged.id)?.score).toBe(70);
  });

  it('names every view it offers, so no picker invents its own words', () => {
    for (const view of SCORE_VIEWS) {
      expect(SCORE_VIEW_LABEL[view]).toBeTruthy();
    }
  });
});
