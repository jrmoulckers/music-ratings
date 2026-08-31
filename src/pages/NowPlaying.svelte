<script lang="ts">
  import { onMount } from 'svelte';

  import { entityHref } from '../lib/app/router';
  import { topUpArtistArtwork } from '../lib/app/artwork';
  import { notify } from '../lib/app/notices';
  import { ensureRelease } from '../lib/app/release';
  import { explicitRatings, graph, settings } from '../lib/app/state';
  import { albumSession, startAlbumSession } from '../lib/playback/album';
  import { playingEntityIds } from '../lib/playback/entities';
  import { allows, freshness, refusalReason } from '../lib/playback/model';
  import { browserPlayer } from '../lib/playback/sdk';
  import {
    playback,
    playbackNow,
    playbackPlay,
    playbackRepeat,
    playbackShuffle,
    refreshDevices,
    refreshPlayback,
    refreshQueue,
    watchPlayback,
  } from '../lib/playback/store';
  import type { RepeatMode } from '../lib/playback/types';
  import { artistNeedsArtwork } from '../lib/spotify/artwork';
  import { connectSpotify } from '../lib/spotify/session';
  import Icon from '../lib/ui/Icon.svelte';
  import AlbumMode from '../components/AlbumMode.svelte';
  import Artwork from '../components/Artwork.svelte';
  import DevicePicker from '../components/DevicePicker.svelte';
  import InlineRating from '../components/InlineRating.svelte';
  import RatableRow from '../components/RatableRow.svelte';
  import RatePanel from '../components/RatePanel.svelte';

  /**
   * Now Playing.
   *
   * The page beneath the bar. The transport — play, previous, next, the
   * scrubber, the volume — is the persistent player at the foot of every
   * screen, and it is not repeated here. What this page adds is everything
   * that bar has no room for: the record at full size, the rating in full,
   * the shape of the session, and what is coming next.
   */

  onMount(() => {
    const stop = watchPlayback();
    void refreshQueue();
    return stop;
  });

  const player = $derived($playback);
  const snapshot = $derived(player.snapshot);
  const item = $derived(snapshot?.item ?? null);

  const ids = $derived(playingEntityIds(item));
  const track = $derived(ids.track ? $graph.entity(ids.track) : undefined);
  const release = $derived(ids.release ? $graph.entity(ids.release) : undefined);
  const artist = $derived(ids.artists[0] ? $graph.entity(ids.artists[0]) : undefined);

  // Playback names the artist but never pictures them, so the artist beside the
  // record you are hearing is completed once, when it first appears.
  $effect(() => {
    void topUpArtistArtwork(artist && artistNeedsArtwork(artist) ? [artist] : []);
  });

  const inAlbumSession = $derived($albumSession.albumId !== null);

  /**
   * The offer to rate a record track by track appears when Spotify is playing
   * a record from start to finish and that record is in the library —
   * otherwise the track list would be empty and the offer a dead end.
   */
  const albumOffer = $derived.by(() => {
    if (inAlbumSession || !$settings.autoAlbumMode) return null;
    if (snapshot?.context?.kind !== 'album' || !snapshot.context.id) return null;
    const id = snapshot.context.id;
    // The record playing is almost always the one the track belongs to; fall
    // back to the Spotify-shaped id only when the track has no release.
    if (release && item?.release?.id === id) return release;
    return $graph.entity(`album:spotify:${id}`) ?? null;
  });

  async function beginAlbumSession() {
    if (!albumOffer) return;
    // The album-mode list is the whole record or it is nothing useful; fetch
    // any tracks this app has not met before starting to walk through it.
    const whole = await ensureRelease(albumOffer, $graph);
    if (whole.status === 'incomplete') {
      notify(
        `Only ${whole.known} of ${whole.total ?? whole.known} tracks are loaded. ${whole.reason}`,
        {
          tone: 'warn',
        },
      );
    }
    startAlbumSession(albumOffer.id, snapshot?.context?.uri ?? null);
  }

  /* ---------------------------------------------------------------------- */
  /* Rating what is playing                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * A rating in progress belongs to the track it was started on.
   *
   * Music moves on while you are still deciding. Swapping the editor's subject
   * underneath an unsaved note would file your opinion against the wrong
   * record, so the editor stays pinned until you finish with it.
   */
  let deepOpen = $state(false);
  let pinnedId = $state<string | null>(null);

  const editing = $derived(pinnedId ? ($graph.entity(pinnedId) ?? track) : track);
  const drifted = $derived(
    deepOpen && !!editing && !!track && editing.id !== track.id ? editing : null,
  );

  function openDeep() {
    pinnedId = track?.id ?? null;
    deepOpen = true;
  }

  function closeDeep() {
    deepOpen = false;
    pinnedId = null;
  }

  function followMusic() {
    pinnedId = track?.id ?? null;
  }

  /* ---------------------------------------------------------------------- */
  /* Devices and secondary rows                                             */
  /* ---------------------------------------------------------------------- */

  let devicesOpen = $state(false);
  let secondaryOpen = $state<'release' | 'artist' | null>(null);
  let queueOpen = $state(true);

  const repeatOrder: RepeatMode[] = ['off', 'context', 'track'];
  const repeatWord: Record<RepeatMode, string> = {
    off: 'Repeat off',
    context: 'Repeat all',
    track: 'Repeat this track',
  };

  function cycleRepeat() {
    const mode = snapshot?.repeat ?? 'off';
    const next = repeatOrder[(repeatOrder.indexOf(mode) + 1) % repeatOrder.length] ?? 'off';
    void playbackRepeat(next);
  }

  async function startDemo() {
    await playbackPlay();
    await refreshQueue();
  }

  function reconnect() {
    void connectSpotify('/now-playing');
  }
</script>

<div class="sheet">
  <header class="head">
    <h1 class="display">Now Playing</h1>
    <p class="label">
      {#if player.source === 'demo'}
        demo playback · nothing is sent to Spotify
      {:else}
        read {freshness(player.fetchedAt, $playbackNow)}
      {/if}
    </p>
  </header>

  {#if player.status === 'needs-permission'}
    <section class="panel stack">
      <h2 class="head">Reconnect to control playback</h2>
      <p class="note">
        Your Spotify connection was made before this app could read and control playback. Reconnect
        to grant those permissions. Nothing you have rated is affected.
      </p>
      <button type="button" class="btn btn--primary" onclick={reconnect}>Reconnect Spotify</button>
    </section>
  {:else if player.status === 'needs-premium'}
    <section class="panel stack">
      <h2 class="head">Spotify Premium is required</h2>
      <p class="note">
        Spotify only lets applications control playback for Premium accounts. You can still rate
        everything here; the transport will stay unavailable.
      </p>
    </section>
  {:else if player.status === 'offline'}
    <section class="panel stack">
      <h2 class="head">Offline</h2>
      <p class="note">
        This is the last thing this device saw, read {freshness(player.fetchedAt, $playbackNow)}. It
        may have moved on since.
      </p>
    </section>
  {/if}

  {#if item}
    <section class="now panel" aria-label="What is playing">
      <div class="now__art">
        <Artwork src={item.artwork} name={item.name} size="lg" priority />
      </div>

      <div class="now__id stack">
        <div>
          <p class="label">
            {item.kind === 'episode' ? 'Episode' : 'Track'}{snapshot?.context
              ? ` · from a ${snapshot.context.kind}`
              : ''}
          </p>
          <h2 class="now__title">{item.name}</h2>
          <p class="now__by">
            {#each item.artists as performer, i (performer.id ?? performer.name)}
              {#if i > 0}<span aria-hidden="true">, </span>{/if}
              {#if ids.artists[i] && $graph.entity(ids.artists[i])}
                <a href={entityHref(ids.artists[i])}>{performer.name}</a>
              {:else}
                <span>{performer.name}</span>
              {/if}
            {/each}
            {#if item.release}
              <span class="note"> · </span>
              {#if release}
                <a href={entityHref(release.id)}>{item.release.name}</a>
              {:else}
                <span class="note">{item.release.name}</span>
              {/if}
            {/if}
          </p>
        </div>

        {#if item.spotifyUrl}
          <a
            class="btn btn--small btn--quiet"
            href={item.spotifyUrl}
            target="_blank"
            rel="noopener"
          >
            Open in Spotify
          </a>
        {/if}
      </div>

      <div class="now__rate stack">
        {#if track}
          <!-- The quick rating for this track lives in the bar below, where it
               is on every page. What the page adds is everything the bar has no
               room for: the note, the confidence, the deeper rating. -->
          <button
            type="button"
            class="btn btn--primary now__deep"
            aria-expanded={deepOpen}
            onclick={() => (deepOpen ? closeDeep() : openDeep())}
          >
            {deepOpen ? 'Close rating details' : 'Rate in detail'}
          </button>
          <p class="note note--small">Note, confidence and deeper rating.</p>
        {:else}
          <p class="note">
            {item.isLocal
              ? 'Local files have no Spotify identity, so they cannot be rated here.'
              : item.kind === 'ad'
                ? 'This is an advert.'
                : 'This cannot be rated.'}
          </p>
        {/if}
      </div>
    </section>

    {#if deepOpen && editing}
      <section class="panel panel--sunk stack" aria-label="Rate in detail">
        {#if drifted}
          <p class="drift note" role="status">
            Still rating <strong>{drifted.name}</strong>. Save it, or
            <button type="button" class="linkish" onclick={followMusic}>
              switch to what is playing now
            </button>.
          </p>
        {/if}
        <RatePanel
          entity={editing}
          inline
          shortcuts={false}
          where="now-playing"
          onafter={closeDeep}
        />
      </section>
    {/if}

    <!-- The transport is the bar along the bottom, on this page as on every
         other. What stays here is the shape of the session: where it is
         playing, and how it moves through a record. -->
    <section class="options panel" aria-label="Playback options">
      <div class="options__row">
        <button
          type="button"
          class="btn options__btn"
          disabled={!allows(snapshot, 'shuffle')}
          aria-pressed={snapshot?.shuffle === true}
          title={allows(snapshot, 'shuffle') ? 'Shuffle' : refusalReason('shuffle')}
          onclick={() => void playbackShuffle(!(snapshot?.shuffle === true))}
        >
          <Icon name="shuffle" size={16} />
          <span>{snapshot?.shuffle ? 'Shuffle on' : 'Shuffle off'}</span>
        </button>

        <button
          type="button"
          class="btn options__btn"
          disabled={!allows(snapshot, 'repeat')}
          aria-pressed={(snapshot?.repeat ?? 'off') !== 'off'}
          title={allows(snapshot, 'repeat')
            ? repeatWord[snapshot?.repeat ?? 'off']
            : refusalReason('repeat')}
          onclick={cycleRepeat}
        >
          <Icon
            name={(snapshot?.repeat ?? 'off') === 'track' ? 'repeat-one' : 'repeat'}
            size={16}
          />
          <span>{repeatWord[snapshot?.repeat ?? 'off']}</span>
        </button>
      </div>

      <button
        type="button"
        class="btn btn--quiet options__btn"
        aria-expanded={devicesOpen}
        onclick={() => {
          devicesOpen = !devicesOpen;
          if (devicesOpen) void refreshDevices();
        }}
      >
        <Icon name="device" size={14} />
        <span>{snapshot?.device?.name ?? 'Devices'}</span>
      </button>
    </section>

    {#if devicesOpen}
      <section class="panel panel--sunk">
        <DevicePicker onchosen={() => (devicesOpen = false)} />
      </section>
    {/if}

    <!-- Rating the record and the performer is a second thought, not the first
         one, so both stay folded away until asked for. -->
    {#if release || artist}
      <section class="stack" aria-label="Also rate">
        <h2 class="head">Also rate</h2>
        <ul class="also">
          {#if release}
            <RatableRow
              entity={release}
              where="now-playing"
              expanded={secondaryOpen === 'release'}
              ontoggle={() => (secondaryOpen = secondaryOpen === 'release' ? null : 'release')}
            />
          {/if}
          {#if artist}
            <RatableRow
              entity={artist}
              where="now-playing"
              expanded={secondaryOpen === 'artist'}
              ontoggle={() => (secondaryOpen = secondaryOpen === 'artist' ? null : 'artist')}
            />
          {/if}
        </ul>
      </section>
    {/if}

    {#if inAlbumSession}
      <AlbumMode />
    {:else if albumOffer}
      <section class="panel row row--between">
        <p class="note">You are listening to a record from start to finish.</p>
        <button type="button" class="btn btn--small" onclick={() => void beginAlbumSession()}>
          Rate it track by track
        </button>
      </section>
    {/if}

    {#if player.queue.length > 0}
      <section class="stack" aria-label="Up next">
        <div class="row row--between">
          <h2 class="head">Up next</h2>
          <button
            type="button"
            class="btn btn--small btn--quiet"
            aria-expanded={queueOpen}
            onclick={() => {
              queueOpen = !queueOpen;
              if (queueOpen) void refreshQueue();
            }}
          >
            {queueOpen ? 'Hide' : `Show ${player.queue.length}`}
          </button>
        </div>
        {#if queueOpen}
          <ol class="queue">
            {#each player.queue.slice(0, 10) as next, i (next.uri ?? `${next.name}-${i}`)}
              {@const queued = playingEntityIds(next)}
              {@const queuedEntity = queued.track ? $graph.entity(queued.track) : undefined}
              <li class="entry queue__row">
                <span class="mono queue__no">{i + 1}</span>
                <span class="queue__name">
                  <span>{next.name}</span>
                  <span class="note">{next.artists.map((a) => a.name).join(', ')}</span>
                </span>
                {#if queuedEntity}
                  <InlineRating
                    entity={queuedEntity}
                    value={$explicitRatings.get(queuedEntity.id)?.normalized ?? null}
                    where="now-playing"
                  />
                {/if}
              </li>
            {/each}
          </ol>
        {/if}
      </section>
    {/if}
  {:else if player.status !== 'needs-permission' && player.status !== 'needs-premium'}
    <section class="panel stack">
      <h2 class="head">Nothing is playing</h2>
      {#if player.source === 'demo'}
        <p class="note">
          You are not connected to Spotify, so this is demo playback: your own saved tracks, on a
          timer, so the whole Now Playing experience works before you connect anything.
        </p>
        <button type="button" class="btn btn--primary" onclick={() => void startDemo()}>
          Start demo playback
        </button>
      {:else}
        <p class="note">
          Start something in Spotify on any device and it will appear here, or pick a device below.
        </p>
        <button type="button" class="btn" onclick={() => void refreshPlayback()}>Check again</button
        >
      {/if}
    </section>

    {#if player.source !== 'demo'}
      <section class="panel panel--sunk">
        <DevicePicker />
      </section>
    {/if}
  {/if}

  {#if player.error}
    <p class="note error" role="status">{player.error}</p>
  {/if}

  {#if $browserPlayer.status === 'error' && $browserPlayer.error}
    <p class="note error" role="status">{$browserPlayer.error}</p>
  {/if}
</div>

<style>
  .now {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: var(--s5);
    /* The sleeve sets the height; the words and the rating sit against its
       middle rather than stranding a column of empty panel beneath them. */
    align-items: center;
  }

  .now__art {
    flex: none;
  }

  .now__title {
    font-size: 1.5rem;
    line-height: 1.15;
    margin: var(--s1) 0 0;
    letter-spacing: -0.01em;
  }

  .now__by {
    margin: var(--s2) 0 0;
    color: var(--ink-quiet);
  }

  .now__rate {
    min-width: 12rem;
    align-items: flex-end;
  }
  .now__deep {
    white-space: nowrap;
  }

  .also {
    display: flex;
    flex-direction: column;
  }

  .drift {
    color: var(--ink);
  }
  .linkish {
    padding: 0;
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .options {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--s4);
  }
  .options__row {
    display: flex;
    gap: var(--s3);
  }
  .options__btn {
    /* Reached for by a thumb, standing up, in the dark. */
    min-height: 44px;
  }

  .queue {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .queue__row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--s3);
  }
  .queue__no {
    color: var(--ink-faint);
    font-size: 0.75rem;
  }
  .queue__name {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .queue__name > span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .error {
    color: var(--danger);
  }

  @media (max-width: 48rem) {
    .now {
      grid-template-columns: auto minmax(0, 1fr);
      gap: var(--s4);
    }
    .now__rate {
      grid-column: 1 / -1;
      align-items: stretch;
      min-width: 0;
    }
    .options {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
