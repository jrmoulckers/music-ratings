import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

import {
  albumProgress,
  albumRows,
  albumSession,
  albumTrackStatus,
  clearAlbumSession,
  endAlbumSession,
  noteListened,
  startAlbumSession,
  stillOnAlbum,
  type AlbumTrackRow,
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
  it('marks what came before, what is playing and what is still to come', () => {
    const rows = albumRows({
      tracks,
      currentUri: 'spotify:track:t3',
      listened: new Set(),
      rated: new Set(),
    });
    expect(rows.map((r) => r.state)).toEqual(['earlier', 'earlier', 'current', 'upcoming']);
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

/**
 * What each row is called, and what it is not allowed to claim.
 *
 * The word "passed" made a status look like something you had done. Worse, it
 * was applied to tracks that were merely above the needle — start a record at
 * track six and the first five were reported as if you had skipped them. Three
 * separate claims are kept apart here, and only Spotify's own record settles a
 * play.
 */
describe('albumTrackStatus', () => {
  const row = (over: Partial<AlbumTrackRow> = {}): AlbumTrackRow => ({
    entity: track(1),
    position: 1,
    state: 'upcoming',
    listened: false,
    confirmed: false,
    rated: false,
    ...over,
  });

  it('calls the current track now playing, whatever else is true of it', () => {
    expect(albumTrackStatus(row({ state: 'current', confirmed: true })).text).toBe('Now playing');
  });

  it('claims a play only when Spotify has confirmed one', () => {
    expect(albumTrackStatus(row({ state: 'earlier', confirmed: true })).text).toBe(
      'Played this session',
    );
  });

  it('says a locally observed play is still waiting on Spotify', () => {
    const status = albumTrackStatus(row({ state: 'earlier', listened: true }));
    expect(status.text).toBe('Awaiting Spotify');
    expect(status.spoken).toMatch(/not confirmed it yet/);
  });

  it('never lets position alone claim a play', () => {
    expect(albumTrackStatus(row({ state: 'earlier' })).text).toBe('Earlier track');
  });

  it('does not describe an earlier track as something you did', () => {
    for (const state of ['earlier', 'upcoming'] as const) {
      expect(albumTrackStatus(row({ state })).text.toLowerCase()).not.toMatch(/passed|skipped/);
    }
  });

  it('calls later tracks up next', () => {
    expect(albumTrackStatus(row({ state: 'upcoming' })).text).toBe('Up next');
  });

  it('reads as a status rather than a control, in sentence case', () => {
    const all = [
      row({ state: 'current' }),
      row({ confirmed: true }),
      row({ listened: true }),
      row({ state: 'earlier' }),
      row(),
    ].map((r) => albumTrackStatus(r).text);
    for (const text of all) {
      expect(text).toBe(text[0]?.toUpperCase() + text.slice(1));
      expect(text).not.toBe(text.toUpperCase());
    }
  });

  it('gives every status something a screen reader can say', () => {
    for (const r of [row({ state: 'current' }), row({ confirmed: true }), row()]) {
      expect(albumTrackStatus(r).spoken.length).toBeGreaterThan(0);
    }
  });

  it('starting a record at track six does not report the first five as played', () => {
    const six = Array.from({ length: 8 }, (_, i) => track(i + 1));
    const rows = albumRows({
      tracks: six,
      currentUri: 'spotify:track:t6',
      listened: new Set(),
      rated: new Set(),
    });

    expect(rows.slice(0, 5).map((r) => albumTrackStatus(r).text)).toEqual([
      'Earlier track',
      'Earlier track',
      'Earlier track',
      'Earlier track',
      'Earlier track',
    ]);
    expect(albumTrackStatus(rows[5]!).text).toBe('Now playing');
    expect(rows.slice(6).map((r) => albumTrackStatus(r).text)).toEqual(['Up next', 'Up next']);
  });

  it('follows a jump backwards without inventing plays', () => {
    const rows = albumRows({
      tracks,
      currentUri: 'spotify:track:t2',
      listened: new Set(['track:spotify:t4' as EntityId]),
      confirmed: new Set(['track:spotify:t4' as EntityId]),
      rated: new Set(),
    });

    expect(rows.map((r) => albumTrackStatus(r).text)).toEqual([
      'Earlier track',
      'Now playing',
      'Up next',
      'Played this session',
    ]);
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
