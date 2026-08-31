<script lang="ts">
  import { rate } from '../lib/app/actions';
  import { scaleForType } from '../lib/app/state';
  import {
    denormalize,
    detentValues,
    formatMark,
    isDenseScale,
    isStarScale,
    markIcon,
    normalize,
    snapRaw,
  } from '../lib/domain/scales';
  import type { Entity } from '../lib/domain/types';
  import { canSaveDraft, settleTyped, steppedFrom } from '../lib/ui/draft';
  import Icon from '../lib/ui/Icon.svelte';
  import type { IconName } from '../lib/ui/icons';
  import { TIER_EDGE, TIER_INK, tierPalette } from '../lib/ui/tiers';
  import StarRating from './StarRating.svelte';

  /**
   * Rating, in one line.
   *
   * Every list in the app can be rated from where you are standing, which means
   * this has to fit in a row without becoming the row. Coarse scales get their
   * detents as marks you press; star scales get stars, because a star row is
   * already the most compact rating control there is. Dense ones can have
   * neither — a hundred marks is not a control — so they get the number itself,
   * typed or stepped, and then saved.
   *
   * Whatever it does, it commits the same rating through the same action as the
   * full editor, so the two can never disagree about what you meant.
   */

  interface Props {
    entity: Entity;
    /** Current value, canonical 0..100. Null when never rated. */
    value: number | null;
    onafter?: (() => void) | undefined;
    disabled?: boolean;
  }

  let { entity, value, onafter, disabled = false }: Props = $props();

  const scale = $derived($scaleForType(entity.type));
  const stars = $derived(isStarScale(scale));
  const dense = $derived(isDenseScale(scale) && !stars);
  const detents = $derived(dense || stars ? [] : detentValues(scale));
  const tiers = $derived(tierPalette(scale));
  const current = $derived(value === null ? null : denormalize(scale, value));

  const decimals = $derived(scale.step < 1 ? (String(scale.step).split('.')[1]?.length ?? 1) : 0);
  // Kept as text so a half-typed "7." is not rewritten under the caret.
  let typed = $state<string | null>(null);
  /**
   * A dense value in a list row is composed the same way as in the full rail:
   * stepped or typed into a draft, then saved. The steppers stay shut until
   * there is something to step from, because half of a scale nobody chose is
   * not a rating.
   */
  let draftRaw = $state<number | null>(null);
  let busy = $state(false);

  const heldRaw = $derived(draftRaw ?? current);
  const dirty = $derived(canSaveDraft(draftRaw, current));
  const shown = $derived(typed ?? (heldRaw === null ? '' : heldRaw.toFixed(decimals)));

  // A rating arriving from anywhere ends the draft: it has become the record.
  $effect(() => {
    void value;
    draftRaw = null;
    typed = null;
  });

  async function commitNormalized(normalized: number) {
    if (busy || disabled) return;
    busy = true;
    try {
      await rate(entity, normalized, { context: 'bulk' });
      onafter?.();
    } finally {
      busy = false;
      // Whatever was being composed has become the record.
      draftRaw = null;
      typed = null;
    }
  }

  function commit(raw: number) {
    void commitNormalized(normalize(scale, snapRaw(scale, raw)));
  }

  function step(by: 1 | -1) {
    const next = steppedFrom(scale, heldRaw, by);
    if (next !== null) draftRaw = next;
  }

  /** Settles typed text into the draft. Never saves on its own. */
  function settle() {
    const settled = settleTyped(scale, typed);
    typed = null;
    if (settled.kind === 'value' || settled.kind === 'clamped') draftRaw = settled.value;
  }

  function save() {
    if (draftRaw === null || !dirty) return;
    commit(draftRaw);
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      settle();
      save();
    } else if (event.key === 'Escape') {
      if (typed === null && draftRaw === null) return;
      event.preventDefault();
      event.stopPropagation();
      typed = null;
      draftRaw = null;
    }
  }
</script>

<div class="quick" class:quick--dense={dense} class:quick--stars={stars}>
  {#if stars}
    <StarRating
      {scale}
      {value}
      compact
      label="Rating for {entity.name}"
      disabled={disabled || busy}
      oncommit={(normalized) => void commitNormalized(normalized)}
    />
  {:else if dense}
    <button
      type="button"
      class="quick__step"
      disabled={disabled || busy || heldRaw === null || heldRaw <= scale.min}
      onclick={() => step(-1)}
      aria-label="Lower the rating for {entity.name}"
    >
      <Icon name="minus" size={13} />
    </button>

    <label class="quick__entry">
      <span class="sr-only">Rating for {entity.name} on the {scale.label} scale</span>
      <input
        class="quick__field figure"
        class:is-draft={dirty}
        type="number"
        inputmode="decimal"
        min={scale.min}
        max={scale.max}
        step={scale.step}
        value={shown}
        placeholder="—"
        disabled={disabled || busy}
        oninput={(event) => (typed = event.currentTarget.value)}
        onblur={settle}
        onkeydown={onKey}
      />
    </label>

    <button
      type="button"
      class="quick__step"
      disabled={disabled || busy || heldRaw === null || heldRaw >= scale.max}
      onclick={() => step(1)}
      aria-label="Raise the rating for {entity.name}"
    >
      <Icon name="plus" size={13} />
    </button>

    {#if dirty}
      <button
        type="button"
        class="quick__save"
        disabled={busy}
        onclick={save}
        aria-label="Save {shown} as the rating for {entity.name}"
      >
        <Icon name="check" size={13} />
      </button>
    {/if}
  {:else}
    <div
      class="quick__marks"
      class:quick__marks--tiers={tiers !== null}
      style:--tier-ink={TIER_INK}
      style:--tier-edge={TIER_EDGE}
      role="group"
      aria-label="Rating for {entity.name}"
    >
      {#each detents as raw, index (raw)}
        {@const icon = markIcon(scale, raw)}
        <button
          type="button"
          class="quick__mark"
          class:is-set={current !== null && raw === current}
          style:--tier={tiers?.[index]}
          disabled={disabled || busy}
          aria-pressed={current !== null && raw === current}
          onclick={() => commit(raw)}
        >
          {#if icon}
            <Icon name={icon as IconName} size={15} label={formatMark(scale, raw)} />
          {:else}
            <span aria-hidden="true">{formatMark(scale, raw)}</span>
            <span class="sr-only">Rate {entity.name} {formatMark(scale, raw)}</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .quick {
    display: flex;
    align-items: center;
    gap: var(--s1);
    min-width: 0;
  }

  /* Coarse scales: the detents themselves, set on one rule so a row of them
     reads as a single object rather than a strip of buttons. */
  .quick__marks {
    display: flex;
    align-items: stretch;
    border: var(--rule-weight) solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .quick__mark {
    min-width: 2rem;
    min-height: 1.9rem;
    padding: 0 var(--s2);
    display: flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-left: var(--rule-weight) solid var(--border-faint);
    background: transparent;
    color: var(--ink-quiet);
    font: inherit;
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    transition:
      background var(--dur-1) var(--ease),
      color var(--dur-1) var(--ease);
  }
  .quick__mark:first-child {
    border-left: 0;
  }
  .quick__mark:hover:not(:disabled) {
    background: var(--surface-raised);
    color: var(--ink);
  }
  .quick__mark.is-set {
    background: var(--accent);
    color: var(--on-accent);
  }
  .quick__mark:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* Tiers carry their own colours. The letter still does the work — the swatch
     confirms it — so the set tier is also boxed, and the ink on the swatch is
     dark in both themes because every tier colour is a pale one. */
  .quick__marks--tiers .quick__mark {
    background: var(--tier);
    color: var(--tier-ink);
    border-left-color: var(--tier-edge);
    font-weight: 700;
  }
  .quick__marks--tiers .quick__mark:hover:not(:disabled) {
    background: var(--tier);
    color: var(--tier-ink);
    filter: brightness(1.06);
  }
  .quick__marks--tiers .quick__mark.is-set {
    background: var(--tier);
    color: var(--tier-ink);
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  @media (forced-colors: active) {
    .quick__marks--tiers .quick__mark {
      forced-color-adjust: none;
      border-left-color: CanvasText;
    }
    .quick__marks--tiers .quick__mark.is-set {
      box-shadow: inset 0 0 0 2px Highlight;
    }
  }

  /* Dense scales: the number, because there is no honest way to draw a hundred
     positions in a table row. */
  .quick__step {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    height: 1.9rem;
    border: var(--rule-weight) solid var(--border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--ink-quiet);
    cursor: pointer;
  }
  .quick__step:hover:not(:disabled) {
    border-color: var(--ink);
    color: var(--ink);
  }
  .quick__step:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .quick__entry {
    display: block;
  }
  .quick__field {
    width: 3.25rem;
    height: 1.9rem;
    padding: 0 var(--s2);
    text-align: center;
    border: var(--rule-weight) solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-sunk);
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    -moz-appearance: textfield;
    appearance: textfield;
  }
  .quick__field::-webkit-outer-spin-button,
  .quick__field::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .quick__field:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  /* An unsaved number is plainly unsaved: it borrows the accent edge, and the
     tick beside it is the only thing that writes it down. */
  .quick__field.is-draft {
    border-color: var(--accent);
    color: var(--accent-ink);
  }

  .quick__save {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    height: 1.9rem;
    flex: none;
    border: var(--rule-weight) solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--on-accent);
    cursor: pointer;
  }
  .quick__save:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* Touch: the marks have to survive a thumb, so they grow rather than wrap. */
  @media (max-width: 52rem) {
    .quick__mark {
      min-width: 2.25rem;
      min-height: 2.25rem;
    }
    .quick__step,
    .quick__field,
    .quick__save {
      height: 2.25rem;
    }
    .quick__step,
    .quick__save {
      width: 2.25rem;
    }
  }
</style>
