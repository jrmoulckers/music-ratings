import { describe, expect, it } from 'vitest';

import { SimulatedPlayback } from './simulated';
import type { PlayingItem } from './types';

/**
 * Demo playback runs the real screens through the real store, so it has to
 * behave like a transport rather than like a slideshow: it advances on a clock,
 * wraps, honours repeat, and refuses to pretend anything is playing until
 * somebody presses play.
 */

function track(n: number, durationMs = 10_000): PlayingItem {
  return {
    id: `t${n}`,
    uri: `spotify:track:t${n}`,
    kind: 'track',
    name: `Track ${n}`,
    artists: [{ id: 'a1', name: 'Someone' }],
    release: { id: 'al1', uri: 'spotify:album:al1', name: 'A record' },
    durationMs,
    isLocal: false,
    playable: true,
  };
}

function make(library: PlayingItem[] = [track(1), track(2), track(3)]) {
  let now = 1_000_000;
  const player = new SimulatedPlayback({
    library: () => library,
    contextItems: (uri) => (uri === 'spotify:album:al1' ? library : []),
    now: () => now,
  });
  return { player, tick: (ms: number) => (now += ms), at: () => now };
}

describe('SimulatedPlayback', () => {
  it('reports nothing playing until play is pressed', async () => {
    const { player } = make();
    expect(await player.read()).toBeNull();
    await player.play();
    expect((await player.read())?.playing).toBe(true);
  });

  it('advances the position against the clock', async () => {
    const { player, tick } = make();
    await player.play();
    tick(3_000);
    expect((await player.read())?.progressMs).toBe(3_000);
  });

  it('moves to the next track when one finishes', async () => {
    const { player, tick } = make();
    await player.play();
    tick(10_500);
    const snapshot = await player.read();
    expect(snapshot?.item?.uri).toBe('spotify:track:t2');
    expect(snapshot?.progressMs).toBeLessThan(1_000);
  });

  it('holds still while paused', async () => {
    const { player, tick } = make();
    await player.play();
    tick(2_000);
    await player.pause();
    tick(60_000);
    const snapshot = await player.read();
    expect(snapshot?.playing).toBe(false);
    expect(snapshot?.progressMs).toBe(2_000);
    expect(snapshot?.item?.uri).toBe('spotify:track:t1');
  });

  it('skips forward and wraps at the end', async () => {
    const { player } = make();
    await player.play();
    await player.next();
    expect((await player.read())?.item?.uri).toBe('spotify:track:t2');
    await player.next();
    await player.next();
    expect((await player.read())?.item?.uri).toBe('spotify:track:t1');
  });

  it('restarts the track when previous is pressed after a few seconds', async () => {
    const { player, tick } = make();
    await player.play();
    await player.next();
    tick(5_000);
    await player.previous();
    let snapshot = await player.read();
    expect(snapshot?.item?.uri).toBe('spotify:track:t2');
    expect(snapshot?.progressMs).toBe(0);

    await player.previous();
    snapshot = await player.read();
    expect(snapshot?.item?.uri).toBe('spotify:track:t1');
  });

  it('seeks within the track and never past its end', async () => {
    const { player } = make();
    await player.play();
    await player.seek(7_000);
    expect((await player.read())?.progressMs).toBe(7_000);
    await player.pause();
    await player.seek(999_999);
    expect((await player.read())?.progressMs).toBe(10_000);
    await player.seek(-5);
    expect((await player.read())?.progressMs).toBe(0);
  });

  it('plays a whole record when given a context, and reports it', async () => {
    const { player } = make();
    await player.play({ contextUri: 'spotify:album:al1', offset: { position: 1 } });
    const snapshot = await player.read();
    expect(snapshot?.context).toMatchObject({ kind: 'album', uri: 'spotify:album:al1' });
    expect(snapshot?.item?.uri).toBe('spotify:track:t2');
  });

  it('repeats one track when asked, instead of moving on', async () => {
    const { player, tick } = make();
    await player.play();
    await player.setRepeat('track');
    tick(11_000);
    expect((await player.read())?.item?.uri).toBe('spotify:track:t1');
  });

  it('carries shuffle and volume back in the reading', async () => {
    const { player } = make();
    await player.play();
    await player.setShuffle(true);
    await player.setVolume(15);
    const snapshot = await player.read();
    expect(snapshot?.shuffle).toBe(true);
    expect(snapshot?.device?.volumePercent).toBe(15);
  });

  it('offers two devices and moves playback between them', async () => {
    const { player } = make();
    await player.play();
    expect((await player.devices()).map((d) => d.id)).toEqual(['demo-browser', 'demo-speaker']);
    await player.transfer('demo-speaker', true);
    expect((await player.read())?.device?.id).toBe('demo-speaker');
  });

  it('queues a track and plays it next', async () => {
    const { player } = make();
    await player.play();
    await player.enqueue('spotify:track:t3');
    expect((await player.queue())[0]?.uri).toBe('spotify:track:t3');
    await player.next();
    expect((await player.read())?.item?.uri).toBe('spotify:track:t3');
  });

  it('reports nothing when the listener has no tracks stored at all', async () => {
    const { player } = make([]);
    await player.play();
    expect(await player.read()).toBeNull();
  });
});
