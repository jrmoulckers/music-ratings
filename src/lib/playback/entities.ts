import { entityId } from '../domain/ids';
import type { Entity, EntityId } from '../domain/types';
import type { SpotifyEpisode, SpotifyTrack } from '../spotify/client';
import { mapEpisode, mapTrack, mergeResults, type MapResult } from '../spotify/mappers';
import type { PlayingItem } from './types';

/**
 * Turning what is playing into something rateable.
 *
 * A listener can start playing anything at all, including records they have
 * never imported. Rating has to work anyway, so the moment something plays it
 * is written into the local store through the same mappers the library import
 * uses — same ids, same credit splits, no duplicates.
 */

const PROVIDER = 'spotify' as const;

export interface PlayingEntityIds {
  track: EntityId | null;
  release: EntityId | null;
  artists: EntityId[];
}

/** The canonical ids for what is playing, whether or not it is stored yet. */
export function playingEntityIds(item: PlayingItem | null): PlayingEntityIds {
  if (!item || item.isLocal || item.kind === 'ad') {
    return { track: null, release: null, artists: [] };
  }
  // An item that came out of the local store already knows which rows it is.
  if (item.origin) {
    return {
      track: item.origin.track as EntityId,
      release: (item.origin.release ?? null) as EntityId | null,
      artists: (item.origin.artists ?? []) as EntityId[],
    };
  }
  if (!item.id) return { track: null, release: null, artists: [] };
  const type = item.kind === 'episode' ? 'episode' : 'track';
  const releaseType = item.kind === 'episode' ? 'show' : 'album';
  return {
    track: entityId(type, PROVIDER, item.id),
    release: item.release?.id ? entityId(releaseType, PROVIDER, item.release.id) : null,
    artists: item.artists
      .filter((a) => a.id)
      .map((a) => entityId(item.kind === 'episode' ? 'show' : 'artist', PROVIDER, a.id as string)),
  };
}

/**
 * Rebuild the catalogue records for what is playing.
 *
 * The playback layer speaks its own vocabulary, so the wire shapes are put back
 * together here rather than kept around: it keeps one description of a track in
 * the app instead of two that can drift.
 */
export function entitiesForPlaying(item: PlayingItem | null, now = Date.now()): MapResult {
  if (!item || !item.id || item.isLocal || item.kind === 'ad') {
    return { entities: [], memberships: [] };
  }
  // Already in the catalogue. Rebuilding it would file a second copy under a
  // provider it never came from.
  if (item.origin) return { entities: [], memberships: [] };

  if (item.kind === 'episode') {
    const show = item.release;
    const episode: SpotifyEpisode = {
      id: item.id,
      name: item.name,
      duration_ms: item.durationMs,
      ...(item.artwork ? { images: [{ url: item.artwork }] } : {}),
      ...(show?.id
        ? {
            show: {
              id: show.id,
              name: show.name,
              ...(show.artwork ? { images: [{ url: show.artwork }] } : {}),
            },
          }
        : {}),
      ...(item.spotifyUrl ? { external_urls: { spotify: item.spotifyUrl } } : {}),
    };
    return mergeResults(mapEpisode(episode, 'now playing', now));
  }

  const release = item.release;
  const track: SpotifyTrack = {
    id: item.id,
    name: item.name,
    duration_ms: item.durationMs,
    ...(item.trackNumber ? { track_number: item.trackNumber } : {}),
    ...(item.discNumber ? { disc_number: item.discNumber } : {}),
    artists: item.artists.filter((a) => a.id).map((a) => ({ id: a.id as string, name: a.name })),
    ...(release?.id
      ? {
          album: {
            id: release.id,
            name: release.name,
            ...(release.artwork ? { images: [{ url: release.artwork }] } : {}),
            ...(release.totalTracks ? { total_tracks: release.totalTracks } : {}),
            // The billed artists of a release are not always the performers on
            // one of its tracks, but for a single playing item they are the
            // best evidence available and the mapper splits credit either way.
            artists: item.artists
              .filter((a) => a.id)
              .map((a) => ({ id: a.id as string, name: a.name })),
          },
        }
      : {}),
    ...(item.spotifyUrl ? { external_urls: { spotify: item.spotifyUrl } } : {}),
    ...(item.playable ? {} : { is_playable: false }),
  };
  // The same artist is credited on both the track and its release, so the
  // mapper names them twice. Merging collapses that into one record.
  return mergeResults(mapTrack(track, 'now playing', now));
}

export function entitiesForPlayingItems(items: PlayingItem[], now = Date.now()): MapResult {
  return mergeResults(...items.map((item) => entitiesForPlaying(item, now)));
}

/* -------------------------------------------------------------------------- */
/* The other direction: stored records as something to play                   */
/* -------------------------------------------------------------------------- */

const DEFAULT_DEMO_DURATION_MS = 194_000;

/**
 * A stored track, described as a playing item.
 *
 * Demo playback runs on the listener's own library rather than on invented
 * records: this app never ships a fake catalogue, and a simulation over real
 * rows exercises the same code the real transport does.
 */
export function playingItemFromEntity(
  entity: Entity,
  release?: Entity | undefined,
  artists: readonly Entity[] = [],
): PlayingItem | null {
  if (entity.type !== 'track' && entity.type !== 'episode') return null;
  const performers = artists.length
    ? artists.map((a) => ({ id: a.providerId, name: a.name }))
    : entity.subtitle
      ? [{ id: null, name: entity.subtitle }]
      : [];
  return {
    id: entity.providerId,
    uri: `spotify:${entity.type}:${entity.providerId}`,
    kind: entity.type === 'episode' ? 'episode' : 'track',
    name: entity.name,
    artists: performers,
    release: release
      ? {
          id: release.providerId,
          uri: `spotify:${release.type}:${release.providerId}`,
          name: release.name,
          ...(release.artworkUrl ? { artwork: release.artworkUrl } : {}),
          ...(release.totalChildren ? { totalTracks: release.totalChildren } : {}),
        }
      : null,
    ...(entity.artworkUrl ? { artwork: entity.artworkUrl } : {}),
    durationMs: entity.durationMs ?? DEFAULT_DEMO_DURATION_MS,
    ...(entity.trackNumber ? { trackNumber: entity.trackNumber } : {}),
    ...(entity.discNumber ? { discNumber: entity.discNumber } : {}),
    isLocal: false,
    playable: entity.available !== false,
    ...(entity.externalUrl ? { spotifyUrl: entity.externalUrl } : {}),
    origin: {
      track: entity.id,
      ...(release ? { release: release.id } : {}),
      ...(artists.length ? { artists: artists.map((a) => a.id) } : {}),
    },
  };
}
