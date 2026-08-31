<script lang="ts">
  import { entityHref } from '../lib/app/router';
  import { explicitRatings, graph, scaleForType, scores } from '../lib/app/state';
  import {
    albumProgress,
    albumRows,
    albumSession,
    clearAlbumSession,
    endAlbumSession,
    noteListened,
    stillOnAlbum,
  } from '../lib/playback/album';
  import { playback } from '../lib/playback/store';
  import type { Entity } from '../lib/domain/types';
  import { formatComputedOn } from '../lib/domain/scales';
  import Artwork from './Artwork.svelte';
  import QuickRate from './QuickRate.svelte';
  import RatableRow from './RatableRow.svelte';
  import RatePanel from './RatePanel.svelte';

  /**
   * Listening to a record and rating it as it goes.
   *
   * The track list is the surface; the record's own rating sits above it and
   * stays independent of it, because "this album is a 9" and "these ten tracks
   * average 7.4" are two different opinions and the app owes you both.
   */

  const session = $derived($albumSession);
  const album = $derived(session.albumId ? ($graph.entity(session.albumId) ?? null) : null);
  const snapshot = $derived($playback.snapshot);
  const onAlbum = $derived(stillOnAlbum(session, snapshot));

  const tracks = $derived.by((): Entity[] => {
    if (!album) return [];
    return $graph
      .childrenOfType(album.id, 'track')
      .map((edge) => $graph.entity(edge.childId))
      .filter((entity): entity is Entity => !!entity);
  });

  const listened = $derived(new Set(session.listened));
  const rated = $derived(
    new Set(tracks.filter((t) => $explicitRatings.has(t.id)).map((t) => t.id)),
  );

  const rows = $derived(
    albumRows({
      tracks,
      currentUri: onAlbum ? (snapshot?.item?.uri ?? null) : null,
      listened,
      rated,
    }),
  );
  const progress = $derived(albumProgress(rows));

  let onlyUnrated = $state(false);
  const shown = $derived(onlyUnrated ? rows.filter((row) => !row.rated) : rows);

  let openId = $state<string | null>(null);
  let albumOpen = $state(false);

  const albumRating = $derived(album ? $explicitRatings.get(album.id) : undefined);
  const albumScore = $derived(album ? $scores.get(album.id) : undefined);
  const albumScale = $derived(album ? $scaleForType(album.type) : null);

  /**
   * A track counts as heard when playback moves on from it, not when it starts.
   * Two seconds of something you skipped is not listening, and asking you to
   * rate it would be asking you to make something up.
   */
  let sounding: string | null = $state(null);

  $effect(() => {
    const uri = onAlbum ? (snapshot?.item?.uri ?? null) : null;
    if (uri === sounding) return;
    const previous = sounding;
    sounding = uri;
    if (!previous) return;
    const left = tracks.find((track) => `spotify:track:${track.providerId}` === previous);
    if (left) noteListened(left.id);
  });

  // Playback leaving the record closes the sitting, so the summary can be
  // offered once rather than every time the state is polled.
  $effect(() => {
    if (session.albumId && !session.endedAt && snapshot && !onAlbum) endAlbumSession();
  });

  const finished = $derived(session.endedAt !== null);
</script>

{#if album}
  <section class="album stack" aria-label="Listening to {album.name}">
    <header class="album__head">
      <Artwork src={album.artworkUrl} thumb={album.artworkThumbUrl} name={album.name} size="md" />
      <div class="album__id stack">
        <div>
          <p class="label">{finished ? 'You listened to' : 'Listening to'}</p>
          <h2 class="album__title">
            <a href={entityHref(album.id)}>{album.name}</a>
          </h2>
          <p class="note">
            {progress.rated} of {progress.total} tracks rated{progress.listened > 0
              ? ` · ${progress.listened} heard this sitting`
              : ''}
          </p>
        </div>
        <div class="row">
          <span class="label">Your rating of the record</span>
          <QuickRate
            entity={album}
            value={albumRating?.normalized ?? null}
            where="album-listening"
          />
        </div>
        <div class="row album__actions">
          <button
            type="button"
            class="btn btn--small btn--quiet"
            aria-expanded={albumOpen}
            onclick={() => (albumOpen = !albumOpen)}
          >
            {albumOpen ? 'Close' : 'Note, confidence and context'}
          </button>
          <button type="button" class="btn btn--small btn--quiet" onclick={clearAlbumSession}>
            {finished ? 'Done' : 'Stop rating this record'}
          </button>
        </div>
      </div>
    </header>

    {#if albumOpen}
      <div class="panel panel--sunk">
        <RatePanel
          entity={album}
          inline
          shortcuts={false}
          where="album-listening"
          onafter={() => (albumOpen = false)}
        />
      </div>
    {/if}

    {#if albumScore?.blended !== null && albumScore !== undefined && albumScale}
      <p class="note album__computed">
        Computed from what you have rated: <span class="figure"
          >{formatComputedOn(albumScale, albumScore.blended ?? 0)}</span
        >. Your own rating of the record is never changed by this.
        <a href={entityHref(album.id)}>Why this score?</a>
      </p>
    {/if}

    {#if finished}
      <p class="album__summary note" role="status">
        Playback left this record.
        {#if progress.unratedListened.length > 0}
          {progress.unratedListened.length} track{progress.unratedListened.length === 1 ? '' : 's'} you
          heard {progress.unratedListened.length === 1 ? 'is' : 'are'} still unrated — they are listed
          below.
        {:else}
          Everything you heard has a rating.
        {/if}
      </p>
    {/if}

    <div class="row row--between">
      <h3 class="head">Tracks</h3>
      <label class="check">
        <input type="checkbox" bind:checked={onlyUnrated} />
        <span>Unrated only</span>
      </label>
    </div>

    {#if shown.length === 0}
      <p class="note">
        {onlyUnrated
          ? 'Every track on this record has a rating.'
          : 'No tracks are stored for this record yet.'}
      </p>
    {:else}
      <ol class="album__tracks">
        {#each shown as row (row.entity.id)}
          <li class="album__track" class:album__track--now={row.state === 'current'}>
            <span class="album__no mono" aria-hidden="true">{row.position}</span>
            <span class="album__state label">
              {#if row.state === 'current'}
                playing
              {:else if row.listened}
                heard
              {:else if row.state === 'played'}
                passed
              {:else}
                &nbsp;
              {/if}
            </span>
            <div class="album__row">
              <RatableRow
                entity={row.entity}
                where="album-listening"
                expanded={openId === row.entity.id}
                ontoggle={() => (openId = openId === row.entity.id ? null : row.entity.id)}
              />
            </div>
          </li>
        {/each}
      </ol>
    {/if}
  </section>
{/if}

<style>
  .album__head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--s4);
    align-items: start;
  }

  .album__title {
    font-size: 1.125rem;
    margin: var(--s1) 0 var(--s1);
  }

  .album__actions {
    gap: var(--s3);
  }

  .album__computed {
    border-left: var(--rule-weight) solid var(--border-faint);
    padding-left: var(--s3);
  }

  .album__summary {
    color: var(--ink);
  }

  .album__tracks {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .album__track {
    display: grid;
    grid-template-columns: 1.75rem 4rem minmax(0, 1fr);
    align-items: center;
    gap: var(--s2);
  }
  /* The playing row is marked with the accent rail, not a fill: the list has to
     stay scannable while it moves. */
  .album__track--now {
    border-left: 2px solid var(--accent);
    margin-left: -2px;
  }

  .album__no {
    font-size: 0.75rem;
    color: var(--ink-faint);
    text-align: right;
  }
  .album__state {
    font-size: 0.6875rem;
    color: var(--ink-faint);
  }
  .album__row {
    min-width: 0;
  }

  @media (max-width: 40rem) {
    .album__track {
      grid-template-columns: 1.5rem minmax(0, 1fr);
    }
    .album__state {
      display: none;
    }
  }
</style>
