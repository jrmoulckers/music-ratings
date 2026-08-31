<script lang="ts">
  import { skip, snooze } from '../lib/app/actions';
  import {
    entityLabelCap,
    explicitRatings,
    scaleForType,
    scores,
    settings,
  } from '../lib/app/state';
  import { entityHref } from '../lib/app/router';
  import { playedReason } from '../lib/domain/reasons';
  import { suggestionSourceLabel } from '../lib/domain/suggestions';
  import type { Entity, RatingContext, ScoreView, Suggestion } from '../lib/domain/types';
  import { duration, releaseYear } from '../lib/ui/format';
  import Icon from '../lib/ui/Icon.svelte';
  import Artwork from './Artwork.svelte';
  import EntityTypeIcon from './EntityTypeIcon.svelte';
  import QuickRate from './QuickRate.svelte';
  import RatePanel from './RatePanel.svelte';
  import ScoreMark from './ScoreMark.svelte';

  /**
   * One ratable thing, in a list.
   *
   * The same row everywhere: queue, library, rankings, contents, search. Rating
   * something should not depend on which page you happened to find it on, so
   * the compact control and the expandable editor are this component's job and
   * no page reimplements either.
   *
   * Collapsed it is a line you can judge at a glance. Opened it hands over the
   * full rail in place, so working down a list never costs you your position.
   */

  interface Props {
    entity: Entity;
    /** Present when this row came out of the rating queue. */
    suggestion?: Suggestion | undefined;
    /** Rank position, when the list is a ranked one. */
    position?: number | undefined;
    tied?: boolean;
    /** Which score the list is ranked by, when the page has its own view. */
    view?: ScoreView | undefined;
    /** Skip and snooze, which only mean something where there is a queue. */
    queueActions?: boolean;
    expanded?: boolean;
    ontoggle?: (() => void) | undefined;
    onafter?: (() => void) | undefined;
    /** Recorded on every rating made from this row. */
    where?: RatingContext | undefined;
  }

  let {
    entity,
    suggestion,
    position,
    tied = false,
    view,
    queueActions = false,
    expanded = false,
    ontoggle,
    onafter,
    where,
  }: Props = $props();

  const scale = $derived($scaleForType(entity.type));
  const existing = $derived($explicitRatings.get(entity.id));
  const breakdown = $derived($scores.get(entity.id));
  const shownView = $derived(view ?? $settings.scoreView);
  const shownScore = $derived(
    breakdown === undefined
      ? null
      : shownView === 'explicit'
        ? breakdown.explicit
        : shownView === 'rollup'
          ? breakdown.rollup
          : breakdown.blended,
  );
  // A queue is unrated by definition, so a mark on every row would be a column
  // of em dashes saying nothing — and where the mark would print the very
  // number the compact control is already showing, it is the same fact twice.
  const hasScore = $derived(shownScore !== null && shownScore !== existing?.normalized);

  const sub = $derived(
    [
      entity.subtitle,
      releaseYear(entity.releaseDate),
      duration(entity.durationMs),
      entity.available === false ? 'unavailable in your market' : '',
    ]
      .filter(Boolean)
      .join(' · '),
  );

  // Where a play is what put this here, the clock is the whole reason and the
  // engine's other evidence only decided ties.
  const played = $derived(suggestion?.lastPlayedAt);
  const reason = $derived(suggestion?.reasons[0]);
  const why = $derived.by(() => {
    if (played !== undefined) return { label: 'Played', text: playedReason(Date.now() - played) };
    if (!reason) return null;
    return { label: suggestionSourceLabel(reason.source), text: reason.detail };
  });
  // The chip and the sentence are the same fact wearing two coats when the
  // sentence opens on the chip's own word. Drop the chip; the sentence says it.
  const chip = $derived(why && !why.text.startsWith(why.label) ? why.label : null);

  let busy = $state(false);
  let disclosure = $state<HTMLButtonElement | null>(null);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    try {
      await action();
      onafter?.();
    } finally {
      busy = false;
    }
  }

  // Escape closes the editor and hands focus back to the control that opened
  // it, so working down a long list by keyboard never strands the caret.
  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !expanded) return;
    const target = event.target as HTMLElement | null;
    // A field with its own Escape meaning — a combobox, say — answers first.
    if (target?.getAttribute('aria-expanded') === 'true' && target !== disclosure) return;
    event.stopPropagation();
    ontoggle?.();
    disclosure?.focus();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<li class="slip" class:is-open={expanded} {onkeydown}>
  <span class="slip__cut" aria-hidden="true"></span>

  <div class="slip__line">
    {#if position !== undefined}
      <span class="slip__position figure" aria-label={tied ? `Tied at ${position}` : undefined}>
        {tied ? '=' : ''}{position}
      </span>
    {:else}
      <Artwork
        src={entity.artworkUrl}
        thumb={entity.artworkThumbUrl}
        name={entity.name}
        size="sm"
      />
    {/if}

    <div class="slip__id">
      <h3 class="slip__name">
        <a class="slip__link" href={entityHref(entity.id)}>{entity.name}</a>
      </h3>
      <p class="note slip__sub">
        <EntityTypeIcon type={entity.type} size={14} />
        <span class="slip__kind">{entityLabelCap(entity.type)}</span>
        {#if sub}<span class="slip__meta">· {sub}</span>{/if}
      </p>
      {#if why}
        <p class="slip__why">
          {#if chip}<span class="label label--accent">{chip}</span>{/if}
          {#if played !== undefined}
            <time class="note" datetime={new Date(played).toISOString()}>{why.text}</time>
          {:else}
            <span class="note">{why.text}</span>
          {/if}
        </p>
      {/if}
    </div>

    <div class="slip__acts">
      <QuickRate
        {entity}
        value={existing?.normalized ?? null}
        disabled={busy}
        {where}
        onafter={() => onafter?.()}
      />

      {#if hasScore && breakdown}
        <ScoreMark {breakdown} {scale} view={shownView} showKind={false} />
      {/if}

      {#if ontoggle}
        <button
          type="button"
          bind:this={disclosure}
          class="btn btn--small slip__open"
          aria-expanded={expanded}
          onclick={ontoggle}
        >
          <Icon name="chevron" size={12} class={expanded ? 'slip__turn' : ''} />
          <span>{expanded ? 'Close' : existing ? 'Edit rating' : 'Rate'}</span>
          <span class="sr-only">{entity.name}</span>
        </button>
      {/if}

      {#if queueActions}
        <span class="slip__aside">
          <button
            type="button"
            class="btn btn--small btn--quiet"
            disabled={busy}
            onclick={() => void run(() => skip(entity))}
          >
            <Icon name="arrow-right" size={13} />
            <span>Skip</span>
            {#if expanded}<kbd>S</kbd>{/if}
            <span class="sr-only">{entity.name}</span>
          </button>
          <button
            type="button"
            class="btn btn--small btn--quiet"
            disabled={busy}
            onclick={() => void run(() => snooze(entity))}
          >
            <Icon name="clock" size={13} />
            <span>Snooze</span>
            {#if expanded}<kbd>Z</kbd>{/if}
            <span class="sr-only">{entity.name}</span>
          </button>
        </span>
      {/if}
    </div>
  </div>

  {#if expanded}
    <div class="slip__editor">
      <RatePanel {entity} {suggestion} {onafter} inline shortcuts={queueActions} {where} />
    </div>
  {/if}
</li>

<style>
  /* Every row hangs off its list's rail by a cut. The open one cuts deeper. */
  .slip {
    position: relative;
    padding: var(--s3) 0;
    border-bottom: var(--rule-weight) solid var(--border-faint);
  }
  .slip.is-open {
    padding-bottom: var(--s5);
    border-bottom-color: var(--border);
  }

  .slip__cut {
    position: absolute;
    left: calc(var(--rail-inset, 0px) * -1);
    top: 1.85rem;
    width: var(--rail-inset, 0px);
    height: var(--rule-weight);
    background: var(--accent);
    transform: scaleX(0.6);
    transform-origin: left center;
    transition: transform var(--dur-1) var(--ease);
  }
  .slip:hover .slip__cut {
    transform: scaleX(1);
  }
  .slip.is-open .slip__cut {
    height: 3px;
    transform: scaleX(1);
  }

  .slip__line {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: var(--s4);
    align-items: center;
  }

  .slip__position {
    min-width: 2.5rem;
    font-size: 1.125rem;
    color: var(--ink-quiet);
    text-align: right;
  }

  .slip__id {
    min-width: 0;
  }
  .slip__name {
    font-size: 1.0625rem;
    font-weight: 600;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .slip__link {
    color: inherit;
    text-decoration: none;
  }
  .slip__link:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .slip__sub {
    display: flex;
    align-items: center;
    gap: var(--s2);
    min-width: 0;
  }
  .slip__kind {
    flex: none;
  }
  .slip__meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .slip__why {
    display: flex;
    align-items: baseline;
    gap: var(--s2);
    margin-top: 1px;
    min-width: 0;
  }
  .slip__why .note {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .slip__acts {
    display: flex;
    gap: var(--s2);
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  /*
   * The row exists so you can judge the thing. Opening the full editor is the
   * point of it; skipping and snoozing are ways of declining. Three identical
   * quiet buttons would put "get rid of this" on equal footing with the reason
   * the list is here at all, so the disclosure keeps its outline and the two
   * dismissals sit back behind a hairline.
   */
  .slip__open {
    border-color: var(--border);
    color: var(--ink);
  }
  .slip__open[aria-expanded='true'] {
    border-color: var(--accent);
    color: var(--accent);
  }

  .slip__aside {
    display: flex;
    gap: var(--s2);
    align-items: center;
    padding-left: var(--s3);
    margin-left: var(--s1);
    border-left: var(--rule-weight) solid var(--border-faint);
  }
  /* Once the actions wrap onto their own line the rule is no longer between
     two things, it is a tick hanging off the left margin. */
  @media (max-width: 40rem) {
    .slip__aside {
      padding-left: 0;
      margin-left: 0;
      border-left: 0;
    }
  }
  .slip__acts :global(.slip__turn) {
    transform: rotate(90deg);
  }

  .slip__editor {
    margin-top: var(--s4);
    padding-top: var(--s4);
    border-top: var(--rule-weight) solid var(--border-faint);
  }

  /* Narrow: the row stacks and the actions become a full-width band with
     targets big enough to hit while walking. */
  @media (max-width: 52rem) {
    .slip__line {
      grid-template-columns: auto minmax(0, 1fr);
      align-items: start;
    }
    .slip__acts {
      grid-column: 1 / -1;
      justify-content: flex-start;
      margin-top: var(--s2);
    }
    .slip__acts :global(.btn) {
      min-height: 2.5rem;
    }
    .slip__cut {
      top: 1.6rem;
    }
    .slip__position {
      min-width: 2rem;
    }
  }
</style>
