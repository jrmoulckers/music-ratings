import { describe, expect, it } from 'vitest';

import {
  buildCanonicalIndex,
  checkCombine,
  expandMembers,
  legacyAliases,
  meanNormalized,
  planCombine,
  planCombinedRating,
  planUncombine,
  resolveAnnotations,
  resolveCollections,
  resolveComparisons,
  resolveQueueStates,
  resolveSignalIds,
  type TypedEntity,
} from './canonical';
import { computeRankings } from './elo';
import { ContainmentGraph } from './graph';
import { historyFor, indexCurrentRatings } from './ratings';
import { computeScore } from './rollup';
import { BUILTIN_SCALES, findScale } from './scales';
import type { CanonicalGroup, EntityId, RatingEvent, RatingScale } from './types';
import { compare, link, makeEntity, rate, T0 } from '../../test/fixtures';
import { DEFAULT_ROLLUP_CONFIG } from './rollup';
import type { RollupConfigByType } from './types';
import { ENTITY_TYPES } from './types';

/**
 * Combining duplicates.
 *
 * The rules that matter are all about what is *not* touched: the events keep
 * their ids and their subjects, the sources keep their records, and separating
 * a group puts every rating back exactly where it was.
 */

const scale = (id: string): RatingScale => {
  const found = findScale(BUILTIN_SCALES, id);
  if (!found) throw new Error(`missing fixture scale ${id}`);
  return found;
};

const original = makeEntity('album', 'original', { name: 'Kid A' });
const remaster = makeEntity('album', 'remaster', { name: 'Kid A (2016 Remaster)' });
const third = makeEntity('album', 'third', { name: 'Kid A (Japan)' });
const song = makeEntity('track', 'song', { name: 'Kid A' });

const typed = (): Map<EntityId, TypedEntity> =>
  new Map(
    [original, remaster, third, song].map((e) => [e.id, { id: e.id, type: e.type, name: e.name }]),
  );

function group(overrides: Partial<CanonicalGroup> = {}): CanonicalGroup {
  return {
    id: 'grp-1',
    entityType: 'album',
    primaryId: original.id,
    memberIds: [original.id, remaster.id],
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

describe('the canonical index', () => {
  it('maps every source onto the primary, and leaves strangers alone', () => {
    const index = buildCanonicalIndex([group()]);
    expect(index.resolve(remaster.id)).toBe(original.id);
    expect(index.resolve(original.id)).toBe(original.id);
    expect(index.resolve(third.id)).toBe(third.id);
    expect(index.isAlias(remaster.id)).toBe(true);
    expect(index.isAlias(original.id)).toBe(false);
    expect(index.members(remaster.id)).toEqual([original.id, remaster.id]);
    expect(index.aliases(original.id)).toEqual([remaster.id]);
  });

  it('ignores a tombstoned group', () => {
    const index = buildCanonicalIndex([group({ deleted: T0 + 1 })]);
    expect(index.resolve(remaster.id)).toBe(remaster.id);
    expect(index.size).toBe(0);
  });

  it('leaves a group alone until every one of its sources has synced here', () => {
    const index = buildCanonicalIndex([group()], [], new Set([remaster.id]));
    // The primary is not on this device yet, so the copy that is here answers
    // for itself rather than resolving onto a record that does not exist.
    expect(index.resolve(remaster.id)).toBe(remaster.id);
    expect(index.size).toBe(0);

    const complete = buildCanonicalIndex([group()], [], new Set([original.id, remaster.id]));
    expect(complete.resolve(remaster.id)).toBe(original.id);
  });

  it('refuses members of another kind, which cannot be the same record', () => {
    const index = buildCanonicalIndex([group({ memberIds: [original.id, remaster.id, song.id] })]);
    expect(index.members(original.id)).toEqual([original.id, remaster.id]);
    expect(index.resolve(song.id)).toBe(song.id);
  });

  it('settles an overlap the same way on every device: the older group keeps it', () => {
    const older = group({ id: 'a', createdAt: 1, memberIds: [original.id, remaster.id] });
    const newer = group({
      id: 'b',
      createdAt: 2,
      primaryId: third.id,
      memberIds: [third.id, remaster.id],
    });
    const forwards = buildCanonicalIndex([older, newer]);
    const backwards = buildCanonicalIndex([newer, older]);
    expect(forwards.resolve(remaster.id)).toBe(original.id);
    expect(backwards.resolve(remaster.id)).toBe(original.id);
    // The younger group is left with one member, which is no group at all.
    expect(forwards.resolve(third.id)).toBe(third.id);
  });

  it('falls back to the lowest id when the named primary was already taken', () => {
    const older = group({ id: 'a', createdAt: 1, memberIds: [original.id, remaster.id] });
    const newer = group({
      id: 'b',
      createdAt: 2,
      primaryId: remaster.id,
      memberIds: [remaster.id, third.id, song.id, makeEntity('album', 'z').id],
    });
    const index = buildCanonicalIndex([older, newer]);
    expect(index.resolve('album:local:z')).toBe(third.id);
    expect(index.members(third.id)).toEqual([third.id, 'album:local:z']);
  });

  it('bridges a legacy duplicateOf pointer, but never over a real group', () => {
    const annotations = [
      { id: remaster.id, tags: [], duplicateOf: original.id, updatedAt: T0 },
      { id: third.id, tags: [], duplicateOf: original.id, updatedAt: T0 },
    ];
    const bridged = buildCanonicalIndex([], legacyAliases(annotations));
    expect(bridged.resolve(remaster.id)).toBe(original.id);
    expect(bridged.resolve(third.id)).toBe(original.id);

    // A group that says otherwise wins outright.
    const withGroup = buildCanonicalIndex(
      [group({ primaryId: remaster.id, memberIds: [remaster.id, third.id] })],
      legacyAliases(annotations),
    );
    expect(withGroup.resolve(third.id)).toBe(remaster.id);
  });
});

describe('resolving the records that point at entities', () => {
  const index = buildCanonicalIndex([group()]);
  const resolve = index.resolver;

  it('re-subjects comparisons without editing the stored rows', () => {
    const rows = [compare(remaster, third, 'a'), compare(original, remaster, 'b')];
    const resolved = resolveComparisons(rows, resolve);
    // The duel between two sources of one record says nothing and is dropped.
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.aId).toBe(original.id);
    expect(rows[0]!.aId).toBe(remaster.id);
  });

  it('keeps a merged pair out of the ladder entirely', () => {
    const rows = [compare(original, remaster, 'a'), compare(original, third, 'a')];
    const table = computeRankings(rows, 'album', resolve);
    expect(table.get(original.id)?.comparisons).toBe(1);
    expect(table.get(remaster.id)).toBeUndefined();
  });

  it('unions tags but never invents a note', () => {
    const merged = resolveAnnotations(
      [
        { id: original.id, tags: ['loud'], note: 'the original pressing', updatedAt: 2 },
        { id: remaster.id, tags: ['warm'], note: 'brighter', pinned: 'favorite', updatedAt: 3 },
      ],
      index,
    );
    const combined = merged.get(original.id);
    expect(combined?.tags).toEqual(['loud', 'warm']);
    expect(combined?.note).toBe('the original pressing');
    expect(combined?.pinned).toBe('favorite');
    expect(merged.has(remaster.id)).toBe(false);
  });

  it('keeps the newest queue decision when two sources disagree', () => {
    const states = resolveQueueStates(
      [
        { id: original.id, entityType: 'album', kind: 'snoozed', at: 1, updatedAt: 1 },
        { id: remaster.id, entityType: 'album', kind: 'skipped', at: 5, updatedAt: 5 },
      ],
      resolve,
    );
    expect(states.size).toBe(1);
    expect(states.get(original.id)?.kind).toBe('skipped');
  });

  it('de-duplicates a list without reordering it', () => {
    const [list] = resolveCollections(
      [
        {
          id: 'c1',
          name: 'Best of',
          entityIds: [third.id, remaster.id, original.id],
          createdAt: T0,
          updatedAt: T0,
        },
      ],
      resolve,
    );
    expect(list!.entityIds).toEqual([third.id, original.id]);
  });

  it('reads listening evidence against the record that stands for it', () => {
    const resolved = resolveSignalIds([{ entityId: remaster.id, at: 5, index: 0 }], resolve);
    expect(resolved[0]!.entityId).toBe(original.id);
  });
});

describe('the graph, with duplicates folded in', () => {
  it('shows one row, reachable by every source id', () => {
    const index = buildCanonicalIndex([group()]);
    const graph = new ContainmentGraph([original, remaster, third], [], index);
    expect(graph.entitiesOfType('album')).toHaveLength(2);
    expect(graph.entity(remaster.id)?.id).toBe(original.id);
    expect(graph.has(remaster.id)).toBe(true);
    expect(graph.source(remaster.id)?.name).toBe('Kid A (2016 Remaster)');
    expect(graph.sourcesOf(original.id).map((e) => e.id)).toEqual([original.id, remaster.id]);
    expect(graph.isCombined(original.id)).toBe(true);
    expect(graph.isCombined(third.id)).toBe(false);
  });

  it('leaves an alias standing when its primary is not in the library', () => {
    const index = buildCanonicalIndex([group()]);
    const graph = new ContainmentGraph([remaster], [], index);
    expect(graph.entity(remaster.id)?.id).toBe(remaster.id);
    expect(graph.entitiesOfType('album')).toHaveLength(1);
  });

  it('re-points containment and counts what it folded', () => {
    const artist = makeEntity('artist', 'artist');
    const trackA = makeEntity('track', 'ta');
    const trackB = makeEntity('track', 'tb');
    const index = buildCanonicalIndex([
      group({ entityType: 'track', primaryId: trackA.id, memberIds: [trackA.id, trackB.id] }),
    ]);
    const graph = new ContainmentGraph(
      [artist, trackA, trackB],
      [link(artist, trackA, { position: 0 }), link(artist, trackB, { position: 1 })],
      index,
    );
    expect(graph.children(artist.id)).toHaveLength(1);
    expect(graph.children(artist.id)[0]!.childId).toBe(trackA.id);
    expect(graph.foldedEdges(artist.id)).toBe(1);

    const config = Object.fromEntries(
      ENTITY_TYPES.map((t) => [t, DEFAULT_ROLLUP_CONFIG]),
    ) as RollupConfigByType;
    const score = computeScore(
      {
        graph,
        explicit: indexCurrentRatings([rate(trackA, 80)], index.resolver),
        rankings: new Map(),
        config,
        now: T0,
      },
      artist.id,
    );
    // The fold is reported rather than left as an unexplained missing child.
    expect(score.exclusions.some((e) => e.code === 'combined')).toBe(true);
  });
});

describe('ratings read canonically', () => {
  const index = buildCanonicalIndex([group()]);

  it('lets one rating on an alias serve the whole group', () => {
    const events = [rate(remaster, 60, { at: T0 })];
    const current = indexCurrentRatings(events, index.resolver);
    expect(current.get(original.id)?.normalized).toBe(60);
    expect(current.get(original.id)?.eventId).toBe(events[0]!.id);
    expect(current.size).toBe(1);
  });

  it('takes the newest event across every source', () => {
    const events = [rate(original, 40, { at: T0 }), rate(remaster, 90, { at: T0 + 10 })];
    expect(indexCurrentRatings(events, index.resolver).get(original.id)?.normalized).toBe(90);
  });

  it('reads one history for the combined record', () => {
    const events = [rate(original, 40, { at: T0 }), rate(remaster, 90, { at: T0 + 10 })];
    const history = historyFor(events, remaster.id, { resolve: index.resolver });
    expect(history.map((e) => e.normalized)).toEqual([90, 40]);
    // The stored events still name the source they were made against.
    expect(history[0]!.entityId).toBe(remaster.id);
  });
});

describe('what combining does to the rating', () => {
  const int10 = scale('int-10');

  it('averages the current ratings, equally weighted', () => {
    expect(meanNormalized([70, 90])).toBe(80);
    expect(meanNormalized([70, 80, 85])).toBe(78.333333);
    expect(meanNormalized([])).toBeNull();
  });

  it('writes one entry at the mean, expressed on the scale in use', () => {
    const events = [rate(original, 70), rate(remaster, 90)];
    const plan = planCombinedRating([original.id, remaster.id], events, int10);
    expect(plan.kind).toBe('averaged');
    expect(plan.event?.normalized).toBe(80);
    expect(plan.event?.value).toBe(8);
    expect(plan.event?.sourceEventIds).toHaveLength(2);
  });

  it('says so when the scale cannot hold the average exactly', () => {
    const events = [rate(original, 70), rate(remaster, 80)];
    const plan = planCombinedRating([original.id, remaster.id], events, int10);
    expect(plan.mean).toBe(75);
    // Written at the mean; printed at the nearest position the scale has.
    expect(plan.event?.normalized).toBe(75);
    expect(plan.event?.value).toBe(8);
    expect(plan.displayNormalized).toBe(80);
    expect(plan.notes.join(' ')).toMatch(/nearest one it can hold/i);
  });

  it('writes nothing at all when only one source is rated', () => {
    const plan = planCombinedRating([original.id, remaster.id], [rate(remaster, 60)], int10);
    expect(plan.kind).toBe('carried');
    expect(plan.event).toBeNull();
    expect(plan.notes.join(' ')).toMatch(/no new entry is written/i);
  });

  it('ignores withdrawn and deleted ratings', () => {
    const events = [
      rate(original, 20, { retracted: T0 + 1 }),
      rate(original, 30, { deleted: T0 + 1 }),
      rate(remaster, 90),
    ];
    const plan = planCombinedRating([original.id, remaster.id], events, int10);
    expect(plan.kind).toBe('carried');
    expect(plan.sources).toHaveLength(1);
  });

  it('averages only the current rating of each source, not its whole history', () => {
    const events = [
      rate(original, 10, { at: T0 }),
      rate(original, 70, { at: T0 + 100 }),
      rate(remaster, 90, { at: T0 + 50 }),
    ];
    const plan = planCombinedRating([original.id, remaster.id], events, int10);
    expect(plan.sources.map((s) => s.normalized).sort()).toEqual([70, 90]);
    expect(plan.event?.normalized).toBe(80);
  });

  it('treats an existing canonical group as one rating when another source is added', () => {
    const combined = buildCanonicalIndex([group()]);
    const previousAverage = rate(original, 80, {
      at: T0 + 100,
      origin: {
        kind: 'combine-average',
        groupId: 'grp-1',
        sourceEventIds: ['rating-a', 'rating-b'],
      },
    });
    const plan = planCombine({
      entityIds: [original.id, third.id],
      primaryId: original.id,
      entities: typed(),
      index: combined,
      ratings: [
        rate(original, 70, { id: 'rating-a', at: T0 }),
        rate(remaster, 90, { id: 'rating-b', at: T0 }),
        previousAverage,
        rate(third, 60, { at: T0 + 50 }),
      ],
      scale: int10,
    });

    expect(plan.rating.sources.map((source) => source.normalized)).toEqual([80, 60]);
    expect(plan.rating.event?.normalized).toBe(70);
  });

  it('carries a note only when the sources agree, and unions their tags', () => {
    const agreed = planCombinedRating(
      [original.id, remaster.id],
      [rate(original, 70, { note: 'same' }), rate(remaster, 90, { tags: ['warm'] })],
      int10,
    );
    expect(agreed.event?.note).toBe('same');
    expect(agreed.event?.tags).toEqual(['warm']);

    const conflicted = planCombinedRating(
      [original.id, remaster.id],
      [
        rate(original, 70, { note: 'the original', tags: ['loud'] }),
        rate(remaster, 90, { note: 'brighter', tags: ['warm'] }),
      ],
      int10,
    );
    expect(conflicted.event?.note).toBeUndefined();
    expect(conflicted.event?.tags).toEqual(['loud', 'warm']);
    expect(conflicted.notes.join(' ')).toMatch(/different notes/i);
  });

  it('takes the least certain confidence when they disagree', () => {
    const events = [
      rate(original, 70, { confidence: 'high' }),
      rate(remaster, 90, { confidence: 'low', at: T0 + 5 }),
    ];
    const plan = planCombinedRating([original.id, remaster.id], events, int10);
    expect(plan.event?.confidence).toBe('low');
    expect(plan.notes.join(' ')).toMatch(/not equally sure/i);

    const agreed = planCombinedRating(
      [original.id, remaster.id],
      [
        rate(original, 70, { confidence: 'high' }),
        rate(remaster, 90, { confidence: 'high', at: T0 + 5 }),
      ],
      int10,
    );
    expect(agreed.event?.confidence).toBe('high');
  });

  it('refuses to blend two sets of context answers', () => {
    const snapshot = {
      v: 1,
      facets: [{ facetId: 'enjoy', value: 8, scaleId: 'int-10', normalized: 80 }],
      weights: { enjoy: 1 },
      contribution: 0.3,
      applicable: 3,
    };
    const one = planCombinedRating(
      [original.id, remaster.id],
      [rate(original, 70, { contextual: snapshot }), rate(remaster, 90)],
      int10,
    );
    expect(one.notes.join(' ')).toMatch(/carried across/i);

    const both = planCombinedRating(
      [original.id, remaster.id],
      [
        rate(original, 70, { contextual: snapshot }),
        rate(remaster, 90, { contextual: { ...snapshot, contribution: 0.5 } }),
      ],
      int10,
    );
    expect(both.notes.join(' ')).toMatch(/left where they were answered/i);
  });
});

describe('validating a combine', () => {
  const index = buildCanonicalIndex([]);

  it('refuses two kinds, one item, and a primary from outside the set', () => {
    expect(
      checkCombine({
        entityIds: [original.id, song.id],
        primaryId: original.id,
        entities: typed(),
        index,
      })?.code,
    ).toBe('type-mismatch');
    expect(
      checkCombine({ entityIds: [original.id], primaryId: original.id, entities: typed(), index })
        ?.code,
    ).toBe('too-few');
    expect(
      checkCombine({
        entityIds: [original.id, original.id],
        primaryId: original.id,
        entities: typed(),
        index,
      })?.code,
    ).toBe('too-few');
    expect(
      checkCombine({
        entityIds: [original.id, remaster.id],
        primaryId: third.id,
        entities: typed(),
        index,
      })?.code,
    ).toBe('primary-not-a-member');
    expect(
      checkCombine({
        entityIds: [original.id, 'album:local:ghost'],
        primaryId: original.id,
        entities: typed(),
        index,
      })?.code,
    ).toBe('unknown-entity');
  });

  it('accepts a plain pair, and refuses one that is already exactly that', () => {
    expect(
      checkCombine({
        entityIds: [original.id, remaster.id],
        primaryId: original.id,
        entities: typed(),
        index,
      }),
    ).toBeNull();

    const combined = buildCanonicalIndex([group()]);
    expect(
      checkCombine({
        entityIds: [original.id, remaster.id],
        primaryId: original.id,
        entities: typed(),
        index: combined,
      })?.code,
    ).toBe('already-combined');
    // Choosing a different primary for the same set is a real change.
    expect(
      checkCombine({
        entityIds: [original.id, remaster.id],
        primaryId: remaster.id,
        entities: typed(),
        index: combined,
      }),
    ).toBeNull();
  });

  it('pulls in the whole group when one of its members is picked', () => {
    const combined = buildCanonicalIndex([group()]);
    expect(expandMembers([remaster.id, third.id], combined)).toEqual(
      [original.id, remaster.id, third.id].sort(),
    );
  });
});

describe('planning and unplanning', () => {
  it('reports what is new and what is being swallowed', () => {
    const index = buildCanonicalIndex([group()]);
    const plan = planCombine({
      entityIds: [original.id, third.id],
      primaryId: original.id,
      entities: typed(),
      index,
      ratings: [],
      scale: scale('int-10'),
    });
    expect(plan.memberIds).toEqual([original.id, remaster.id, third.id].sort());
    expect(plan.addedIds).toEqual([third.id]);
    expect(plan.existingGroupId).toBe('grp-1');
    expect(plan.absorbedGroupIds).toEqual([]);
    expect(plan.entityType).toBe('album');
  });

  it('withdraws only the entries combining wrote', () => {
    const written: RatingEvent = rate(original, 80, { id: 'made-by-combine' });
    const byHand: RatingEvent = rate(original, 40);
    const plan = planUncombine(group({ averagedEventIds: ['made-by-combine'] }), [written, byHand]);
    expect(plan.withdrawEventIds).toEqual(['made-by-combine']);
    expect(plan.memberIds).toHaveLength(2);
    expect(plan.notes.join(' ')).toMatch(/keeps its own ratings/i);
  });

  it('has nothing to withdraw when the combine wrote nothing', () => {
    expect(planUncombine(group(), [rate(original, 40)]).withdrawEventIds).toEqual([]);
  });
});
