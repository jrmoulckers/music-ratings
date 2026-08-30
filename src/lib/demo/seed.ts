import { entityId, membershipId } from '../domain/ids';
import type { Comparison, Entity, EntityId, Membership, RatingEvent } from '../domain/types';

/**
 * A complete fictional catalogue.
 *
 * Every name here is invented. Nothing is drawn from a real catalogue, no real
 * artist, release or recording is described, and no lyrics or copyrighted text
 * appear. The point is a world large enough that rollups, rankings, coverage
 * gaps and stale-rating prompts all behave exactly as they will on real data.
 */

const PROVIDER = 'demo';

/* Deterministic pseudo-random so the demo is identical on every device, which
   makes it usable as a fixture for screenshots and for support questions. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const DAY = 86_400_000;

interface ArtistSpec {
  key: string;
  name: string;
  genre: string;
  releases: ReleaseSpec[];
}

interface ReleaseSpec {
  key: string;
  title: string;
  year: number;
  kind: 'album' | 'single' | 'compilation';
  tracks: string[];
}

const CATALOGUE: ArtistSpec[] = [
  {
    key: 'halden-quarry',
    name: 'Halden Quarry',
    genre: 'slowcore',
    releases: [
      {
        key: 'the-long-field',
        title: 'The Long Field',
        year: 2019,
        kind: 'album',
        tracks: [
          'Ferrous',
          'A Weather Front',
          'Nine Hours of Light',
          'Undercut',
          'The Long Field',
          'Sediment',
          'Boat, Rowed Backwards',
          'Closing the House',
        ],
      },
      {
        key: 'quarry-hymns',
        title: 'Quarry Hymns',
        year: 2022,
        kind: 'album',
        tracks: [
          'Blast Door',
          'Hymn for the Overburden',
          'Aggregate',
          'Drill Song',
          'Water Table',
          'Reclamation',
        ],
      },
      {
        key: 'ferrous-remade',
        title: 'Ferrous (Remade)',
        year: 2023,
        kind: 'single',
        tracks: ['Ferrous (Remade)', 'Ferrous (Instrumental)'],
      },
    ],
  },
  {
    key: 'marta-lindqvist',
    name: 'Marta Lindqvist',
    genre: 'chamber folk',
    releases: [
      {
        key: 'winterlight-studies',
        title: 'Winterlight Studies',
        year: 2020,
        kind: 'album',
        tracks: [
          'Study in Grey',
          'The Ice Road',
          'Two Lamps',
          'Study in Blue',
          'Northern Passage',
          'Thaw',
          'Study in White',
        ],
      },
      {
        key: 'the-glassblower',
        title: 'The Glassblower',
        year: 2024,
        kind: 'album',
        tracks: [
          'Furnace',
          'Annealing',
          'The Glassblower',
          'Cullet',
          'Crown Glass',
          'Lehr',
          'Frit',
          'Shattered Batch',
          'Cold Work',
        ],
      },
    ],
  },
  {
    key: 'ocean-terminal',
    name: 'Ocean Terminal',
    genre: 'dub techno',
    releases: [
      {
        key: 'berth-04',
        title: 'Berth 04',
        year: 2021,
        kind: 'album',
        tracks: ['Gantry', 'Berth 04', 'Container Yard', 'Bollard', 'Tide Gate', 'Night Shift'],
      },
      {
        key: 'harbour-static',
        title: 'Harbour Static',
        year: 2023,
        kind: 'album',
        tracks: [
          'Harbour Static',
          'Dredge',
          'Slipway',
          'Ballast Water',
          'Quayside',
          'Pilot Boat',
          'Breakwater',
        ],
      },
    ],
  },
  {
    key: 'the-sundial-club',
    name: 'The Sundial Club',
    genre: 'jangle pop',
    releases: [
      {
        key: 'appointments',
        title: 'Appointments',
        year: 2018,
        kind: 'album',
        tracks: [
          'Half Past Nothing',
          'Appointments',
          'Gnomon',
          'A Reliable Friend',
          'Shadow Line',
          'Solar Noon',
          'The Equation of Time',
        ],
      },
      {
        key: 'second-hand',
        title: 'Second Hand',
        year: 2022,
        kind: 'album',
        tracks: ['Second Hand', 'Escapement', 'Mainspring', 'Balance Wheel', 'Overwound'],
      },
    ],
  },
  {
    key: 'rue-cassini',
    name: 'Rue Cassini',
    genre: 'downtempo',
    releases: [
      {
        key: 'meridian-tables',
        title: 'Meridian Tables',
        year: 2020,
        kind: 'album',
        tracks: [
          'Right Ascension',
          'Meridian Tables',
          'Transit of Venus',
          'Declination',
          'Ephemeris',
          'The Cassini Division',
        ],
      },
    ],
  },
  {
    key: 'brass-diary',
    name: 'Brass Diary',
    genre: 'post-bop',
    releases: [
      {
        key: 'entries',
        title: 'Entries',
        year: 2021,
        kind: 'album',
        tracks: [
          'Entry, January',
          'Valve Oil',
          'Entry, March',
          'The Second Chair',
          'Entry, August',
          'Rehearsal Letter C',
          'Entry, December',
        ],
      },
      {
        key: 'marginalia',
        title: 'Marginalia',
        year: 2024,
        kind: 'album',
        tracks: ['Marginalia', 'Foxed', 'Deckle Edge', 'Errata', 'Colophon'],
      },
    ],
  },
  {
    key: 'nyx-transit',
    name: 'Nyx Transit',
    genre: 'industrial',
    releases: [
      {
        key: 'rolling-stock',
        title: 'Rolling Stock',
        year: 2023,
        kind: 'album',
        tracks: [
          'Rolling Stock',
          'Third Rail',
          'Signal Failure',
          'Shunt',
          'Depot',
          'Last Service',
          'Ghost Train',
          'Terminus',
        ],
      },
    ],
  },
  {
    key: 'pale-committee',
    name: 'Pale Committee',
    genre: 'art rock',
    releases: [
      {
        key: 'minutes-of-the-meeting',
        title: 'Minutes of the Meeting',
        year: 2019,
        kind: 'album',
        tracks: [
          'Apologies for Absence',
          'Matters Arising',
          'Any Other Business',
          'Minutes of the Meeting',
          'Quorum',
          'Motion Carried',
          'Adjourned',
        ],
      },
      {
        key: 'standing-orders',
        title: 'Standing Orders',
        year: 2024,
        kind: 'album',
        tracks: ['Standing Orders', 'Point of Order', 'Casting Vote', 'Abstention', 'Sine Die'],
      },
    ],
  },
  {
    key: 'ivory-coastline',
    name: 'Ivory Coastline',
    genre: 'ambient',
    releases: [
      {
        key: 'shelf-and-shore',
        title: 'Shelf and Shore',
        year: 2022,
        kind: 'album',
        tracks: ['Littoral', 'Shelf and Shore', 'Longshore Drift', 'Spit', 'Lagoon', 'Barrier'],
      },
    ],
  },
  {
    key: 'the-fen-orchestra',
    name: 'The Fen Orchestra',
    genre: 'modern classical',
    releases: [
      {
        key: 'drainage',
        title: 'Drainage',
        year: 2021,
        kind: 'album',
        tracks: [
          'Pumping Station I',
          'Sluice',
          'Peat',
          'Pumping Station II',
          'Washland',
          'Reed Bed',
          'Pumping Station III',
        ],
      },
      {
        key: 'the-hundred-foot',
        title: 'The Hundred Foot',
        year: 2024,
        kind: 'album',
        tracks: ['The Old Bedford', 'The Hundred Foot', 'Denver Sluice', 'Ouse', 'Silt'],
      },
    ],
  },
  {
    key: 'various',
    name: 'Various Artists',
    genre: 'compilation',
    releases: [
      {
        key: 'field-notes-vol-2',
        title: 'Field Notes, Volume Two',
        year: 2023,
        kind: 'compilation',
        tracks: [
          'Cartographer',
          'Datum',
          'Contour Interval',
          'Trig Point',
          'Benchmark',
          'Grid North',
        ],
      },
    ],
  },
];

const PLAYLISTS: { key: string; name: string; description: string; picks: number }[] = [
  {
    key: 'late-desk',
    name: 'Late Desk',
    description: 'What stays on while the work does.',
    picks: 18,
  },
  {
    key: 'first-light',
    name: 'First Light',
    description: 'Quiet enough for the first hour of the day.',
    picks: 14,
  },
  {
    key: 'the-argument',
    name: 'The Argument',
    description: 'Records that will not sit politely in the background.',
    picks: 16,
  },
];

const SHOWS: { key: string; name: string; publisher: string; episodes: string[] }[] = [
  {
    key: 'the-listening-room',
    name: 'The Listening Room',
    publisher: 'Ravensmoor Audio',
    episodes: [
      'One Record, Forty Minutes',
      'On Second Listens',
      'The Trouble With Best-Of Lists',
      'Sequencing an Album',
      'What a Producer Actually Does',
      'Live Albums, Honestly',
    ],
  },
  {
    key: 'liner-notes',
    name: 'Liner Notes',
    publisher: 'Halfpenny Bridge Media',
    episodes: [
      'The Sleeve as an Argument',
      'Credits Nobody Reads',
      'Catalogue Numbers',
      'Reissue Culture',
    ],
  },
];

const AUDIOBOOKS: { key: string; name: string; author: string; chapters: number }[] = [
  {
    key: 'a-history-of-listening',
    name: 'A History of Listening',
    author: 'E. R. Vance',
    chapters: 9,
  },
  { key: 'the-quiet-format', name: 'The Quiet Format', author: 'Nadia Okonjo', chapters: 7 },
];

/* -------------------------------------------------------------------------- */

export interface DemoWorld {
  entities: Entity[];
  memberships: Membership[];
  ratings: RatingEvent[];
  comparisons: Comparison[];
}

/**
 * `now` is injectable so tests get a fixed world and the app gets one whose
 * "three days ago" really is three days ago.
 */
export function buildDemoWorld(now = Date.now()): DemoWorld {
  const random = rng(0x5eed1e);
  const entities: Entity[] = [];
  const memberships: Membership[] = [];
  const ratings: RatingEvent[] = [];
  const comparisons: Comparison[] = [];
  const trackIds: EntityId[] = [];
  const albumIds: EntityId[] = [];
  const artistIds: EntityId[] = [];

  const record = (entity: Entity) => {
    entities.push(entity);
    return entity.id;
  };

  const edge = (
    parentId: EntityId,
    childId: EntityId,
    parentType: Membership['parentType'],
    childType: Membership['childType'],
    extra: { position?: number; share?: number } = {},
  ) => {
    const m: Membership = {
      id: membershipId(parentId, childId),
      parentId,
      childId,
      parentType,
      childType,
      updatedAt: now,
    };
    if (extra.position !== undefined) m.position = extra.position;
    if (extra.share !== undefined && extra.share < 1) m.share = extra.share;
    memberships.push(m);
  };

  const shell = (
    type: Entity['type'],
    key: string,
    name: string,
    via: string,
    extra: Partial<Entity> = {},
  ): Entity => ({
    id: entityId(type, PROVIDER, key),
    type,
    provider: PROVIDER,
    providerId: key,
    name,
    provenance: { provider: PROVIDER, via, fetchedAt: now },
    createdAt: now,
    updatedAt: now,
    ...extra,
  });

  /* ---- artists, releases, tracks ---------------------------------------- */

  for (const artist of CATALOGUE) {
    const isVarious = artist.key === 'various';
    const artistId = record(
      shell('artist', artist.key, artist.name, 'demo catalogue', { subtitle: artist.genre }),
    );
    if (!isVarious) artistIds.push(artistId);

    for (const release of artist.releases) {
      const albumId = record(
        shell('album', release.key, release.title, 'demo catalogue', {
          subtitle: artist.name,
          releaseDate: `${release.year}-0${1 + Math.floor(random() * 9)}-14`,
          albumKind: release.kind,
          totalChildren: release.tracks.length,
          artistIds: [artistId],
          ...(isVarious ? { variousArtists: true } : {}),
        }),
      );
      albumIds.push(albumId);
      edge(artistId, albumId, 'artist', 'album');

      release.tracks.forEach((title, index) => {
        const trackKey = `${release.key}-${index + 1}`;
        // The compilation credits a different artist per track, so credit
        // allocation across a various-artists release is exercised properly.
        const creditKey = isVarious ? CATALOGUE[index % (CATALOGUE.length - 1)]?.key : artist.key;
        const creditName = isVarious
          ? (CATALOGUE[index % (CATALOGUE.length - 1)]?.name ?? artist.name)
          : artist.name;
        const creditId = entityId('artist', PROVIDER, creditKey ?? artist.key);
        const trackId = record(
          shell('track', trackKey, title, 'demo catalogue', {
            subtitle: creditName,
            durationMs: Math.round((150 + random() * 210) * 1000),
            trackNumber: index + 1,
            discNumber: 1,
            artistIds: [creditId],
            parentIds: [albumId],
            ...(random() < 0.08 ? { explicitContent: true } : {}),
          }),
        );
        trackIds.push(trackId);
        edge(albumId, trackId, 'album', 'track', { position: index + 1 });
        edge(creditId, trackId, 'artist', 'track');
        // A couple of tracks carry a second credit so shared attribution shows.
        if (!isVarious && index === 2 && random() < 0.5) {
          const guest = CATALOGUE[(CATALOGUE.length + index) % (CATALOGUE.length - 1)];
          if (guest && guest.key !== artist.key) {
            const guestId = entityId('artist', PROVIDER, guest.key);
            edge(guestId, trackId, 'artist', 'track', { share: 0.5 });
            edge(creditId, trackId, 'artist', 'track', { share: 0.5 });
          }
        }
      });
    }
  }

  /* ---- playlists --------------------------------------------------------- */

  for (const spec of PLAYLISTS) {
    const playlistId = record(
      shell('playlist', spec.key, spec.name, 'demo catalogue', {
        subtitle: 'compiled by you',
        description: spec.description,
        totalChildren: spec.picks,
      }),
    );
    const chosen = new Set<EntityId>();
    while (chosen.size < spec.picks) {
      const pick = trackIds[Math.floor(random() * trackIds.length)];
      if (pick) chosen.add(pick);
    }
    [...chosen].forEach((trackId, index) => {
      edge(playlistId, trackId, 'playlist', 'track', { position: index });
    });
  }

  /* ---- shows and audiobooks ---------------------------------------------- */

  for (const show of SHOWS) {
    const showId = record(
      shell('show', show.key, show.name, 'demo catalogue', {
        subtitle: show.publisher,
        totalChildren: show.episodes.length,
      }),
    );
    show.episodes.forEach((title, index) => {
      const episodeId = record(
        shell('episode', `${show.key}-${index + 1}`, title, 'demo catalogue', {
          subtitle: show.name,
          durationMs: Math.round((1400 + random() * 2200) * 1000),
          parentIds: [showId],
        }),
      );
      edge(showId, episodeId, 'show', 'episode', { position: index + 1 });
    });
  }

  for (const book of AUDIOBOOKS) {
    const bookId = record(
      shell('audiobook', book.key, book.name, 'demo catalogue', {
        subtitle: book.author,
        totalChildren: book.chapters,
      }),
    );
    for (let index = 1; index <= book.chapters; index += 1) {
      const chapterId = record(
        shell('chapter', `${book.key}-${index}`, `Chapter ${index}`, 'demo catalogue', {
          subtitle: book.name,
          durationMs: Math.round((900 + random() * 1500) * 1000),
          trackNumber: index,
          parentIds: [bookId],
        }),
      );
      edge(bookId, chapterId, 'audiobook', 'chapter', { position: index });
    }
  }

  /* ---- a plausible rating history ---------------------------------------- */

  // Each artist gets a private centre of gravity, so albums and tracks cluster
  // the way a real listener's do rather than scattering uniformly.
  const artistBias = new Map<EntityId, number>();
  for (const id of artistIds) artistBias.set(id, 35 + random() * 50);

  let ratingSeq = 0;
  const rate = (
    entity: Entity,
    normalized: number,
    daysAgo: number,
    note?: string,
    tags?: string[],
  ) => {
    ratingSeq += 1;
    const clamped = Math.max(0, Math.min(100, Math.round(normalized)));
    const at = now - daysAgo * DAY;
    const event: RatingEvent = {
      id: `demo-rat-${ratingSeq.toString().padStart(4, '0')}`,
      entityId: entity.id,
      entityType: entity.type,
      at,
      // The demo runs on the ten-point scale, the app's default.
      value: Math.max(1, Math.round(clamped / 10)),
      scaleId: 'int-10',
      normalized: clamped,
      confidence: random() < 0.2 ? 'low' : random() < 0.75 ? 'medium' : 'high',
      context: 'queue',
      updatedAt: at,
    };
    if (note) event.note = note;
    if (tags?.length) event.tags = tags;
    ratings.push(event);
  };

  const byId = new Map(entities.map((e) => [e.id, e]));

  for (const track of entities.filter((e) => e.type === 'track')) {
    // Deliberately partial: coverage gaps are a feature the app has to show.
    if (random() < 0.42) continue;
    const credit = track.artistIds?.[0];
    const bias = (credit ? artistBias.get(credit) : undefined) ?? 55;
    const value = bias + (random() - 0.5) * 34;
    const daysAgo = Math.floor(random() * 400);
    rate(track, value, daysAgo);
  }

  const notes: Record<string, string> = {
    'album:demo:the-glassblower': 'Best thing they have done. The sequencing is the argument.',
    'album:demo:rolling-stock': 'Relentless in a way I admire more than I enjoy.',
    'album:demo:appointments': 'Sentimental favourite. I know exactly why and I do not care.',
    'album:demo:harbour-static': 'Two great tracks holding up a lot of filler.',
  };

  for (const album of entities.filter((e) => e.type === 'album')) {
    if (random() < 0.45) continue;
    const credit = album.artistIds?.[0];
    const bias = (credit ? artistBias.get(credit) : undefined) ?? 55;
    rate(
      album,
      bias + (random() - 0.5) * 20,
      Math.floor(random() * 500),
      notes[album.id],
      random() < 0.3 ? ['reference'] : undefined,
    );
  }

  for (const id of artistIds) {
    const artist = byId.get(id);
    if (!artist || random() < 0.35) continue;
    rate(artist, (artistBias.get(id) ?? 55) + (random() - 0.5) * 12, Math.floor(random() * 600));
  }

  for (const playlist of entities.filter((e) => e.type === 'playlist')) {
    if (random() < 0.4) continue;
    rate(playlist, 55 + random() * 35, Math.floor(random() * 120));
  }

  // A handful of second opinions, so the timeline has genuine revisions in it.
  const revisable = ratings.filter((r) => r.entityType === 'album').slice(0, 6);
  for (const original of revisable) {
    const entity = byId.get(original.entityId);
    if (!entity || random() < 0.5) continue;
    rate(
      entity,
      Math.max(0, Math.min(100, original.normalized + (random() - 0.4) * 26)),
      Math.max(0, Math.floor(original.at ? (now - original.at) / DAY / 2 : 30)),
      'Revisited. It has grown on me.',
    );
  }

  /* ---- some settled comparisons ------------------------------------------ */

  let comparisonSeq = 0;
  const duel = (aId: EntityId, bId: EntityId, type: Entity['type'], daysAgo: number) => {
    comparisonSeq += 1;
    const roll = random();
    const outcome: Comparison['outcome'] = roll < 0.46 ? 'a' : roll < 0.92 ? 'b' : 'tie';
    const at = now - daysAgo * DAY;
    comparisons.push({
      id: `demo-cmp-${comparisonSeq.toString().padStart(4, '0')}`,
      entityType: type,
      aId,
      bId,
      outcome,
      at,
      reason: 'Both rated closely; the ranking needed a tie-break.',
      updatedAt: at,
    });
  };

  const ratedAlbums = [
    ...new Set(ratings.filter((r) => r.entityType === 'album').map((r) => r.entityId)),
  ];
  for (let i = 0; i < 48; i += 1) {
    const a = ratedAlbums[Math.floor(random() * ratedAlbums.length)];
    const b = ratedAlbums[Math.floor(random() * ratedAlbums.length)];
    if (a && b && a !== b) duel(a, b, 'album', Math.floor(random() * 90));
  }
  const ratedTracks = [
    ...new Set(ratings.filter((r) => r.entityType === 'track').map((r) => r.entityId)),
  ];
  for (let i = 0; i < 80; i += 1) {
    const a = ratedTracks[Math.floor(random() * ratedTracks.length)];
    const b = ratedTracks[Math.floor(random() * ratedTracks.length)];
    if (a && b && a !== b) duel(a, b, 'track', Math.floor(random() * 120));
  }
  for (let i = 0; i < 22; i += 1) {
    const a = artistIds[Math.floor(random() * artistIds.length)];
    const b = artistIds[Math.floor(random() * artistIds.length)];
    if (a && b && a !== b) duel(a, b, 'artist', Math.floor(random() * 200));
  }

  // Deduplicate the edges built above; a track can be credited twice.
  const uniqueMemberships = [...new Map(memberships.map((m) => [m.id, m])).values()];

  return { entities, memberships: uniqueMemberships, ratings, comparisons };
}

/** Listening signals for the demo, so the queue explains itself the same way. */
export function demoSignals(world: DemoWorld, now = Date.now()) {
  const random = rng(0xc0ffee);
  const tracks = world.entities.filter((e) => e.type === 'track');
  const artists = world.entities.filter((e) => e.type === 'artist' && e.providerId !== 'various');

  const recentlyPlayed = Array.from({ length: 40 }, (_, index) => {
    const track = tracks[Math.floor(random() * tracks.length)];
    return track
      ? {
          entityId: track.id,
          at: now - Math.floor(random() * 12 * DAY),
          index,
        }
      : null;
  }).filter((x): x is { entityId: EntityId; at: number; index: number } => x !== null);

  const top = [
    ...artists.slice(0, 12).map((a, rank) => ({
      entityId: a.id,
      term: 'short' as const,
      rank,
      of: 12,
    })),
    ...tracks.slice(0, 25).map((t, rank) => ({
      entityId: t.id,
      term: 'medium' as const,
      rank,
      of: 25,
    })),
    ...artists.slice(3, 13).map((a, rank) => ({
      entityId: a.id,
      term: 'long' as const,
      rank,
      of: 10,
    })),
  ];

  const saved = [
    ...world.entities
      .filter((e) => e.type === 'album')
      .slice(0, 10)
      .map((a) => ({ entityId: a.id, savedAt: now - Math.floor(random() * 300 * DAY) })),
    ...tracks
      .slice(0, 30)
      .map((t) => ({ entityId: t.id, savedAt: now - Math.floor(random() * 200 * DAY) })),
  ];

  return { recentlyPlayed, top, saved, fetchedAt: now };
}
