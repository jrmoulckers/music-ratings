<script lang="ts">
  import { markUnfamiliar, skip, snooze } from '../lib/app/actions';
  import { entityLabelCap, explicitRatings, scaleForType } from '../lib/app/state';
  import { entityHref } from '../lib/app/router';
  import { formatNormalizedOn } from '../lib/domain/scales';
  import { suggestionSourceLabel } from '../lib/domain/suggestions';
  import type { Entity, Suggestion } from '../lib/domain/types';
  import { relative } from '../lib/ui/format';
  import Icon from '../lib/ui/Icon.svelte';
  import Artwork from './Artwork.svelte';
  import RatePanel from './RatePanel.svelte';

  /**
   * One stop on the queue.
   *
   * Collapsed it is a line you can judge at a glance and dismiss without
   * opening: what it is, why it is here, and when you last played it. Opened it
   * hands the whole rail over in place, so working down the queue never costs
   * you your position on the page.
   */

  interface Props {
    entity: Entity;
    suggestion: Suggestion;
    expanded: boolean;
    ontoggle: () => void;
    onafter: () => void;
  }

  let { entity, suggestion, expanded, ontoggle, onafter }: Props = $props();

  const scale = $derived($scaleForType(entity.type));
  const existing = $derived($explicitRatings.get(entity.id));
  const sub = $derived(
    [
      entityLabelCap(entity.type),
      entity.subtitle,
      existing ? `rated ${formatNormalizedOn(scale, existing.normalized)}` : '',
    ]
      .filter((part) => part !== undefined && part !== '')
      .join(' · '),
  );
  // Where a play is what put this here, the clock is the whole reason and the
  // engine's other evidence only decided ties. Saying it twice — once as a
  // sentence and once as a time — is the same fact wearing two coats.
  const played = $derived(suggestion.lastPlayedAt);
  const reason = $derived(suggestion.reasons[0]);
  const why = $derived(
    played !== undefined
      ? { label: 'Played', text: relative(played) }
      : reason
        ? { label: suggestionSourceLabel(reason.source), text: reason.detail }
        : null,
  );
  let busy = $state(false);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    try {
      await action();
      onafter();
    } finally {
      busy = false;
    }
  }
</script>

<li class="slip" class:is-open={expanded}>
  <span class="slip__cut" aria-hidden="true"></span>

  <div class="slip__line">
    <Artwork src={entity.artworkUrl} thumb={entity.artworkThumbUrl} name={entity.name} size="sm" />

    <div class="slip__id">
      <h3 class="slip__name">
        <a class="slip__link" href={entityHref(entity.id)}>{entity.name}</a>
      </h3>
      <p class="note slip__sub">{sub}</p>
      {#if why}
        <p class="slip__why">
          <span class="label label--accent">{why.label}</span>
          {#if played !== undefined}
            <time class="note" datetime={new Date(played).toISOString()}>{why.text}</time>
          {:else}
            <span class="note">{why.text}</span>
          {/if}
        </p>
      {/if}
    </div>

    <div class="slip__acts">
      <button
        type="button"
        class="btn btn--small btn--primary"
        aria-expanded={expanded}
        onclick={ontoggle}
      >
        {expanded ? 'Close' : existing ? 'Change rating' : 'Rate'}
      </button>
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
      <button
        type="button"
        class="btn btn--small btn--quiet"
        disabled={busy}
        onclick={() => void run(() => markUnfamiliar(entity))}
      >
        <span>Don't know it</span>
        {#if expanded}<kbd>?</kbd>{/if}
        <span class="sr-only">{entity.name}</span>
      </button>
    </div>
  </div>

  {#if expanded}
    <div class="slip__editor">
      <RatePanel {entity} {suggestion} {onafter} inline shortcuts />
    </div>
  {/if}
</li>

<style>
  /* Every stop hangs off the queue's rail by a cut, the way the rankings hang
     off theirs. The open one cuts deeper. */
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
    left: calc(var(--rail-inset) * -1);
    top: 1.85rem;
    width: var(--rail-inset);
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
  }
</style>
