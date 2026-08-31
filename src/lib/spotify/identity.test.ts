import { describe, expect, it } from 'vitest';

import { ContainmentGraph } from '../domain/graph';
import type { Entity } from '../domain/types';
import { mapAlbum, mapTrack, mergeResults } from './mappers';
import type { SpotifyAlbum, SpotifyTrack } from './client';

/**
 * One record, however it was found.
 *
 * A release turns up through the saved library, through a track that belongs to
 * it, through search and through whatever happens to be playing. All four must
 * land on the same key, or the library grows a second copy of the same album
 * and the ratings split between them.
 *
 * The key is `${type}:${provider}:${providerId}`, so this holds by construction
 * — which is exactly why it is worth pinning: it is the property every dedupe
 * downstream is allowed to assume.
 */

const IMAGES = [{ url: 'https://img/lg', width: 640, height: 640 }];

function albumPayload(over: Partial<SpotifyAlbum> = {}): SpotifyAlbum {
  return {
    id: 'letitbleed',
    name: 'Let It Bleed',
    album_type: 'album',
    total_tracks: 9,
    release_date: '1969-12-05',
    images: IMAGES,
    artists: [{ id: 'stones', name: 'The Rolling Stones' }],
    ...over,
  } as SpotifyAlbum;
}

/** The stripped-down album Spotify nests inside a track or a playback item. */
function simplifiedAlbum(): SpotifyAlbum {
  return {
    id: 'letitbleed',
    name: 'Let It Bleed',
    album_type: 'album',
    artists: [{ id: 'stones', name: 'The Rolling Stones' }],
  } as SpotifyAlbum;
}

function trackPayload(): SpotifyTrack {
  return {
    id: 'gimme',
    name: 'Gimme Shelter',
    track_number: 1,
    disc_number: 1,
    duration_ms: 271000,
    album: simplifiedAlbum(),
    artists: [{ id: 'stones', name: 'The Rolling Stones' }],
  } as SpotifyTrack;
}

describe('entity identity across discovery paths', () => {
  const paths = {
    library: mapAlbum(albumPayload(), 'library'),
    search: mapAlbum(albumPayload(), 'search'),
    track: mapTrack(trackPayload(), 'track'),
    playback: mapTrack(trackPayload(), 'playback'),
  };

  function albumFrom(result: { entities: Entity[] }): Entity {
    const found = result.entities.find((e) => e.type === 'album');
    expect(found).toBeDefined();
    return found!;
  }

  it('gives the release one id however it was discovered', () => {
    const ids = Object.values(paths).map((r) => albumFrom(r).id);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe('album:spotify:letitbleed');
  });

  it('collapses every path into a single record when merged', () => {
    const merged = mergeResults(...Object.values(paths));
    const albums = merged.entities.filter((e) => e.type === 'album');
    expect(albums).toHaveLength(1);
  });

  it('keeps the richer payload when a simplified one arrives after it', () => {
    const merged = mergeResults(paths.library, paths.playback);
    const record = albumFrom(merged);
    // The nested album has no artwork or date; merging must not erase them.
    expect(record.artworkUrl).toBe('https://img/lg');
    expect(record.releaseDate).toBe('1969-12-05');
    expect(record.totalChildren).toBe(9);
  });

  it('stores one entity in the graph after all four paths', () => {
    const merged = mergeResults(...Object.values(paths));
    const graph = new ContainmentGraph(merged.entities, merged.memberships);
    expect(graph.allEntities().filter((e) => e.type === 'album')).toHaveLength(1);
  });

  it('gives genuinely different editions different ids', () => {
    const original = albumFrom(mapAlbum(albumPayload(), 'search'));
    const remaster = albumFrom(
      mapAlbum(albumPayload({ id: 'letitbleed2019', release_date: '2019-11-01' }), 'search'),
    );
    expect(original.id).not.toBe(remaster.id);
    const merged = mergeResults(
      { entities: [original], memberships: [] },
      { entities: [remaster], memberships: [] },
    );
    // Two real records: kept, never silently combined.
    expect(merged.entities).toHaveLength(2);
  });

  it('does not duplicate the membership linking release to track', () => {
    const merged = mergeResults(paths.track, paths.playback, paths.library);
    const edges = merged.memberships.filter(
      (m) => m.childId === 'track:spotify:gimme' && m.parentId === 'album:spotify:letitbleed',
    );
    expect(edges).toHaveLength(1);
  });
});
