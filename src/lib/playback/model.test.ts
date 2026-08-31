import { describe, expect, it } from 'vitest';

import {
  allows,
  contextFromUri,
  freshness,
  isFresher,
  parseUri,
  pollEvery,
  progressAt,
  progressFraction,
  refusalReason,
  sameItem,
} from './model';
import type { PlaybackSnapshot, PlayingItem } from './types';

/**
 * The arithmetic behind the transport.
 *
 * Every one of these answers a question the screen asks several times a second,
 * so a wrong answer is a needle that jumps, a button that lies, or a poll loop
 * that burns somebody's rate limit in a tab they cannot see.
 */

function item(over: Partial<PlayingItem> = {}): PlayingItem {
  return {
    id: 't1',
    uri: 'spotify:track:t1',
    kind: 'track',
    name: 'A track',
    artists: [{ id: 'a1', name: 'Someone' }],
    release: null,
    durationMs: 200_000,
    isLocal: false,
    playable: true,
    ...over,
  };
}

function snapshot(over: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
    item: item(),
    context: null,
    device: null,
    playing: true,
    progressMs: 10_000,
    durationMs: 200_000,
    shuffle: false,
    repeat: 'off',
    disallows: {},
    at: 1_000_000,
    ...over,
  };
}

describe('parseUri', () => {
  it('reads the kind and id from a Spotify URI', () => {
    expect(parseUri('spotify:album:abc')).toEqual({ kind: 'album', id: 'abc' });
    expect(parseUri('spotify:track:xyz')).toEqual({ kind: 'track', id: 'xyz' });
  });

  it('handles the old user-scoped playlist form Spotify still emits', () => {
    expect(parseUri('spotify:user:jane:playlist:p1')).toEqual({ kind: 'playlist', id: 'p1' });
  });

  it('refuses anything that is not a Spotify URI', () => {
    expect(parseUri('https://example.com')).toEqual({ kind: 'other', id: null });
    expect(parseUri(null)).toEqual({ kind: 'other', id: null });
    expect(parseUri('spotify:track')).toEqual({ kind: 'other', id: null });
  });
});

describe('contextFromUri', () => {
  it('names the containers it knows', () => {
    expect(contextFromUri('spotify:album:a1')).toEqual({
      kind: 'album',
      uri: 'spotify:album:a1',
      id: 'a1',
    });
    expect(contextFromUri('spotify:artist:x')?.kind).toBe('artist');
    expect(contextFromUri('spotify:collection')?.kind).toBe('other');
  });

  it('calls an unknown container "other" rather than guessing', () => {
    expect(contextFromUri('spotify:mystery:m1')?.kind).toBe('other');
  });

  it('is null when nothing is playing from anywhere', () => {
    expect(contextFromUri(null)).toBeNull();
  });
});

describe('progressAt', () => {
  it('counts forward from the moment the reading was taken', () => {
    expect(progressAt(snapshot(), 1_003_000)).toBe(13_000);
  });

  it('stands still while paused, however long ago the reading was', () => {
    expect(progressAt(snapshot({ playing: false }), 1_060_000)).toBe(10_000);
  });

  it('never runs past the end of the track while waiting for the next poll', () => {
    expect(progressAt(snapshot(), 1_000_000 + 500_000)).toBe(200_000);
  });

  it('is zero when nothing is playing', () => {
    expect(progressAt(null, Date.now())).toBe(0);
  });

  it('gives a fraction, and never NaN for a zero-length item', () => {
    expect(progressFraction(snapshot({ durationMs: 100_000, progressMs: 25_000 }), 1_000_000)).toBe(
      0.25,
    );
    expect(progressFraction(snapshot({ durationMs: 0 }), 1_000_000)).toBe(0);
  });
});

describe('pollEvery', () => {
  it('asks often while playing and visible', () => {
    expect(
      pollEvery({ playing: true, visible: true, online: true, preference: 'responsive' }),
    ).toBe(4_000);
  });

  it('backs off while paused', () => {
    expect(
      pollEvery({ playing: false, visible: true, online: true, preference: 'responsive' }),
    ).toBe(15_000);
  });

  it('honours the relaxed preference', () => {
    expect(pollEvery({ playing: true, visible: true, online: true, preference: 'relaxed' })).toBe(
      10_000,
    );
    expect(pollEvery({ playing: false, visible: true, online: true, preference: 'relaxed' })).toBe(
      45_000,
    );
  });

  it('stops entirely for a hidden tab, an offline device, or a manual preference', () => {
    expect(
      pollEvery({ playing: true, visible: false, online: true, preference: 'responsive' }),
    ).toBeNull();
    expect(
      pollEvery({ playing: true, visible: true, online: false, preference: 'responsive' }),
    ).toBeNull();
    expect(
      pollEvery({ playing: true, visible: true, online: true, preference: 'manual' }),
    ).toBeNull();
  });
});

describe('allows', () => {
  it('treats an absent key as permitted', () => {
    expect(allows(snapshot(), 'next')).toBe(true);
    expect(allows(snapshot(), 'seek')).toBe(true);
  });

  it('reads Spotify’s refusals for the current device and content', () => {
    const refused = snapshot({ disallows: { skippingPrevious: true, seeking: true } });
    expect(allows(refused, 'previous')).toBe(false);
    expect(allows(refused, 'seek')).toBe(false);
    expect(allows(refused, 'next')).toBe(true);
  });

  it('permits nothing when nothing is playing', () => {
    expect(allows(null, 'next')).toBe(false);
  });

  it('has a reason a listener can act on for every action', () => {
    for (const action of [
      'pause',
      'resume',
      'seek',
      'next',
      'previous',
      'shuffle',
      'repeat',
      'transfer',
    ] as const) {
      expect(refusalReason(action).length).toBeGreaterThan(0);
    }
  });
});

describe('sameItem', () => {
  it('compares by URI', () => {
    expect(sameItem(item(), item())).toBe(true);
    expect(sameItem(item(), item({ uri: 'spotify:track:t2' }))).toBe(false);
  });

  it('falls back to name and length for local files with no URI', () => {
    const local = item({ uri: null, id: null, isLocal: true });
    expect(sameItem(local, { ...local })).toBe(true);
    expect(sameItem(local, { ...local, durationMs: 1 })).toBe(false);
  });

  it('treats nothing playing as itself, and as different from something', () => {
    expect(sameItem(null, null)).toBe(true);
    expect(sameItem(null, item())).toBe(false);
  });
});

describe('isFresher', () => {
  it('adopts the first reading', () => {
    expect(isFresher(snapshot(), null)).toBe(true);
  });

  it('rejects an answer that arrived out of order', () => {
    const current = snapshot({ at: 2_000 });
    expect(isFresher(snapshot({ at: 1_000 }), current)).toBe(false);
    expect(isFresher(snapshot({ at: 3_000 }), current)).toBe(true);
  });
});

describe('freshness', () => {
  it('says so plainly when nothing has been read yet', () => {
    expect(freshness(null, 1_000)).toBe('not checked yet');
  });

  it('phrases the age in words', () => {
    const now = 10_000_000;
    expect(freshness(now - 5_000, now)).toBe('just now');
    expect(freshness(now - 40_000, now)).toBe('less than a minute ago');
    expect(freshness(now - 120_000, now)).toBe('2 minutes ago');
    expect(freshness(now - 7_200_000, now)).toBe('2 hours ago');
  });

  it('never reports a negative age from a clock that jumped', () => {
    expect(freshness(2_000, 1_000)).toBe('just now');
  });
});
