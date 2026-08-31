import { flushSync, mount, unmount } from 'svelte';
import { get, writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlaybackState, PlayingItem } from '../lib/playback/types';

/**
 * The player surfaces, mounted.
 *
 * What matters here is not the transport — that is proved next door — but that
 * the screens read it honestly: a refusal disables the control that cannot be
 * used and says why, a rating draft stays pinned to the track it was opened on
 * when the record moves underneath it, and the bar never appears as an empty
 * band when there is nothing at all to show.
 */

const playback = writable<PlaybackState>({
  source: 'demo',
  status: 'idle',
  snapshot: null,
  devices: [],
  queue: [],
  pending: null,
  error: null,
  fetchedAt: Date.now(),
  watching: true,
});
const playbackNow = writable(Date.now());
/** The frame clock, driven by hand so a test can hold the needle still. */
const playbackProgress = writable(30_000);

const commands: string[] = [];
const stopWatching = vi.fn();

vi.mock('../lib/playback/store', () => ({
  get playback() {
    return playback;
  },
  get playbackNow() {
    return playbackNow;
  },
  get playbackProgress() {
    return playbackProgress;
  },
  watchPlayback: () => stopWatching,
  refreshPlayback: async () => undefined,
  refreshDevices: async () => undefined,
  refreshQueue: async () => undefined,
  resetPlayback: () => undefined,
  playbackPlay: async () => void commands.push('play'),
  playbackPause: async () => void commands.push('pause'),
  playbackToggle: async () => void commands.push('toggle'),
  playbackNext: async () => void commands.push('next'),
  playbackPrevious: async () => void commands.push('previous'),
  playbackSeek: (ms: number) => {
    commands.push(`seek:${ms}`);
    // The real transport updates its own snapshot optimistically, so the
    // display follows a seek before the API has answered. Mirror that here or
    // the second of two keypresses would count from a stale position.
    playbackProgress.set(ms);
  },
  playbackVolume: (v: number) => void commands.push(`volume:${v}`),
  playbackShuffle: async (on: boolean) => void commands.push(`shuffle:${on}`),
  playbackRepeat: async (mode: string) => void commands.push(`repeat:${mode}`),
  playbackTransfer: async (id: string) => void commands.push(`transfer:${id}`),
  playbackEnqueue: async (uri: string) => void commands.push(`enqueue:${uri}`),
}));

vi.mock('../lib/playback/media-session', () => ({
  watchMediaSession: () => () => undefined,
}));

const MiniPlayer = (await import('../components/MiniPlayer.svelte')).default;
const NowPlaying = (await import('../pages/NowPlaying.svelte')).default;

const item: PlayingItem = {
  id: 't1',
  uri: 'spotify:track:t1',
  kind: 'track',
  name: 'Cold Sweat',
  artists: [{ id: 'a1', name: 'James Brown' }],
  release: { id: 'al1', uri: 'spotify:album:al1', name: 'Cold Sweat', totalTracks: 10 },
  durationMs: 180_000,
  isLocal: false,
  playable: true,
};

function playingState(over: Partial<PlaybackState> = {}): PlaybackState {
  return {
    source: 'demo',
    status: 'active',
    snapshot: {
      item,
      context: null,
      device: {
        id: 'd1',
        name: 'Kitchen',
        type: 'speaker',
        active: true,
        restricted: false,
        privateSession: false,
        supportsVolume: true,
        volumePercent: 60,
      },
      playing: true,
      progressMs: 30_000,
      durationMs: 180_000,
      at: Date.now(),
      shuffle: false,
      repeat: 'off',
      disallows: {},
    },
    devices: [
      {
        id: 'd1',
        name: 'Kitchen',
        type: 'speaker',
        active: true,
        restricted: false,
        privateSession: false,
        supportsVolume: true,
        volumePercent: 60,
      },
    ],
    queue: [],
    pending: null,
    error: null,
    fetchedAt: Date.now(),
    watching: true,
    ...over,
  };
}

let host: HTMLDivElement | null = null;

let app: any = null;

function render(component: unknown, props: Record<string, unknown> = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  app = mount(component as any, { target: host, props });
  flushSync();
  return host;
}

function text(): string {
  return host?.textContent?.replace(/\s+/g, ' ') ?? '';
}

/** Find a control the way a listener would: by what it is called. */
function control(name: RegExp): HTMLButtonElement {
  const found = [...(host?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
    (b) =>
      name.test((b.textContent ?? '').replace(/\s+/g, ' ').trim()) ||
      name.test(b.getAttribute('title') ?? ''),
  );
  if (!found) throw new Error(`no control called ${name}`);
  return found;
}

/** The rail, found by its accessible name rather than a hook put there for us. */
function scrubber(): HTMLInputElement {
  const rail = host?.querySelector<HTMLInputElement>(
    'input[type="range"][aria-label^="Position in track"]',
  );
  if (!rail) throw new Error('no scrubber');
  return rail;
}

beforeEach(() => {
  commands.length = 0;
  playbackProgress.set(30_000);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  playback.set(get(playback));
});

afterEach(() => {
  if (app) void unmount(app, { outro: false });
  host?.remove();
  app = null;
  host = null;
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty('--player-h');
});

describe('the bar that follows you around', () => {
  it('shows nothing at all when there is nothing playing and no device to use', () => {
    playback.set({ ...playingState(), status: 'idle', snapshot: null, devices: [] });
    render(MiniPlayer);
    expect(host?.querySelector('aside[aria-label="Now playing"]')).toBeNull();
  });

  it('offers a device instead of an empty band when playback is idle', () => {
    playback.set({ ...playingState(), status: 'idle', snapshot: null });
    render(MiniPlayer);
    expect(host?.querySelector('aside[aria-label="Now playing"]')).not.toBeNull();
    expect(text()).toContain('Choose a device');
  });

  it('names what is playing and where', () => {
    playback.set(playingState());
    render(MiniPlayer);
    expect(text()).toContain('Cold Sweat');
    expect(text()).toContain('James Brown');
    expect(text()).toContain('Kitchen');
  });

  it('publishes its height so nothing else has to guess', () => {
    playback.set(playingState());
    render(MiniPlayer);
    expect(document.documentElement.style.getPropertyValue('--player-h')).toMatch(/px$/);
  });

  it('sends the transport commands it shows', () => {
    playback.set(playingState());
    render(MiniPlayer);
    control(/^Pause$/).click();
    flushSync();
    expect(commands).toContain('toggle');
  });
});

describe('the Now Playing screen', () => {
  it('asks for the missing permission rather than showing a broken player', () => {
    playback.set({ ...playingState(), status: 'needs-permission', snapshot: null });
    render(NowPlaying);
    expect(text()).toMatch(/permission/i);
  });

  it('says plainly that control needs Premium', () => {
    playback.set({ ...playingState(), status: 'needs-premium' });
    render(NowPlaying);
    expect(text()).toMatch(/Premium/);
  });

  it('disables a control Spotify has refused, and says why', () => {
    playback.set(
      playingState({
        snapshot: { ...playingState().snapshot!, disallows: { skippingPrevious: true } },
      }),
    );
    render(NowPlaying);
    const previous = control(/^Previous$/);
    expect(previous.disabled).toBe(true);
    expect(previous.title).toMatch(/nothing is queued before/i);
  });

  it('shows the transport in the state the reading reports', () => {
    playback.set(playingState({ snapshot: { ...playingState().snapshot!, shuffle: true } }));
    render(NowPlaying);
    expect(control(/Shuffle on/).getAttribute('aria-pressed')).toBe('true');
  });

  it('cycles repeat through off, the record and the track', () => {
    playback.set(playingState());
    render(NowPlaying);
    control(/^Repeat off$/).click();
    flushSync();
    expect(commands).toContain('repeat:context');
  });

  it('scrubs to where the listener let go, not to every value on the way', () => {
    playback.set(playingState());
    render(NowPlaying);
    const rail = scrubber();
    rail.value = '90000';
    rail.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(commands.filter((c) => c.startsWith('seek'))).toEqual([]);
    rail.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(commands).toContain('seek:90000');
  });

  it('moves in steps far finer than a second, so a drag is not a staircase', () => {
    playback.set(playingState());
    render(NowPlaying);
    expect(Number(scrubber().step)).toBeLessThanOrEqual(100);
  });

  it('follows every input event while the finger is down', () => {
    playback.set(playingState());
    render(NowPlaying);
    const rail = scrubber();
    const seen: string[] = [];
    for (const value of ['31000', '31200', '31400', '31600']) {
      rail.value = value;
      rail.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
      seen.push(rail.getAttribute('style') ?? '');
    }
    // The fill moved on every one of them, even though the clock display —
    // which is deliberately whole seconds — did not.
    expect(new Set(seen).size).toBe(4);
    expect(rail.getAttribute('aria-valuetext')).toMatch(/^0:31/);
    expect(commands.filter((c) => c.startsWith('seek'))).toEqual([]);
  });

  it('sends exactly one seek for one drag', () => {
    playback.set(playingState());
    render(NowPlaying);
    const rail = scrubber();
    for (const value of ['40000', '50000', '60000', '70000']) {
      rail.value = value;
      rail.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
    }
    rail.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(commands.filter((c) => c.startsWith('seek'))).toEqual(['seek:70000']);
  });

  it('does not let a poll pull the thumb out from under a finger', () => {
    playback.set(playingState());
    render(NowPlaying);
    const rail = scrubber();
    rail.value = '90000';
    rail.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    // The frame clock keeps running underneath, as it would during a drag.
    playbackProgress.set(35_000);
    flushSync();
    expect(rail.getAttribute('aria-valuetext')).toMatch(/^1:30/);
  });

  it('puts the thumb back where the music is when the drag is abandoned', () => {
    playback.set(playingState());
    render(NowPlaying);
    const rail = scrubber();
    rail.value = '90000';
    rail.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    rail.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(commands.filter((c) => c.startsWith('seek'))).toEqual([]);
    expect(rail.getAttribute('aria-valuetext')).toMatch(/^0:30/);
  });

  it('moves five seconds per arrow key, not one detent', () => {
    playback.set(playingState());
    render(NowPlaying);
    const rail = scrubber();
    rail.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    flushSync();
    expect(commands).toContain('seek:35000');

    rail.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    flushSync();
    expect(commands).toContain('seek:30000');
  });

  it('leaps by the page keys and lands on the ends with Home and End', () => {
    playback.set(playingState());
    render(NowPlaying);
    const rail = scrubber();
    rail.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }));
    flushSync();
    expect(commands).toContain('seek:60000');

    rail.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    flushSync();
    expect(commands).toContain('seek:0');

    rail.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    flushSync();
    expect(commands).toContain('seek:180000');
  });

  it('never offers a position past the end of the track', () => {
    playback.set(playingState());
    render(NowPlaying);
    const rail = scrubber();
    for (let i = 0; i < 60; i += 1) {
      rail.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }));
    }
    flushSync();
    expect(commands.every((c) => !c.startsWith('seek:') || Number(c.slice(5)) <= 180_000)).toBe(
      true,
    );
  });

  it('shows the moving position from the frame clock, not from the poll', () => {
    playback.set(playingState());
    render(NowPlaying);
    expect(text()).toContain('0:30');
    playbackProgress.set(64_500);
    flushSync();
    expect(text()).toContain('1:04');
  });

  it('offers a way out to Spotify itself', () => {
    playback.set(
      playingState({
        snapshot: {
          ...playingState().snapshot!,
          item: { ...item, spotifyUrl: 'https://open.spotify.com/track/t1' },
        },
      }),
    );
    render(NowPlaying);
    const link = [...(host?.querySelectorAll('a') ?? [])].find((a) =>
      /open in spotify/i.test(a.textContent ?? ''),
    );
    expect(link?.getAttribute('href')).toBe('https://open.spotify.com/track/t1');
  });
});
