import { describe, expect, it } from 'vitest';

import { ContainmentGraph } from '../lib/domain/graph';
import { entityId, membershipId } from '../lib/domain/ids';
import { PLAY_SCHEMA_VERSION, type PlayEvent } from '../lib/domain/listening';
import {
  LISTENING_RANGES,
  PlayIndex,
  RANGE_LABEL,
  catalogueFrom,
  computeListeningStats,
  albumListening,
  artistListening,
  rangeStart,
} from '../lib/domain/listening-stats';
import type { Entity, Membership } from '../lib/domain/types';
import type { ExplicitRating } from '../lib/domain/ratings';
import {
  NO_PERCENTILE,
  breadth,
  coverageNotes,
  observedSince,
  share,
} from '../lib/listening/phrasing';
import { emptyCoverage } from '../lib/domain/listening';
import { DAY, HOUR, MINUTE, T0 } from './fixtures';

/**
 * The statistics have one job beyond being right: never to imply something the
 * source cannot support. So this suite checks the arithmetic *and* checks that
 * the shares are shares of observed listening, that credited-artist breadth is
 * kept separate from share, and that no phrase in the vocabulary claims a
 * standing among other listeners.
 */

/* -------------------------------------------------------------------------- */
/* World                                                                      */
/* -------------------------------------------------------------------------- */

interface Built {
  graph: ContainmentGraph;
  ids: Record<string, string>;
}

/**
 * Two artists, three releases, one of them a collaboration, so multi-artist
 * attribution has something real to disagree about.
 */
function world(): Built {
  const entities: Entity[] = [];
  const memberships: Membership[] = [];
  const ids: Record<string, string> = {};

  const make = (type: 'artist' | 'album' | 'track', key: string, extra: Partial<Entity> = {}) => {
    const id = entityId(type, 'local', key);
    ids[key] = id;
    entities.push({
      id,
      type,
      provider: 'local',
      providerId: key,
      name: key,
      available: true,
      provenance: { provider: 'local', via: 'test', fetchedAt: T0 },
      createdAt: T0,
      updatedAt: T0,
      ...extra,
    });
    return id;
  };

  const linkUp = (parent: string, child: string, position?: number) => {
    const parentEntity = entities.find((e) => e.id === parent);
    const childEntity = entities.find((e) => e.id === child);
    if (!parentEntity || !childEntity) throw new Error('bad link');
    memberships.push({
      id: membershipId(parent, child, position),
      parentId: parent,
      childId: child,
      parentType: parentEntity.type,
      childType: childEntity.type,
      ...(position === undefined ? {} : { position }),
      updatedAt: T0,
    });
  };

  const ada = make('artist', 'ada');
  const bo = make('artist', 'bo');

  const solo = make('album', 'solo', { totalChildren: 3 });
  const other = make('album', 'other', { totalChildren: 2 });
  const split = make('album', 'split', { totalChildren: 2 });

  linkUp(ada, solo);
  linkUp(bo, other);
  linkUp(ada, split);
  linkUp(bo, split);

  for (let i = 1; i <= 3; i += 1) {
    const track = make('track', `solo-${i}`, { durationMs: 3 * MINUTE, trackNumber: i });
    linkUp(solo, track, i);
    linkUp(ada, track);
  }
  for (let i = 1; i <= 2; i += 1) {
    const track = make('track', `other-${i}`, { durationMs: 4 * MINUTE, trackNumber: i });
    linkUp(other, track, i);
    linkUp(bo, track);
  }
  // Credited to both, in credit order: Ada first.
  for (let i = 1; i <= 2; i += 1) {
    const track = make('track', `split-${i}`, { durationMs: 5 * MINUTE, trackNumber: i });
    linkUp(split, track, i);
    linkUp(ada, track);
    linkUp(bo, track);
  }

  return { graph: new ContainmentGraph(entities, memberships), ids };
}

function ev(trackId: string, at: number, durationMs = 3 * MINUTE): PlayEvent {
  return {
    id: `ply:spotify:${trackId}:${at}`,
    entityId: trackId,
    entityType: 'track',
    at,
    durationMs,
    ingestedAt: at,
    source: 'spotify-recently-played',
    v: PLAY_SCHEMA_VERSION,
    updatedAt: at,
  };
}

const NOW = T0 + 400 * DAY;

function statsFor(plays: PlayEvent[], range: (typeof LISTENING_RANGES)[number] = 'all') {
  const built = world();
  return {
    built,
    stats: computeListeningStats({
      index: new PlayIndex(plays),
      catalogue: catalogueFrom(built.graph),
      explicit: new Map<string, ExplicitRating>(),
      completions: [],
      range,
      now: NOW,
    }),
  };
}

/* -------------------------------------------------------------------------- */

describe('play index', () => {
  it('keeps per-entity totals without sweeping the log', () => {
    const built = world();
    const plays = [
      ev(built.ids['solo-1']!, NOW - 2 * DAY),
      ev(built.ids['solo-1']!, NOW - DAY),
      ev(built.ids['solo-2']!, NOW - 3 * DAY),
    ];
    const index = new PlayIndex(plays);
    expect(index.playsOf(built.ids['solo-1']!)).toBe(2);
    expect(index.playsOf(built.ids['solo-2']!)).toBe(1);
    expect(index.playsOf(built.ids['solo-3']!)).toBe(0);
    expect(index.lastPlayOf(built.ids['solo-1']!)).toBe(NOW - DAY);
    expect(index.firstPlayOf(built.ids['solo-1']!)).toBe(NOW - 2 * DAY);
  });

  it('finds the range start by binary search, not by scanning', () => {
    const plays = Array.from({ length: 500 }, (_, i) => ev('t', T0 + i * HOUR));
    const index = new PlayIndex(plays);
    expect(index.lowerBound(T0 + 250 * HOUR)).toBe(250);
    expect(index.lowerBound(T0 - HOUR)).toBe(0);
    expect(index.lowerBound(T0 + 10_000 * HOUR)).toBe(500);
  });
});

describe('time ranges', () => {
  it('gives every range a start no later than now', () => {
    const index = new PlayIndex([ev('t', NOW - DAY)]);
    for (const range of LISTENING_RANGES) {
      expect(rangeStart(index, range, NOW)).toBeLessThanOrEqual(NOW);
      expect(RANGE_LABEL[range]).toBeTruthy();
    }
  });

  it('walks a sitting back only while the gaps stay short', () => {
    const plays = [
      ev('t', NOW - 8 * HOUR), // before the break
      ev('t', NOW - 40 * MINUTE),
      ev('t', NOW - 20 * MINUTE),
      ev('t', NOW - 2 * MINUTE),
    ];
    const index = new PlayIndex(plays);
    const from = rangeStart(index, 'sitting', NOW);
    expect(from).toBeGreaterThan(NOW - 8 * HOUR);
    expect(from).toBeLessThanOrEqual(NOW - 40 * MINUTE);
  });

  it('counts only plays inside the chosen range', () => {
    const built = world();
    const plays = [
      ev(built.ids['solo-1']!, NOW - 200 * DAY),
      ev(built.ids['solo-1']!, NOW - 3 * DAY),
    ];
    const catalogue = catalogueFrom(built.graph);
    const index = new PlayIndex(plays);
    const base = {
      index,
      catalogue,
      explicit: new Map<string, ExplicitRating>(),
      completions: [],
      now: NOW,
    };
    expect(computeListeningStats({ ...base, range: '7d' }).plays).toBe(1);
    expect(computeListeningStats({ ...base, range: 'all' }).plays).toBe(2);
  });
});

describe('shares and attribution', () => {
  it('makes play shares of the ranked lists sum to no more than the whole', () => {
    const built = world();
    const plays = [
      ev(built.ids['solo-1']!, NOW - 5 * DAY),
      ev(built.ids['solo-2']!, NOW - 4 * DAY),
      ev(built.ids['other-1']!, NOW - 3 * DAY),
      ev(built.ids['split-1']!, NOW - 2 * DAY),
      ev(built.ids['split-2']!, NOW - DAY),
    ];
    const { stats } = statsFor(plays);

    const artistShare = stats.topArtists.reduce((sum, row) => sum + row.playShare, 0);
    expect(artistShare).toBeLessThanOrEqual(1.000001);

    const trackShare = stats.topTracks.reduce((sum, row) => sum + row.playShare, 0);
    expect(trackShare).toBeLessThanOrEqual(1.000001);
  });

  it('attributes a shared track to its first credited artist for share', () => {
    const built = world();
    // Two plays of collaboration tracks and nothing else.
    const plays = [ev(built.ids['split-1']!, NOW - DAY), ev(built.ids['split-2']!, NOW - HOUR)];
    const { stats } = statsFor(plays);

    expect(stats.plays).toBe(2);
    // Exactly one artist carries the share, and it totals the whole.
    const total = stats.topArtists.reduce((sum, row) => sum + row.plays, 0);
    expect(total).toBe(2);
  });

  it('counts every credit for breadth, which may exceed the total on purpose', () => {
    const built = world();
    const plays = [ev(built.ids['split-1']!, NOW - DAY), ev(built.ids['split-2']!, NOW - HOUR)];
    const { stats } = statsFor(plays);

    const credited = stats.artistCredits.reduce((sum, row) => sum + row.plays, 0);
    expect(stats.artistCredits.length).toBe(2);
    expect(credited).toBe(4);
    expect(credited).toBeGreaterThan(stats.plays);
  });

  it('estimates time from track lengths and admits what it could not count', () => {
    const built = world();
    const plays = [
      ev(built.ids['solo-1']!, NOW - 2 * DAY, 3 * MINUTE),
      { ...ev(built.ids['solo-2']!, NOW - DAY), durationMs: undefined },
    ];
    const { stats } = statsFor(plays);
    expect(stats.estimatedMs).toBe(3 * MINUTE);
    expect(stats.playsWithoutDuration).toBe(1);
  });
});

describe('breadth against the local catalogue', () => {
  it('reports tracks heard over tracks known for a release', () => {
    const built = world();
    const index = new PlayIndex([
      ev(built.ids['solo-1']!, NOW - DAY),
      ev(built.ids['solo-1']!, NOW - HOUR),
      ev(built.ids['solo-2']!, NOW - 2 * HOUR),
    ]);
    const result = albumListening(index, catalogueFrom(built.graph), built.ids['solo']!, []);
    expect(result.plays).toBe(3);
    expect(result.breadth.heard).toBe(2);
    expect(result.breadth.known).toBe(3);
  });

  it('reports an artist against what the app knows locally, not a discography', () => {
    const built = world();
    const index = new PlayIndex([ev(built.ids['solo-1']!, NOW - DAY)]);
    const result = artistListening(index, catalogueFrom(built.graph), built.ids['ada']!, []);
    expect(result.plays).toBe(1);
    expect(result.trackBreadth.heard).toBe(1);
    expect(result.trackBreadth.known).toBeGreaterThanOrEqual(3);
    expect(result.releaseBreadth.heard).toBe(1);
  });

  it('is empty rather than wrong when nothing was heard', () => {
    const built = world();
    const result = albumListening(
      new PlayIndex([]),
      catalogueFrom(built.graph),
      built.ids['solo']!,
      [],
    );
    expect(result.plays).toBe(0);
    expect(result.breadth.heard).toBe(0);
    expect(result.lastAt).toBeNull();
  });
});

describe('repeats and discovery', () => {
  it('counts a repeat only for a play of something already heard in the range', () => {
    const built = world();
    const plays = [
      ev(built.ids['solo-1']!, NOW - 3 * DAY),
      ev(built.ids['solo-1']!, NOW - 2 * DAY),
      ev(built.ids['solo-2']!, NOW - DAY),
    ];
    const { stats } = statsFor(plays);
    expect(stats.repeatPlays).toBe(1);
    expect(stats.uniqueTracks).toBe(2);
  });

  it('calls something new only when its first observed play is inside the range', () => {
    const built = world();
    const plays = [
      ev(built.ids['solo-1']!, NOW - 300 * DAY),
      ev(built.ids['solo-1']!, NOW - 2 * DAY),
      ev(built.ids['solo-2']!, NOW - DAY),
    ];
    const built30 = computeListeningStats({
      index: new PlayIndex(plays),
      catalogue: catalogueFrom(built.graph),
      explicit: new Map<string, ExplicitRating>(),
      completions: [],
      range: '30d',
      now: NOW,
    });
    const names = built30.newToObservation.map((row) => row.entityId);
    expect(names).toContain(built.ids['solo-2']);
    expect(names).not.toContain(built.ids['solo-1']);
  });
});

describe('honesty of the vocabulary', () => {
  it('states shares with their own numerator and denominator', () => {
    expect(share(214, 1190)).toBe('18% — 214 of 1,190 observed plays');
  });

  it('leads breadth with a count, not a bare percentage', () => {
    expect(breadth(34, 52)).toBe('34 of 52 known tracks (65%)');
    expect(breadth(34, 52).startsWith('34')).toBe(true);
  });

  it('dates its own observation window', () => {
    expect(observedSince(T0)).toMatch(/^Based on listening observed by this app since /);
    expect(observedSince(null)).toBe('Based on listening observed by this app.');
  });

  it('says outright that no population percentile is available', () => {
    expect(NO_PERCENTILE).toMatch(/cannot and does not show a listener percentile/);
  });

  it('never produces a phrase that claims a standing among other listeners', () => {
    const banned = /top \d+%|percentile|better than \d+%|more than \d+% of listeners|top listener/i;
    const vocabulary = [
      share(214, 1190),
      share(0, 0),
      breadth(34, 52),
      breadth(0, 0),
      observedSince(T0),
      observedSince(null),
      NO_PERCENTILE,
      ...coverageNotes(emptyCoverage(), NOW).map((note) => note.text),
    ];
    for (const line of vocabulary) {
      // NO_PERCENTILE is allowed to name the thing it is refusing to show.
      if (line === NO_PERCENTILE) continue;
      expect(line).not.toMatch(banned);
    }
  });

  it('admits when nothing has been read yet', () => {
    const notes = coverageNotes(emptyCoverage(), NOW);
    expect(notes[0]?.text).toBe('Nothing has been read from Spotify yet.');
  });

  it('warns plainly about a gap rather than hiding it', () => {
    const notes = coverageNotes(
      {
        ...emptyCoverage(),
        lastFetchAt: NOW,
        gaps: [{ after: T0, before: T0 + 10 * DAY, detectedAt: NOW }],
      },
      NOW,
    );
    const warn = notes.find((note) => note.tone === 'warn');
    expect(warn?.text).toMatch(/never visible/);
  });
});
