import type { ListeningSignals, PlaySignal, SavedSignal, TopSignal } from '../domain/suggestions';
import type { Entity, EntityId, EntityType, Membership } from '../domain/types';
import { entityId } from '../domain/ids';
import { META_CURSORS, deleteMeta, readMeta, writeMeta } from '../storage/db';
import { replaceChildren, saveMemberships, upsertEntities } from '../storage/repo';
import { SEARCH_LIMIT_MAX } from './capabilities';
import { SpotifyApiError, type PlayHistory, type SpotifyClient } from './client';
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
  /** The recently-played window this pass read, for the listening log. */
  recent: PlayHistory[];
}

export interface StoredSignals extends ListeningSignals {
  fetchedAt: number;
  /**
   * When the recently-played window was last read. Separate from `fetchedAt`
   * because listening goes stale in minutes while a library import is an
   * expensive, occasional thing.
   */
  listeningFetchedAt?: number;
}

const SIGNALS_KEY = 'spotify-signals';

export async function readSignals(): Promise<StoredSignals | undefined> {
  return readMeta<StoredSignals>(SIGNALS_KEY);
}

export async function writeSignals(signals: StoredSignals): Promise<void> {
  await writeMeta(SIGNALS_KEY, signals);
}

export async function clearSignals(): Promise<void> {
  await deleteMeta(SIGNALS_KEY);
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
  let recent: PlayHistory[] = [];

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
    recent = [...items];
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
    listeningFetchedAt: startedAt,
  });
  await writeMeta(META_CURSORS, { lastImportAt: Date.now() });

  return {
    startedAt,
    finishedAt: Date.now(),
    steps,
    entities: merged.entities.length,
    memberships: merged.memberships.length,
    recent,
  };
}

/* -------------------------------------------------------------------------- */

export interface ListeningReport {
  fetchedAt: number;
  /** Distinct tracks in the returned window. */
  plays: number;
  entities: number;
  /**
   * The raw window, handed back so the caller can fold it into the durable
   * listening log *after* the tracks and their albums are stored. Completion
   * has to be judged against a catalogue that already knows the album, so the
   * two steps cannot be reordered.
   */
  items: PlayHistory[];
}

/**
 * Read just the recently-played window.
 *
 * The queue's whole claim is that what you were listening to a moment ago comes
 * first, and a full library import is far too expensive to run often enough to
 * keep that true. This is one request against one endpoint: it maps the tracks
 * it returns so they can be rated, and leaves the top and saved signals exactly
 * as the last import left them.
 *
 * Spotify only ever returns the latest 50 plays, so this is a window and not a
 * history — anything played earlier is gone from the source, not from us.
 */
export async function importListening(options: {
  client: SpotifyClient;
  signal?: AbortSignal;
}): Promise<ListeningReport> {
  const { client } = options;
  const req = options.signal ? { signal: options.signal } : {};
  const fetchedAt = Date.now();

  const { items } = await client.recentlyPlayed(req);
  const results: MapResult[] = [];
  const plays: PlaySignal[] = [];
  items.forEach((item, index) => {
    if (!item.track?.id) return;
    results.push(mapTrack(item.track, 'recently played'));
    plays.push({
      entityId: entityId('track', 'spotify', item.track.id),
      at: Date.parse(item.played_at),
      index,
    });
  });

  const merged = mergeResults(...results);
  await upsertEntities(merged.entities);
  await saveMemberships(merged.memberships);

  // Everything the library import knows and this endpoint does not is carried
  // through untouched, so a listening refresh never costs the user their top
  // items or their saved library.
  const prior = await readSignals();
  await writeSignals({
    recentlyPlayed: plays,
    top: prior?.top ?? [],
    saved: prior?.saved ?? [],
    fetchedAt: prior?.fetchedAt ?? fetchedAt,
    listeningFetchedAt: fetchedAt,
  });

  return {
    fetchedAt,
    plays: new Set(plays.map((p) => p.entityId)).size,
    entities: merged.entities.length,
    items: [...items],
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
      // The artist record itself comes first: an artist reached through a track
      // or a playback event carries a name and nothing else, and this is the
      // one call that can give it a picture and its genres.
      const [artist, albums] = await Promise.all([
        client.artist(id),
        client.artistAlbums(id, { max: 200 }),
      ]);
      return mergeResults(
        { entities: [mapArtist(artist, 'artist detail')], memberships: [] },
        ...albums.map((a) => mapAlbum(a, 'artist albums')),
      );
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
export interface SearchResult extends MapResult {
  /**
   * What Spotify actually answered with, in a balanced order.
   *
   * A catalogue search for one track drags in its release, its artists and the
   * artists of every other release returned — real records, needed for the
   * links, but not answers to the question. Listing `entities` directly buries
   * the track you searched for under other people's metadata. So the direct
   * hits are named here and interleaved a type at a time, which keeps the best
   * artist, the best release and the best track all in the first three rows.
   */
  hits: EntityId[];
}

export async function searchCatalogue(
  client: SpotifyClient,
  query: string,
  types: readonly EntityType[],
): Promise<SearchResult> {
  const searchTypes = searchTypesFor(types);
  if (!query.trim() || searchTypes.length === 0) return { entities: [], memberships: [], hits: [] };
  const response = await client.search(query, searchTypes, SEARCH_LIMIT_MAX);
  const parts: MapResult[] = [];
  const lanes: EntityId[][] = [];

  /** Keep one lane per kind: the answers, not what they happen to reference. */
  function lane(results: MapResult[], pick: (r: MapResult) => EntityId | undefined) {
    const ids: EntityId[] = [];
    for (const result of results) {
      parts.push(result);
      const id = pick(result);
      if (id) ids.push(id);
    }
    if (ids.length > 0) lanes.push(ids);
  }

  const first = (r: MapResult) => r.entities[0]?.id;
  const ofType = (type: EntityType) => (r: MapResult) =>
    r.entities.find((e) => e.type === type)?.id;

  lane(
    (response.artists?.items ?? [])
      .filter((a): a is NonNullable<typeof a> => !!a)
      .map((a) => ({ entities: [mapArtist(a, 'search')], memberships: [] })),
    first,
  );
  lane(
    (response.albums?.items ?? [])
      .filter((a): a is NonNullable<typeof a> => !!a)
      .map((a) => mapAlbum(a, 'search')),
    ofType('album'),
  );
  lane(
    (response.tracks?.items ?? [])
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map((t) => mapTrack(t, 'search')),
    ofType('track'),
  );
  lane(
    (response.playlists?.items ?? [])
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({ entities: [mapPlaylist(p, 'search')], memberships: [] })),
    first,
  );
  lane(
    (response.shows?.items ?? [])
      .filter((s): s is NonNullable<typeof s> => !!s)
      .map((s) => ({ entities: [mapShow(s, 'search')], memberships: [] })),
    first,
  );
  lane(
    (response.episodes?.items ?? [])
      .filter((e): e is NonNullable<typeof e> => !!e)
      .map((e) => mapEpisode(e, 'search')),
    ofType('episode'),
  );
  lane(
    (response.audiobooks?.items ?? [])
      .filter((b): b is NonNullable<typeof b> => !!b)
      .map((b) => ({ entities: [mapAudiobook(b, 'search')], memberships: [] })),
    first,
  );

  return { ...mergeResults(...parts), hits: interleave(lanes) };
}

/** One from each lane in turn, so no single kind pushes the others off the screen. */
function interleave(lanes: readonly (readonly EntityId[])[]): EntityId[] {
  const out: EntityId[] = [];
  const seen = new Set<EntityId>();
  const longest = Math.max(0, ...lanes.map((l) => l.length));
  for (let i = 0; i < longest; i += 1) {
    for (const lane of lanes) {
      const id = lane[i];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * `/search` takes singular type names — `artist,album`, never `artists,albums`
 * — even though it answers with plural keys. Sending the plural form fails the
 * whole request with a 400, so the two vocabularies are mapped explicitly here
 * rather than derived from each other.
 *
 * Chapters are not searchable on their own; Spotify only indexes the audiobook.
 * That collapses two enabled types onto one search type, hence the dedupe.
 */
const SEARCH_TYPES: Readonly<Record<EntityType, string | null>> = {
  artist: 'artist',
  album: 'album',
  track: 'track',
  playlist: 'playlist',
  show: 'show',
  episode: 'episode',
  audiobook: 'audiobook',
  chapter: 'audiobook',
};

export function searchTypesFor(types: readonly EntityType[]): string[] {
  const out: string[] = [];
  for (const type of types) {
    const mapped = SEARCH_TYPES[type];
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

function describe(error: unknown): string {
  if (error instanceof SpotifyApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
