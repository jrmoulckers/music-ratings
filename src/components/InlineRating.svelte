<script lang="ts">
  import type { Snippet } from 'svelte';

  import { rate } from '../lib/app/actions';
  import { scaleForType } from '../lib/app/state';
  import { ratingWords, NOT_RATED } from '../lib/domain/phrases';
  import type { Entity, RatingContext, RatingScale } from '../lib/domain/types';
  import { wideEnoughForRail } from '../lib/ui/media';
  import Icon from '../lib/ui/Icon.svelte';
  import { denormalize, formatNormalizedOn } from '../lib/domain/scales';
  import CompactRating from './rating/CompactRating.svelte';
  import RatingRail from './rating/RatingRail.svelte';

  /**
   * Rating something, wherever it is.
   *
   * This is the only rating control the app mounts. Everything that can be
   * rated — a queue slip, a library row, a search result, the thing playing,
   * a track inside a record, one question inside a context draft — puts this
   * here, and it draws whichever control the configured scale deserves: stars
   * for stars, the tier colours for a tier list, thumbs for thumbs, pressable
   * detents for a short scale, a typed number with a save for a dense one.
   *
   * Two things are deliberately not variable. **What a rating means** is the
   * same everywhere, so every commit goes through the one action and no surface
   * can invent its own idea of saving. **How the control behaves** is the same
   * everywhere, so a variant may change how large it is and how much of its
   * labelling is visible, and may never change what pressing it does.
   *
   * The scale control is always present. Nobody should have to press *Rate* to
   * be shown the thing they came to use; *Rate* opens the deeper fields — the
   * note, the confidence, the context questions — and those live in `RatePanel`.
   */

  interface Props {
    entity: Entity;
    /**
     * The value on show, canonical 0..100, or null for unrated.
     *
     * Passed in rather than read here because the caller often already knows
     * it, and because History opens a control on an older entry's value.
     */
    value: number | null;
    /**
     * Size and labelling, never behaviour.
     *
     * `row` sits in a list. `compact` is the same control with no surrounding
     * label, for somewhere already tight. `player` is the persistent bar, which
     * folds into a popover when the bar is too narrow to hold a scale. And
     * `prominent` is the full rail, for a page whose subject is this one item.
     */
    variant?: 'compact' | 'row' | 'player' | 'prominent';
    /**
     * Who owns the save.
     *
     * `commit` writes a rating event — the ordinary case. `held` writes
     * nothing and hands the value to `onvalue`, which is how one question
     * inside a context draft is answered without becoming a rating of its own.
     */
    mode?: 'commit' | 'held';
    /** Required by `held`. Never fired in `commit` mode. */
    onvalue?: ((normalized: number) => void) | undefined;
    /**
     * Replaces the write, for a caller that has more to record than a number —
     * the full editor saves a note, a confidence and the context answers as one
     * event. The guard against a double submit, the error handling and the
     * announcement stay here, so every surface still behaves the same way.
     */
    onrate?: ((normalized: number) => Promise<void>) | undefined;
    /** Recorded on the event so the timeline can say where you were. */
    where?: RatingContext;
    /** Overrides the entity type's configured scale. Context facets pass one. */
    scale?: RatingScale | undefined;
    disabled?: boolean;
    /** The caller is busy with something of its own. */
    busy?: boolean;
    onafter?: (() => void) | undefined;
    /**
     * Offered as *Rate* / *Edit details* beside the control, where the surface
     * has somewhere deeper to go. Absent means this surface has no deeper form,
     * not that rating is unavailable.
     */
    ondetails?: (() => void) | undefined;
    detailsOpen?: boolean;
    /** Overrides the disclosure wording, e.g. "Note, confidence and context". */
    detailsLabel?: string | undefined;
    /**
     * Hands back the disclosure button, so a list that closes an editor with
     * Escape can put the caret back where it came from.
     */
    detailsRef?: ((element: HTMLButtonElement | null) => void) | undefined;
    /** Names the control for a screen reader. Defaults to the entity's name. */
    label?: string | undefined;
    /**
     * Rendered between the control and the disclosure — a score mark, usually,
     * which belongs beside the rating it is not.
     */
    aside?: Snippet | undefined;
  }

  let {
    entity,
    value,
    variant = 'row',
    mode = 'commit',
    onvalue,
    onrate,
    where = 'bulk',
    scale: scaleProp,
    disabled = false,
    busy = false,
    onafter,
    ondetails,
    detailsOpen = false,
    detailsLabel,
    detailsRef,
    label: labelProp,
    aside,
  }: Props = $props();

  const uid = $props.id();
  const scale = $derived(scaleProp ?? $scaleForType(entity.type));
  const label = $derived(labelProp ?? `Rating for ${entity.name}`);
  // Named for a screen reader as the scale it actually is, because "7" means
  // nothing without knowing what it is 7 of. Parenthetical rather than "on the
  // … scale", which is only grammatical for some of the scale names.
  const spoken = $derived(`${label} (${scale.label})`);

  let saving = $state(false);
  let failure = $state<string | null>(null);
  let announcement = $state('');
  const locked = $derived(disabled || busy || saving);

  /**
   * The one write path. A second press while the first is in the air is
   * dropped rather than queued: two events for one gesture would be two
   * opinions in the record where the person expressed one.
   */
  async function commit(normalized: number) {
    if (mode === 'held') {
      onvalue?.(normalized);
      return;
    }
    if (locked) return;
    saving = true;
    failure = null;
    try {
      if (onrate) await onrate(normalized);
      else await rate(entity, normalized, { context: where });
      announcement = `Saved ${ratingWords(scale, denormalize(scale, normalized)).spoken} for ${entity.name}.`;
      open = false;
      onafter?.();
    } catch (error) {
      failure = error instanceof Error ? error.message : 'That rating could not be saved.';
      announcement = `${entity.name} was not saved. ${failure}`;
    } finally {
      saving = false;
    }
  }

  /* ------------------------------------------------------------------------ */
  /* The player's narrow state                                                */
  /* ------------------------------------------------------------------------ */

  /**
   * A scale does not fit beside a transport on a phone. Rather than give the
   * player a rating button of its own invention — which is how two controls
   * that must agree start to disagree — the same control moves into a popover
   * and the bar keeps only the current value as its trigger.
   */
  const folds = $derived(variant === 'player' && !$wideEnoughForRail);
  let open = $state(false);
  let trigger = $state<HTMLButtonElement | null>(null);
  let popover = $state<HTMLDivElement | null>(null);

  const reading = $derived(value === null ? 'Not rated' : formatNormalizedOn(scale, value));
  // The chip shows a fragment; a screen reader hears the whole phrase.
  const said = $derived(value === null ? NOT_RATED : ratingWords(scale, denormalize(scale, value)));

  function close(focus = true) {
    if (!open) return;
    open = false;
    if (focus) trigger?.focus();
  }

  function onWindowPointer(event: PointerEvent) {
    if (!open) return;
    const target = event.target as Node | null;
    if (target && (popover?.contains(target) || trigger?.contains(target))) return;
    close(false);
  }

  function onWindowKey(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      close();
    }
  }
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={onWindowKey} />

<div class="inline inline--{variant}" class:is-folded={folds} data-rating-control={variant}>
  {#if folds}
    <button
      type="button"
      class="inline__trigger"
      class:is-rated={value !== null}
      bind:this={trigger}
      disabled={locked}
      aria-expanded={open}
      aria-haspopup="dialog"
      onclick={() => (open = !open)}
    >
      <Icon name="star" size={13} />
      <span class="inline__reading figure" aria-hidden="true">{reading}</span>
      <span class="sr-only">{spoken}: {said.spoken}</span>
    </button>

    {#if open}
      <div
        class="inline__pop panel"
        role="dialog"
        aria-label={spoken}
        bind:this={popover}
        tabindex="-1"
      >
        <p class="inline__popname label">{entity.name}</p>
        <CompactRating
          {scale}
          {value}
          label={spoken}
          subject={label}
          mode={mode === 'held' ? 'held' : 'save'}
          disabled={locked}
          oncommit={(normalized) => void commit(normalized)}
        />
      </div>
    {/if}
  {:else if variant === 'prominent'}
    <RatingRail
      {scale}
      {value}
      label={spoken}
      orientation={$wideEnoughForRail ? 'horizontal' : 'vertical'}
      mode={mode === 'held' ? 'compose' : 'commit'}
      disabled={locked}
      oncommit={(normalized) => void commit(normalized)}
    />
  {:else}
    <CompactRating
      {scale}
      {value}
      label={spoken}
      subject={label}
      mode={mode === 'held' ? 'held' : 'save'}
      disabled={locked}
      oncommit={(normalized) => void commit(normalized)}
    />
  {/if}

  {#if aside}{@render aside()}{/if}

  {#if ondetails}
    <button
      type="button"
      class="btn btn--small inline__more"
      id="{uid}-more"
      aria-expanded={detailsOpen}
      disabled={disabled || busy}
      onclick={ondetails}
      {@attach (element: HTMLButtonElement) => {
        detailsRef?.(element);
        return () => detailsRef?.(null);
      }}
    >
      <Icon name="chevron" size={12} class={detailsOpen ? 'inline__turn' : ''} />
      <span>
        {detailsLabel ?? (detailsOpen ? 'Close' : value === null ? 'Add details' : 'Edit details')}
      </span>
      <span class="sr-only">{entity.name}</span>
    </button>
  {/if}
</div>

{#if failure}
  <p class="inline__failed note note--warn">{failure}</p>
{/if}
<span class="sr-only" role="status" aria-live="polite">{announcement}</span>

<style>
  .inline {
    display: flex;
    align-items: center;
    gap: var(--s2);
    min-width: 0;
  }

  /*
   * The disclosure is the reason a row is here at all, so it keeps an outline
   * while neighbouring dismissals sit behind a hairline, and it takes the accent
   * once it is holding an editor open.
   */
  .inline__more {
    border-color: var(--border);
    color: var(--ink);
  }
  .inline__more[aria-expanded='true'] {
    border-color: var(--accent);
    color: var(--accent);
  }

  /* The full rail wants the width of its container, not the width of a row. */
  .inline--prominent {
    display: block;
  }
  .inline--prominent .inline__more {
    margin-top: var(--s3);
  }

  .inline--compact {
    gap: var(--s1);
  }

  /* Folded: the trigger prints the value, because a rating you cannot see is
     one you will set twice. */
  .inline.is-folded {
    position: relative;
  }
  .inline__trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--s1);
    min-height: 2.25rem;
    padding: 0 var(--s3);
    border: var(--rule-weight) solid var(--border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--ink-quiet);
    font: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
  }
  .inline__trigger:hover:not(:disabled) {
    border-color: var(--ink);
    color: var(--ink);
  }
  .inline__trigger.is-rated {
    color: var(--ink);
    border-color: var(--ink-faint);
  }
  .inline__trigger:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .inline__reading {
    font-variant-numeric: tabular-nums;
  }

  .inline__pop {
    position: absolute;
    right: 0;
    bottom: calc(100% + var(--s2));
    z-index: 40;
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    padding: var(--s3);
    min-width: max-content;
  }
  .inline__popname {
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .inline__failed {
    margin-top: var(--s1);
  }

  /* The disclosure's chevron turns to point at what it opened. */
  .inline__more :global(.inline__turn) {
    transform: rotate(90deg);
  }
</style>
