import type { ListeningSignals, PlaySignal, SavedSignal, TopSignal } from '../domain/suggestions';
import type { Entity, EntityType, Membership } from '../domain/types';
import { entityId } from '../domain/ids';
import { META_CURSORS, readMeta, writeMeta } from '../storage/db';
import { replaceChildren, saveMemberships, upsertEntities } from '../storage/repo';
import { SpotifyApiError, type SpotifyClient } from './client';
import {
  mapAlbum,
  mapArtist,
  mapAudiobook,
  mapChapter,
  mapEpisode,
  mapPlaylist,
  mapPlaylistItems,
  mapShow,
  mapTrack,
  mergeResults,
  type MapResult,
} from './mappers';

/**
 * Pulling the user's account into the local library.
 *
 * Every step is independently failable: a revoked podcast scope must not stop
 * saved albums from arriving. Each step reports what it managed and what it
 * could not, and the caller shows that list rather than a single red banner.
 */

export interface ImportStep {
  key: string;
  label: string;
  status: 'ok' | 'skipped' | 'failed';
  count: number;
  detail?: string;
}

export interface ImportReport {
  startedAt: number;
  finishedAt: number;
  steps: ImportStep[];
  entities: number;
  memberships: number;
}

export interface StoredSignals extends ListeningSignals {
  fetchedAt: number;
}

const SIGNALS_KEY = 'spotify-signals';

export async function readSignals(): Promise<StoredSignals | undefined> {
  return readMeta<StoredSignals>(SIGNALS_KEY);
}

export async function writeSignals(signals: StoredSignals): Promise<void> {
  await writeMeta(SIGNALS_KEY, signals);
}

export async function clearSignals(): Promise<void> {
  await writeMeta(SIGNALS_KEY, undefined);
}

export interface ImportOptions {
  client: SpotifyClient;
  enabledTypes: readonly EntityType[];
  /** Ceiling per paged endpoint, so a huge library cannot spend the whole rate budget. */
  maxPerEndpoint?: number;
  onProgress?: (step: ImportStep) => void;
  signal?: AbortSignal;
}

/**
 * One pass over everything the account exposes. Safe to run repeatedly: entity
 * upserts merge, and playlist contents are reconciled rather than duplicated.
 */
export async function importLibrary(options: ImportOptions): Promise<ImportReport> {
  const { client } = options;
  const max = options.maxPerEndpoint ?? 400;
  const enabled = new Set(options.enabledTypes);
  const startedAt = Date.now();
  const steps: ImportStep[] = [];
  const results: MapResult[] = [];
  const plays: PlaySignal[] = [];
  const top: TopSignal[] = [];
  const saved: SavedSignal[] = [];

  const run = async (
    key: string,
    label: string,
    enabledFor: EntityType | null,
    task: () => Promise<number>,
  ) => {
    if (enabledFor && !enabled.has(enabledFor)) {
      const step: ImportStep = {
        key,
        label,
        status: 'skipped',
        count: 0,
        detail: 'Turned off in settings.',
      };
      steps.push(step);
      options.onProgress?.(step);
      return;
    }
    try {
      const count = await task();
      const step: ImportStep = { key, label, status: 'ok', count };
      steps.push(step);
      options.onProgress?.(step);
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      const step: ImportStep = {
        key,
        label,
        status: 'failed',
        count: 0,
        detail: describe(error),
      };
      steps.push(step);
      options.onProgress?.(step);
    }
  };

  const req = { ...(options.signal ? { signal: options.signal } : {}), max };

  /* ---- listening signals ------------------------------------------------- */

  await run('recent', 'Recently played', null, async () => {
    const { items } = await client.recentlyPlayed(req);
    items.forEach((item, index) => {
      if (!item.track?.id) return;
      results.push(mapTrack(item.track, 'recently played'));
      plays.push({
        entityId: entityId('track', 'spotify', item.track.id),
        at: Date.parse(item.played_at),
        index,
      });
    });
    return items.length;
  });

  for (const [term, label] of [
    ['short_term', 'Top items — 4 weeks'],
    ['medium_term', 'Top items — 6 months'],
    ['long_term', 'Top items — all time'],
  ] as const) {
    await run(`top-${term}`, label, null, async () => {
      let count = 0;
      const shortTerm =
        term === 'short_term' ? 'short' : term === 'medium_term' ? 'medium' : 'long';
      if (enabled.has('artist')) {
        const page = await client.topItems('artists', term, 50, req);
        page.items.forEach((item, rank) => {
          const artist = item as Parameters<typeof mapArtist>[0];
          results.push({ entities: [mapArtist(artist, 'top artists')], memberships: [] });
          top.push({
            entityId: entityId('artist', 'spotify', artist.id),
            term: shortTerm,
            rank,
            of: page.items.length,
          });
        });
        count += page.items.length;
      }
      if (enabled.has('track')) {
        const page = await client.topItems('tracks', term, 50, req);
        page.items.forEach((item, rank) => {
          const track = item as Parameters<typeof mapTrack>[0];
          if (!track.id) return;
          results.push(mapTrack(track, 'top tracks'));
          top.push({
            entityId: entityId('track', 'spotify', track.id),
            term: shortTerm,
            rank,
            of: page.items.length,
          });
        });
        count += page.items.length;
      }
      return count;
    });
  }

  /* ---- saved library ----------------------------------------------------- */

  await run('saved-tracks', 'Saved tracks', 'track', async () => {
    const rows = await client.savedTracks(req);
    for (const row of rows) {
      if (!row.track?.id) continue;
      const mapped = mapTrack(row.track, 'saved tracks');
      const savedAt = Date.parse(row.added_at);
      for (const entity of mapped.entities) {
        if (entity.type === 'track' && entity.providerId === row.track.id) entity.savedAt = savedAt;
      }
      results.push(mapped);
      saved.push({ entityId: entityId('track', 'spotify', row.track.id), savedAt });
    }
    return rows.length;
  });

  await run('saved-albums', 'Saved albums', 'album', async () => {
    const rows = await client.savedAlbums(req);
    for (const row of rows) {
      if (!row.album?.id) continue;
      const mapped = mapAlbum(row.album, 'saved albums');
      const savedAt = Date.parse(row.added_at);
      for (const entity of mapped.entities) {
        if (entity.type === 'album' && entity.providerId === row.album.id) entity.savedAt = savedAt;
      }
      results.push(mapped);
      saved.push({ entityId: entityId('album', 'spotify', row.album.id), savedAt });
    }
    return rows.length;
  });

  await run('saved-shows', 'Saved shows', 'show', async () => {
    const rows = await client.savedShows(req);
    for (const row of rows) {
      if (!row.show?.id) continue;
      const show = mapShow(row.show, 'saved shows');
      show.savedAt = Date.parse(row.added_at);
      results.push({ entities: [show], memberships: [] });
      saved.push({ entityId: show.id, savedAt: show.savedAt });
    }
    return rows.length;
  });

  await run('saved-episodes', 'Saved episodes', 'episode', async () => {
    const rows = await client.savedEpisodes(req);
    for (const row of rows) {
      if (!row.episode?.id) continue;
      const mapped = mapEpisode(row.episode, 'saved episodes');
      results.push(mapped);
      saved.push({
        entityId: entityId('episode', 'spotify', row.episode.id),
        savedAt: Date.parse(row.added_at),
      });
    }
    return rows.length;
  });

  await run('saved-audiobooks', 'Saved audiobooks', 'audiobook', async () => {
    const rows = await client.savedAudiobooks(req);
    for (const book of rows) {
      if (!book?.id) continue;
      const entity = mapAudiobook(book, 'saved audiobooks');
      results.push({ entities: [entity], memberships: [] });
      saved.push({ entityId: entity.id });
    }
    return rows.length;
  });

  /* ---- playlists --------------------------------------------------------- */

  await run('playlists', 'Playlists', 'playlist', async () => {
    const lists = await client.playlists({ ...req, max: 200 });
    const live = lists.filter(Boolean);
    results.push({ entities: live.map((p) => mapPlaylist(p, 'your playlists')), memberships: [] });
    // Contents are fetched separately so one unreadable playlist cannot cost
    // the user every other playlist in the account.
    for (const playlist of live.slice(0, 60)) {
      try {
        const items = await client.playlistTracks(playlist.id, { ...req, max: 500 });
        const mapped = mapPlaylistItems(playlist, items);
        await upsertEntities(mapped.entities);
        await replaceChildren(
          entityId('playlist', 'spotify', playlist.id),
          mapped.memberships.filter((m) => m.parentType === 'playlist'),
        );
        await saveMemberships(mapped.memberships.filter((m) => m.parentType !== 'playlist'));
      } catch {
        // A playlist can vanish or become private between the list and the read.
        continue;
      }
    }
    return live.length;
  });

  /* ---- write through ----------------------------------------------------- */

  const merged = mergeResults(...results);
  await upsertEntities(merged.entities);
  await saveMemberships(merged.memberships);
  await writeSignals({
    recentlyPlayed: plays,
    top,
    saved,
    fetchedAt: startedAt,
  });
  await writeMeta(META_CURSORS, { lastImportAt: Date.now() });

  return {
    startedAt,
    finishedAt: Date.now(),
    steps,
    entities: merged.entities.length,
    memberships: merged.memberships.length,
  };
}

/* -------------------------------------------------------------------------- */

/** Fill in an entity's children on demand, when a detail page is opened. */
export async function expandEntity(
  client: SpotifyClient,
  entity: Entity,
): Promise<{ entities: Entity[]; memberships: Membership[] }> {
  const empty = { entities: [] as Entity[], memberships: [] as Membership[] };
  if (entity.provider !== 'spotify') return empty;
  const id = entity.providerId;

  switch (entity.type) {
    case 'artist': {
      const albums = await client.artistAlbums(id, { max: 200 });
      return mergeResults(...albums.map((a) => mapAlbum(a, 'artist albums')));
    }
    case 'album': {
      const album = await client.album(id);
      const tracks = await client.albumTracks(id, { max: 200 });
      return mergeResults(
        mapAlbum(album, 'album detail'),
        ...tracks.map((t) => mapTrack({ ...t, album }, 'album tracks')),
      );
    }
    case 'playlist': {
      const items = await client.playlistTracks(id, { max: 1000 });
      const playlist = { id, name: entity.name, tracks: { total: items.length } };
      return mapPlaylistItems(playlist, items);
    }
    case 'show': {
      const episodes = await client.showEpisodes(id, { max: 200 });
      const show = await client.show(id);
      return mergeResults(
        { entities: [mapShow(show, 'show detail')], memberships: [] },
        ...episodes.map((e) => mapEpisode({ ...e, show }, 'show episodes')),
      );
    }
    case 'audiobook': {
      const book = await client.audiobook(id);
      const chapters = await client.audiobookChapters(id, { max: 400 });
      return mergeResults(
        { entities: [mapAudiobook(book, 'audiobook detail')], memberships: [] },
        ...chapters.map((c) => mapChapter({ ...c, audiobook: book }, 'audiobook chapters')),
      );
    }
    default:
      return empty;
  }
}

/** Search, mapped straight into domain records so results are ratable at once. */
export async function searchCatalogue(
  client: SpotifyClient,
  query: string,
  types: readonly EntityType[],
): Promise<MapResult> {
  if (!query.trim() || types.length === 0) return { entities: [], memberships: [] };
  const response = await client.search(query, types.map(pluralise), 20);
  const parts: MapResult[] = [];

  for (const artist of response.artists?.items ?? []) {
    if (artist) parts.push({ entities: [mapArtist(artist, 'search')], memberships: [] });
  }
  for (const album of response.albums?.items ?? []) {
    if (album) parts.push(mapAlbum(album, 'search'));
  }
  for (const track of response.tracks?.items ?? []) {
    if (track) parts.push(mapTrack(track, 'search'));
  }
  for (const playlist of response.playlists?.items ?? []) {
    if (playlist) parts.push({ entities: [mapPlaylist(playlist, 'search')], memberships: [] });
  }
  for (const show of response.shows?.items ?? []) {
    if (show) parts.push({ entities: [mapShow(show, 'search')], memberships: [] });
  }
  for (const episode of response.episodes?.items ?? []) {
    if (episode) parts.push(mapEpisode(episode, 'search'));
  }
  for (const book of response.audiobooks?.items ?? []) {
    if (book) parts.push({ entities: [mapAudiobook(book, 'search')], memberships: [] });
  }

  return mergeResults(...parts);
}

function pluralise(type: EntityType): string {
  return type === 'chapter' ? 'audiobook' : `${type}s`;
}

function describe(error: unknown): string {
  if (error instanceof SpotifyApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
