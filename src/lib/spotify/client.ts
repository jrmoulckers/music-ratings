import {
  SpotifyAuthError,
  forgetTokens,
  refresh,
  storedTokens,
  type SpotifyConfig,
  type SpotifyTokens,
} from './auth';
import {
  ARTIST_ALBUMS_LIMIT_MAX,
  RECENTLY_PLAYED_MAX,
  SEARCH_LIMIT_MAX,
  type TopTerm,
} from './capabilities';

const API = 'https://api.spotify.com/v1';

export type Params = Record<string, string | number | boolean | undefined>;

/** Builds a request URL, dropping empty parameters and encoding the rest. */
function endpoint(path: string, params: Params = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  return `${API}${path}${query.size ? `?${query.toString()}` : ''}`;
}

/** Reads Spotify's error body once, tolerating empty and non-JSON responses. */
async function failure(response: Response): Promise<{ message: string; reason?: string }> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string; reason?: string } | string;
  };
  if (typeof body.error === 'string') return { message: body.error.trim() };
  return { message: (body.error?.message ?? '').trim(), reason: body.error?.reason };
}

export type SpotifyErrorKind =
  | 'rate-limit'
  | 'quota'
  | 'forbidden'
  | 'not-found'
  | 'offline'
  | 'server'
  | 'premium'
  | 'no-device'
  | 'restricted'
  | 'other';

export class SpotifyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: SpotifyErrorKind,
    /** Spotify's own machine reason, e.g. `NO_ACTIVE_DEVICE`. Player errors only. */
    readonly reason?: string,
  ) {
    super(message);
    this.name = 'SpotifyApiError';
  }
}

/**
 * What the player endpoints say when they refuse, and what that means to a
 * person. Spotify sends a machine `reason` alongside the status; using it is the
 * difference between "Spotify refused that request" and "nothing is playing
 * anywhere to control".
 */
const PLAYER_REASONS: Record<string, { kind: SpotifyErrorKind; message: string }> = {
  NO_ACTIVE_DEVICE: {
    kind: 'no-device',
    message: 'Nothing is playing. Open Spotify on a device, or play in this browser.',
  },
  PREMIUM_REQUIRED: {
    kind: 'premium',
    message: 'Controlling playback needs Spotify Premium.',
  },
  NO_PREV_TRACK: { kind: 'restricted', message: 'There is nothing before this.' },
  NO_NEXT_TRACK: { kind: 'restricted', message: 'There is nothing after this.' },
  ALREADY_PAUSED: { kind: 'restricted', message: 'It is already paused.' },
  NOT_PAUSED: { kind: 'restricted', message: 'It is already playing.' },
  NOT_PLAYING_TRACK: { kind: 'restricted', message: 'No track is playing.' },
  NOT_PLAYING_CONTEXT: {
    kind: 'restricted',
    message: 'Nothing is playing from a release or list.',
  },
  ENDLESS_CONTEXT: { kind: 'restricted', message: 'This is an endless station, so it cannot.' },
  CONTEXT_DISALLOW: { kind: 'restricted', message: 'What is playing does not allow that.' },
  ALREADY_PLAYING: { kind: 'restricted', message: 'That is already playing.' },
  REMOTE_CONTROL_DISALLOW: {
    kind: 'restricted',
    message: 'That device does not accept remote control.',
  },
  DEVICE_NOT_CONTROLLABLE: {
    kind: 'restricted',
    message: 'That device cannot be controlled from here.',
  },
  VOLUME_CONTROL_DISALLOW: { kind: 'restricted', message: 'That device sets its own volume.' },
  UNSUPPORTED_DEVICE: { kind: 'restricted', message: 'That device does not support this.' },
};

function playerRefusal(reason: string | undefined) {
  return reason ? PLAYER_REASONS[reason] : undefined;
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Called when Spotify asks us to wait, so the UI can say so honestly. */
  onBackoff?: (seconds: number) => void;
}

export interface SpotifyClientOptions extends RequestOptions {
  config: SpotifyConfig;
  market?: string;
}

/* -------------------------------------------------------------------------- */

let inFlightRefresh: Promise<SpotifyTokens> | null = null;

/** A valid access token, refreshing first if the stored one has expired. */
export async function accessToken(config: SpotifyConfig): Promise<string> {
  const tokens = storedTokens();
  if (!tokens) throw new SpotifyAuthError('Connect Spotify to load your library.', 'expired');
  if (tokens.expiresAt > Date.now()) return tokens.accessToken;
  // Several requests can expire at once; only refresh once for all of them.
  inFlightRefresh ??= refresh(config, tokens).finally(() => {
    inFlightRefresh = null;
  });
  return (await inFlightRefresh).accessToken;
}

export class SpotifyClient {
  private readonly config: SpotifyConfig;
  private readonly market: string | undefined;
  private readonly onBackoff: ((seconds: number) => void) | undefined;

  constructor(options: SpotifyClientOptions) {
    this.config = options.config;
    // Left unset, Spotify resolves the market from the user's own access token,
    // which is what we want. `from_token` used to say that explicitly but is no
    // longer accepted and now fails the request outright with "Invalid market
    // code", so an unset market is both the correct and the safer default.
    this.market = options.market;
    this.onBackoff = options.onBackoff;
  }

  async get<T>(path: string, params: Params = {}, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(endpoint(path, params), options);
  }

  /**
   * PUT, POST or DELETE with an optional JSON body.
   *
   * Every player command answers `204 No Content` on success, which the request
   * layer already reads as "done" rather than as an empty response to parse.
   */
  private send<T>(
    method: 'PUT' | 'POST' | 'DELETE',
    path: string,
    params: Params = {},
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    return this.request<T>(endpoint(path, params), options, { method, body });
  }

  private async request<T>(
    url: string,
    options: RequestOptions,
    call: { method?: 'PUT' | 'POST' | 'DELETE'; body?: unknown } = {},
    attempt = 0,
  ): Promise<T> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new SpotifyApiError('You are offline, so nothing new could be fetched.', 0, 'offline');
    }

    const token = await accessToken(this.config);
    let response: Response;
    try {
      const init: RequestInit = { headers: { Authorization: `Bearer ${token}` } };
      if (call.method) init.method = call.method;
      if (call.body !== undefined) {
        init.body = JSON.stringify(call.body);
        (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
      }
      const signal = options.signal ?? this.signal;
      if (signal) init.signal = signal;
      response = await fetch(url, init);
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      throw new SpotifyApiError('Could not reach Spotify.', 0, 'offline');
    }

    if (response.status === 429) {
      const body = (await response
        .clone()
        .json()
        .catch(() => ({}))) as { reason?: string; error?: { reason?: string } };
      const seconds = Number(response.headers.get('Retry-After') ?? 2);
      if (body.reason === 'QUOTA_EXCEEDED' || body.error?.reason === 'QUOTA_EXCEEDED') {
        throw new SpotifyApiError(
          'This Spotify app has hit its request quota. Apps in development mode have a small allowance; wait a while and try again.',
          429,
          'quota',
        );
      }
      if (attempt >= 3) {
        throw new SpotifyApiError(
          `Spotify is rate limiting this app. Try again in about ${Math.ceil(seconds)} seconds.`,
          429,
          'rate-limit',
        );
      }
      // Spotify tells us exactly how long to wait. Waiting is the whole fix.
      const wait = Math.max(1, seconds);
      (options.onBackoff ?? this.onBackoff)?.(wait);
      await sleep(wait * 1000, options.signal);
      return this.request<T>(url, options, call, attempt + 1);
    }

    if (response.status === 401) {
      forgetTokens();
      throw new SpotifyAuthError(
        'Your Spotify sign-in expired. Connect again to continue.',
        'expired',
      );
    }
    if (response.status === 403) {
      const { message, reason } = await failure(response);
      const known = playerRefusal(reason);
      if (known) throw new SpotifyApiError(known.message, 403, known.kind, reason);
      throw new SpotifyApiError(
        message ||
          'Spotify refused that request. If this app is in development mode, your account must be added to it in the Spotify dashboard.',
        403,
        'forbidden',
        reason,
      );
    }
    if (response.status === 404) {
      const { reason } = await failure(response);
      const known = playerRefusal(reason);
      if (known) throw new SpotifyApiError(known.message, 404, known.kind, reason);
      throw new SpotifyApiError(
        'Spotify has nothing at that address for your market.',
        404,
        'not-found',
      );
    }
    if (response.status >= 500) {
      if (attempt < 3) {
        await sleep(2 ** attempt * 700, options.signal);
        return this.request<T>(url, options, call, attempt + 1);
      }
      throw new SpotifyApiError('Spotify is having trouble right now.', response.status, 'server');
    }
    if (!response.ok) {
      // Spotify explains itself in the body ("Invalid market code", "Bad
      // request"). Swallowing that leaves a bare status code and nothing to act
      // on, so pass the reason through when there is one.
      const { message, reason } = await failure(response);
      const known = playerRefusal(reason);
      if (known) throw new SpotifyApiError(known.message, response.status, known.kind, reason);
      throw new SpotifyApiError(
        message
          ? `Spotify returned ${response.status}: ${message}`
          : `Spotify returned ${response.status}.`,
        response.status,
        'other',
        reason,
      );
    }
    // 204 is both how every player command reports success and how Spotify says
    // "nothing is playing at all" — an empty body, never an error.
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  private signal: AbortSignal | undefined;

  /* ---- paging ----------------------------------------------------------- */

  /**
   * Walks a paged endpoint. `max` is a hard stop so a user with 12,000 saved
   * tracks does not silently spend ten minutes and their whole rate budget.
   */
  async *pages<T>(
    path: string,
    params: Record<string, string | number | undefined> = {},
    options: RequestOptions & { max?: number } = {},
  ): AsyncGenerator<T[], void, void> {
    const max = options.max ?? 1000;
    let url: string | null = null;
    let fetched = 0;
    let first = true;

    while (fetched < max) {
      const page: Paged<T> = first
        ? await this.get<Paged<T>>(path, { limit: 50, ...params }, options)
        : await this.request<Paged<T>>(url as string, options);
      first = false;
      const items = (page.items ?? []).filter(Boolean);
      if (items.length === 0) return;
      fetched += items.length;
      yield items;
      if (!page.next) return;
      url = page.next;
    }
  }

  async collect<T>(
    path: string,
    params: Record<string, string | number | undefined> = {},
    options: RequestOptions & { max?: number } = {},
  ): Promise<T[]> {
    const out: T[] = [];
    for await (const page of this.pages<T>(path, params, options)) out.push(...page);
    return out;
  }

  /* ---- endpoints -------------------------------------------------------- */

  profile(options?: RequestOptions) {
    return this.get<SpotifyUser>('/me', {}, options);
  }

  /**
   * `limit` is clamped rather than trusted: Spotify refuses anything above ten
   * with `400 Invalid limit`, and a search that 400s looks to the user like the
   * catalogue simply does not contain what they typed.
   */
  search(
    query: string,
    types: readonly string[],
    limit = SEARCH_LIMIT_MAX,
    options?: RequestOptions,
  ) {
    return this.get<SearchResponse>(
      '/search',
      {
        q: query,
        type: types.join(','),
        limit: Math.max(1, Math.min(Math.trunc(limit), SEARCH_LIMIT_MAX)),
        market: this.market,
      },
      options,
    );
  }

  topItems(kind: 'artists' | 'tracks', term: TopTerm, limit = 50, options?: RequestOptions) {
    return this.get<Paged<SpotifyArtist | SpotifyTrack>>(
      `/me/top/${kind}`,
      { time_range: term, limit },
      options,
    );
  }

  /** Tracks only, fifty at most — Spotify keeps no deeper history. */
  recentlyPlayed(options?: RequestOptions) {
    return this.get<{ items: PlayHistory[] }>(
      '/me/player/recently-played',
      { limit: RECENTLY_PLAYED_MAX },
      options,
    );
  }

  savedTracks(options?: RequestOptions & { max?: number }) {
    return this.collect<{ added_at: string; track: SpotifyTrack }>(
      '/me/tracks',
      { market: this.market },
      options,
    );
  }

  savedAlbums(options?: RequestOptions & { max?: number }) {
    return this.collect<{ added_at: string; album: SpotifyAlbum }>(
      '/me/albums',
      { market: this.market },
      options,
    );
  }

  savedShows(options?: RequestOptions & { max?: number }) {
    return this.collect<{ added_at: string; show: SpotifyShow }>('/me/shows', {}, options);
  }

  savedEpisodes(options?: RequestOptions & { max?: number }) {
    return this.collect<{ added_at: string; episode: SpotifyEpisode }>(
      '/me/episodes',
      { market: this.market },
      options,
    );
  }

  savedAudiobooks(options?: RequestOptions & { max?: number }) {
    return this.collect<SpotifyAudiobook>('/me/audiobooks', {}, options);
  }

  playlists(options?: RequestOptions & { max?: number }) {
    return this.collect<SpotifyPlaylist>('/me/playlists', {}, options);
  }

  /**
   * Spotify removed `/playlists/{id}/tracks` for development-mode apps in
   * February 2026 and renamed it to `/playlists/{id}/items`. Extended-quota apps
   * still answer on the old address, so a 404 falls back rather than losing
   * every playlist's contents on that tier.
   *
   * Either way Spotify now withholds the contents of playlists the user neither
   * owns nor collaborates on. That reads as a forbidden or empty response, and
   * the caller treats it as "no contents" rather than as a failure.
   */
  async playlistTracks(id: string, options?: RequestOptions & { max?: number }) {
    const params = { market: this.market, additional_types: 'track' };
    try {
      return await this.collect<PlaylistItem>(`/playlists/${id}/items`, params, options);
    } catch (error) {
      if (error instanceof SpotifyApiError && error.status === 404) {
        return this.collect<PlaylistItem>(`/playlists/${id}/tracks`, params, options);
      }
      if (error instanceof SpotifyApiError && error.kind === 'forbidden') return [];
      throw error;
    }
  }

  artist(id: string, options?: RequestOptions) {
    return this.get<SpotifyArtist>(`/artists/${id}`, {}, options);
  }

  artistAlbums(id: string, options?: RequestOptions & { max?: number }) {
    return this.collect<SpotifyAlbum>(
      `/artists/${id}/albums`,
      {
        include_groups: 'album,single,compilation',
        market: this.market,
        limit: ARTIST_ALBUMS_LIMIT_MAX,
      },
      options,
    );
  }

  album(id: string, options?: RequestOptions) {
    return this.get<SpotifyAlbum>(`/albums/${id}`, { market: this.market }, options);
  }

  albumTracks(id: string, options?: RequestOptions & { max?: number }) {
    return this.collect<SpotifyTrack>(`/albums/${id}/tracks`, { market: this.market }, options);
  }

  track(id: string, options?: RequestOptions) {
    return this.get<SpotifyTrack>(`/tracks/${id}`, { market: this.market }, options);
  }

  show(id: string, options?: RequestOptions) {
    return this.get<SpotifyShow>(`/shows/${id}`, { market: this.market }, options);
  }

  showEpisodes(id: string, options?: RequestOptions & { max?: number }) {
    return this.collect<SpotifyEpisode>(`/shows/${id}/episodes`, { market: this.market }, options);
  }

  audiobook(id: string, options?: RequestOptions) {
    return this.get<SpotifyAudiobook>(`/audiobooks/${id}`, { market: this.market }, options);
  }

  audiobookChapters(id: string, options?: RequestOptions & { max?: number }) {
    return this.collect<SpotifyChapter>(
      `/audiobooks/${id}/chapters`,
      { market: this.market },
      options,
    );
  }

  /* ---- player ----------------------------------------------------------- */

  /**
   * What is playing right now, anywhere on the account.
   *
   * Answers `204` — and therefore `undefined` here — when no device is active.
   * That is the ordinary resting state, not a failure.
   */
  playbackState(options?: RequestOptions) {
    return this.get<PlaybackState | undefined>(
      '/me/player',
      { market: this.market, additional_types: 'track,episode' },
      options,
    );
  }

  /** Every device Spotify currently knows about for this account. */
  async devices(options?: RequestOptions) {
    const body = await this.get<{ devices?: SpotifyDevice[] } | undefined>(
      '/me/player/devices',
      {},
      options,
    );
    return body?.devices ?? [];
  }

  /** Moves playback to another device. `play: false` keeps the current state. */
  transferPlayback(deviceId: string, play: boolean, options?: RequestOptions) {
    return this.send<void>('PUT', '/me/player', {}, { device_ids: [deviceId], play }, options);
  }

  /**
   * Starts or resumes playback.
   *
   * With no arguments this resumes whatever was paused. A `contextUri` starts a
   * release or list; `uris` starts loose tracks. Sending an empty body is not
   * the same as sending `{}` with keys set to undefined, so the body is built
   * up only from what was actually asked for.
   */
  play(
    input: {
      deviceId?: string;
      contextUri?: string;
      uris?: string[];
      offset?: { position?: number; uri?: string };
      positionMs?: number;
    } = {},
    options?: RequestOptions,
  ) {
    const body: Record<string, unknown> = {};
    if (input.contextUri) body.context_uri = input.contextUri;
    if (input.uris?.length) body.uris = input.uris;
    if (input.offset) body.offset = input.offset;
    if (input.positionMs !== undefined)
      body.position_ms = Math.max(0, Math.trunc(input.positionMs));
    return this.send<void>(
      'PUT',
      '/me/player/play',
      { device_id: input.deviceId },
      Object.keys(body).length ? body : {},
      options,
    );
  }

  pause(deviceId?: string, options?: RequestOptions) {
    return this.send<void>('PUT', '/me/player/pause', { device_id: deviceId }, undefined, options);
  }

  next(deviceId?: string, options?: RequestOptions) {
    return this.send<void>('POST', '/me/player/next', { device_id: deviceId }, undefined, options);
  }

  previous(deviceId?: string, options?: RequestOptions) {
    return this.send<void>(
      'POST',
      '/me/player/previous',
      { device_id: deviceId },
      undefined,
      options,
    );
  }

  seek(positionMs: number, deviceId?: string, options?: RequestOptions) {
    return this.send<void>(
      'PUT',
      '/me/player/seek',
      { position_ms: Math.max(0, Math.trunc(positionMs)), device_id: deviceId },
      undefined,
      options,
    );
  }

  /** Percent, clamped — Spotify 400s on anything outside 0–100. */
  setVolume(percent: number, deviceId?: string, options?: RequestOptions) {
    return this.send<void>(
      'PUT',
      '/me/player/volume',
      {
        volume_percent: Math.max(0, Math.min(100, Math.round(percent))),
        device_id: deviceId,
      },
      undefined,
      options,
    );
  }

  setShuffle(state: boolean, deviceId?: string, options?: RequestOptions) {
    return this.send<void>(
      'PUT',
      '/me/player/shuffle',
      { state, device_id: deviceId },
      undefined,
      options,
    );
  }

  setRepeat(state: RepeatMode, deviceId?: string, options?: RequestOptions) {
    return this.send<void>(
      'PUT',
      '/me/player/repeat',
      { state, device_id: deviceId },
      undefined,
      options,
    );
  }

  /** What is lined up next. Answers `204` when nothing is playing. */
  async queue(options?: RequestOptions) {
    const body = await this.get<SpotifyQueue | undefined>('/me/player/queue', {}, options);
    return { currently_playing: body?.currently_playing ?? null, queue: body?.queue ?? [] };
  }

  addToQueue(uri: string, deviceId?: string, options?: RequestOptions) {
    return this.send<void>(
      'POST',
      '/me/player/queue',
      { uri, device_id: deviceId },
      undefined,
      options,
    );
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Wire shapes — only the fields this app reads                               */
/* -------------------------------------------------------------------------- */

export interface Paged<T> {
  items: T[];
  next: string | null;
  total?: number;
}

export interface SpotifyImage {
  url: string;
  width?: number | null;
  height?: number | null;
}

/**
 * Spotify removed `popularity`, `followers`, `available_markets`, `album_group`,
 * `label` and the user's `country`, `email`, `product` and `explicit_content` in
 * February 2026. None of them are declared here, because declaring a field the
 * API no longer sends invites code that quietly depends on `undefined`.
 */
export interface SpotifyUser {
  id: string;
  display_name?: string | null;
  images?: SpotifyImage[];
  external_urls?: { spotify?: string };
}

export interface SpotifyArtist {
  id: string;
  name: string;
  genres?: string[];
  images?: SpotifyImage[];
  external_urls?: { spotify?: string };
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  album_type?: string;
  release_date?: string;
  release_date_precision?: string;
  total_tracks?: number;
  images?: SpotifyImage[];
  artists?: SpotifyArtist[];
  tracks?: Paged<SpotifyTrack>;
  is_playable?: boolean;
  restrictions?: { reason?: string };
  external_urls?: { spotify?: string };
}

export interface SpotifyTrack {
  id: string | null;
  name: string;
  duration_ms?: number;
  explicit?: boolean;
  track_number?: number;
  disc_number?: number;
  album?: SpotifyAlbum;
  artists?: SpotifyArtist[];
  is_local?: boolean;
  is_playable?: boolean;
  restrictions?: { reason?: string };
  external_urls?: { spotify?: string };
  type?: string;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description?: string | null;
  images?: SpotifyImage[] | null;
  owner?: { id: string; display_name?: string | null };
  /** Renamed from `tracks` in February 2026; absent for playlists you do not own. */
  items?: { total?: number };
  /** The pre-2026 name, still sent to extended-quota apps. */
  tracks?: { total?: number };
  public?: boolean | null;
  external_urls?: { spotify?: string };
}

export interface PlaylistItem {
  added_at?: string;
  is_local?: boolean;
  /** Renamed from `track` in February 2026. */
  item?: SpotifyTrack | null;
  /** The pre-2026 name, still sent to extended-quota apps. */
  track?: SpotifyTrack | null;
}

export interface PlayHistory {
  track: SpotifyTrack;
  played_at: string;
  /** What it was played from, when Spotify says. Often absent. */
  context?: PlaybackContext | null;
}

export interface SpotifyShow {
  id: string;
  name: string;
  publisher?: string;
  description?: string;
  images?: SpotifyImage[];
  total_episodes?: number;
  external_urls?: { spotify?: string };
}

export interface SpotifyEpisode {
  id: string;
  name: string;
  description?: string;
  duration_ms?: number;
  release_date?: string;
  images?: SpotifyImage[];
  show?: SpotifyShow;
  external_urls?: { spotify?: string };
}

export interface SpotifyAudiobook {
  id: string;
  name: string;
  authors?: { name: string }[];
  narrators?: { name: string }[];
  publisher?: string;
  images?: SpotifyImage[];
  total_chapters?: number;
  external_urls?: { spotify?: string };
}

export interface SpotifyChapter {
  id: string;
  name: string;
  chapter_number?: number;
  duration_ms?: number;
  images?: SpotifyImage[];
  audiobook?: SpotifyAudiobook;
  external_urls?: { spotify?: string };
}

export interface SearchResponse {
  artists?: Paged<SpotifyArtist>;
  albums?: Paged<SpotifyAlbum>;
  tracks?: Paged<SpotifyTrack>;
  playlists?: Paged<SpotifyPlaylist | null>;
  shows?: Paged<SpotifyShow | null>;
  episodes?: Paged<SpotifyEpisode | null>;
  audiobooks?: Paged<SpotifyAudiobook | null>;
}

/* ---- player wire shapes -------------------------------------------------- */

export type RepeatMode = 'off' | 'context' | 'track';

export interface SpotifyDevice {
  id: string | null;
  name: string;
  type?: string;
  is_active?: boolean;
  is_private_session?: boolean;
  is_restricted?: boolean;
  supports_volume?: boolean;
  volume_percent?: number | null;
}

/** What playback is running against: a release, a list, an artist's catalogue. */
export interface PlaybackContext {
  type?: string;
  uri?: string;
  external_urls?: { spotify?: string };
}

/**
 * Spotify reports what the current device and content will *not* accept. Every
 * absent key is allowed; every key present and true is refused. Honouring this
 * is the difference between a disabled button and a command that 403s.
 */
export interface PlaybackDisallows {
  interrupting_playback?: boolean;
  pausing?: boolean;
  resuming?: boolean;
  seeking?: boolean;
  skipping_next?: boolean;
  skipping_prev?: boolean;
  toggling_repeat_context?: boolean;
  toggling_repeat_track?: boolean;
  toggling_shuffle?: boolean;
  transferring_playback?: boolean;
}

export interface PlaybackState {
  device?: SpotifyDevice | null;
  repeat_state?: RepeatMode;
  shuffle_state?: boolean;
  context?: PlaybackContext | null;
  timestamp?: number;
  progress_ms?: number | null;
  is_playing?: boolean;
  /** A track, an episode, or null while Spotify plays an advert. */
  item?: SpotifyTrack | SpotifyEpisode | null;
  currently_playing_type?: string;
  actions?: { disallows?: PlaybackDisallows };
}

export interface SpotifyQueue {
  currently_playing?: SpotifyTrack | SpotifyEpisode | null;
  queue?: (SpotifyTrack | SpotifyEpisode)[];
}
