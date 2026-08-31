import { contextFromUri } from './model';
import type {
  Disallows,
  PlaybackDevice,
  PlaybackService,
  PlaybackSnapshot,
  PlayingItem,
  PlayRequest,
  RepeatMode,
} from './types';

/**
 * Playback without Spotify.
 *
 * Demo mode simulates the transport, not the catalogue: it plays the listener's
 * own stored tracks against a clock. Nothing is invented, nothing is fetched,
 * and every screen above it runs the same code path it runs for real — which is
 * the only way a demo is worth having.
 */

export interface SimulatedOptions {
  /** The tracks available to play, newest intent first. */
  library: () => PlayingItem[];
  /** The tracks belonging to a release or list, for context playback. */
  contextItems?: (uri: string) => PlayingItem[];
  now?: () => number;
}

const DEMO_DEVICES: PlaybackDevice[] = [
  {
    id: 'demo-browser',
    name: 'Demo player',
    type: 'computer',
    active: true,
    restricted: false,
    privateSession: false,
    supportsVolume: true,
    volumePercent: 60,
  },
  {
    id: 'demo-speaker',
    name: 'Demo speaker',
    type: 'speaker',
    active: false,
    restricted: false,
    privateSession: false,
    supportsVolume: true,
    volumePercent: 40,
  },
];

/** Stops a zero-length item from spinning the settle loop forever. */
const MIN_ITEM_MS = 1_000;

export class SimulatedPlayback implements PlaybackService {
  readonly id = 'demo' as const;

  private list: PlayingItem[] = [];
  private index = 0;
  private playing = false;
  private position = 0;
  private since = 0;
  private shuffleOn = false;
  private repeatMode: RepeatMode = 'off';
  private volume = 60;
  private contextUri: string | null = null;
  private lined: PlayingItem[] = [];
  private deviceId = 'demo-browser';
  private started = false;
  private readonly clock: () => number;

  constructor(private readonly options: SimulatedOptions) {
    this.clock = options.now ?? (() => Date.now());
    this.since = this.clock();
  }

  /* ---- reading ---------------------------------------------------------- */

  async read(): Promise<PlaybackSnapshot | null> {
    // Nothing is playing until somebody presses play. A demo that starts making
    // believe on load would put a player in front of people who never asked
    // for one.
    if (!this.started) return null;
    this.ensureList();
    this.settle();
    const item = this.list[this.index];
    if (!item) return null;
    return {
      item,
      context: contextFromUri(this.contextUri),
      device: this.device(),
      playing: this.playing,
      progressMs: Math.round(this.position),
      durationMs: item.durationMs,
      shuffle: this.shuffleOn,
      repeat: this.repeatMode,
      disallows: this.disallows(),
      at: this.clock(),
    };
  }

  async devices(): Promise<PlaybackDevice[]> {
    return DEMO_DEVICES.map((device) => ({
      ...device,
      active: device.id === this.deviceId,
      ...(device.id === this.deviceId ? { volumePercent: this.volume } : {}),
    }));
  }

  async queue(): Promise<PlayingItem[]> {
    this.ensureList();
    return [...this.lined, ...this.list.slice(this.index + 1, this.index + 1 + 10)];
  }

  /* ---- commands --------------------------------------------------------- */

  async play(request: PlayRequest = {}): Promise<void> {
    if (request.contextUri) {
      const items = this.options.contextItems?.(request.contextUri) ?? [];
      if (items.length) {
        this.list = items;
        this.contextUri = request.contextUri;
        this.index = clampIndex(request.offset?.position ?? indexOfUri(items, request.offset?.uri));
        this.position = request.positionMs ?? 0;
      }
    } else if (request.uris?.length) {
      const wanted = new Set(request.uris);
      const items = this.options.library().filter((item) => item.uri && wanted.has(item.uri));
      if (items.length) {
        this.list = items;
        this.contextUri = null;
        this.index = 0;
        this.position = request.positionMs ?? 0;
      }
    } else if (request.positionMs !== undefined) {
      this.position = request.positionMs;
    }
    this.ensureList();
    this.playing = true;
    this.started = true;
    this.since = this.clock();
  }

  async pause(): Promise<void> {
    this.settle();
    this.playing = false;
  }

  async next(): Promise<void> {
    this.ensureList();
    if (this.lined.length) {
      const queued = this.lined.shift();
      if (queued) {
        this.list = [
          ...this.list.slice(0, this.index + 1),
          queued,
          ...this.list.slice(this.index + 1),
        ];
      }
    }
    this.index = this.index + 1 >= this.list.length ? 0 : this.index + 1;
    this.position = 0;
    this.since = this.clock();
  }

  async previous(): Promise<void> {
    this.ensureList();
    // Matching every player ever made: within the first few seconds it steps
    // back, after that it restarts what is playing.
    this.settle();
    if (this.position > 3_000) {
      this.position = 0;
    } else {
      this.index = this.index === 0 ? Math.max(0, this.list.length - 1) : this.index - 1;
      this.position = 0;
    }
    this.since = this.clock();
  }

  async seek(positionMs: number): Promise<void> {
    const item = this.list[this.index];
    const limit = item ? item.durationMs : 0;
    this.position = Math.max(0, Math.min(limit, positionMs));
    this.since = this.clock();
  }

  async setVolume(percent: number): Promise<void> {
    this.volume = Math.max(0, Math.min(100, Math.round(percent)));
  }

  async setShuffle(on: boolean): Promise<void> {
    this.shuffleOn = on;
  }

  async setRepeat(mode: RepeatMode): Promise<void> {
    this.repeatMode = mode;
  }

  async transfer(deviceId: string, play: boolean): Promise<void> {
    this.deviceId = deviceId;
    if (play) {
      this.ensureList();
      this.playing = true;
      this.started = true;
      this.since = this.clock();
    }
  }

  async enqueue(uri: string): Promise<void> {
    const item = this.options.library().find((candidate) => candidate.uri === uri);
    if (item) this.lined.push(item);
  }

  /* ---- internals -------------------------------------------------------- */

  private device(): PlaybackDevice {
    const found = DEMO_DEVICES.find((d) => d.id === this.deviceId) ?? DEMO_DEVICES[0]!;
    return { ...found, active: true, volumePercent: this.volume };
  }

  private disallows(): Disallows {
    const last = this.index >= this.list.length - 1;
    return {
      ...(this.playing ? { resuming: true } : { pausing: true }),
      ...(last && this.repeatMode === 'off' ? { skippingNext: true } : {}),
    };
  }

  private ensureList(): void {
    if (this.list.length) return;
    this.list = this.options.library();
    this.index = 0;
    this.position = 0;
  }

  /**
   * Move the clock forward.
   *
   * Everything is derived from elapsed real time rather than from a running
   * timer, so a tab that was asleep for ten minutes catches up correctly
   * instead of pretending nothing happened.
   */
  private settle(): void {
    const now = this.clock();
    if (!this.playing || !this.list.length) {
      this.since = now;
      return;
    }
    let elapsed = this.position + Math.max(0, now - this.since);
    let guard = 0;
    while (guard++ < 500) {
      const item = this.list[this.index];
      if (!item) break;
      const length = Math.max(MIN_ITEM_MS, item.durationMs);
      if (elapsed < length) break;
      elapsed -= length;
      if (this.repeatMode === 'track') continue;
      if (this.index + 1 < this.list.length) {
        this.index += 1;
        continue;
      }
      if (this.repeatMode === 'context') {
        this.index = 0;
        continue;
      }
      // The end of everything: stop on the last item rather than loop.
      this.playing = false;
      elapsed = length;
      break;
    }
    this.position = elapsed;
    this.since = now;
  }
}

function clampIndex(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function indexOfUri(items: PlayingItem[], uri: string | undefined): number {
  if (!uri) return 0;
  const found = items.findIndex((item) => item.uri === uri);
  return found >= 0 ? found : 0;
}
