import type { EntityType } from '../domain/types';

/**
 * What the Spotify Web API can actually do for us today.
 *
 * This table exists so the app can grey a feature out and say why, instead of
 * offering something that will fail. It is checked against the November 2024
 * deprecation notice and the current reference, and it is deliberately
 * conservative: if a capability is uncertain, it is marked unavailable.
 */

export interface Capability {
  available: boolean;
  /** Shown verbatim in the UI when unavailable or restricted. */
  note?: string;
}

export const ENTITY_SUPPORT: Record<EntityType, Capability> = {
  artist: { available: true },
  album: { available: true },
  track: { available: true },
  playlist: {
    available: true,
    note: 'Spotify-owned editorial and algorithmic playlists (Discover Weekly, Release Radar, mood mixes) are no longer readable by new apps, so only your own and other users\u2019 playlists appear.',
  },
  show: {
    available: true,
    note: 'Podcast endpoints need the playback-position scope. Turn shows on to be asked for it the next time you connect.',
  },
  episode: {
    available: true,
    note: 'Episodes are read through their show. Recently played never includes podcast episodes, so episodes are suggested from your saved library instead.',
  },
  audiobook: {
    available: true,
    note: 'Spotify serves audiobooks only in the US, UK, Canada, Ireland, New Zealand and Australia. Outside those markets the catalogue returns nothing and this stays empty.',
  },
  chapter: {
    available: true,
    note: 'Chapters are read through their audiobook, and inherit the same market limits.',
  },
};

/** Endpoints this app deliberately does not use, and why. Shown in diagnostics. */
export const UNAVAILABLE_FEATURES: { name: string; reason: string }[] = [
  {
    name: 'Recommendations',
    reason:
      'Withdrawn from new apps in November 2024. Rating suggestions here are built from your own listening and ratings instead.',
  },
  {
    name: 'Related artists',
    reason:
      'Withdrawn from new apps in November 2024. Related-artist hints are derived from shared releases in your own library.',
  },
  {
    name: 'Audio features and analysis',
    reason:
      'Withdrawn from new apps in November 2024. No tempo, key, energy or danceability data is available, and none is invented.',
  },
  {
    name: 'Featured and category playlists',
    reason: 'Withdrawn from new apps in November 2024.',
  },
  {
    name: '30-second previews',
    reason: 'Preview URLs are no longer returned to new apps, so nothing is played in this app.',
  },
  {
    name: 'Artist top tracks',
    reason:
      'Deprecated in the current reference. Popular tracks are read from the artist\u2019s albums instead.',
  },
  {
    name: 'Contents of playlists you do not own',
    reason:
      'Since February 2026 Spotify returns only metadata for playlists you neither own nor collaborate on, so their tracks cannot be read or rolled up.',
  },
  {
    name: 'Popularity, follower counts and available markets',
    reason:
      'Removed from Spotify responses in February 2026. This app never scored on them, so nothing is lost.',
  },
];

export const TOP_ITEM_TYPES: EntityType[] = ['artist', 'track'];

/** Spotify only reports top items for artists and tracks, in three windows. */
export const TOP_TERMS = ['short_term', 'medium_term', 'long_term'] as const;
export type TopTerm = (typeof TOP_TERMS)[number];

export const TERM_LABEL: Record<TopTerm, string> = {
  short_term: 'the last four weeks',
  medium_term: 'the last six months',
  long_term: 'your all-time listening',
};

/** Recently played is tracks only, and never returns more than fifty. */
export const RECENTLY_PLAYED_MAX = 50;

/**
 * Spotify cut the search page size for development-mode apps in February 2026:
 * `limit` went from a maximum of 50 to a maximum of 10, and anything larger is
 * refused outright with `400 Invalid limit`. Extended-quota apps still allow 50,
 * but ten is valid under both, so the app asks for ten and never negotiates.
 *
 * https://developer.spotify.com/documentation/web-api/references/changes/february-2026
 */
export const SEARCH_LIMIT_MAX = 10;

export const AUDIOBOOK_MARKETS = ['US', 'GB', 'CA', 'IE', 'NZ', 'AU'] as const;

export const DEVELOPMENT_MODE_USER_LIMIT = 5;
