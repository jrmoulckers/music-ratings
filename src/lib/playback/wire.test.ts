import { describe, expect, it } from 'vitest';

import type { PlaybackState as WirePlaybackState, SpotifyTrack } from '../spotify/client';
import { mapDevices, mapPlayingItem, mapSnapshot } from './wire';

/**
 * Spotify's payloads are half-populated far more often than its documentation
 * suggests: adverts arrive with a null item, local files have no ids, episodes
 * arrive in the same field as tracks. Every one of those has put a broken
 * player in front of somebody at some point, so each has a test here.
 */

const track = {
  id: 't1',
  name: 'Cold Sweat',
  duration_ms: 180_000,
  track_number: 3,
  disc_number: 1,
  artists: [{ id: 'a1', name: 'James Brown' }],
  album: {
    id: 'al1',
    name: 'Cold Sweat',
    total_tracks: 10,
    images: [
      { url: 'small.jpg', width: 64, height: 64 },
      { url: 'big.jpg', width: 640, height: 640 },
    ],
  },
  external_urls: { spotify: 'https://open.spotify.com/track/t1' },
} as unknown as SpotifyTrack;

describe('mapPlayingItem', () => {
  it('translates a track, largest artwork first', () => {
    const item = mapPlayingItem(track);
    expect(item).toMatchObject({
      id: 't1',
      uri: 'spotify:track:t1',
      kind: 'track',
      name: 'Cold Sweat',
      artwork: 'big.jpg',
      durationMs: 180_000,
      trackNumber: 3,
      isLocal: false,
      playable: true,
      spotifyUrl: 'https://open.spotify.com/track/t1',
    });
    expect(item?.artists).toEqual([{ id: 'a1', name: 'James Brown' }]);
    expect(item?.release).toMatchObject({ id: 'al1', uri: 'spotify:album:al1', totalTracks: 10 });
  });

  it('names an advert instead of showing an empty player', () => {
    const item = mapPlayingItem(null, 'ad');
    expect(item).toMatchObject({ kind: 'ad', name: 'Advertisement', id: null, uri: null });
  });

  it('is null when there is genuinely nothing', () => {
    expect(mapPlayingItem(null)).toBeNull();
    expect(mapPlayingItem(undefined, 'track')).toBeNull();
  });

  it('marks a local file, which has no Spotify identity', () => {
    const local = mapPlayingItem({
      ...track,
      id: null,
      is_local: true,
    } as unknown as SpotifyTrack);
    expect(local).toMatchObject({ id: null, uri: null, isLocal: true });
  });

  it('carries the unplayable flag rather than hiding it', () => {
    const blocked = mapPlayingItem({ ...track, is_playable: false } as unknown as SpotifyTrack);
    expect(blocked?.playable).toBe(false);
  });

  it('treats an episode as its show, not as a track with no artist', () => {
    const episode = mapPlayingItem({
      id: 'e1',
      type: 'episode',
      name: 'Episode one',
      duration_ms: 900_000,
      show: { id: 's1', name: 'A show', images: [{ url: 'show.jpg', width: 300, height: 300 }] },
    } as never);
    expect(episode).toMatchObject({
      kind: 'episode',
      uri: 'spotify:episode:e1',
      artwork: 'show.jpg',
    });
    expect(episode?.artists).toEqual([{ id: 's1', name: 'A show' }]);
    expect(episode?.release).toMatchObject({ id: 's1', uri: 'spotify:show:s1' });
  });
});

describe('mapDevices', () => {
  it('normalises the type and the flags Spotify omits when false', () => {
    const devices = mapDevices([
      {
        id: 'd1',
        name: 'Kitchen',
        type: 'Speaker',
        is_active: true,
        volume_percent: 40,
      },
      { id: null, name: 'Restricted thing', type: 'Computer', is_restricted: true },
    ] as never);
    expect(devices[0]).toEqual({
      id: 'd1',
      name: 'Kitchen',
      type: 'speaker',
      active: true,
      restricted: false,
      privateSession: false,
      supportsVolume: true,
      volumePercent: 40,
    });
    expect(devices[1]).toMatchObject({ id: null, restricted: true, volumePercent: null });
  });

  it('survives the empty list Spotify returns when nothing is awake', () => {
    expect(mapDevices(undefined)).toEqual([]);
    expect(mapDevices([])).toEqual([]);
  });
});

describe('mapSnapshot', () => {
  const state = {
    device: { id: 'd1', name: 'Kitchen', type: 'Speaker', supports_volume: true },
    is_playing: true,
    progress_ms: 42_000,
    timestamp: 1_700_000_000_000,
    shuffle_state: true,
    repeat_state: 'context',
    context: { uri: 'spotify:album:al1', type: 'album' },
    item: track,
    currently_playing_type: 'track',
    actions: { disallows: { seeking: true, skipping_prev: true } },
  } as unknown as WirePlaybackState;

  it('stamps the reading with this device’s clock, never Spotify’s', () => {
    const snapshot = mapSnapshot(state, 555);
    expect(snapshot?.at).toBe(555);
  });

  it('carries the whole reading across', () => {
    const snapshot = mapSnapshot(state, 555);
    expect(snapshot).toMatchObject({
      playing: true,
      progressMs: 42_000,
      durationMs: 180_000,
      shuffle: true,
      repeat: 'context',
    });
    expect(snapshot?.context).toEqual({ kind: 'album', uri: 'spotify:album:al1', id: 'al1' });
    expect(snapshot?.device).toMatchObject({ id: 'd1', name: 'Kitchen' });
  });

  it('keeps only the refusals Spotify actually sent', () => {
    expect(mapSnapshot(state, 1)?.disallows).toEqual({ seeking: true, skippingPrevious: true });
  });

  it('is null when Spotify reports nothing playing anywhere', () => {
    expect(mapSnapshot(null, 1)).toBeNull();
  });

  it('never reports a negative position from a stale payload', () => {
    const odd = mapSnapshot({ ...state, progress_ms: -5 } as never, 1);
    expect(odd?.progressMs).toBe(0);
  });
});
