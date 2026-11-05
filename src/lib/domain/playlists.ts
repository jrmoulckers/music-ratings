import { buildRankedList, type ListInput } from './lists';
import { SCORE_VIEWS, type ScoreView } from './types';

export const PLAYLIST_SIZES = [10, 25, 50, 100, 250, 500] as const;
export type PlaylistSize = (typeof PLAYLIST_SIZES)[number];

export const LEGACY_PLAYLISTS_KEY = 'ranked-spotify-playlists';

export interface ManagedPlaylist {
  id: string;
  accountId: string;
  size: PlaylistSize;
  view: ScoreView;
  live: boolean;
  lastUris: string[];
  syncedAt: number | null;
  error: string | null;
  updatedAt: number;
  preferenceUpdatedAt?: number;
  deleted?: number;
}

export function isManagedPlaylist(value: unknown): value is ManagedPlaylist {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<ManagedPlaylist>;
  return (
    typeof row.id === 'string' &&
    /^[a-zA-Z0-9]+$/.test(row.id) &&
    typeof row.accountId === 'string' &&
    row.accountId.length > 0 &&
    PLAYLIST_SIZES.some((size) => size === row.size) &&
    SCORE_VIEWS.some((view) => view === row.view) &&
    typeof row.live === 'boolean' &&
    Array.isArray(row.lastUris) &&
    row.lastUris.every(
      (uri) => typeof uri === 'string' && /^spotify:track:[a-zA-Z0-9]+$/.test(uri),
    ) &&
    (row.syncedAt === null ||
      (typeof row.syncedAt === 'number' && Number.isFinite(row.syncedAt))) &&
    (row.error === null || typeof row.error === 'string') &&
    typeof row.updatedAt === 'number' &&
    Number.isFinite(row.updatedAt) &&
    (row.preferenceUpdatedAt === undefined ||
      (typeof row.preferenceUpdatedAt === 'number' && Number.isFinite(row.preferenceUpdatedAt))) &&
    (row.deleted === undefined || (typeof row.deleted === 'number' && Number.isFinite(row.deleted)))
  );
}

export function rankedPlaylist(input: ListInput, size: PlaylistSize, view: ScoreView) {
  const ranked = buildRankedList(input, {
    type: 'track',
    view,
    direction: 'top',
    limit: Number.MAX_SAFE_INTEGER,
  });
  const seen = new Set<string>();
  let excluded = 0;
  const eligible = ranked.rows.flatMap((row) => {
    const source = input.graph
      .sourcesOf(row.entityId)
      .find(
        (entity) =>
          entity.provider === 'spotify' &&
          entity.available !== false &&
          /^[a-zA-Z0-9]+$/.test(entity.providerId),
      );
    if (!source) {
      excluded += 1;
      return [];
    }
    const uri = `spotify:track:${source.providerId}`;
    if (seen.has(uri)) return [];
    seen.add(uri);
    return [{ ...row, uri }];
  });
  const rows = eligible.slice(0, size);
  return { rows, uris: rows.map((row) => row.uri), excluded, eligible: eligible.length };
}
