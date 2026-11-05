import { describe, expect, it } from 'vitest';

import { ContainmentGraph } from './graph';
import { buildRankedList } from './lists';
import { PLAYLIST_SIZES, rankedPlaylist } from './playlists';
import { indexCurrentRatings } from './ratings';
import { computeScores, defaultRollupConfigByType } from './rollup';
import { makeEntity, rate } from '../../test/fixtures';
import type { Entity } from './types';

function input(entities: Entity[]) {
  const graph = new ContainmentGraph(entities, []);
  const explicit = indexCurrentRatings(entities.map((entity, i) => rate(entity, 100 - i / 10)));
  return {
    graph,
    explicit,
    scores: computeScores(
      { graph, explicit, rankings: new Map(), config: defaultRollupConfigByType() },
      entities.map((entity) => entity.id),
    ),
  };
}

function tracks(count: number) {
  return Array.from({ length: count }, (_, i) =>
    makeEntity('track', `t${i}`, { provider: 'spotify', providerId: `t${i}` }),
  );
}

describe('ranked Spotify playlist selection', () => {
  it.each(PLAYLIST_SIZES)('selects exactly the top %i tracks in ranking order', (size) => {
    const data = input(tracks(510));
    const result = rankedPlaylist(data, size, 'explicit');
    const ranked = buildRankedList(data, {
      type: 'track',
      view: 'explicit',
      direction: 'top',
      limit: size,
    });
    expect(result.rows.map((row) => row.entityId)).toEqual(ranked.rows.map((row) => row.entityId));
    expect(result.uris).toHaveLength(size);
    expect(result.uris[0]).toBe('spotify:track:t0');
    expect(result.uris[size - 1]).toBe(`spotify:track:t${size - 1}`);
  });

  it('filters before limiting, excludes local and unavailable tracks, and deduplicates URIs', () => {
    const entities = tracks(20);
    entities[0]!.provider = 'local';
    entities[1]!.available = false;
    entities[2]!.providerId = entities[3]!.providerId;
    const result = rankedPlaylist(input(entities), 10, 'explicit');
    expect(result.excluded).toBe(2);
    expect(result.uris).toHaveLength(10);
    expect(new Set(result.uris).size).toBe(10);
    expect(result.uris.at(-1)).toBe('spotify:track:t12');
  });

  it('does not pad a short list or include unrated tracks', () => {
    const data = input(tracks(3));
    const unrated = makeEntity('track', 'unrated', { provider: 'spotify' });
    data.graph = new ContainmentGraph([...data.graph.allEntities(), unrated], []);
    expect(rankedPlaylist(data, 500, 'explicit').uris).toHaveLength(3);
    expect(rankedPlaylist(data, 10, 'context').uris).toEqual([]);
  });

  it('keeps equal-score order identical to Rankings', () => {
    const data = input(tracks(20));
    for (const score of data.scores.values()) score.explicit = 95;
    const ranked = buildRankedList(data, {
      type: 'track',
      view: 'explicit',
      direction: 'top',
      limit: 10,
    });
    expect(rankedPlaylist(data, 10, 'explicit').rows.map((row) => row.entityId)).toEqual(
      ranked.rows.map((row) => row.entityId),
    );
  });

  it('can use an available Spotify source behind a local canonical track', () => {
    const primary = makeEntity('track', 'primary');
    const alias = makeEntity('track', 'alias', { provider: 'spotify', providerId: 'spotifyalias' });
    const data = input([primary, alias]);
    data.graph = new ContainmentGraph([primary, alias], [], { resolve: () => primary.id });
    expect(rankedPlaylist(data, 10, 'explicit').uris).toEqual(['spotify:track:spotifyalias']);
  });
});
