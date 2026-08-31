import type { RepeatMode } from '../spotify/client';

/**
 * What is playing, as this app understands it.
 *
 * Deliberately its own vocabulary rather than Spotify's wire shape: playback is
 * borrowed, momentary state — it is never stored, never synced, and never
 * allowed to leak field names into the rating model that outlives it.
 */

export type { RepeatMode };

export type PlayKind = 'track' | 'episode' | 'ad' | 'unknown';

export interface PlayingItem {
  /** Spotify's id. Null for local files and for adverts. */
  id: string | null;
  uri: string | null;
  kind: PlayKind;
  name: string;
  /** Performers for a track; the show for an episode. */
  artists: { id: string | null; name: string }[];
  release: {
    id: string | null;
    uri: string | null;
    name: string;
    artwork?: string;
    totalTracks?: number;
  } | null;
  artwork?: string;
  durationMs: number;
  trackNumber?: number;
  discNumber?: number;
  /** A file from the listener's own machine. It has no Spotify identity. */
  isLocal: boolean;
  playable: boolean;
  spotifyUrl?: string;
  /**
   * The catalogue rows this item was built from, when it came out of the local
   * store rather than off the wire. Demo playback plays what you already have,
   * so it says which rows those are instead of letting them be rebuilt from a
   * Spotify-shaped guess — which would file a second copy of every track.
   */
  origin?: {
    track: string;
    release?: string;
    artists?: string[];
  };
}

export type PlaybackContextKind = 'album' | 'playlist' | 'artist' | 'show' | 'collection' | 'other';

export interface PlayingContext {
  kind: PlaybackContextKind;
  uri: string;
  /** The bare id, when the URI carries one. */
  id: string | null;
}

export interface PlaybackDevice {
  id: string | null;
  name: string;
  type: string;
  active: boolean;
  /** Spotify will not accept commands for this device. */
  restricted: boolean;
  privateSession: boolean;
  supportsVolume: boolean;
  volumePercent: number | null;
}

/**
 * What the current device and content refuse.
 *
 * Every key absent means allowed. Reading this is what separates a control that
 * is honestly disabled from one that fails with a 403 after you press it.
 */
export interface Disallows {
  pausing?: boolean;
  resuming?: boolean;
  seeking?: boolean;
  skippingNext?: boolean;
  skippingPrevious?: boolean;
  togglingShuffle?: boolean;
  togglingRepeatContext?: boolean;
  togglingRepeatTrack?: boolean;
  transferring?: boolean;
}

export interface PlaybackSnapshot {
  item: PlayingItem | null;
  context: PlayingContext | null;
  device: PlaybackDevice | null;
  playing: boolean;
  progressMs: number;
  durationMs: number;
  shuffle: boolean;
  repeat: RepeatMode;
  disallows: Disallows;
  /** When this reading was taken, by this device's clock. */
  at: number;
}

/** Everything a screen needs to decide what to draw. */
export type PlaybackStatus =
  'unsupported' | 'needs-permission' | 'idle' | 'active' | 'offline' | 'needs-premium' | 'error';

export type PlaybackCommand =
  | 'play'
  | 'pause'
  | 'next'
  | 'previous'
  | 'seek'
  | 'volume'
  | 'shuffle'
  | 'repeat'
  | 'transfer'
  | 'enqueue';

export interface PlaybackState {
  source: 'spotify' | 'demo' | 'none';
  status: PlaybackStatus;
  snapshot: PlaybackSnapshot | null;
  devices: PlaybackDevice[];
  queue: PlayingItem[];
  /** The command currently in flight, so its control can show it is working. */
  pending: PlaybackCommand | null;
  error: string | null;
  /** When the state was last read successfully. Drives the freshness label. */
  fetchedAt: number | null;
  /** Whether the poll loop is currently running. */
  watching: boolean;
}

export interface PlayRequest {
  contextUri?: string;
  uris?: string[];
  offset?: { position?: number; uri?: string };
  positionMs?: number;
  deviceId?: string;
}

/**
 * The transport, whoever is providing it.
 *
 * Spotify implements this over the Web API; demo mode implements it over a
 * timer. Every screen and the store above them only ever see this interface,
 * which is why demo mode exercises the real code rather than a mock of it.
 */
export interface PlaybackService {
  readonly id: 'spotify' | 'demo';
  /** Null means nothing is playing anywhere. */
  read(signal?: AbortSignal): Promise<PlaybackSnapshot | null>;
  devices(signal?: AbortSignal): Promise<PlaybackDevice[]>;
  queue(signal?: AbortSignal): Promise<PlayingItem[]>;
  play(request?: PlayRequest): Promise<void>;
  pause(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(percent: number): Promise<void>;
  setShuffle(on: boolean): Promise<void>;
  setRepeat(mode: RepeatMode): Promise<void>;
  transfer(deviceId: string, play: boolean): Promise<void>;
  enqueue(uri: string): Promise<void>;
}
