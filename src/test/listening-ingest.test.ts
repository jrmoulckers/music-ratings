import { beforeEach, describe, expect, it } from 'vitest';

import { ContainmentGraph } from '../lib/domain/graph';
import { entityId, membershipId } from '../lib/domain/ids';
import type { Entity, Membership } from '../lib/domain/types';
import { PLAY_SCHEMA_VERSION, playId, foldCoverage, emptyCoverage } from '../lib/domain/listening';
import { ingestPlayHistory, toPlayEvents } from '../lib/listening/ingest';
import type { PlayHistory } from '../lib/spotify/client';
import { clearStore } from '../lib/storage/db';
import {
  countPlays,
  listPlays,
  prunePlaysBefore,
  purgeListeningHistory,
} from '../lib/storage/repo';
import { DAY, T0 } from './fixtures';

/**
 * Ingestion is the only door between Spotify and the durable log, so this suite
 * is about the door: the same play arriving twice, from two devices, or after a
 * reload must never become two rows, and a window that came back full must be
 * admitted as a possible gap rather than passed off as a complete record.
 */

/**
 * A Spotify-provider album whose track ids are exactly the ones the fake
 * recently-played window will carry, so the graph the engine consults is the
 * graph ingestion would actually have resolved against.
 */
function spotifyAlbum(
  name: string,
  count: number,
  albumOverrides: Partial<Entity> = {},
): { graph: ContainmentGraph; trackIds: string[] } {
  const base = (type: 'album' | 'track', providerId: string, extra: Partial<Entity>): Entity => ({
    id: entityId(type, 'spotify', providerId),
    type,
    provider: 'spotify',
    providerId,
    name: providerId,
    available: true,
    provenance: { provider: 'spotify', via: 'test', fetchedAt: T0 },
    createdAt: T0,
    updatedAt: T0,
    ...extra,
  });

  const album = base('album', name, { totalChildren: count, ...albumOverrides });
  const tracks = Array.from({ length: count }, (_, i) =>
    base('track', `${name}-${i + 1}`, { trackNumber: i + 1, durationMs: 200_000 }),
  );
  const memberships: Membership[] = tracks.map((track, i) => ({
    id: membershipId(album.id, track.id, i + 1),
    parentId: album.id,
    childId: track.id,
    parentType: 'album',
    childType: 'track',
    position: i + 1,
    updatedAt: T0,
  }));

  return {
    graph: new ContainmentGraph([album, ...tracks], memberships),
    trackIds: tracks.map((track) => track.providerId),
  };
}

function history(trackId: string, playedAt: number, durationMs = 200_000): PlayHistory {
  return {
    track: {
      id: trackId,
      name: trackId,
      duration_ms: durationMs,
      artists: [{ id: 'ar1', name: 'An Artist' }],
    },
    played_at: new Date(playedAt).toISOString(),
  } as PlayHistory;
}

beforeEach(async () => {
  await clearStore('plays');
  await clearStore('completions');
});

describe('play identity', () => {
  it('derives the same id for the same play every time', () => {
    expect(playId('spotify', 't1', 1_700_000_000_000)).toBe('ply:spotify:t1:1700000000000');
    expect(playId('spotify', 't1', 1_700_000_000_000)).toBe(
      playId('spotify', 't1', 1_700_000_000_000),
    );
  });

  it('separates two plays of the same track at different times', () => {
    expect(playId('spotify', 't1', 1)).not.toBe(playId('spotify', 't1', 2));
  });

  it('maps a Spotify window to events and stamps the schema version', () => {
    const { plays, unusable } = toPlayEvents([history('t1', T0)], T0);
    expect(unusable).toBe(0);
    expect(plays).toHaveLength(1);
    expect(plays[0]?.v).toBe(PLAY_SCHEMA_VERSION);
    expect(plays[0]?.source).toBe('spotify-recently-played');
    expect(plays[0]?.durationMs).toBe(200_000);
  });

  it('drops rows with no track id or no readable timestamp', () => {
    const broken = [
      { track: { name: 'local file' }, played_at: new Date(T0).toISOString() },
      { track: { id: 't2', name: 't2' }, played_at: 'not a date' },
    ] as unknown as PlayHistory[];
    const { plays, unusable } = toPlayEvents(broken, T0);
    expect(plays).toHaveLength(0);
    expect(unusable).toBe(2);
  });
});

describe('deduplication', () => {
  it('ingests a window once however many times it is offered', async () => {
    const { graph } = spotifyAlbum('dedupe', 3);
    const window = [history('dedupe-1', T0), history('dedupe-2', T0 + 60_000)];

    const first = await ingestPlayHistory({ items: window, graph, now: T0 + 120_000 });
    const second = await ingestPlayHistory({ items: window, graph, now: T0 + 180_000 });

    expect(first.inserted).toBe(2);
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(2);
    expect(await countPlays()).toBe(2);
  });

  it('merges an overlapping window from another device without double counting', async () => {
    const { graph } = spotifyAlbum('overlap', 4);

    await ingestPlayHistory({
      items: [history('overlap-1', T0), history('overlap-2', T0 + 60_000)],
      graph,
      now: T0 + 90_000,
    });
    // The other device saw the same two plays plus one more.
    await ingestPlayHistory({
      items: [
        history('overlap-2', T0 + 60_000),
        history('overlap-1', T0),
        history('overlap-3', T0 + 120_000),
      ],
      graph,
      now: T0 + 150_000,
    });

    expect(await countPlays()).toBe(3);
  });
});

describe('coverage and the fifty-play window', () => {
  it('flags a saturated read', async () => {
    const { graph } = spotifyAlbum('sat', 2);
    const items = Array.from({ length: 50 }, (_, i) => history('sat-1', T0 + i * 60_000));

    const result = await ingestPlayHistory({ items, graph, now: T0 + 60 * 60_000 });
    expect(result.windowSaturated).toBe(true);
  });

  it('records a gap when a full window starts after the newest play already seen', () => {
    const before = foldCoverage(emptyCoverage(), {
      at: T0,
      received: 5,
      inserted: 5,
      oldestAt: T0 - 5 * 60_000,
      newestAt: T0,
    });
    // Next read is full and its oldest play is newer than anything seen, so
    // listening happened in between that was never visible.
    const after = foldCoverage(before, {
      at: T0 + 10 * DAY,
      received: 50,
      inserted: 50,
      oldestAt: T0 + 9 * DAY,
      newestAt: T0 + 10 * DAY,
    });
    expect(after.gaps.length).toBe(1);
    expect(after.gaps[0]?.after).toBe(T0);
    expect(after.gaps[0]?.before).toBe(T0 + 9 * DAY);
  });

  it('does not invent a gap when reads overlap', () => {
    const before = foldCoverage(emptyCoverage(), {
      at: T0,
      received: 50,
      inserted: 50,
      oldestAt: T0 - 50 * 60_000,
      newestAt: T0,
    });
    const after = foldCoverage(before, {
      at: T0 + 60_000,
      received: 50,
      inserted: 1,
      oldestAt: T0 - 49 * 60_000,
      newestAt: T0 + 60_000,
    });
    expect(after.gaps).toHaveLength(0);
  });

  it('never claims coverage before the first play observed', () => {
    const coverage = foldCoverage(emptyCoverage(), {
      at: T0,
      received: 3,
      inserted: 3,
      oldestAt: T0 - 3 * DAY,
      newestAt: T0,
    });
    expect(coverage.newestSeenAt).toBe(T0);
    expect(coverage.firstFetchAt).toBe(T0);
    expect(coverage.lastFetchCount).toBe(3);
    expect(coverage.gaps).toHaveLength(0);
  });
});

describe('retention and deletion', () => {
  it('refuses to store plays already past the retention floor', async () => {
    const { graph } = spotifyAlbum('retain', 2);
    const now = T0 + 400 * DAY;

    const result = await ingestPlayHistory({
      items: [history('retain-1', T0), history('retain-2', now - DAY)],
      graph,
      now,
      retentionDays: 365,
    });

    expect(result.inserted).toBe(1);
    expect((await listPlays())[0]?.entityId).toContain('retain-2');
  });

  it('prunes stored plays that have aged past the floor', async () => {
    const { graph } = spotifyAlbum('prune', 2);
    await ingestPlayHistory({
      items: [history('prune-1', T0), history('prune-2', T0 + 100 * DAY)],
      graph,
      now: T0 + 100 * DAY,
    });

    const pruned = await prunePlaysBefore(T0 + 50 * DAY);
    expect(pruned).toBe(1);
    expect(await countPlays()).toBe(1);
  });

  it('tombstones rather than dropping, so a stale device cannot resurrect them', async () => {
    const { graph } = spotifyAlbum('tomb', 2);
    await ingestPlayHistory({
      items: [history('tomb-1', T0), history('tomb-2', T0 + 60_000)],
      graph,
      now: T0 + 90_000,
    });

    const removed = await purgeListeningHistory();
    expect(removed.plays).toBe(2);
    expect(await countPlays()).toBe(0);

    // Re-offering the very same window must not bring them back.
    const again = await ingestPlayHistory({
      items: [history('tomb-1', T0), history('tomb-2', T0 + 60_000)],
      graph,
      now: T0 + 120_000,
    });
    expect(again.inserted).toBe(0);
    expect(await countPlays()).toBe(0);
  });
});

describe('completion through the ingest door', () => {
  it('records the completion only on the pass that supplies the final track', async () => {
    const { graph } = spotifyAlbum('door', 3);

    const first = await ingestPlayHistory({
      items: [history('door-1', T0), history('door-2', T0 + 60_000)],
      graph,
      now: T0 + 90_000,
    });
    expect(first.completions).toHaveLength(0);

    const second = await ingestPlayHistory({
      items: [history('door-3', T0 + 120_000)],
      graph,
      now: T0 + 150_000,
    });
    expect(second.completions).toHaveLength(1);
    expect(second.completions[0]?.trackCount).toBe(3);

    // Offering the same window again must not produce a second moment.
    const third = await ingestPlayHistory({
      items: [history('door-3', T0 + 120_000)],
      graph,
      now: T0 + 180_000,
    });
    expect(third.completions).toHaveLength(0);
  });

  it('does not complete a record whose track list is not fully known', async () => {
    const { graph } = spotifyAlbum('partial', 3, { totalChildren: 8 });

    const result = await ingestPlayHistory({
      items: [
        history('partial-1', T0),
        history('partial-2', T0 + 60_000),
        history('partial-3', T0 + 120_000),
      ],
      graph,
      now: T0 + 150_000,
    });
    expect(result.completions).toHaveLength(0);
  });
});
