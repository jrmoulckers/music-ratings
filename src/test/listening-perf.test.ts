import { describe, expect, it } from 'vitest';

import { ContainmentGraph } from '../lib/domain/graph';
import { entityId, membershipId } from '../lib/domain/ids';
import { PLAY_SCHEMA_VERSION, type PlayEvent } from '../lib/domain/listening';
import {
  PlayIndex,
  albumListening,
  artistListening,
  catalogueFrom,
  computeListeningStats,
} from '../lib/domain/listening-stats';
import { albumTrackSet, evaluateAlbumCompletion } from '../lib/domain/completion';
import type { Entity, Membership } from '../lib/domain/types';
import type { ExplicitRating } from '../lib/domain/ratings';
import { DAY, MINUTE, T0 } from './fixtures';

/**
 * The shape of the cost, at a volume nobody will reach quickly.
 *
 * A listening log only grows, so the thing worth proving is not that a hundred
 * thousand plays are fast in the abstract but that the two operations the
 * interface performs constantly — opening an entity page, and judging whether
 * an ingest just finished a record — do not grow with the size of the log.
 *
 * Budgets are deliberately loose. They exist to catch a change of complexity,
 * not to police a few milliseconds on a busy machine.
 */

const PLAYS = 100_000;
const ARTISTS = 200;
const ALBUMS_PER_ARTIST = 5;
const TRACKS_PER_ALBUM = 10;

interface Big {
  graph: ContainmentGraph;
  trackIds: string[];
  albumIds: string[];
  artistIds: string[];
}

function bigWorld(): Big {
  const entities: Entity[] = [];
  const memberships: Membership[] = [];
  const trackIds: string[] = [];
  const albumIds: string[] = [];
  const artistIds: string[] = [];

  const push = (type: 'artist' | 'album' | 'track', key: string, extra: Partial<Entity> = {}) => {
    const id = entityId(type, 'local', key);
    entities.push({
      id,
      type,
      provider: 'local',
      providerId: key,
      name: key,
      available: true,
      provenance: { provider: 'local', via: 'perf', fetchedAt: T0 },
      createdAt: T0,
      updatedAt: T0,
      ...extra,
    });
    return id;
  };

  const join = (
    parent: string,
    child: string,
    parentType: 'artist' | 'album',
    childType: 'album' | 'track',
    position?: number,
  ) => {
    memberships.push({
      id: membershipId(parent, child, position),
      parentId: parent,
      childId: child,
      parentType,
      childType,
      ...(position === undefined ? {} : { position }),
      updatedAt: T0,
    });
  };

  for (let a = 0; a < ARTISTS; a += 1) {
    const artist = push('artist', `ar${a}`);
    artistIds.push(artist);
    for (let b = 0; b < ALBUMS_PER_ARTIST; b += 1) {
      const album = push('album', `al${a}-${b}`, { totalChildren: TRACKS_PER_ALBUM });
      albumIds.push(album);
      join(artist, album, 'artist', 'album');
      for (let t = 0; t < TRACKS_PER_ALBUM; t += 1) {
        const track = push('track', `tr${a}-${b}-${t}`, {
          durationMs: 3 * MINUTE,
          trackNumber: t + 1,
        });
        trackIds.push(track);
        join(album, track, 'album', 'track', t + 1);
        join(artist, track, 'artist', 'track');
      }
    }
  }

  return { graph: new ContainmentGraph(entities, memberships), trackIds, albumIds, artistIds };
}

/** Deterministic pseudo-random, so a slow run is never a different workload. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function bigLog(world: Big, now: number): PlayEvent[] {
  const random = lcg(20_260_101);
  const plays: PlayEvent[] = new Array(PLAYS);
  for (let i = 0; i < PLAYS; i += 1) {
    const track = world.trackIds[Math.floor(random() * world.trackIds.length)]!;
    const at = now - Math.floor(random() * 1200 * DAY);
    plays[i] = {
      id: `ply:spotify:${i}:${at}`,
      entityId: track,
      entityType: 'track',
      at,
      durationMs: 3 * MINUTE,
      ingestedAt: at,
      source: 'spotify-recently-played',
      v: PLAY_SCHEMA_VERSION,
      updatedAt: at,
    };
  }
  plays.sort((a, b) => a.at - b.at);
  return plays;
}

function ms(work: () => void): number {
  const started = performance.now();
  work();
  return performance.now() - started;
}

describe(`listening at ${PLAYS.toLocaleString()} plays`, () => {
  const now = T0 + 1300 * DAY;
  const world = bigWorld();
  const plays = bigLog(world, now);
  const catalogue = catalogueFrom(world.graph);
  const explicit = new Map<string, ExplicitRating>();

  let index!: PlayIndex;

  it('builds the index in one pass', () => {
    const took = ms(() => {
      index = new PlayIndex(plays);
    });
    expect(index.length).toBe(PLAYS);
    // eslint-disable-next-line no-console
    console.log(`  index build (${PLAYS.toLocaleString()} plays): ${took.toFixed(1)}ms`);
    expect(took).toBeLessThan(3000);
  });

  it('answers an entity page without touching the log', () => {
    // Every album and artist in the catalogue, back to back. If this were a
    // sweep per entity it would be a thousand passes over a hundred thousand
    // rows; it is a lookup per track instead.
    const took = ms(() => {
      for (const albumId of world.albumIds) albumListening(index, catalogue, albumId, []);
      for (const artistId of world.artistIds) artistListening(index, catalogue, artistId, []);
    });
    const each = took / (world.albumIds.length + world.artistIds.length);
    // eslint-disable-next-line no-console
    console.log(
      `  entity pages (${world.albumIds.length} albums + ${world.artistIds.length} artists): ${took.toFixed(1)}ms total, ${each.toFixed(3)}ms each`,
    );
    expect(each).toBeLessThan(5);
  });

  it('computes the whole surface for every range', () => {
    for (const range of ['sitting', '7d', '30d', '6m', 'all'] as const) {
      let plays_ = 0;
      const took = ms(() => {
        const stats = computeListeningStats({
          index,
          catalogue,
          explicit,
          completions: [],
          range,
          now,
        });
        plays_ = stats.plays;
      });
      // eslint-disable-next-line no-console
      console.log(`  stats [${range}]: ${took.toFixed(1)}ms over ${plays_.toLocaleString()} plays`);
      expect(took).toBeLessThan(2000);
    }
  });

  it('narrows a range without scanning the plays before it', () => {
    // A short range must cost far less than the whole log, or the time filters
    // are decoration over a full sweep.
    const wide = ms(() =>
      computeListeningStats({ index, catalogue, explicit, completions: [], range: 'all', now }),
    );
    const narrow = ms(() =>
      computeListeningStats({ index, catalogue, explicit, completions: [], range: '7d', now }),
    );
    // eslint-disable-next-line no-console
    console.log(`  all: ${wide.toFixed(1)}ms vs 7d: ${narrow.toFixed(1)}ms`);
    expect(narrow).toBeLessThanOrEqual(wide + 5);
  });

  it('judges a completion against one album, not the whole history', () => {
    const albumId = world.albumIds[0]!;
    const tracks = albumTrackSet(world.graph, albumId);
    expect(tracks.confidence).toBe('complete');

    // The candidate window as ingestion builds it: this album's tracks only.
    const wanted = new Set(tracks.trackIds);
    const window = plays.filter((play) => wanted.has(play.entityId) && play.at > now - 60 * DAY);
    const closing = window[window.length - 1];

    const took = ms(() => {
      evaluateAlbumCompletion({
        tracks,
        plays: window,
        windowMs: 30 * DAY,
        newPlayIds: new Set(closing ? [closing.id] : []),
        existing: [],
        recompletion: 'fresh',
        now,
      });
    });
    // eslint-disable-next-line no-console
    console.log(`  completion check (${window.length} candidate plays): ${took.toFixed(2)}ms`);
    expect(took).toBeLessThan(50);
  });
});
