<script lang="ts">
  import { rate } from '../lib/app/actions';
  import { scaleForType } from '../lib/app/state';
  import {
    denormalize,
    detentValues,
    formatMark,
    isDenseScale,
    markIcon,
    normalize,
    snapRaw,
  } from '../lib/domain/scales';
  import type { Entity } from '../lib/domain/types';
  import Icon from '../lib/ui/Icon.svelte';
  import type { IconName } from '../lib/ui/icons';

  /**
   * Rating, in one line.
   *
   * Every list in the app can be rated from where you are standing, which means
   * this has to fit in a row without becoming the row. Coarse scales get their
   * detents as marks you press. Dense ones cannot — a hundred marks is not a
   * control — so they get the number itself, typed or stepped.
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
  const dense = $derived(isDenseScale(scale));
  const detents = $derived(dense ? [] : detentValues(scale));
  const current = $derived(value === null ? null : denormalize(scale, value));

  const decimals = $derived(scale.step < 1 ? (String(scale.step).split('.')[1]?.length ?? 1) : 0);
  // Kept as text so a half-typed "7." is not rewritten under the caret.
  let typed = $state('');
  let editing = $state(false);
  let busy = $state(false);

  const shown = $derived(editing ? typed : current === null ? '' : current.toFixed(decimals));

  async function commit(raw: number) {
    if (busy || disabled) return;
    busy = true;
    try {
      await rate(entity, normalize(scale, snapRaw(scale, raw)), { context: 'bulk' });
      onafter?.();
    } finally {
      busy = false;
      editing = false;
    }
  }

  function step(by: number) {
    const from = current ?? (scale.min + scale.max) / 2;
    void commit(from + by * scale.step);
  }

  function commitTyped() {
    editing = false;
    const parsed = Number(typed);
    if (typed.trim() === '' || !Number.isFinite(parsed)) return;
    if (current !== null && snapRaw(scale, parsed) === current) return;
    void commit(parsed);
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      (event.currentTarget as HTMLInputElement).blur();
    } else if (event.key === 'Escape') {
      editing = false;
      typed = current === null ? '' : current.toFixed(decimals);
    }
  }
</script>

<div class="quick" class:quick--dense={dense}>
  {#if dense}
    <button
      type="button"
      class="quick__step"
      disabled={disabled || busy || (current !== null && current <= scale.min)}
      onclick={() => step(-1)}
      aria-label="Lower the rating for {entity.name}"
    >
      <Icon name="minus" size={13} />
    </button>

    <label class="quick__entry">
      <span class="sr-only">Rating for {entity.name} on the {scale.label} scale</span>
      <input
        class="quick__field figure"
        type="number"
        inputmode="decimal"
        min={scale.min}
        max={scale.max}
        step={scale.step}
        value={shown}
        placeholder="—"
        disabled={disabled || busy}
        oninput={(event) => {
          editing = true;
          typed = event.currentTarget.value;
        }}
        onblur={commitTyped}
        onkeydown={onKey}
      />
    </label>

    <button
      type="button"
      class="quick__step"
      disabled={disabled || busy || (current !== null && current >= scale.max)}
      onclick={() => step(1)}
      aria-label="Raise the rating for {entity.name}"
    >
      <Icon name="plus" size={13} />
    </button>
  {:else}
    <div class="quick__marks" role="group" aria-label="Rating for {entity.name}">
      {#each detents as raw (raw)}
        {@const icon = markIcon(scale, raw)}
        <button
          type="button"
          class="quick__mark"
          class:is-set={current !== null && raw === current}
          disabled={disabled || busy}
          aria-pressed={current !== null && raw === current}
          onclick={() => void commit(raw)}
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

  /* Touch: the marks have to survive a thumb, so they grow rather than wrap. */
  @media (max-width: 52rem) {
    .quick__mark {
      min-width: 2.25rem;
      min-height: 2.25rem;
    }
    .quick__step,
    .quick__field {
      height: 2.25rem;
    }
    .quick__step {
      width: 2.25rem;
    }
  }
</style>
