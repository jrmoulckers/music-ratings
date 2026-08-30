import { entityId, membershipId } from '../domain/ids';
import type { Entity, EntityId, EntityType, Membership } from '../domain/types';
import type {
  SpotifyAlbum,
  SpotifyArtist,
  SpotifyAudiobook,
  SpotifyChapter,
  SpotifyEpisode,
  SpotifyImage,
  SpotifyPlaylist,
  SpotifyShow,
  SpotifyTrack,
} from './client';

/**
 * Provider shapes in, domain records out.
 *
 * Nothing here invents data. Where Spotify no longer returns something the app
 * might once have used, the field is simply absent rather than guessed at, and
 * every record carries where it came from so a detail page can say so.
 */

const PROVIDER = 'spotify';

/** Spotify's own id for the placeholder artist used on compilations. */
const VARIOUS_ARTISTS_ID = '0LyfQWJT6nXafLPZqxe9Of';

export interface MapResult {
  entities: Entity[];
  memberships: Membership[];
}

export function emptyResult(): MapResult {
  return { entities: [], memberships: [] };
}

/**
 * Later, richer records win field by field, so a full album fetch upgrades the
 * stub a track reference created without discarding what was already there.
 */
export function mergeResults(...results: MapResult[]): MapResult {
  const entities = new Map<EntityId, Entity>();
  const memberships = new Map<string, Membership>();
  for (const result of results) {
    for (const entity of result.entities) {
      const existing = entities.get(entity.id);
      entities.set(entity.id, existing ? { ...existing, ...entity } : entity);
    }
    for (const membership of result.memberships) memberships.set(membership.id, membership);
  }
  return { entities: [...entities.values()], memberships: [...memberships.values()] };
}

function artworkOf(images: SpotifyImage[] | null | undefined): Partial<Entity> {
  if (!images?.length) return {};
  const sorted = [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const large = sorted[0]?.url;
  const small = sorted[sorted.length - 1]?.url;
  const out: Partial<Entity> = {};
  if (large) out.artworkUrl = large;
  if (small) out.artworkThumbUrl = small;
  return out;
}

function base(
  type: EntityType,
  providerId: string,
  name: string,
  via: string,
  now: number,
): Entity {
  return {
    id: entityId(type, PROVIDER, providerId),
    type,
    provider: PROVIDER,
    providerId,
    name,
    provenance: { provider: PROVIDER, via, fetchedAt: now },
    createdAt: now,
    updatedAt: now,
  };
}

/* -------------------------------------------------------------------------- */

export function mapArtist(artist: SpotifyArtist, via = 'artist', now = Date.now()): Entity {
  const entity = base('artist', artist.id, artist.name, via, now);
  Object.assign(entity, artworkOf(artist.images));
  if (artist.genres?.length) entity.subtitle = artist.genres.slice(0, 3).join(' \u00b7 ');
  if (artist.external_urls?.spotify) entity.externalUrl = artist.external_urls.spotify;
  return entity;
}

export function mapAlbum(album: SpotifyAlbum, via = 'album', now = Date.now()): MapResult {
  const entity = albumRecord(album, via, now);
  const entities: Entity[] = [entity];
  const memberships: Membership[] = [];
  const artists = album.artists ?? [];

  // A various-artists compilation must not credit every contributor with the
  // whole record, so credit is split evenly across the billed artists.
  const share = artists.length > 0 ? 1 / artists.length : 1;
  for (const artist of artists) {
    entities.push(mapArtist(artist, 'album artist', now));
    memberships.push(
      link(entityId('artist', PROVIDER, artist.id), entity.id, 'artist', 'album', now, { share }),
    );
  }

  for (const track of album.tracks?.items ?? []) {
    const mapped = mapTrack({ album, ...track }, 'album track', now);
    entities.push(...mapped.entities);
    memberships.push(...mapped.memberships);
  }

  return { entities, memberships };
}

function albumRecord(album: SpotifyAlbum, via: string, now: number): Entity {
  const entity = base('album', album.id, album.name, via, now);
  Object.assign(entity, artworkOf(album.images));
  const artists = album.artists ?? [];
  if (artists.length) {
    entity.subtitle = artists.map((a) => a.name).join(', ');
    entity.artistIds = artists.map((a) => entityId('artist', PROVIDER, a.id));
    if (artists.some((a) => a.id === VARIOUS_ARTISTS_ID)) entity.variousArtists = true;
  }
  if (album.album_type === 'compilation') entity.variousArtists = true;
  if (album.release_date) entity.releaseDate = album.release_date;
  if (album.album_type) entity.albumKind = albumKind(album.album_type);
  if (album.total_tracks) entity.totalChildren = album.total_tracks;
  if (album.external_urls?.spotify) entity.externalUrl = album.external_urls.spotify;
  if (album.is_playable === false || album.restrictions?.reason) entity.available = false;
  return entity;
}

export function mapTrack(track: SpotifyTrack, via = 'track', now = Date.now()): MapResult {
  // Local files carry no id and can never be looked up again, so they are
  // skipped rather than stored under a fabricated key.
  if (!track.id || track.is_local) return emptyResult();

  const entity = base('track', track.id, track.name, via, now);
  const artists = track.artists ?? [];
  if (artists.length) {
    entity.subtitle = artists.map((a) => a.name).join(', ');
    entity.artistIds = artists.map((a) => entityId('artist', PROVIDER, a.id));
  }
  if (track.duration_ms) entity.durationMs = track.duration_ms;
  if (track.explicit) entity.explicitContent = true;
  if (track.track_number !== undefined) entity.trackNumber = track.track_number;
  if (track.disc_number !== undefined) entity.discNumber = track.disc_number;
  if (track.external_urls?.spotify) entity.externalUrl = track.external_urls.spotify;
  if (track.is_playable === false || track.restrictions?.reason) entity.available = false;

  const entities: Entity[] = [entity];
  const memberships: Membership[] = [];

  if (track.album?.id) {
    const album = albumRecord(track.album, 'track album', now);
    entities.push(album);
    entity.parentIds = [album.id];
    // A track inherits its release's artwork; Spotify ships none of its own.
    Object.assign(entity, artworkOf(track.album.images));
    memberships.push(
      link(album.id, entity.id, 'album', 'track', now, {
        ...(track.track_number !== undefined ? { position: track.track_number } : {}),
      }),
    );
    const albumArtists = track.album.artists ?? [];
    const albumShare = albumArtists.length > 0 ? 1 / albumArtists.length : 1;
    for (const artist of albumArtists) {
      entities.push(mapArtist(artist, 'album artist', now));
      memberships.push(
        link(entityId('artist', PROVIDER, artist.id), album.id, 'artist', 'album', now, {
          share: albumShare,
        }),
      );
    }
  }

  // A featured artist gets a share of the credit, not the whole of it.
  const share = artists.length > 0 ? 1 / artists.length : 1;
  for (const artist of artists) {
    entities.push(mapArtist(artist, 'track artist', now));
    memberships.push(
      link(entityId('artist', PROVIDER, artist.id), entity.id, 'artist', 'track', now, { share }),
    );
  }

  return { entities, memberships };
}

export function mapPlaylist(playlist: SpotifyPlaylist, via = 'playlist', now = Date.now()): Entity {
  const entity = base('playlist', playlist.id, playlist.name, via, now);
  Object.assign(entity, artworkOf(playlist.images));
  if (playlist.owner?.display_name) entity.subtitle = `compiled by ${playlist.owner.display_name}`;
  if (playlist.description) entity.description = stripTags(playlist.description);
  const total = playlist.items?.total ?? playlist.tracks?.total;
  if (total !== undefined) entity.totalChildren = total;
  if (playlist.external_urls?.spotify) entity.externalUrl = playlist.external_urls.spotify;
  return entity;
}

export function mapPlaylistItems(
  playlist: SpotifyPlaylist,
  items: readonly {
    item?: SpotifyTrack | null;
    track?: SpotifyTrack | null;
    is_local?: boolean;
    added_at?: string;
  }[],
  now = Date.now(),
): MapResult {
  const parent = mapPlaylist(playlist, 'playlist', now);
  const entities: Entity[] = [parent];
  const memberships: Membership[] = [];
  let position = 0;
  for (const entry of items) {
    // February 2026 renamed this field from `track` to `item`; extended-quota
    // apps still send the old name, so both are read.
    const track = entry.item ?? entry.track;
    // Removed tracks arrive as nulls, and local files cannot be identified.
    // The index still advances so later positions stay truthful.
    if (!track?.id || entry.is_local) {
      position += 1;
      continue;
    }
    const mapped = mapTrack(track, 'playlist track', now);
    entities.push(...mapped.entities);
    memberships.push(...mapped.memberships);
    const edge = link(parent.id, entityId('track', PROVIDER, track.id), 'playlist', 'track', now, {
      position,
    });
    if (entry.added_at) edge.addedAt = Date.parse(entry.added_at);
    memberships.push(edge);
    position += 1;
  }
  return { entities, memberships };
}

export function mapShow(show: SpotifyShow, via = 'show', now = Date.now()): Entity {
  const entity = base('show', show.id, show.name, via, now);
  Object.assign(entity, artworkOf(show.images));
  if (show.publisher) entity.subtitle = show.publisher;
  if (show.description) entity.description = show.description;
  if (show.total_episodes) entity.totalChildren = show.total_episodes;
  if (show.external_urls?.spotify) entity.externalUrl = show.external_urls.spotify;
  return entity;
}

export function mapEpisode(episode: SpotifyEpisode, via = 'episode', now = Date.now()): MapResult {
  const entity = base('episode', episode.id, episode.name, via, now);
  Object.assign(entity, artworkOf(episode.images));
  if (episode.duration_ms) entity.durationMs = episode.duration_ms;
  if (episode.release_date) entity.releaseDate = episode.release_date;
  if (episode.description) entity.description = episode.description;
  if (episode.external_urls?.spotify) entity.externalUrl = episode.external_urls.spotify;

  const entities: Entity[] = [entity];
  const memberships: Membership[] = [];
  if (episode.show?.id) {
    const show = mapShow(episode.show, 'episode show', now);
    entity.subtitle = show.name;
    entity.parentIds = [show.id];
    entities.push(show);
    memberships.push(link(show.id, entity.id, 'show', 'episode', now));
  }
  return { entities, memberships };
}

export function mapAudiobook(book: SpotifyAudiobook, via = 'audiobook', now = Date.now()): Entity {
  const entity = base('audiobook', book.id, book.name, via, now);
  Object.assign(entity, artworkOf(book.images));
  const authors = (book.authors ?? []).map((a) => a.name).filter(Boolean);
  if (authors.length) entity.subtitle = authors.join(', ');
  if (book.total_chapters) entity.totalChildren = book.total_chapters;
  if (book.external_urls?.spotify) entity.externalUrl = book.external_urls.spotify;
  return entity;
}

export function mapChapter(chapter: SpotifyChapter, via = 'chapter', now = Date.now()): MapResult {
  const entity = base('chapter', chapter.id, chapter.name, via, now);
  Object.assign(entity, artworkOf(chapter.images));
  if (chapter.duration_ms) entity.durationMs = chapter.duration_ms;
  if (chapter.chapter_number !== undefined) entity.trackNumber = chapter.chapter_number;
  if (chapter.external_urls?.spotify) entity.externalUrl = chapter.external_urls.spotify;

  const entities: Entity[] = [entity];
  const memberships: Membership[] = [];
  if (chapter.audiobook?.id) {
    const book = mapAudiobook(chapter.audiobook, 'chapter audiobook', now);
    entity.subtitle = book.name;
    entity.parentIds = [book.id];
    entities.push(book);
    memberships.push(
      link(book.id, entity.id, 'audiobook', 'chapter', now, {
        ...(chapter.chapter_number !== undefined ? { position: chapter.chapter_number } : {}),
      }),
    );
  }
  return { entities, memberships };
}

/* -------------------------------------------------------------------------- */

function link(
  parentId: EntityId,
  childId: EntityId,
  parentType: EntityType,
  childType: EntityType,
  now: number,
  extra: { position?: number; share?: number } = {},
): Membership {
  const membership: Membership = {
    id: membershipId(parentId, childId),
    parentId,
    childId,
    parentType,
    childType,
    updatedAt: now,
  };
  if (extra.position !== undefined) membership.position = extra.position;
  if (extra.share !== undefined && extra.share < 1) membership.share = extra.share;
  return membership;
}

function albumKind(kind: string): Entity['albumKind'] {
  const lower = kind.toLowerCase();
  if (lower === 'single') return 'single';
  if (lower === 'compilation') return 'compilation';
  return 'album';
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}
