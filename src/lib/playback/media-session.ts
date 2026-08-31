import { get } from 'svelte/store';

import { sameItem } from './model';
import { browserPlayer } from './sdk';
import { playback, playbackNext, playbackPause, playbackPlay, playbackPrevious } from './store';
import type { PlayingItem } from './types';

/**
 * Lock-screen and media-key metadata.
 *
 * Only claimed when this app is genuinely the thing making the sound — the
 * browser player, or demo playback. Publishing handlers while a phone across
 * the room is the actual Spotify device would put a play button on the
 * lock screen that belongs to somebody else's transport.
 */

interface MediaSessionLike {
  metadata: unknown;
  playbackState?: 'none' | 'paused' | 'playing';
  setActionHandler(action: string, handler: (() => void) | null): void;
  setPositionState?: (state: { duration: number; position: number; playbackRate: number }) => void;
}

function session(): MediaSessionLike | null {
  const nav =
    typeof navigator === 'undefined' ? null : (navigator as unknown as Record<string, unknown>);
  const media = nav?.['mediaSession'] as MediaSessionLike | undefined;
  return media ?? null;
}

function metadata(item: PlayingItem): unknown {
  const Ctor = (globalThis as unknown as Record<string, unknown>)['MediaMetadata'] as
    (new (init: Record<string, unknown>) => unknown) | undefined;
  if (!Ctor) return null;
  return new Ctor({
    title: item.name,
    artist: item.artists.map((a) => a.name).join(', '),
    album: item.release?.name ?? '',
    artwork: item.artwork ? [{ src: item.artwork, sizes: '512x512', type: 'image/jpeg' }] : [],
  });
}

const ACTIONS = ['play', 'pause', 'previoustrack', 'nexttrack'] as const;

function clear(media: MediaSessionLike): void {
  media.metadata = null;
  if (media.playbackState) media.playbackState = 'none';
  for (const action of ACTIONS) {
    try {
      media.setActionHandler(action, null);
    } catch {
      // Some browsers refuse unsupported actions. Nothing to do about it.
    }
  }
}

function claim(media: MediaSessionLike): void {
  const handlers: Record<(typeof ACTIONS)[number], () => void> = {
    play: () => void playbackPlay(),
    pause: () => void playbackPause(),
    previoustrack: () => void playbackPrevious(),
    nexttrack: () => void playbackNext(),
  };
  for (const action of ACTIONS) {
    try {
      media.setActionHandler(action, handlers[action]);
    } catch {
      // Ignored: an unsupported action simply stays unhandled.
    }
  }
}

/** Keeps the OS media panel in step. Returns an unsubscribe that lets go. */
export function watchMediaSession(): () => void {
  const media = session();
  if (!media) return () => undefined;

  let claimed = false;
  let last: PlayingItem | null = null;

  const stop = playback.subscribe((state) => {
    const ours = state.source === 'demo' || get(browserPlayer).status === 'ready';
    const item = state.snapshot?.item ?? null;

    if (!ours || !item) {
      if (claimed) {
        clear(media);
        claimed = false;
        last = null;
      }
      return;
    }

    if (!claimed) {
      claim(media);
      claimed = true;
    }
    if (!sameItem(item, last)) {
      last = item;
      const meta = metadata(item);
      if (meta) media.metadata = meta;
    }
    if (media.playbackState) {
      media.playbackState = state.snapshot?.playing ? 'playing' : 'paused';
    }
  });

  return () => {
    stop();
    if (claimed) clear(media);
  };
}
