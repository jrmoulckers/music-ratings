<script lang="ts">
  import { entityHref } from '../lib/app/router';
  import { explicitRatings, graph, playIndex, scaleForType, scores } from '../lib/app/state';
  import { albumTrackSet } from '../lib/domain/completion';
  import type { AlbumCompletion } from '../lib/domain/listening';
  import { formatComputedOn } from '../lib/domain/scales';
  import {
    CONFIRMED_BY,
    completionSpanLine,
    heardAllLine,
    ordinalLine,
  } from '../lib/listening/phrasing';
  import { setCompletionPrompt, ratingsFor } from '../lib/storage/repo';
  import Icon from '../lib/ui/Icon.svelte';
  import Artwork from './Artwork.svelte';
  import InlineRating from './InlineRating.svelte';
  import RatePanel from './RatePanel.svelte';
  import TrackRail from './TrackRail.svelte';

  /**
   * A record heard all the way through.
   *
   * Deliberately not a queue suggestion and deliberately not a modal. The queue
   * offers things it guessed you might rate; this states something that
   * happened, with the evidence for it. So it is drawn as the completed rail
   * rather than as another row with a reason on it, and it waits rather than
   * interrupting — nothing here blocks playback, and nothing here steals an
   * editor that is already open on something else.
   *
   * It stays until it is answered. Rating it resolves it; **Later** puts it
   * back for a day; **Dismiss** closes it for good. Reloading, navigating and
   * syncing all leave it exactly where it was, because it is a stored record
   * and not a toast.
   */

  interface Props {
    completion: AlbumCompletion;
    /** Plays the ink sweep once, for a completion that has just arrived. */
    fresh?: boolean;
    /** Compact form for a list of past completions. */
    quiet?: boolean;
  }

  let { completion, fresh = false, quiet = false }: Props = $props();

  const SNOOZE_MS = 86_400_000;

  const album = $derived($graph.entity(completion.albumId));
  const tracks = $derived(album ? albumTrackSet($graph, completion.albumId) : null);
  const rating = $derived($explicitRatings.get(completion.albumId));
  const breakdown = $derived($scores.get(completion.albumId));
  const scale = $derived($scaleForType('album'));

  /** How much of the record has been rated, track by track. */
  const rated = $derived.by(() => {
    const ids = tracks?.trackIds ?? [];
    const done = ids.filter((id) => $explicitRatings.has(id)).length;
    return { done, total: ids.length };
  });

  const plays = $derived.by(() => {
    const ids = tracks?.trackIds ?? [];
    return ids.reduce((sum, id) => sum + $playIndex.playsOf(id), 0);
  });

  let open = $state(false);
  let busy = $state(false);

  /** What was done about this one, for the read-only history row. */
  const answered = $derived(
    completion.prompt === 'rated'
      ? 'rated'
      : completion.prompt === 'dismissed'
        ? 'dismissed'
        : completion.prompt === 'snoozed'
          ? 'put off'
          : 'not yet answered',
  );

  async function answer(prompt: 'dismissed' | 'snoozed'): Promise<void> {
    busy = true;
    try {
      await setCompletionPrompt(
        completion.id,
        prompt,
        prompt === 'snoozed' ? { snoozeUntil: Date.now() + SNOOZE_MS } : {},
      );
    } finally {
      busy = false;
    }
  }

  /**
   * Records which rating answered this completion, so the two stay linked in
   * history. Read back from the store rather than from the panel, because the
   * shared editor deliberately does not hand its saved event to its callers.
   */
  async function rated_(): Promise<void> {
    open = false;
    const saved = await ratingsFor(completion.albumId);
    const latest = saved.filter((r) => !r.retracted).sort((a, b) => b.at - a.at)[0];
    await setCompletionPrompt(completion.id, 'rated', latest ? { ratingId: latest.id } : {});
  }
</script>

{#if album}
  <article class="done" class:done--quiet={quiet} aria-labelledby="done-{completion.id}">
    <div class="done__head">
      <Artwork
        src={album.artworkUrl}
        thumb={album.artworkThumbUrl}
        name={album.name}
        size={quiet ? 'sm' : 'md'}
      />
      <div class="done__ident">
        <p class="label label--accent done__flag">
          <Icon name="check" size={12} />
          Album complete
          {#if quiet && answered}<span class="done__answered">· {answered}</span>{/if}
        </p>
        <h3 class="done__name" id="done-{completion.id}">
          <a href={entityHref(album.id)}>{album.name}</a>
        </h3>
        {#if album.subtitle}<p class="note done__by">{album.subtitle}</p>{/if}
      </div>
    </div>

    <TrackRail
      heard={completion.trackCount}
      total={completion.trackCount}
      {fresh}
      label="All {completion.trackCount} tracks heard"
    />

    <p class="done__span">
      <strong>{heardAllLine(completion)}.</strong>
      {completionSpanLine(completion)}
      {#if ordinalLine(completion)}
        <span class="note">{ordinalLine(completion)}</span>
      {/if}
    </p>

    <dl class="done__facts">
      <div>
        <dt class="note note--small">Tracks rated</dt>
        <dd class="mono">{rated.done} of {rated.total}</dd>
      </div>
      <div>
        <dt class="note note--small">Observed plays</dt>
        <dd class="mono">{plays}</dd>
      </div>
      <div>
        <dt class="note note--small">{rating ? 'Your rating' : 'Computed from tracks'}</dt>
        <dd class="mono">
          <!-- RATING SURFACE: read-only value text. Formatter only, no rating
               component. Swap for the canonical inline display if one lands. -->
          {#if rating}
            {formatComputedOn(scale, rating.normalized)}
          {:else if breakdown?.rollup != null}
            <span class="done__computed">{formatComputedOn(scale, breakdown.rollup)}</span>
          {:else}
            —
          {/if}
        </dd>
      </div>
    </dl>

    {#if !quiet}
      <p class="note note--small done__source">
        <Icon name="lens" size={12} />
        {CONFIRMED_BY}
      </p>
    {/if}

    {#if !quiet}
      <div class="done__actions">
        <InlineRating
          entity={album}
          value={rating?.normalized ?? null}
          variant="row"
          where="album-listening"
          onafter={rated_}
          ondetails={() => (open = !open)}
          detailsOpen={open}
          detailsLabel="Note, confidence and context"
        />
        <a class="btn btn--quiet" href="{entityHref(album.id)}?unrated=1">Review tracks</a>
        <button
          type="button"
          class="btn btn--quiet"
          disabled={busy}
          onclick={() => answer('snoozed')}
        >
          Later
        </button>
        <button
          type="button"
          class="btn btn--quiet"
          disabled={busy}
          onclick={() => answer('dismissed')}
        >
          Dismiss
        </button>
      </div>

      {#if open}
        <div class="done__panel">
          <RatePanel
            entity={album}
            inline
            shortcuts={false}
            where="album-listening"
            aboutSaving="Saves a rating for this record. It does not change what was observed."
            onafter={rated_}
          />
        </div>
      {/if}
    {/if}
  </article>
{/if}

<style>
  /* A ruled band, not a card: the same hairline structure the rest of the app
     uses, with the accent reserved for the rail and the one small flag. */
  .done {
    display: grid;
    gap: var(--s3);
    padding: var(--s4) 0;
    border-top: var(--rule-weight) solid var(--border);
    border-bottom: var(--rule-weight) solid var(--border);
  }
  .done--quiet {
    gap: var(--s2);
    padding: var(--s3) 0;
    border-bottom: 0;
  }

  .done__head {
    display: flex;
    align-items: flex-start;
    gap: var(--s3);
  }
  .done__ident {
    min-width: 0;
  }
  .done__flag {
    display: flex;
    align-items: center;
    gap: var(--s1);
    margin: 0 0 var(--s1);
  }
  .done__name {
    margin: 0;
    font-family: var(--serif);
    font-size: 1.25rem;
    font-weight: 500;
    line-height: 1.2;
    letter-spacing: -0.01em;
  }
  .done--quiet .done__name {
    font-size: 1rem;
  }
  .done__name a {
    color: inherit;
    text-decoration: none;
  }
  .done__name a:hover {
    text-decoration: underline;
  }
  .done__by {
    margin: var(--s1) 0 0;
  }
  .done__answered {
    color: var(--ink-faint);
  }

  .done__span {
    margin: 0;
    max-width: var(--measure);
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--ink);
  }
  .done__span .note {
    display: block;
  }

  .done__facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s2) var(--s5);
    margin: 0;
  }
  .done__facts div {
    display: grid;
    gap: 2px;
  }
  .done__facts dt {
    margin: 0;
  }
  .done__facts dd {
    margin: 0;
    font-size: 1rem;
    color: var(--ink);
  }
  .done__computed {
    color: var(--ink-quiet);
  }

  .done__source {
    display: flex;
    align-items: center;
    gap: var(--s1);
    margin: 0;
  }

  .done__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s2);
  }

  .done__panel {
    padding-top: var(--s2);
    border-top: var(--hairline) solid var(--border-faint);
  }
</style>
