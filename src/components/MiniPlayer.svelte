<script lang="ts">
  import { onMount } from 'svelte';

  import { href, navigate } from '../lib/app/router';
  import { explicitRatings, graph } from '../lib/app/state';
  import { allows } from '../lib/playback/model';
  import { playingEntityIds } from '../lib/playback/entities';
  import { watchMediaSession } from '../lib/playback/media-session';
  import {
    playback,
    playbackNext,
    playbackPrevious,
    playbackProgress,
    playbackToggle,
    watchPlayback,
  } from '../lib/playback/store';
  import { clockTime } from '../lib/ui/format';
  import Icon from '../lib/ui/Icon.svelte';
  import Artwork from './Artwork.svelte';
  import QuickRate from './QuickRate.svelte';

  /**
   * The player that follows you around.
   *
   * A single ruled band at the foot of the app: what is playing, the three
   * controls worth reaching for without thinking, and the same rating control
   * used everywhere else — because the whole point of knowing what is playing
   * is being able to say what you think of it.
   *
   * It publishes its own height as `--player-h` so the shell, the notices and
   * the update prompt move up by exactly the right amount instead of guessing.
   */

  let bar = $state<HTMLElement | null>(null);

  onMount(() => {
    const stopWatching = watchPlayback();
    const stopMedia = watchMediaSession();
    return () => {
      stopMedia();
      stopWatching();
    };
  });

  const snapshot = $derived($playback.snapshot);
  const item = $derived(snapshot?.item ?? null);
  const playing = $derived(snapshot?.playing === true);
  const elapsed = $derived($playbackProgress);
  const fraction = $derived(
    snapshot && snapshot.durationMs > 0 ? elapsed / snapshot.durationMs : 0,
  );

  const ids = $derived(playingEntityIds(item));
  const entity = $derived(ids.track ? $graph.entity(ids.track) : undefined);
  const rating = $derived(entity ? $explicitRatings.get(entity.id) : undefined);

  const idle = $derived(!item && $playback.devices.length > 0);
  const shown = $derived(Boolean(item) || idle);

  const artists = $derived(item?.artists.map((a) => a.name).join(', ') ?? '');

  // Every layout the bar can take publishes the same measurement, so nothing
  // downstream has to know which one is on screen.
  $effect(() => {
    const root = document.documentElement;
    if (!shown || !bar) {
      root.style.removeProperty('--player-h');
      return;
    }
    const observer = new ResizeObserver(() => {
      root.style.setProperty('--player-h', `${bar?.offsetHeight ?? 0}px`);
    });
    observer.observe(bar);
    root.style.setProperty('--player-h', `${bar.offsetHeight}px`);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--player-h');
    };
  });

  function open() {
    navigate(href('now-playing'));
  }
</script>

{#if shown}
  <aside class="mini" class:mini--idle={idle} bind:this={bar} aria-label="Now playing">
    <!-- The travelled rail. The scrubber proper lives on the Now Playing page,
         where a drag cannot be a mis-tap on the way to something else. -->
    <div class="mini__rail" aria-hidden="true">
      <span class="mini__travelled" style="transform: scaleX({fraction.toFixed(5)})"></span>
    </div>

    {#if item}
      <div class="mini__body">
        <button type="button" class="mini__id" onclick={open}>
          <Artwork src={item.artwork} name={item.name} size="sm" />
          <span class="mini__names">
            <span class="mini__title">{item.name}</span>
            <span class="note mini__sub">{artists || 'Unknown artist'}</span>
          </span>
        </button>

        <div class="mini__transport">
          <button
            type="button"
            class="btn btn--small mini__btn"
            disabled={!allows(snapshot, 'previous')}
            onclick={() => void playbackPrevious()}
          >
            <Icon name="previous" size={14} />
            <span class="sr-only">Previous</span>
          </button>
          <button
            type="button"
            class="btn btn--small mini__btn mini__btn--play"
            onclick={() => void playbackToggle()}
          >
            <Icon name={playing ? 'pause' : 'play'} size={14} />
            <span class="sr-only">{playing ? 'Pause' : 'Play'}</span>
          </button>
          <button
            type="button"
            class="btn btn--small mini__btn"
            disabled={!allows(snapshot, 'next')}
            onclick={() => void playbackNext()}
          >
            <Icon name="next" size={14} />
            <span class="sr-only">Next</span>
          </button>
        </div>

        <span class="mini__time mono">
          {clockTime(elapsed)} / {clockTime(snapshot?.durationMs ?? 0)}
        </span>

        <div class="mini__rate">
          {#if entity}
            <QuickRate {entity} value={rating?.normalized ?? null} where="now-playing" />
          {:else}
            <span class="note">Not rateable</span>
          {/if}
        </div>

        <div class="mini__aside">
          {#if snapshot?.device}
            <span class="label mini__device">{snapshot.device.name}</span>
          {/if}
          <a class="btn btn--small btn--quiet" href={href('now-playing')}>
            <span>Open</span>
            <span class="sr-only">Now Playing</span>
          </a>
        </div>
      </div>
    {:else}
      <div class="mini__body mini__body--idle">
        <span class="note">Nothing is playing.</span>
        <a class="btn btn--small" href={href('now-playing')}>Choose a device</a>
      </div>
    {/if}
  </aside>
{/if}

<style>
  .mini {
    position: fixed;
    inset: auto 0 0 var(--rail-w);
    z-index: var(--z-player);
    background: var(--surface-raised);
    border-top: var(--rule-weight) solid var(--ink);
    padding-bottom: env(safe-area-inset-bottom);
  }

  @media (max-width: 60rem) {
    .mini {
      inset: auto 0 calc(3.5rem + env(safe-area-inset-bottom)) 0;
      padding-bottom: 0;
    }
  }

  .mini__rail {
    height: var(--rule-weight);
    background: var(--border-faint);
  }
  .mini__travelled {
    display: block;
    width: 100%;
    height: 100%;
    background: var(--accent);
    /* Scaled rather than resized: the rail is repainted every frame while the
       music plays, and a transform costs the compositor nothing. */
    transform-origin: left center;
    will-change: transform;
  }

  .mini__body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto auto auto;
    align-items: center;
    gap: var(--s4);
    padding: var(--s2) var(--s5);
  }
  .mini__body--idle {
    grid-template-columns: minmax(0, 1fr) auto;
    padding-block: var(--s3);
  }

  .mini__id {
    display: flex;
    align-items: center;
    gap: var(--s3);
    min-width: 0;
    padding: 0;
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .mini__id:focus-visible {
    outline: var(--rule-weight) solid var(--accent);
    outline-offset: 3px;
  }

  .mini__names {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .mini__title {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mini__id:hover .mini__title {
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .mini__sub {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mini__transport {
    display: flex;
    gap: var(--s2);
  }
  .mini__btn {
    padding-inline: var(--s3);
    min-height: 44px;
  }
  .mini__btn--play {
    border-color: var(--ink);
  }

  .mini__time {
    font-size: 0.75rem;
    color: var(--ink-quiet);
    white-space: nowrap;
  }

  .mini__aside {
    display: flex;
    align-items: center;
    gap: var(--s3);
  }
  .mini__device {
    max-width: 10rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Phones keep what is playing, one control and the rating; everything else
     is a tap away on the page. */
  @media (max-width: 48rem) {
    .mini__body {
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: var(--s3);
      padding: var(--s2) var(--s4);
    }
    .mini__time,
    .mini__aside {
      display: none;
    }
    .mini__transport .mini__btn:not(.mini__btn--play) {
      display: none;
    }
  }
</style>
