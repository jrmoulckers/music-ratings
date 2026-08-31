import { readable } from 'svelte/store';
import type { Readable } from 'svelte/store';

import { progressAt } from './model';
import type { PlaybackSnapshot, PlaybackState } from './types';

/**
 * The needle, moving.
 *
 * Spotify is asked where the record is every few seconds; anything more often
 * is rude to the API and pointless to the eye. Between those answers the
 * position is counted forward here, on the display's own clock, so the scrubber
 * moves the way a needle moves rather than lurching once per tick.
 *
 * Two things keep that honest. It runs only while something is actually playing
 * where someone can actually see it — paused, hidden, offline or unwatched, the
 * loop stops dead. And when the next real answer disagrees with the local
 * count, small disagreements are absorbed over a few frames instead of snapping
 * the thumb backwards, while a real jump — a seek, a skip, a return from a
 * background tab — is taken immediately, because pretending to glide there
 * would be a lie about where the music is.
 */

/** Beyond this, the position did not drift — it moved. Take it as given. */
export const SNAP_MS = 1200;

/** How much of a small disagreement to absorb each frame. */
export const SLEW = 0.18;

export interface ClockEnv {
  now?: () => number;
  raf?: (cb: () => void) => number;
  cancel?: (handle: number) => void;
  visible?: () => boolean;
  online?: () => boolean;
  /** False when the reader asked for reduced motion: correct at once instead. */
  smooth?: () => boolean;
  /** Subscribe to whatever changes the answers above. Returns a detach. */
  listen?: (onChange: () => void) => () => void;
}

function defaultVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function defaultOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function defaultSmooth(): boolean {
  if (typeof matchMedia !== 'function') return true;
  return !matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function defaultListen(onChange: () => void): () => void {
  if (typeof document === 'undefined' || typeof addEventListener !== 'function') return () => {};
  document.addEventListener('visibilitychange', onChange);
  addEventListener('online', onChange);
  addEventListener('offline', onChange);
  return () => {
    document.removeEventListener('visibilitychange', onChange);
    removeEventListener('online', onChange);
    removeEventListener('offline', onChange);
  };
}

/** What counts as "the same record", for deciding whether to glide or jump. */
function itemKey(snapshot: PlaybackSnapshot | null): string {
  if (!snapshot?.item) return '';
  return `${snapshot.item.uri}|${snapshot.item.id}`;
}

function ceiling(value: number, snapshot: PlaybackSnapshot | null): number {
  const limit = snapshot?.durationMs ?? 0;
  const floored = Math.max(0, value);
  return limit > 0 ? Math.min(limit, floored) : floored;
}

export function createProgressClock(
  source: Readable<PlaybackState>,
  env: ClockEnv = {},
): Readable<number> {
  const now = env.now ?? (() => Date.now());
  const request = env.raf ?? ((cb: () => void) => requestAnimationFrame(cb));
  const cancel = env.cancel ?? ((handle: number) => cancelAnimationFrame(handle));
  const visible = env.visible ?? defaultVisible;
  const online = env.online ?? defaultOnline;
  const smooth = env.smooth ?? defaultSmooth;
  const listen = env.listen ?? defaultListen;

  return readable(0, (set) => {
    let snapshot: PlaybackSnapshot | null = null;
    let shown = 0;
    let key = '';
    let frame: number | null = null;

    const authoritative = () => progressAt(snapshot, now());

    function show(value: number) {
      shown = ceiling(value, snapshot);
      set(shown);
    }

    function moving(): boolean {
      return !!snapshot && snapshot.playing && visible() && online();
    }

    function stop() {
      if (frame !== null) cancel(frame);
      frame = null;
    }

    function tick() {
      frame = null;
      if (!moving()) {
        show(authoritative());
        return;
      }
      const target = authoritative();
      const drift = target - shown;
      // Close enough is arrived: an asymptote that never quite reaches the end
      // of a track would leave the last millisecond permanently unplayed.
      const eased = Math.abs(drift) < 1 ? target : shown + drift * SLEW;
      show(Math.abs(drift) > SNAP_MS || !smooth() ? target : eased);
      frame = request(tick);
    }

    function sync() {
      if (moving()) {
        if (frame === null) frame = request(tick);
        return;
      }
      stop();
      show(authoritative());
    }

    const unsubscribe = source.subscribe((state) => {
      snapshot = state.snapshot;
      const next = itemKey(state.snapshot);
      if (next !== key) {
        // A different record entirely. There is no drift to absorb, only a new
        // place to start counting from.
        key = next;
        stop();
        show(authoritative());
      }
      sync();
    });

    const detach = listen(sync);

    return () => {
      stop();
      unsubscribe();
      detach();
    };
  });
}
