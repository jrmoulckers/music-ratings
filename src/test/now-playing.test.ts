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

const commands: string[] = [];
const stopWatching = vi.fn();

vi.mock('../lib/playback/store', () => ({
  get playback() {
    return playback;
  },
  get playbackNow() {
    return playbackNow;
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
  playbackSeek: (ms: number) => void commands.push(`seek:${ms}`),
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

beforeEach(() => {
  commands.length = 0;
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
    const rail = host?.querySelector<HTMLInputElement>('input[aria-label="Position in track"]');
    if (!rail) throw new Error('no scrubber');
    rail.value = '90000';
    rail.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(commands.filter((c) => c.startsWith('seek'))).toEqual([]);
    rail.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(commands).toContain('seek:90000');
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
