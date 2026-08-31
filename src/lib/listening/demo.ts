import { albumTrackSet, evaluateAlbumCompletion } from '../domain/completion';
import { entityId } from '../domain/ids';
import {
  playId,
  PLAY_SCHEMA_VERSION,
  type AlbumCompletion,
  type PlayEvent,
} from '../domain/listening';
import { ContainmentGraph } from '../domain/graph';
import type { Entity, Membership } from '../domain/types';
import { insertPlays, saveCompletions, upsertEntities, saveMemberships } from '../storage/repo';
import { db, writeMeta, readMeta } from '../storage/db';
import { META_LISTENING_COVERAGE } from './ingest';
import { hydrateSettings } from '../storage/settings';
import type { ListeningCoverage } from '../domain/listening';

/**
 * A demonstration listening history.
 *
 * The Listening surface is hard to judge empty, and harder to judge against a
 * Spotify account you have to wait weeks to fill. This seeds a plausible few
 * months so the ranked lists, the time filters, the gap notices and — the point
 * of the exercise — a record that has just this moment been finished can all be
 * looked at directly.
 *
 * Everything it writes is `provider: 'local'`, which in this app means
 * user-added rather than imported, and is exactly what it is: material this
 * device made up. It is development-only, one call to remove, and it never
 * touches a Spotify-provided entity, so it cannot be mistaken for or merged
 * into observed listening from the real account.
 */

const DAY = 86_400_000;
const MINUTE = 60_000;

interface Seed {
  artist: string;
  album: string;
  year: number;
  tracks: { name: string; minutes: number }[];
}

const SEEDS: Seed[] = [
  {
    artist: 'The Sound Cartography',
    album: 'Ordinary Weather',
    year: 2021,
    tracks: [
      { name: 'Low Tide', minutes: 4.2 },
      { name: 'Handwriting', minutes: 3.5 },
      { name: 'Cold Front', minutes: 5.1 },
      { name: 'Ordinary Weather', minutes: 6.4 },
      { name: 'Every Third Thursday', minutes: 3.8 },
      { name: 'Slate', minutes: 4.9 },
    ],
  },
  {
    artist: 'Marguerite Vane',
    album: 'Signal Fires',
    year: 2019,
    tracks: [
      { name: 'Beacon', minutes: 3.1 },
      { name: 'The Long Road In', minutes: 4.6 },
      { name: 'Signal Fires', minutes: 5.5 },
      { name: 'Nightwatch', minutes: 4.0 },
      { name: 'Ash', minutes: 3.3 },
    ],
  },
  {
    artist: 'Bramble & Fell',
    album: 'Common Ground',
    year: 2023,
    tracks: [
      { name: 'Boundary Stone', minutes: 3.7 },
      { name: 'Rights of Way', minutes: 4.4 },
      { name: 'Common Ground', minutes: 5.8 },
      { name: 'Enclosure', minutes: 4.1 },
      { name: 'Bramble', minutes: 2.9 },
      { name: 'Fell', minutes: 6.2 },
      { name: 'The Old Path', minutes: 4.5 },
    ],
  },
  {
    artist: 'Kestrel Line',
    album: 'Departures',
    year: 2022,
    tracks: [
      { name: 'Platform Four', minutes: 3.4 },
      { name: 'Rolling Stock', minutes: 4.8 },
      { name: 'Departures', minutes: 5.2 },
      { name: 'Sidings', minutes: 3.9 },
    ],
  },
];

export const DEMO_PREFIX = 'demo-listening';

const PROVENANCE = { provider: 'local' as const, via: 'demo-listening', fetchedAt: 0 };

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

interface Built {
  entities: Entity[];
  memberships: Membership[];
  albumIds: string[];
  trackIds: Map<string, string[]>;
  durations: Map<string, number>;
}

function build(now: number): Built {
  const entities: Entity[] = [];
  const memberships: Membership[] = [];
  const albumIds: string[] = [];
  const trackIds = new Map<string, string[]>();
  const durations = new Map<string, number>();

  for (const seed of SEEDS) {
    const artistId = entityId('artist', 'local', `${DEMO_PREFIX}-${slug(seed.artist)}`);
    const albumId = entityId('album', 'local', `${DEMO_PREFIX}-${slug(seed.album)}`);
    albumIds.push(albumId);

    entities.push({
      id: artistId,
      type: 'artist',
      provider: 'local',
      providerId: `${DEMO_PREFIX}-${slug(seed.artist)}`,
      name: seed.artist,
      available: true,
      provenance: PROVENANCE,
      createdAt: now,
      updatedAt: now,
    });
    entities.push({
      id: albumId,
      type: 'album',
      provider: 'local',
      providerId: `${DEMO_PREFIX}-${slug(seed.album)}`,
      name: seed.album,
      subtitle: seed.artist,
      releaseDate: `${seed.year}-01-01`,
      totalChildren: seed.tracks.length,
      artistIds: [artistId],
      available: true,
      provenance: PROVENANCE,
      createdAt: now,
      updatedAt: now,
    });
    memberships.push({
      id: `${albumId}::${artistId}`,
      parentId: artistId,
      childId: albumId,
      parentType: 'artist',
      childType: 'album',
      updatedAt: now,
    });

    const ids: string[] = [];
    seed.tracks.forEach((track, index) => {
      const trackId = entityId('track', 'local', `${DEMO_PREFIX}-${slug(seed.album)}-${index + 1}`);
      ids.push(trackId);
      durations.set(trackId, Math.round(track.minutes * MINUTE));
      entities.push({
        id: trackId,
        type: 'track',
        provider: 'local',
        providerId: `${DEMO_PREFIX}-${slug(seed.album)}-${index + 1}`,
        name: track.name,
        subtitle: seed.artist,
        durationMs: Math.round(track.minutes * MINUTE),
        trackNumber: index + 1,
        discNumber: 1,
        artistIds: [artistId],
        parentIds: [albumId],
        available: true,
        provenance: PROVENANCE,
        createdAt: now,
        updatedAt: now,
      });
      memberships.push({
        id: `${trackId}::${albumId}`,
        parentId: albumId,
        childId: trackId,
        parentType: 'album',
        childType: 'track',
        position: index,
        updatedAt: now,
      });
      memberships.push({
        id: `${trackId}::${artistId}`,
        parentId: artistId,
        childId: trackId,
        parentType: 'artist',
        childType: 'track',
        share: 1,
        updatedAt: now,
      });
    });
    trackIds.set(albumId, ids);
  }

  return { entities, memberships, albumIds, trackIds, durations };
}

function makePlay(trackId: string, at: number, durationMs: number, context?: string): PlayEvent {
  return {
    id: playId('spotify', trackId, at),
    entityId: trackId,
    entityType: 'track',
    at,
    durationMs,
    ...(context ? { contextType: 'album' as const, contextId: context } : {}),
    source: 'spotify-recently-played',
    ingestedAt: at,
    v: PLAY_SCHEMA_VERSION,
    updatedAt: at,
  };
}

/**
 * Remove everything a previous seed wrote.
 *
 * Every run picks a fresh `now`, so the whole invented history shifts and the
 * plays and completions get new identities. Without this, seeding twice leaves
 * two parallel histories layered on top of each other and the counts stop
 * meaning anything. Rows are removed outright rather than tombstoned: this is
 * material this device made up, and it has no business being synced anywhere as
 * a deletion.
 */
export async function clearDemoListening(): Promise<{ plays: number; completions: number }> {
  const database = await db();
  const owned = (id: string) => id.includes(DEMO_PREFIX);

  let plays = 0;
  for (const play of await database.getAll('plays')) {
    if (!owned(play.entityId)) continue;
    await database.delete('plays', play.id);
    plays += 1;
  }

  let completions = 0;
  for (const completion of await database.getAll('completions')) {
    if (!owned(completion.albumId)) continue;
    await database.delete('completions', completion.id);
    completions += 1;
  }

  return { plays, completions };
}

/**
 * Write the demo history.
 *
 * The last album is played straight through ending seconds ago, so the
 * completion moment is on screen the instant this returns — that is the part
 * that is otherwise impossible to see on demand.
 */
export async function seedDemoListening(
  now = Date.now(),
): Promise<{ plays: number; completions: AlbumCompletion[]; observedSince: number }> {
  await clearDemoListening();

  const built = build(now);
  await upsertEntities(built.entities);
  await saveMemberships(built.memberships);

  // Judge against what was just written, not against the app's loaded graph,
  // which has not seen these entities yet.
  const graph = new ContainmentGraph(built.entities, built.memberships);

  const plays: PlayEvent[] = [];

  // Five months of ordinary listening: scattered tracks, some records finished,
  // some only dipped into, and a stretch of repeats near the present.
  built.albumIds.forEach((albumId, albumIndex) => {
    const tracks = built.trackIds.get(albumId) ?? [];
    const isLast = albumIndex === built.albumIds.length - 1;

    // A full sitting, a long time ago.
    if (albumIndex % 2 === 0) {
      const base = now - (140 - albumIndex * 9) * DAY;
      let at = base;
      for (const trackId of tracks) {
        plays.push(makePlay(trackId, at, built.durations.get(trackId) ?? 0, albumId));
        at += (built.durations.get(trackId) ?? 0) + 4_000;
      }
    }

    // The last record is kept clean of stray plays on purpose. A single older
    // play of one track is enough to close the set partway through a sitting —
    // correctly, because that track had already been heard inside the window —
    // and then the headline example is a five-day span rather than the sitting
    // it is meant to demonstrate.
    if (!isLast) {
      // Scattered single tracks across the middle months.
      tracks.forEach((trackId, index) => {
        const spread = 3 + ((albumIndex * 7 + index * 11) % 60);
        plays.push(makePlay(trackId, now - spread * DAY, built.durations.get(trackId) ?? 0));
      });

      // Favourites, played more than once.
      if (tracks.length > 1) {
        const favourite = tracks[albumIndex % tracks.length];
        if (favourite) {
          for (let n = 1; n <= 4; n += 1) {
            plays.push(
              makePlay(
                favourite,
                now - n * 5 * DAY - 3 * MINUTE,
                built.durations.get(favourite) ?? 0,
              ),
            );
          }
        }
      }
    }

    // The last record is finished right now, in one sitting, so the completion
    // moment is genuinely a moment rather than a reconstruction.
    if (isLast) {
      let at = now - 40 * MINUTE;
      for (const trackId of tracks) {
        plays.push(makePlay(trackId, at, built.durations.get(trackId) ?? 0, albumId));
        at += (built.durations.get(trackId) ?? 0) + 3_000;
      }
    }
  });

  plays.sort((a, b) => a.at - b.at);
  const inserted = await insertPlays(plays);

  // Judge the seeded log with the real engine rather than writing completions by
  // hand, so what the demo shows is what the app would actually have decided.
  const completions: AlbumCompletion[] = [];
  for (const albumId of built.albumIds) {
    const wanted = new Set(built.trackIds.get(albumId) ?? []);
    const mine = plays.filter((play) => wanted.has(play.entityId));
    const tracks = albumTrackSet(graph, albumId);

    // Sweep play by play, exactly as ingestion would have, so a record closes on
    // the play that closed it and re-completion is decided by the same rules.
    for (const play of mine) {
      const outcome = evaluateAlbumCompletion({
        tracks,
        plays: mine.filter((candidate) => candidate.at <= play.at),
        newPlayIds: new Set([play.id]),
        existing: completions.filter((held) => held.albumId === albumId),
        windowMs: 30 * DAY,
        recompletion: 'fresh',
        now,
      });
      if (outcome.completion) completions.push(outcome.completion);
    }
  }
  await saveCompletions(completions);

  // Write the coverage record and the observation start too. Without them the
  // surface would say only "observed by this app" with no date, which is the
  // honest thing to say when nothing is known but the wrong preview of a real
  // history.
  const first = plays[0]?.at ?? now;
  await writeMeta(META_LISTENING_COVERAGE, {
    firstFetchAt: first,
    lastFetchAt: now,
    lastFetchCount: plays.length,
    lastFetchNew: inserted.length,
    saturatedFetches: 0,
    newestSeenAt: plays[plays.length - 1]?.at ?? now,
    gaps: [],
  } satisfies ListeningCoverage);
  const held = hydrateSettings(await readMeta('settings'));
  await writeMeta('settings', {
    ...held,
    listeningEnabled: true,
    listeningObservedFrom: first,
    updatedAt: now,
  });

  return { plays: inserted.length, completions, observedSince: first };
}
