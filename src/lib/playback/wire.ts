import type {
  PlaybackState as WirePlaybackState,
  SpotifyDevice,
  SpotifyEpisode,
  SpotifyImage,
  SpotifyTrack,
} from '../spotify/client';
import { contextFromUri } from './model';
import type { Disallows, PlaybackDevice, PlaybackSnapshot, PlayingItem } from './types';

/**
 * Spotify's wire shapes, translated once.
 *
 * Everything above this file works in the app's own vocabulary. Adverts, local
 * files, missing artwork and half-populated payloads are all resolved here so no
 * screen has to ask whether `item.artists` exists.
 */

function largestArtwork(images: SpotifyImage[] | undefined | null): string | undefined {
  if (!images?.length) return undefined;
  const sorted = [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return sorted[0]?.url;
}

function isEpisode(item: SpotifyTrack | SpotifyEpisode): item is SpotifyEpisode {
  return 'show' in item || (item as { type?: string }).type === 'episode';
}

export function mapPlayingItem(
  item: SpotifyTrack | SpotifyEpisode | null | undefined,
  currentlyPlayingType?: string,
): PlayingItem | null {
  if (!item) {
    // Spotify sends a null item while an advert plays. That is worth naming
    // rather than showing an empty player.
    if (currentlyPlayingType === 'ad') {
      return {
        id: null,
        uri: null,
        kind: 'ad',
        name: 'Advertisement',
        artists: [],
        release: null,
        durationMs: 0,
        isLocal: false,
        playable: true,
      };
    }
    return null;
  }

  if (isEpisode(item)) {
    const show = item.show;
    return {
      id: item.id ?? null,
      uri: item.id ? `spotify:episode:${item.id}` : null,
      kind: 'episode',
      name: item.name,
      artists: show ? [{ id: show.id ?? null, name: show.name }] : [],
      release: show
        ? {
            id: show.id ?? null,
            uri: show.id ? `spotify:show:${show.id}` : null,
            name: show.name,
            ...(largestArtwork(show.images) ? { artwork: largestArtwork(show.images) } : {}),
          }
        : null,
      ...(largestArtwork(item.images ?? show?.images)
        ? { artwork: largestArtwork(item.images ?? show?.images) }
        : {}),
      durationMs: item.duration_ms ?? 0,
      isLocal: false,
      playable: true,
      ...(item.external_urls?.spotify ? { spotifyUrl: item.external_urls.spotify } : {}),
    };
  }

  const album = item.album;
  const artwork = largestArtwork(album?.images);
  return {
    id: item.id ?? null,
    uri: item.id ? `spotify:track:${item.id}` : null,
    kind: 'track',
    name: item.name,
    artists: (item.artists ?? []).map((a) => ({ id: a.id ?? null, name: a.name })),
    release: album
      ? {
          id: album.id ?? null,
          uri: album.id ? `spotify:album:${album.id}` : null,
          name: album.name,
          ...(artwork ? { artwork } : {}),
          ...(album.total_tracks ? { totalTracks: album.total_tracks } : {}),
        }
      : null,
    ...(artwork ? { artwork } : {}),
    durationMs: item.duration_ms ?? 0,
    ...(item.track_number ? { trackNumber: item.track_number } : {}),
    ...(item.disc_number ? { discNumber: item.disc_number } : {}),
    isLocal: item.is_local === true,
    playable: item.is_playable !== false,
    ...(item.external_urls?.spotify ? { spotifyUrl: item.external_urls.spotify } : {}),
  };
}

export function mapDevice(device: SpotifyDevice | null | undefined): PlaybackDevice | null {
  if (!device) return null;
  return {
    id: device.id ?? null,
    name: device.name,
    type: (device.type ?? 'unknown').toLowerCase(),
    active: device.is_active === true,
    restricted: device.is_restricted === true,
    privateSession: device.is_private_session === true,
    supportsVolume: device.supports_volume !== false,
    volumePercent: typeof device.volume_percent === 'number' ? device.volume_percent : null,
  };
}

export function mapDevices(devices: SpotifyDevice[] | undefined): PlaybackDevice[] {
  return (devices ?? []).map((d) => mapDevice(d)).filter((d): d is PlaybackDevice => d !== null);
}

function mapDisallows(state: WirePlaybackState): Disallows {
  const d = state.actions?.disallows ?? {};
  const out: Disallows = {};
  if (d.pausing) out.pausing = true;
  if (d.resuming) out.resuming = true;
  if (d.seeking) out.seeking = true;
  if (d.skipping_next) out.skippingNext = true;
  if (d.skipping_prev) out.skippingPrevious = true;
  if (d.toggling_shuffle) out.togglingShuffle = true;
  if (d.toggling_repeat_context) out.togglingRepeatContext = true;
  if (d.toggling_repeat_track) out.togglingRepeatTrack = true;
  if (d.transferring_playback) out.transferring = true;
  return out;
}

/**
 * A whole reading, stamped with this device's clock.
 *
 * Spotify's own `timestamp` is its server's, and comparing it to `Date.now()`
 * would fold clock skew straight into the progress bar. The local stamp is what
 * the interpolation counts from.
 */
export function mapSnapshot(state: WirePlaybackState | null | undefined, at: number) {
  if (!state) return null;
  const item = mapPlayingItem(state.item, state.currently_playing_type);
  const snapshot: PlaybackSnapshot = {
    item,
    context: contextFromUri(state.context?.uri),
    device: mapDevice(state.device),
    playing: state.is_playing === true,
    progressMs: Math.max(0, state.progress_ms ?? 0),
    durationMs: item?.durationMs ?? 0,
    shuffle: state.shuffle_state === true,
    repeat: state.repeat_state ?? 'off',
    disallows: mapDisallows(state),
    at,
  };
  return snapshot;
}
