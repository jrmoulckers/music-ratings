import type { Entity } from '../domain/types';
import { SpotifyApiError, type SpotifyClient } from './client';
import { mapArtist } from './mappers';

/**
 * Filling in the artist pictures Spotify does not send.
 *
 * Only a full artist object carries images. Every artist that arrives on a
 * track, an album, a playlist item or a playback state is the simplified kind —
 * an id and a name — and that is how most artists are first met, so most
 * artists arrive with no picture at all. The record is correct; it is just
 * incomplete, and nothing but a second request will complete it.
 *
 * Spotify has removed the batch `GET /artists`, so this is one request per
 * artist and the cost has to be governed rather than absorbed:
 *
 * - only artists whose stored record actually lacks a picture are asked about;
 * - a hard ceiling per call, so a page of sixty rows cannot become sixty
 *   requests;
 * - in-flight de-duplication, so a burst of rows naming the same artist asks
 *   once and they all wait on that one answer;
 * - a memory of what has already been asked, so an artist Spotify simply has no
 *   picture for is not re-requested every time a list re-renders.
 *
 * A failure is not an error the person needs to see — a missing picture is a
 * missing picture — so it is counted and returned rather than thrown, and the
 * artist is left exactly as it was. Transient failures forget they happened so
 * a later pass can try again; a refusal or a deleted artist is remembered, so
 * it is asked once and never again.
 */

/** Asked about in one call. Enough to fill a screen, small enough to be free. */
export const ARTWORK_MAX_PER_CALL = 8;

/** Requests in the air, keyed by Spotify artist id. */
const inFlight = new Map<string, Promise<Entity | null>>();
/** Artists already asked about this session, whether or not one came back. */
const asked = new Set<string>();

export interface ArtworkFill {
  /** Artists that came back with a picture, ready to be written down. */
  filled: Entity[];
  /** How many were asked about and did not produce one. */
  missed: number;
  /** Reasons, for diagnostics. Empty when everything worked. */
  problems: string[];
}

/**
 * Worth asking about: a Spotify artist we hold no picture for. A local artist
 * has no Spotify record to complete, and one we have already asked about is
 * either filled or known not to have one.
 */
export function artistNeedsArtwork(entity: Entity): boolean {
  return (
    entity.type === 'artist' &&
    entity.provider === 'spotify' &&
    !entity.deleted &&
    !entity.artworkUrl &&
    !entity.artworkThumbUrl
  );
}

/** Forgets the session's memory. Tests and a fresh sign-in both want this. */
export function resetArtistArtwork(): void {
  inFlight.clear();
  asked.clear();
}

/**
 * A transient failure should not poison the artist for the rest of the session:
 * being rate-limited or offline says nothing about whether a picture exists.
 */
function isTransient(error: unknown): boolean {
  if (error instanceof SpotifyApiError) return error.status === 429 || error.status >= 500;
  return true;
}

async function fetchOne(client: SpotifyClient, providerId: string): Promise<Entity | null> {
  const running = inFlight.get(providerId);
  if (running) return running;

  const request = (async () => {
    const full = await client.artist(providerId);
    const mapped = mapArtist(full, 'artist artwork');
    return mapped.artworkUrl || mapped.artworkThumbUrl ? mapped : null;
  })();

  inFlight.set(providerId, request);
  try {
    return await request;
  } finally {
    inFlight.delete(providerId);
  }
}

/**
 * Completes the artists among `candidates` that have no picture.
 *
 * Returns the completed records rather than writing them, because who owns the
 * write differs by caller — an import already has a transaction open, a page
 * does not.
 */
export async function fillArtistArtwork(
  client: SpotifyClient,
  candidates: readonly Entity[],
  options: { max?: number } = {},
): Promise<ArtworkFill> {
  const max = options.max ?? ARTWORK_MAX_PER_CALL;
  const out: ArtworkFill = { filled: [], missed: 0, problems: [] };
  if (max <= 0) return out;

  // Deduplicated within the call as well as across calls: one album can name
  // the same artist on every track.
  const wanted: string[] = [];
  const seen = new Set<string>();
  for (const entity of candidates) {
    if (!artistNeedsArtwork(entity)) continue;
    const providerId = entity.providerId;
    if (!providerId || seen.has(providerId) || asked.has(providerId)) continue;
    seen.add(providerId);
    wanted.push(providerId);
    if (wanted.length >= max) break;
  }
  if (wanted.length === 0) return out;

  for (const providerId of wanted) asked.add(providerId);

  const results = await Promise.all(
    wanted.map(async (providerId) => {
      try {
        return { providerId, entity: await fetchOne(client, providerId) };
      } catch (error) {
        // Something we might win next time should not be remembered as settled.
        if (isTransient(error)) asked.delete(providerId);
        const why = error instanceof Error ? error.message : String(error);
        return { providerId, entity: null, why };
      }
    }),
  );

  for (const result of results) {
    if (result.entity) out.filled.push(result.entity);
    else {
      out.missed += 1;
      if (result.why) out.problems.push(`${result.providerId}: ${result.why}`);
    }
  }
  return out;
}
