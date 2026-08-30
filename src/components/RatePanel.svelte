<script lang="ts">
  import { rate, markUnfamiliar, skip, snooze } from '../lib/app/actions';
  import { annotationsById, explicitRatings, scaleForType, scores } from '../lib/app/state';
  import { CONFIDENCE_LABEL } from '../lib/domain/ratings';
  import { formatComputedOn } from '../lib/domain/scales';
  import type { Entity, RatingConfidence, Suggestion } from '../lib/domain/types';
  import { suggestionSourceLabel } from '../lib/domain/suggestions';
  import { swipe } from '../lib/ui/actions';
  import { wideEnoughForRail } from '../lib/ui/media';
  import Icon from '../lib/ui/Icon.svelte';
  import { relative } from '../lib/ui/format';
  import Artwork from './Artwork.svelte';
  import RatingRail from './RatingRail.svelte';

  /**
   * The rating panel.
   *
   * One item, its evidence, and the rail. The reasons it is in front of you are
   * printed before the controls, because a queue that will not say why it chose
   * something is asking to be trusted blindly.
   */

  interface Props {
    entity: Entity;
    suggestion?: Suggestion | undefined;
    onafter?: () => void;
  }

  let { entity, suggestion, onafter }: Props = $props();

  const scale = $derived($scaleForType(entity.type));
  const existing = $derived($explicitRatings.get(entity.id));
  const breakdown = $derived($scores.get(entity.id));
  const annotation = $derived($annotationsById.get(entity.id));

  let note = $state('');
  let confidence = $state<RatingConfidence>('medium');
  let preview = $state<number | null>(null);
  let dragOffset = $state(0);
  let busy = $state(false);

  // A new item arrives with a clean slip; nothing carries over from the last.
  $effect(() => {
    void entity.id;
    note = '';
    confidence = 'medium';
    preview = null;
  });

  const shown = $derived(preview ?? existing?.normalized ?? null);

  async function commit(normalized: number) {
    if (busy) return;
    busy = true;
    try {
      await rate(entity, normalized, {
        note,
        confidence,
        context: 'queue',
        ...(annotation?.tags?.length ? { tags: annotation.tags } : {}),
      });
      onafter?.();
    } finally {
      busy = false;
      preview = null;
    }
  }

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

  function onKey(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (event.key === 's' || event.key === 'S') {
      event.preventDefault();
      void run(() => skip(entity));
    } else if (event.key === 'z' || event.key === 'Z') {
      event.preventDefault();
      void run(() => snooze(entity));
    } else if (event.key === '?') {
      event.preventDefault();
      void run(() => markUnfamiliar(entity));
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<article
  class="panel"
  class:is-dragging={dragOffset !== 0}
  style:--drag="{dragOffset}px"
  use:swipe={{
    onMove: (dx) => (dragOffset = Math.max(-140, Math.min(140, dx))),
    onLeft: () => void run(() => skip(entity)),
    onRight: () => void run(() => snooze(entity)),
    onEnd: () => (dragOffset = 0),
  }}
>
  <header class="panel__head">
    <Artwork
      src={entity.artworkUrl}
      thumb={entity.artworkThumbUrl}
      name={entity.name}
      size="md"
      priority
    />
    <div class="panel__id">
      <h2 class="panel__name title">{entity.name}</h2>
      {#if entity.subtitle}<p class="note">{entity.subtitle}</p>{/if}
      <p class="label">{entity.type}</p>
    </div>
  </header>

  {#if suggestion}
    <ul class="panel__reasons">
      {#each suggestion.reasons.slice(0, 3) as reason (reason.source)}
        <li>
          <span class="label label--accent">{suggestionSourceLabel(reason.source)}</span>
          <span class="note">{reason.detail}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if existing}
    <p class="panel__prior note">
      You last rated this {relative(existing.at)}. Seating a new value keeps the old one in the
      record.
    </p>
  {:else if breakdown?.rollup !== null && breakdown?.rollup !== undefined}
    <p class="panel__prior note">
      Never rated directly. Its contents currently compute to {formatComputedOn(
        scale,
        breakdown.rollup,
      )} on the {scale.label} scale.
    </p>
  {/if}

  <div class="panel__rail">
    <RatingRail
      {scale}
      value={shown}
      label="Rating for {entity.name}"
      orientation={$wideEnoughForRail ? 'horizontal' : 'vertical'}
      onpreview={(value) => (preview = value)}
      oncommit={(value) => void commit(value)}
      disabled={busy}
    />
  </div>

  <div class="panel__aside">
    <label class="field">
      <span class="label">Note (optional)</span>
      <textarea
        class="textarea"
        bind:value={note}
        rows="2"
        placeholder="Optional. Saved with this rating."
      ></textarea>
    </label>

    <fieldset class="panel__confidence">
      <legend class="label">How sure are you?</legend>
      <div class="row row--tight">
        {#each ['low', 'medium', 'high'] as const as level (level)}
          <button
            type="button"
            class="btn btn--small"
            aria-pressed={confidence === level}
            class:is-on={confidence === level}
            onclick={() => (confidence = level)}
          >
            {CONFIDENCE_LABEL[level]}
          </button>
        {/each}
      </div>
    </fieldset>
  </div>

  <footer class="panel__actions">
    <button type="button" class="btn btn--small" onclick={() => void run(() => skip(entity))}>
      <Icon name="arrow-right" size={13} /> Skip <kbd>S</kbd>
    </button>
    <button type="button" class="btn btn--small" onclick={() => void run(() => snooze(entity))}>
      <Icon name="clock" size={13} /> Snooze <kbd>Z</kbd>
    </button>
    <button
      type="button"
      class="btn btn--small"
      onclick={() => void run(() => markUnfamiliar(entity))}
    >
      Don't know it <kbd>?</kbd>
    </button>
  </footer>
</article>

<style>
  .panel {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 16rem;
    grid-template-areas:
      'head head'
      'reasons reasons'
      'prior prior'
      'rail rail'
      'aside aside'
      'actions actions';
    gap: var(--s4) var(--s6);
    align-items: start;
    padding: var(--s5);
    border: var(--rule-weight) solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-raised);
    transform: translateX(var(--drag, 0));
    touch-action: pan-y;
  }
  .panel.is-dragging {
    transition: none;
  }

  .panel__head {
    grid-area: head;
    display: flex;
    align-items: center;
    gap: var(--s4);
    padding-bottom: var(--s4);
    border-bottom: var(--rule-weight) solid var(--border);
  }
  .panel__id {
    min-width: 0;
  }
  .panel__name {
    font-size: clamp(1.375rem, 1.1rem + 1.1vw, 1.875rem);
  }

  .panel__reasons {
    grid-area: reasons;
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }
  /* Narrow: the label sits directly on its line, tight, not a wrapped column. */
  .panel__reasons li {
    display: grid;
    gap: 0;
  }
  @media (min-width: 48rem) {
    .panel__reasons {
      gap: var(--s1);
    }
    .panel__reasons li {
      grid-template-columns: 11rem minmax(0, 1fr);
      gap: var(--s3);
      align-items: baseline;
    }
  }

  .panel__prior {
    grid-area: prior;
    max-width: 52ch;
  }

  .panel__rail {
    grid-area: rail;
  }

  .panel__aside {
    grid-area: aside;
    display: flex;
    gap: var(--s6);
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .panel__aside > :global(.field) {
    flex: 1 1 18rem;
    min-width: 0;
  }

  .panel__confidence {
    border: 0;
    padding: 0;
    margin: 0;
  }
  .panel__confidence legend {
    padding: 0 0 var(--s2);
  }
  .btn.is-on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }

  .panel__actions {
    grid-area: actions;
    display: flex;
    gap: var(--s2);
    flex-wrap: wrap;
    padding-top: var(--s4);
    border-top: var(--rule-weight) solid var(--border-faint);
  }

  kbd {
    font-family: var(--mono);
    font-size: 0.625rem;
    border: var(--rule-weight) solid var(--border);
    padding: 0 3px;
    color: var(--ink-faint);
  }

  @media (max-width: 58rem) {
    .panel {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas:
        'head'
        'reasons'
        'prior'
        'rail'
        'aside'
        'actions';
      padding: var(--s4);
    }
  }
</style>
