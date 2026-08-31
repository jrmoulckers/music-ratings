import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

import {
  albumProgress,
  albumRows,
  albumSession,
  clearAlbumSession,
  endAlbumSession,
  noteListened,
  startAlbumSession,
  stillOnAlbum,
} from './album';
import type { Entity, EntityId } from '../domain/types';
import type { PlaybackSnapshot } from './types';

/**
 * Listening to a record and rating as it goes.
 *
 * The two things that must never blur: what playback says is happening now, and
 * what this sitting has actually put past your ears. They differ every time
 * somebody starts mid-record or shuffles, and the summary at the end depends on
 * the second one.
 */

function track(n: number): Entity {
  return {
    id: `track:spotify:t${n}` as EntityId,
    type: 'track',
    provider: 'spotify',
    providerId: `t${n}`,
    name: `Track ${n}`,
    trackNumber: n,
    updatedAt: 1,
  } as Entity;
}

const tracks = [track(1), track(2), track(3), track(4)];

function snapshot(over: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
    item: null,
    context: null,
    device: null,
    playing: true,
    progressMs: 0,
    durationMs: 0,
    shuffle: false,
    repeat: 'off',
    disallows: {},
    at: 1,
    ...over,
  };
}

beforeEach(() => clearAlbumSession());

describe('albumRows', () => {
  it('marks what has passed, what is playing and what is still to come', () => {
    const rows = albumRows({
      tracks,
      currentUri: 'spotify:track:t3',
      listened: new Set(),
      rated: new Set(),
    });
    expect(rows.map((r) => r.state)).toEqual(['played', 'played', 'current', 'upcoming']);
  });

  it('treats the whole record as still to come when nothing from it is playing', () => {
    const rows = albumRows({ tracks, currentUri: null, listened: new Set(), rated: new Set() });
    expect(rows.every((r) => r.state === 'upcoming')).toBe(true);
  });

  it('keeps "heard this sitting" separate from playing position', () => {
    const rows = albumRows({
      tracks,
      currentUri: 'spotify:track:t1',
      listened: new Set(['track:spotify:t4' as EntityId]),
      rated: new Set(['track:spotify:t2' as EntityId]),
    });
    expect(rows[3]).toMatchObject({ state: 'upcoming', listened: true, rated: false });
    expect(rows[1]).toMatchObject({ state: 'upcoming', listened: false, rated: true });
  });

  it('numbers rows from the sleeve, falling back to list order', () => {
    const unnumbered = [{ ...track(1), trackNumber: undefined } as Entity];
    expect(
      albumRows({ tracks: unnumbered, currentUri: null, listened: new Set(), rated: new Set() })[0]
        ?.position,
    ).toBe(1);
  });
});

describe('albumProgress', () => {
  it('counts the record and singles out what you heard but did not rate', () => {
    const rows = albumRows({
      tracks,
      currentUri: 'spotify:track:t3',
      listened: new Set(['track:spotify:t1', 'track:spotify:t2'] as EntityId[]),
      rated: new Set(['track:spotify:t1'] as EntityId[]),
    });
    const progress = albumProgress(rows);
    expect(progress).toMatchObject({ total: 4, rated: 1, listened: 2 });
    expect(progress.unratedListened.map((r) => r.entity.id)).toEqual(['track:spotify:t2']);
  });
});

describe('the sitting', () => {
  it('starts, remembers what was heard, and does not repeat itself', () => {
    startAlbumSession('album:spotify:al1' as EntityId, 'spotify:album:al1');
    noteListened('track:spotify:t1' as EntityId);
    noteListened('track:spotify:t1' as EntityId);
    expect(get(albumSession).listened).toEqual(['track:spotify:t1']);
  });

  it('does not restart when the same record is already running', () => {
    startAlbumSession('album:spotify:al1' as EntityId, 'spotify:album:al1');
    noteListened('track:spotify:t1' as EntityId);
    startAlbumSession('album:spotify:al1' as EntityId, 'spotify:album:al1');
    expect(get(albumSession).listened).toEqual(['track:spotify:t1']);
  });

  it('starts fresh for a different record', () => {
    startAlbumSession('album:spotify:al1' as EntityId, 'spotify:album:al1');
    noteListened('track:spotify:t1' as EntityId);
    startAlbumSession('album:spotify:al2' as EntityId, 'spotify:album:al2');
    expect(get(albumSession)).toMatchObject({ albumId: 'album:spotify:al2', listened: [] });
  });

  it('remembers nothing when no sitting is running', () => {
    noteListened('track:spotify:t1' as EntityId);
    expect(get(albumSession).listened).toEqual([]);
  });

  it('ends once, so the summary is offered once', () => {
    startAlbumSession('album:spotify:al1' as EntityId, 'spotify:album:al1');
    endAlbumSession();
    const first = get(albumSession).endedAt;
    endAlbumSession();
    expect(get(albumSession).endedAt).toBe(first);
  });
});

describe('stillOnAlbum', () => {
  const session = {
    albumId: 'album:spotify:al1' as EntityId,
    contextUri: 'spotify:album:al1',
    startedAt: 0,
    listened: [],
    endedAt: null,
  };

  it('follows the playback context', () => {
    expect(
      stillOnAlbum(
        session,
        snapshot({ context: { kind: 'album', uri: 'spotify:album:al1', id: 'al1' } }),
      ),
    ).toBe(true);
  });

  it('also counts a track from the record played from somewhere else', () => {
    expect(
      stillOnAlbum(
        session,
        snapshot({
          context: { kind: 'playlist', uri: 'spotify:playlist:p1', id: 'p1' },
          item: {
            id: 't1',
            uri: 'spotify:track:t1',
            kind: 'track',
            name: 'Track 1',
            artists: [],
            release: { id: 'al1', uri: 'spotify:album:al1', name: 'A record' },
            durationMs: 1,
            isLocal: false,
            playable: true,
          },
        }),
      ),
    ).toBe(true);
  });

  it('is false once playback moves to another record entirely', () => {
    expect(
      stillOnAlbum(
        session,
        snapshot({ context: { kind: 'album', uri: 'spotify:album:al9', id: 'al9' } }),
      ),
    ).toBe(false);
  });

  it('is false with no sitting and with nothing playing', () => {
    expect(stillOnAlbum({ ...session, albumId: null }, snapshot())).toBe(false);
    expect(stillOnAlbum(session, null)).toBe(false);
  });
});
