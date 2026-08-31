<script lang="ts">
  import { catalogue, completions, graph, playIndex, settings } from '../lib/app/state';
  import { albumTrackSet } from '../lib/domain/completion';
  import { href } from '../lib/app/router';
  import { albumListening, artistListening } from '../lib/domain/listening-stats';
  import type { Entity } from '../lib/domain/types';
  import { CONFIRMED_BY, breadth, observedSince } from '../lib/listening/phrasing';
  import { dateAndTime, plural, relative } from '../lib/ui/format';
  import Icon from '../lib/ui/Icon.svelte';
  import AlbumComplete from './AlbumComplete.svelte';
  import TrackRail from './TrackRail.svelte';

  /**
   * What this app observed of one release or artist.
   *
   * Reads the totals the play index already carries — one lookup per track, no
   * pass over the log — so opening an entity page costs the same whether the
   * history holds a hundred plays or a hundred thousand.
   *
   * On a release it also states whether the track list is even complete enough
   * to judge. An album whose contents were never fully fetched cannot be
   * "complete", and saying so is better than a number that quietly means
   * something narrower than it looks.
   */

  interface Props {
    entity: Entity;
  }

  let { entity }: Props = $props();

  const isRelease = $derived(entity.type === 'album' || entity.type === 'playlist');
  const isArtist = $derived(entity.type === 'artist');

  const album = $derived(
    isRelease ? albumListening($playIndex, $catalogue, entity.id, $completions) : null,
  );
  const artist = $derived(
    isArtist ? artistListening($playIndex, $catalogue, entity.id, $completions) : null,
  );
  const trackSet = $derived(isRelease ? albumTrackSet($graph, entity.id) : null);

  const mine = $derived(
    $completions
      .filter((c) => !c.deleted && c.albumId === entity.id)
      .sort((a, b) => b.endAt - a.endAt),
  );

  const observed = $derived($settings.listeningObservedFrom);
  const anything = $derived((album?.plays ?? artist?.plays ?? 0) > 0);
</script>

{#if $settings.listeningEnabled && (isRelease || isArtist)}
  <section class="listened" aria-labelledby="listened-head">
    <div class="head">
      <h2 id="listened-head" class="title">What you have heard</h2>
      <a class="label" href={href('/listening')}>All listening</a>
    </div>

    {#if !anything}
      <p class="note listened__none">
        No confirmed play of this yet. A play is recorded once Spotify lists it in your recently
        played, so anything heard before this app started watching is not counted.
      </p>
    {:else if album}
      <TrackRail
        heard={album.breadth.heard}
        total={album.breadth.known}
        label="{album.breadth.heard} of {album.breadth.known} tracks heard"
      />

      <dl class="facts">
        <div>
          <dt class="note note--small">Tracks heard</dt>
          <dd class="mono">{breadth(album.breadth.heard, album.breadth.known, 'known tracks')}</dd>
        </div>
        <div>
          <dt class="note note--small">Observed plays</dt>
          <dd class="mono">{album.plays.toLocaleString()}</dd>
        </div>
        {#if album.lastAt}
          <div>
            <dt class="note note--small">Last heard</dt>
            <dd class="mono">{relative(album.lastAt)}</dd>
          </div>
        {/if}
        <div>
          <dt class="note note--small">Completed</dt>
          <dd class="mono">
            {album.completions === 0 ? 'not yet' : plural(album.completions, 'time')}
          </dd>
        </div>
      </dl>

      {#if trackSet?.confidence === 'incomplete'}
        <p class="note note--small listened__warn">
          <Icon name="flag" size={12} />
          Track list incomplete — {trackSet.knownTotal} of {trackSet.declaredTotal ?? '?'} tracks are
          known here, so this record cannot be judged complete. Load its contents to fix that.
        </p>
      {/if}
      {#if trackSet && trackSet.excluded.unavailable > 0}
        <p class="note note--small">
          {plural(trackSet.excluded.unavailable, 'track')} unavailable in your market, so not required
          for completion.
        </p>
      {/if}
    {:else if artist}
      <dl class="facts">
        <div>
          <dt class="note note--small">Observed plays</dt>
          <dd class="mono">{artist.plays.toLocaleString()}</dd>
        </div>
        <div>
          <dt class="note note--small">Tracks heard</dt>
          <dd class="mono">
            {breadth(artist.trackBreadth.heard, artist.trackBreadth.known, 'known tracks')}
          </dd>
        </div>
        <div>
          <dt class="note note--small">Releases touched</dt>
          <dd class="mono">
            {breadth(artist.releaseBreadth.heard, artist.releaseBreadth.known, 'known releases')}
          </dd>
        </div>
        {#if artist.lastAt}
          <div>
            <dt class="note note--small">Last heard</dt>
            <dd class="mono">{relative(artist.lastAt)}</dd>
          </div>
        {/if}
        <div>
          <dt class="note note--small">Albums completed</dt>
          <dd class="mono">{artist.completions}</dd>
        </div>
      </dl>
      <p class="note note--small">
        Counted against what this app knows of the artist locally, not their full discography.
      </p>
    {/if}

    {#if mine.length > 0}
      <div class="listened__done">
        <h3 class="label">
          {mine.length === 1 ? 'Heard end to end' : `Heard end to end ${mine.length} times`}
        </h3>
        {#each mine.slice(0, 3) as completion (completion.id)}
          <AlbumComplete {completion} quiet />
        {/each}
        {#if mine.length > 3}
          <p class="note note--small">
            Earliest of {mine.length} was {dateAndTime(mine[mine.length - 1]?.endAt ?? 0)}.
          </p>
        {/if}
      </div>
    {/if}

    <p class="note note--small listened__source">
      <Icon name="lens" size={12} />
      {CONFIRMED_BY}. {observedSince(observed)}
    </p>
  </section>
{/if}

<style>
  .listened {
    display: grid;
    gap: var(--s3);
  }
  .listened__none {
    max-width: var(--measure);
    margin: 0;
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s3) var(--s5);
    margin: 0;
  }
  .facts div {
    display: grid;
    gap: 2px;
  }
  .facts dt,
  .facts dd {
    margin: 0;
  }
  .facts dd {
    font-size: 1rem;
    color: var(--ink);
  }

  .listened__warn {
    display: flex;
    align-items: flex-start;
    gap: var(--s1);
    max-width: var(--measure);
    margin: 0;
    color: var(--ink);
  }

  .listened__done {
    display: grid;
    gap: var(--s2);
    padding-top: var(--s2);
    border-top: var(--rule-weight) solid var(--border-faint);
  }

  .listened__source {
    display: flex;
    align-items: center;
    gap: var(--s1);
    margin: 0;
  }
</style>
