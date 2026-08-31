import { onTrackChange } from '../playback/store';
import { refreshListening } from '../spotify/session';

/**
 * Re-read the recently-played window shortly after playback moves on.
 *
 * The track change is only a prompt to ask. Spotify decides whether the track
 * counted, and it needs a moment to make up its mind — the play appears in
 * `/recently-played` some seconds after the next one starts, and not at all if
 * it was skipped early. So this waits, then asks, and records whatever comes
 * back. Nothing about the change itself is written down.
 */

/** Long enough for Spotify to settle, short enough to feel immediate. */
const SETTLE_MS = 12_000;

export function watchListening(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = onTrackChange(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void refreshListening();
    }, SETTLE_MS);
  });

  return () => {
    if (timer) clearTimeout(timer);
    stop();
  };
}
