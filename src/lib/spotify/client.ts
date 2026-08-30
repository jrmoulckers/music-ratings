import {
  SpotifyAuthError,
  forgetTokens,
  refresh,
  storedTokens,
  type SpotifyConfig,
  type SpotifyTokens,
} from './auth';
import { RECENTLY_PLAYED_MAX, type TopTerm } from './capabilities';

const API = 'https://api.spotify.com/v1';

export class SpotifyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind:
      'rate-limit' | 'quota' | 'forbidden' | 'not-found' | 'offline' | 'server' | 'other',
  ) {
    super(message);
    this.name = 'SpotifyApiError';
  }
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

async function freshToken(config: SpotifyConfig): Promise<string> {
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

  async get<T>(
    path: string,
    params: Record<string, string | number | undefined> = {},
    options: RequestOptions = {},
  ): Promise<T> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    const url = `${API}${path}${query.size ? `?${query.toString()}` : ''}`;
    return this.request<T>(url, options);
  }

  private async request<T>(url: string, options: RequestOptions, attempt = 0): Promise<T> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new SpotifyApiError('You are offline, so nothing new could be fetched.', 0, 'offline');
    }

    const token = await freshToken(this.config);
    let response: Response;
    try {
      const init: RequestInit = { headers: { Authorization: `Bearer ${token}` } };
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
        .catch(() => ({}))) as { reason?: string };
      const seconds = Number(response.headers.get('Retry-After') ?? 2);
      if (body.reason === 'QUOTA_EXCEEDED') {
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
      return this.request<T>(url, options, attempt + 1);
    }

    if (response.status === 401) {
      forgetTokens();
      throw new SpotifyAuthError(
        'Your Spotify sign-in expired. Connect again to continue.',
        'expired',
      );
    }
    if (response.status === 403) {
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new SpotifyApiError(
        body.error?.message ??
          'Spotify refused that request. If this app is in development mode, your account must be added to it in the Spotify dashboard.',
        403,
        'forbidden',
      );
    }
    if (response.status === 404) {
      throw new SpotifyApiError(
        'Spotify has nothing at that address for your market.',
        404,
        'not-found',
      );
    }
    if (response.status >= 500) {
      if (attempt < 3) {
        await sleep(2 ** attempt * 700, options.signal);
        return this.request<T>(url, options, attempt + 1);
      }
      throw new SpotifyApiError('Spotify is having trouble right now.', response.status, 'server');
    }
    if (!response.ok) {
      // Spotify explains itself in the body ("Invalid market code", "Bad
      // request"). Swallowing that leaves a bare status code and nothing to act
      // on, so pass the reason through when there is one.
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string } | string;
      };
      const detail =
        typeof body.error === 'string' ? body.error : (body.error?.message ?? '').trim();
      throw new SpotifyApiError(
        detail
          ? `Spotify returned ${response.status}: ${detail}`
          : `Spotify returned ${response.status}.`,
        response.status,
        'other',
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
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

  search(query: string, types: readonly string[], limit = 20, options?: RequestOptions) {
    return this.get<SearchResponse>(
      '/search',
      { q: query, type: types.join(','), limit, market: this.market },
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
   * `/items` is the newer address but Spotify restricts it to playlists you own
   * or collaborate on, which would silently drop every playlist you merely
   * follow. `/tracks` still answers for all of them.
   */
  playlistTracks(id: string, options?: RequestOptions & { max?: number }) {
    return this.collect<PlaylistItem>(
      `/playlists/${id}/tracks`,
      { market: this.market, additional_types: 'track' },
      options,
    );
  }

  artist(id: string, options?: RequestOptions) {
    return this.get<SpotifyArtist>(`/artists/${id}`, {}, options);
  }

  artistAlbums(id: string, options?: RequestOptions & { max?: number }) {
    return this.collect<SpotifyAlbum>(
      `/artists/${id}/albums`,
      { include_groups: 'album,single,compilation', market: this.market },
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

export interface SpotifyUser {
  id: string;
  display_name?: string | null;
  images?: SpotifyImage[];
  product?: string;
  external_urls?: { spotify?: string };
}

export interface SpotifyArtist {
  id: string;
  name: string;
  genres?: string[];
  images?: SpotifyImage[];
  popularity?: number;
  external_urls?: { spotify?: string };
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  album_type?: string;
  album_group?: string;
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
  tracks?: { total?: number };
  public?: boolean | null;
  external_urls?: { spotify?: string };
}

export interface PlaylistItem {
  added_at?: string;
  is_local?: boolean;
  track: SpotifyTrack | null;
}

export interface PlayHistory {
  track: SpotifyTrack;
  played_at: string;
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
