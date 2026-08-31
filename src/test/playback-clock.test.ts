import { get, writable } from 'svelte/store';
import { describe, expect, it } from 'vitest';

import { createProgressClock, SNAP_MS } from '../lib/playback/clock';
import type { PlaybackSnapshot, PlaybackState, PlayingItem } from '../lib/playback/types';

/**
 * The needle's own clock.
 *
 * Everything here is about the gap between two authoritative answers. The
 * position has to move continuously through that gap without asking Spotify
 * anything, stop entirely when nobody can see it, and know the difference
 * between a reading that drifted by a few frames and a record that changed.
 */

function item(over: Partial<PlayingItem> = {}): PlayingItem {
  return {
    id: 't1',
    uri: 'spotify:track:t1',
    kind: 'track',
    name: 'Cold Sweat',
    artists: [{ id: 'a1', name: 'James Brown' }],
    release: null,
    durationMs: 180_000,
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
    durationMs: 180_000,
    at: 1_000_000,
    shuffle: false,
    repeat: 'off',
    disallows: {},
    ...over,
  };
}

function state(snap: PlaybackSnapshot | null): PlaybackState {
  return {
    source: 'spotify',
    status: snap ? 'active' : 'idle',
    snapshot: snap,
    devices: [],
    queue: [],
    pending: null,
    error: null,
    fetchedAt: 1_000_000,
    watching: true,
  };
}

/** A hand-cranked frame loop, so a test can decide when time passes. */
function rig(options: { visible?: boolean; online?: boolean; smooth?: boolean } = {}) {
  const source = writable(state(snapshot()));
  let clock = 1_000_000;
  let visible = options.visible ?? true;
  let online = options.online ?? true;
  const frames: Array<() => void> = [];
  let cancelled = 0;
  let listeners: Array<() => void> = [];

  const progress = createProgressClock(source, {
    now: () => clock,
    raf: (cb) => {
      frames.push(cb);
      return frames.length;
    },
    cancel: () => {
      cancelled += 1;
    },
    visible: () => visible,
    online: () => online,
    smooth: () => options.smooth ?? true,
    listen: (onChange) => {
      listeners.push(onChange);
      return () => {
        listeners = listeners.filter((l) => l !== onChange);
      };
    },
  });

  return {
    source,
    progress,
    get pending() {
      return frames.length;
    },
    get cancelled() {
      return cancelled;
    },
    get listening() {
      return listeners.length;
    },
    /** Advance the wall clock and run one frame, the way a browser would. */
    frame(ms = 16) {
      clock += ms;
      const next = frames.shift();
      if (!next) return false;
      next();
      return true;
    },
    advance(ms: number) {
      clock += ms;
    },
    setVisible(value: boolean) {
      visible = value;
      for (const l of [...listeners]) l();
    },
    setOnline(value: boolean) {
      online = value;
      for (const l of [...listeners]) l();
    },
  };
}

describe('the progress clock', () => {
  it('does nothing at all until somebody is watching', () => {
    const r = rig();
    expect(r.pending).toBe(0);
    expect(r.listening).toBe(0);
  });

  it('moves continuously between authoritative reads', () => {
    const r = rig();
    const seen: number[] = [];
    const stop = r.progress.subscribe((v) => seen.push(v));

    for (let i = 0; i < 30; i += 1) r.frame(16);
    stop();

    // Thirty frames of a fifth of a second: many distinct positions, not two.
    const distinct = new Set(seen.map((v) => Math.round(v)));
    expect(distinct.size).toBeGreaterThan(20);
    // And every one of them further along than the last.
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
  });

  it('reads the position it was given, and asks the transport for nothing', () => {
    const r = rig();
    let reads = 0;
    const counted = {
      subscribe: (run: (v: PlaybackState) => void) => {
        reads += 1;
        return r.source.subscribe(run);
      },
    };
    const clock = createProgressClock(counted, {
      now: () => 1_000_000,
      raf: () => 1,
      cancel: () => {},
      listen: () => () => {},
    });
    const stop = clock.subscribe(() => {});
    expect(get(clock)).toBe(10_000);
    expect(reads).toBe(1);
    stop();
  });

  it('stops the loop the moment the music pauses', () => {
    const r = rig();
    const stop = r.progress.subscribe(() => {});
    r.frame(16);
    expect(r.pending).toBe(1);

    r.source.set(state(snapshot({ playing: false, progressMs: 42_000 })));
    expect(get(r.progress)).toBe(42_000);
    r.frame(16);
    // The queued frame ran, saw a paused record, and did not queue another.
    expect(r.pending).toBe(0);
    stop();
  });

  it('stops while hidden and picks up again on return', () => {
    const r = rig();
    const stop = r.progress.subscribe(() => {});
    r.frame(16);

    // Suspending settles honestly on the last real position, then goes quiet.
    r.setVisible(false);
    r.frame(16);
    const parked = get(r.progress);
    expect(r.pending).toBe(0);

    // Half a minute of a background tab costs nothing and reads nothing.
    r.advance(30_000);
    expect(get(r.progress)).toBe(parked);

    r.setVisible(true);
    expect(r.pending).toBe(1);
    r.frame(16);
    // Back in the room, and honest about where the music actually got to.
    expect(get(r.progress)).toBeGreaterThan(parked + 29_000);
    stop();
  });

  it('stops when the connection goes and resumes when it returns', () => {
    const r = rig();
    const stop = r.progress.subscribe(() => {});
    r.frame(16);

    r.setOnline(false);
    r.frame(16);
    expect(r.pending).toBe(0);

    r.setOnline(true);
    expect(r.pending).toBe(1);
    stop();
  });

  it('lets go of everything on the last unsubscribe', () => {
    const r = rig();
    const stop = r.progress.subscribe(() => {});
    r.frame(16);
    expect(r.listening).toBe(1);
    stop();
    expect(r.listening).toBe(0);
    expect(r.cancelled).toBeGreaterThan(0);
  });

  it('absorbs a small backwards correction instead of jerking', () => {
    const r = rig();
    const stop = r.progress.subscribe(() => {});
    for (let i = 0; i < 10; i += 1) r.frame(100);
    const before = get(r.progress);

    // A poll comes back a little behind where the local count had reached.
    r.source.set(state(snapshot({ progressMs: before - 600, at: 1_001_000 })));
    r.frame(0);
    const after = get(r.progress);

    expect(after).toBeLessThan(before);
    // Eased, not snapped: nowhere near the full 600ms in one frame.
    expect(before - after).toBeLessThan(300);
    stop();
  });

  it('takes a real seek immediately rather than gliding to it', () => {
    const r = rig();
    const stop = r.progress.subscribe(() => {});
    r.frame(16);

    r.source.set(state(snapshot({ progressMs: 120_000, at: 1_000_016 })));
    r.frame(0);
    expect(get(r.progress)).toBeGreaterThan(120_000 - SNAP_MS);
    expect(get(r.progress)).toBeLessThan(120_000 + 100);
    stop();
  });

  it('starts from scratch when the record changes', () => {
    const r = rig();
    const stop = r.progress.subscribe(() => {});
    for (let i = 0; i < 20; i += 1) r.frame(100);
    expect(get(r.progress)).toBeGreaterThan(11_000);

    r.source.set(
      state(
        snapshot({
          item: item({ id: 't2', uri: 'spotify:track:t2', name: 'Super Bad' }),
          progressMs: 0,
          at: 1_002_000,
        }),
      ),
    );
    expect(get(r.progress)).toBe(0);
    stop();
  });

  it('never shows a position beyond the end of the track', () => {
    const r = rig();
    const stop = r.progress.subscribe(() => {});
    r.source.set(state(snapshot({ progressMs: 179_000, at: 1_000_000 })));
    for (let i = 0; i < 40; i += 1) r.frame(200);
    expect(get(r.progress)).toBe(180_000);
    stop();
  });

  it('corrects at once when the reader asked for less motion', () => {
    const r = rig({ smooth: false });
    const stop = r.progress.subscribe(() => {});
    for (let i = 0; i < 5; i += 1) r.frame(100);
    const before = get(r.progress);

    r.source.set(state(snapshot({ progressMs: before - 500, at: 1_000_500 })));
    r.frame(0);
    expect(get(r.progress)).toBeCloseTo(before - 500, 0);
    stop();
  });

  it('sits still at zero when there is nothing playing at all', () => {
    const r = rig();
    r.source.set(state(null));
    const stop = r.progress.subscribe(() => {});
    expect(get(r.progress)).toBe(0);
    expect(r.pending).toBe(0);
    stop();
  });
});
