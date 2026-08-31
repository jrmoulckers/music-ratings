import type { SpotifyClient } from '../spotify/client';
import type {
  PlaybackDevice,
  PlaybackService,
  PlaybackSnapshot,
  PlayingItem,
  PlayRequest,
  RepeatMode,
} from './types';
import { mapDevices, mapPlayingItem, mapSnapshot } from './wire';

/**
 * The transport, over Spotify Connect.
 *
 * Commands are sent without a device id wherever possible: Spotify routes them
 * to whichever device is active, which is what "the thing that is playing"
 * means to the listener. Only starting playback somewhere new and handing over
 * name a device explicitly.
 */
export class SpotifyPlayback implements PlaybackService {
  readonly id = 'spotify' as const;

  constructor(private readonly client: SpotifyClient) {}

  async read(signal?: AbortSignal): Promise<PlaybackSnapshot | null> {
    const state = await this.client.playbackState(signal ? { signal } : {});
    return mapSnapshot(state, Date.now());
  }

  async devices(signal?: AbortSignal): Promise<PlaybackDevice[]> {
    return mapDevices(await this.client.devices(signal ? { signal } : {}));
  }

  async queue(signal?: AbortSignal): Promise<PlayingItem[]> {
    const body = await this.client.queue(signal ? { signal } : {});
    return body.queue
      .map((item) => mapPlayingItem(item))
      .filter((item): item is PlayingItem => item !== null);
  }

  play(request: PlayRequest = {}): Promise<void> {
    return this.client.play(request);
  }

  pause(): Promise<void> {
    return this.client.pause();
  }

  next(): Promise<void> {
    return this.client.next();
  }

  previous(): Promise<void> {
    return this.client.previous();
  }

  seek(positionMs: number): Promise<void> {
    return this.client.seek(positionMs);
  }

  setVolume(percent: number): Promise<void> {
    return this.client.setVolume(percent);
  }

  setShuffle(on: boolean): Promise<void> {
    return this.client.setShuffle(on);
  }

  setRepeat(mode: RepeatMode): Promise<void> {
    return this.client.setRepeat(mode);
  }

  transfer(deviceId: string, play: boolean): Promise<void> {
    return this.client.transferPlayback(deviceId, play);
  }

  enqueue(uri: string): Promise<void> {
    return this.client.addToQueue(uri);
  }
}
