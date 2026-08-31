import { describe, expect, it } from 'vitest';

import { entitiesForPlaying, playingEntityIds, playingItemFromEntity } from './entities';
import type { Entity } from '../domain/types';
import type { PlayingItem } from './types';

/**
 * Rating has to work on something you have never imported, so what is playing
 * becomes an ordinary catalogue row on first sight. The ids it produces must
 * match the ones the library import produces exactly, or the app would end up
 * holding two records for the same track and rating the wrong one.
 */

const playing: PlayingItem = {
  id: 't1',
  uri: 'spotify:track:t1',
  kind: 'track',
  name: 'Cold Sweat',
  artists: [
    { id: 'a1', name: 'James Brown' },
    { id: 'a2', name: 'The Famous Flames' },
  ],
  release: { id: 'al1', uri: 'spotify:album:al1', name: 'Cold Sweat', totalTracks: 10 },
  artwork: 'art.jpg',
  durationMs: 180_000,
  trackNumber: 3,
  isLocal: false,
  playable: true,
  spotifyUrl: 'https://open.spotify.com/track/t1',
};

describe('playingEntityIds', () => {
  it('names the track, the release and every credited artist', () => {
    expect(playingEntityIds(playing)).toEqual({
      track: 'track:spotify:t1',
      release: 'album:spotify:al1',
      artists: ['artist:spotify:a1', 'artist:spotify:a2'],
    });
  });

  it('maps an episode onto its show rather than an album and an artist', () => {
    const episode: PlayingItem = {
      ...playing,
      id: 'e1',
      uri: 'spotify:episode:e1',
      kind: 'episode',
      artists: [{ id: 's1', name: 'A show' }],
      release: { id: 's1', uri: 'spotify:show:s1', name: 'A show' },
    };
    expect(playingEntityIds(episode)).toEqual({
      track: 'episode:spotify:e1',
      release: 'show:spotify:s1',
      artists: ['show:spotify:s1'],
    });
  });

  it('has nothing to offer for adverts, local files and silence', () => {
    const none = { track: null, release: null, artists: [] };
    expect(playingEntityIds(null)).toEqual(none);
    expect(playingEntityIds({ ...playing, kind: 'ad', id: null })).toEqual(none);
    expect(playingEntityIds({ ...playing, isLocal: true })).toEqual(none);
  });
});

describe('entitiesForPlaying', () => {
  it('builds the track, its release and its artists with their memberships', () => {
    const { entities, memberships } = entitiesForPlaying(playing, 1_000);
    const ids = entities.map((e) => e.id).sort();
    expect(ids).toEqual(
      ['album:spotify:al1', 'artist:spotify:a1', 'artist:spotify:a2', 'track:spotify:t1'].sort(),
    );
    const track = entities.find((e) => e.id === 'track:spotify:t1');
    expect(track).toMatchObject({
      name: 'Cold Sweat',
      durationMs: 180_000,
      trackNumber: 3,
      externalUrl: 'https://open.spotify.com/track/t1',
    });
    expect(memberships.some((m) => m.parentId === 'album:spotify:al1')).toBe(true);
  });

  it('splits the credit between two artists rather than counting the track twice', () => {
    const { memberships } = entitiesForPlaying(playing, 1_000);
    const credits = memberships.filter((m) => m.parentType === 'artist' && m.childType === 'track');
    expect(credits).toHaveLength(2);
    const total = credits.reduce((sum, m) => sum + (m.share ?? 1), 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('writes nothing for an advert, a local file or silence', () => {
    expect(entitiesForPlaying(null).entities).toEqual([]);
    expect(entitiesForPlaying({ ...playing, kind: 'ad', id: null }).entities).toEqual([]);
    expect(entitiesForPlaying({ ...playing, isLocal: true }).entities).toEqual([]);
  });
});

describe('playingItemFromEntity', () => {
  const entity: Entity = {
    id: 'track:spotify:t1',
    type: 'track',
    provider: 'spotify',
    providerId: 't1',
    name: 'Cold Sweat',
    subtitle: 'James Brown',
    durationMs: 180_000,
    updatedAt: 1,
  } as Entity;

  it('round-trips a stored track back into something playable', () => {
    const item = playingItemFromEntity(entity);
    expect(item).toMatchObject({
      id: 't1',
      uri: 'spotify:track:t1',
      kind: 'track',
      name: 'Cold Sweat',
      durationMs: 180_000,
      isLocal: false,
    });
    expect(item?.artists).toEqual([{ id: null, name: 'James Brown' }]);
  });

  it('attaches the release when one is known', () => {
    const album = {
      id: 'album:spotify:al1',
      type: 'album',
      provider: 'spotify',
      providerId: 'al1',
      name: 'Cold Sweat',
      artworkUrl: 'art.jpg',
      updatedAt: 1,
    } as Entity;
    expect(playingItemFromEntity(entity, album)?.release).toMatchObject({
      id: 'al1',
      uri: 'spotify:album:al1',
      artwork: 'art.jpg',
    });
  });

  it('gives a track with no stored length a plausible one rather than zero', () => {
    const noLength = { ...entity, durationMs: undefined } as Entity;
    expect(playingItemFromEntity(noLength)?.durationMs).toBeGreaterThan(0);
  });

  it('refuses to make an album or an artist into something playing', () => {
    expect(playingItemFromEntity({ ...entity, type: 'album' } as Entity)).toBeNull();
    expect(playingItemFromEntity({ ...entity, type: 'artist' } as Entity)).toBeNull();
  });

  it('carries the rows it came from, so it resolves to them rather than to a guess', () => {
    const album = {
      ...entity,
      id: 'album:local:al1',
      type: 'album',
      provider: 'local',
      providerId: 'al1',
    } as Entity;
    const artist = {
      ...entity,
      id: 'artist:local:a1',
      type: 'artist',
      provider: 'local',
      providerId: 'a1',
      name: 'James Brown',
    } as Entity;
    const stored = { ...entity, id: 'track:local:t1', provider: 'local' } as Entity;
    const item = playingItemFromEntity(stored, album, [artist]);
    expect(item?.origin).toEqual({
      track: 'track:local:t1',
      release: 'album:local:al1',
      artists: ['artist:local:a1'],
    });
    expect(item?.artists).toEqual([{ id: 'a1', name: 'James Brown' }]);
    // The whole point: a catalogue that never came from Spotify still resolves.
    expect(playingEntityIds(item)).toEqual({
      track: 'track:local:t1',
      release: 'album:local:al1',
      artists: ['artist:local:a1'],
    });
    // And nothing is filed a second time under a provider it never came from.
    expect(entitiesForPlaying(item).entities).toEqual([]);
  });
});
