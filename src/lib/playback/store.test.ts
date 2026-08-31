import { get } from 'svelte/store';
import { writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SpotifyApiError } from '../spotify/client';
import type { PlaybackDevice, PlaybackService, PlaybackSnapshot, PlayingItem } from './types';

/**
 * The transport store: the part that lies for a moment on purpose.
 *
 * Everything here is about the gap between pressing a control and Spotify
 * agreeing it happened. The optimistic patch has to be taken back when the
 * command fails, commands must not overtake each other, a dragged scrubber must
 * send one value rather than forty, and a refusal has to become a sentence the
 * listener can act on rather than a status code.
 */

const session = writable({ connected: true, missingPlaybackScopes: false });
const settingsStore = writable({ playbackPolling: 'responsive' });
const worldStore = writable({ entities: [] as unknown[] });
const upsertEntities = vi.fn(async () => undefined);
const saveMemberships = vi.fn(async () => undefined);
const refreshWorld = vi.fn(async () => undefined);

vi.mock('../app/state', () => ({
  get settings() {
    return settingsStore;
  },
  get world() {
    return worldStore;
  },
  refreshWorld: (...args: unknown[]) => refreshWorld(...(args as [])),
}));

vi.mock('../spotify/session', () => ({
  get spotifySession() {
    return session;
  },
  spotifyConfig: () => ({ clientId: 'test', redirectUri: 'http://127.0.0.1/callback' }),
}));

vi.mock('../storage/repo', () => ({
  upsertEntities: (...args: unknown[]) => upsertEntities(...(args as [])),
  saveMemberships: (...args: unknown[]) => saveMemberships(...(args as [])),
}));

/** One fake transport, standing in for both the real ones. */
class FakeTransport implements PlaybackService {
  readonly id = 'spotify' as const;
  calls: string[] = [];
  snapshot: PlaybackSnapshot | null = null;
  deviceList: PlaybackDevice[] = [];
  queueItems: PlayingItem[] = [];
  failWith: Error | null = null;
  private hold: Promise<void> | null = null;
  private letGo: (() => void) | null = null;

  /** Freeze every command until `release`, to prove they queue rather than race. */
  holdCommands(): void {
    this.hold = new Promise<void>((resolve) => {
      this.letGo = resolve;
    });
  }

  release(): void {
    const go = this.letGo;
    this.hold = null;
    this.letGo = null;
    go?.();
  }

  private async command(name: string): Promise<void> {
    this.calls.push(name);
    if (this.hold) await this.hold;
    if (this.failWith) throw this.failWith;
  }

  async read() {
    this.calls.push('read');
    return this.snapshot;
  }
  async devices() {
    this.calls.push('devices');
    return this.deviceList;
  }
  async queue() {
    this.calls.push('queue');
    if (this.failWith) throw this.failWith;
    return this.queueItems;
  }
  play() {
    return this.command('play');
  }
  pause() {
    return this.command('pause');
  }
  next() {
    return this.command('next');
  }
  previous() {
    return this.command('previous');
  }
  seek(ms: number) {
    return this.command(`seek:${ms}`);
  }
  setVolume(percent: number) {
    return this.command(`volume:${percent}`);
  }
  setShuffle(on: boolean) {
    return this.command(`shuffle:${on}`);
  }
  setRepeat(mode: string) {
    return this.command(`repeat:${mode}`);
  }
  transfer(deviceId: string, play: boolean) {
    return this.command(`transfer:${deviceId}:${play}`);
  }
  enqueue(uri: string) {
    return this.command(`enqueue:${uri}`);
  }
}

let fake: FakeTransport;

vi.mock('./spotify', () => ({
  SpotifyPlayback: class {
    constructor() {
      return fake as unknown as object;
    }
  },
}));

vi.mock('./simulated', () => ({
  SimulatedPlayback: class {
    constructor() {
      return fake as unknown as object;
    }
  },
}));

const store = await import('./store');

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

function snapshot(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
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
    ...overrides,
  };
}

/** Let the command chain's own microtasks run before looking at the store. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

beforeEach(() => {
  fake = new FakeTransport();
  session.set({ connected: true, missingPlaybackScopes: false });
  settingsStore.set({ playbackPolling: 'responsive' });
  worldStore.set({ entities: [] });
  upsertEntities.mockClear();
  saveMemberships.mockClear();
  refreshWorld.mockClear();
  store.resetPlayback();
});

afterEach(() => {
  fake.release();
  vi.useRealTimers();
});

describe('reading', () => {
  it('adopts what the transport reports', async () => {
    fake.snapshot = snapshot();
    await store.refreshPlayback();
    const state = get(store.playback);
    expect(state.status).toBe('active');
    expect(state.snapshot?.item?.name).toBe('Cold Sweat');
    expect(state.source).toBe('spotify');
  });

  it('is idle, not broken, when nothing is playing anywhere', async () => {
    fake.snapshot = null;
    await store.refreshPlayback();
    expect(get(store.playback).status).toBe('idle');
    expect(get(store.playback).error).toBeNull();
  });

  it('asks for permission instead of collecting 403s', async () => {
    session.set({ connected: true, missingPlaybackScopes: true });
    await store.refreshPlayback();
    expect(get(store.playback).status).toBe('needs-permission');
    expect(fake.calls).toEqual([]);
  });

  it('says offline rather than reporting a failed request', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await store.refreshPlayback();
    expect(get(store.playback).status).toBe('offline');
    expect(fake.calls).toEqual([]);
    online.mockRestore();
  });

  it('shares one request between overlapping callers', async () => {
    fake.snapshot = snapshot();
    await Promise.all([store.refreshPlayback(), store.refreshPlayback(), store.refreshPlayback()]);
    expect(fake.calls.filter((c) => c === 'read')).toHaveLength(1);
  });

  it('names the Premium requirement plainly', async () => {
    fake.read = async () => {
      throw new SpotifyApiError('Controlling playback needs Spotify Premium.', 403, 'premium');
    };
    await store.refreshPlayback();
    expect(get(store.playback).status).toBe('needs-premium');
  });

  it('treats "no device" as nothing playing, not as an error to display', async () => {
    fake.read = async () => {
      throw new SpotifyApiError('Nothing is playing.', 404, 'no-device');
    };
    await store.refreshPlayback();
    expect(get(store.playback).status).toBe('idle');
    expect(get(store.playback).error).toBeNull();
  });

  it('keeps the transport working when the queue cannot be read', async () => {
    fake.failWith = new SpotifyApiError('nope', 403, 'forbidden');
    await store.refreshQueue();
    expect(get(store.playback).queue).toEqual([]);
    expect(get(store.playback).error).toBeNull();
  });
});

describe('writing what is playing into the library', () => {
  /** The store remembers what it has already stored, so each case needs its own. */
  function fresh(id: string): PlayingItem {
    return { ...item, id, uri: `spotify:track:${id}` };
  }

  it('stores the track once, however many times it is read', async () => {
    fake.snapshot = snapshot({ item: fresh('ingest-a') });
    await store.refreshPlayback();
    await store.refreshPlayback();
    await settle();
    expect(upsertEntities).toHaveBeenCalledTimes(1);
    expect(saveMemberships).toHaveBeenCalledTimes(1);
  });

  it('rebuilds the world only for records it has never seen', async () => {
    fake.snapshot = snapshot({ item: fresh('ingest-b') });
    await store.refreshPlayback();
    await vi.waitFor(() => expect(refreshWorld).toHaveBeenCalledTimes(1));
  });

  it('stores nothing for an advert', async () => {
    fake.snapshot = snapshot({ item: { ...fresh('ingest-c'), kind: 'ad', id: null } });
    await store.refreshPlayback();
    await settle();
    expect(upsertEntities).not.toHaveBeenCalled();
  });
});

describe('commands', () => {
  it('shows the change at once, then reconciles with a real reading', async () => {
    vi.useFakeTimers();
    fake.snapshot = snapshot({ playing: true });
    await store.refreshPlayback();

    const done = store.playbackPause();
    await settle();
    expect(get(store.playback).snapshot?.playing).toBe(false);
    expect(get(store.playback).pending).toBe('pause');

    fake.snapshot = snapshot({ playing: false, at: Date.now() + 1 });
    await vi.advanceTimersByTimeAsync(400);
    await done;
    expect(fake.calls).toContain('pause');
    expect(get(store.playback).pending).toBeNull();
    expect(get(store.playback).snapshot?.playing).toBe(false);
  });

  it('puts the previous reading back when the command is refused', async () => {
    vi.useFakeTimers();
    fake.snapshot = snapshot({ playing: true, shuffle: false });
    await store.refreshPlayback();

    fake.holdCommands();
    fake.failWith = new SpotifyApiError('That device does not accept it.', 403, 'restricted');
    const done = store.playbackShuffle(true);
    await settle();
    // While the command is in flight the control shows what was asked for.
    expect(get(store.playback).snapshot?.shuffle).toBe(true);

    fake.release();
    await vi.advanceTimersByTimeAsync(400);
    await done;

    expect(get(store.playback).snapshot?.shuffle).toBe(false);
    expect(get(store.playback).error).toMatch(/does not accept/);
  });

  it('runs one command at a time, in the order they were pressed', async () => {
    fake.snapshot = snapshot();
    await store.refreshPlayback();
    fake.holdCommands();

    const first = store.playbackNext();
    const second = store.playbackPrevious();
    await settle();

    expect(fake.calls.filter((c) => c === 'next' || c === 'previous')).toEqual(['next']);
    fake.release();
    await first;
    await second;
    expect(fake.calls.filter((c) => c === 'next' || c === 'previous')).toEqual([
      'next',
      'previous',
    ]);
  });
});

describe('dragging', () => {
  it('sends only the position the listener let go on', async () => {
    vi.useFakeTimers();
    fake.snapshot = snapshot();
    await store.refreshPlayback();

    store.playbackSeek(10_000);
    store.playbackSeek(20_000);
    store.playbackSeek(45_500);
    expect(get(store.playback).snapshot?.progressMs).toBe(45_500);
    expect(fake.calls.some((c) => c.startsWith('seek'))).toBe(false);

    await vi.advanceTimersByTimeAsync(700);
    expect(fake.calls.filter((c) => c.startsWith('seek:'))).toEqual(['seek:45500']);
  });

  it('never seeks to a negative position', async () => {
    vi.useFakeTimers();
    fake.snapshot = snapshot();
    await store.refreshPlayback();
    store.playbackSeek(-5_000);
    await vi.advanceTimersByTimeAsync(700);
    expect(fake.calls).toContain('seek:0');
  });

  it('coalesces the volume slider and keeps it inside 0–100', async () => {
    vi.useFakeTimers();
    fake.snapshot = snapshot();
    await store.refreshPlayback();

    store.playbackVolume(50);
    store.playbackVolume(140);
    await vi.advanceTimersByTimeAsync(700);
    expect(fake.calls.filter((c) => c.startsWith('volume:'))).toEqual(['volume:100']);
  });
});

describe('watching', () => {
  it('counts watchers so one screen closing does not stop the other', async () => {
    fake.snapshot = snapshot();
    const stopA = store.watchPlayback();
    const stopB = store.watchPlayback();
    await vi.waitFor(() => expect(get(store.playback).watching).toBe(true));
    stopA();
    expect(get(store.playback).watching).toBe(true);
    stopB();
    expect(get(store.playback).watching).toBe(false);
  });
});
