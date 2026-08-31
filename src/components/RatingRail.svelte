<script lang="ts">
  import {
    denormalize,
    detentValues,
    detentIndex,
    formatMark,
    formatRaw,
    isDenseScale,
    isStarScale,
    markIcon,
    normalizedForDetent,
  } from '../lib/domain/scales';
  import type { RatingScale } from '../lib/domain/types';
  import Icon from '../lib/ui/Icon.svelte';
  import { ICON_PATHS, type IconName } from '../lib/ui/icons';
  import { TIER_EDGE, TIER_INK, tierPalette } from '../lib/ui/tiers';
  import PrecisionRail from './PrecisionRail.svelte';
  import StarRating from './StarRating.svelte';

  /**
   * The rail.
   *
   * One physical object with detents cut by the current scale. A rating is
   * seated into a detent and stays lit where it was left. This is the app's
   * signature gesture, and it is the right one wherever the scale has no
   * stronger convention of its own.
   *
   * Two scales do. Stars are the shape everyone already reads, so star scales
   * get `StarRating` rather than five detents with numbers printed in them.
   * And past a certain density the detents stop being things you can hit or
   * read, so the rail changes state rather than shrinking: `PrecisionRail`
   * keeps the spine, the ink and the accent cut, trades a hundred seats for a
   * sliding one, and — because a hundred positions cannot be hit once and be
   * right — composes the value into a draft you save.
   *
   * Which one you get is decided by the scale itself, never by its name: every
   * caller passes a scale and gets the control that scale deserves.
   */

  interface Props {
    scale: RatingScale;
    /** Canonical 0..100, or null when nothing has been seated yet. */
    value: number | null;
    /** Fires while a detent is merely under the pointer. */
    onpreview?: (normalized: number) => void;
    /** Fires when a detent is seated. */
    oncommit?: (normalized: number) => void;
    label?: string;
    orientation?: 'vertical' | 'horizontal';
    disabled?: boolean;
    /** Prints the scale's own marks in the index column beside the detents. */
    showMarks?: boolean;
  }

  let {
    scale,
    value,
    onpreview,
    oncommit,
    label = 'Rating',
    orientation = 'vertical',
    disabled = false,
    showMarks = true,
  }: Props = $props();

  let hovered = $state<number | null>(null);

  const stars = $derived(isStarScale(scale));
  const dense = $derived(isDenseScale(scale));
  const detents = $derived(detentValues(scale));
  const tiers = $derived(tierPalette(scale));
  const seated = $derived(value == null ? null : detentIndex(scale, value));
  const active = $derived(hovered ?? seated);
  const currentRaw = $derived(value == null ? null : denormalize(scale, value));

  function markFor(index: number): string {
    const raw = detents[index];
    if (raw === undefined) return '';
    const mark = formatMark(scale, raw);
    return mark || formatRaw(scale, raw);
  }

  /** Scales that draw their marks — thumbs — hand back a glyph instead of a word. */
  function iconFor(index: number): IconName | null {
    const raw = detents[index];
    if (raw === undefined) return null;
    const name = markIcon(scale, raw);
    return name && name in ICON_PATHS ? (name as IconName) : null;
  }

  function labelFor(index: number): string {
    const raw = detents[index];
    if (raw === undefined) return '';
    return `${formatRaw(scale, raw)} on ${scale.label}`;
  }

  function pick(index: number, commit: boolean): void {
    const normalized = normalizedForDetent(scale, index);
    if (commit) {
      hovered = null;
      oncommit?.(normalized);
    } else {
      hovered = index;
      onpreview?.(normalized);
    }
  }

  /**
   * The whole rail is one tab stop. Arrows walk the detents, digits pick a known
   * value outright, Home and End reach the ends.
   */
  function onKeyDown(event: KeyboardEvent): void {
    if (disabled) return;
    const count = detents.length;
    const current = seated ?? Math.floor((count - 1) / 2);
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        next = Math.min(count - 1, current + 1);
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        next = Math.max(0, current - 1);
        break;
      case 'PageUp':
        next = Math.min(count - 1, current + Math.max(1, Math.round(count / 5)));
        break;
      case 'PageDown':
        next = Math.max(0, current - Math.max(1, Math.round(count / 5)));
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = count - 1;
        break;
      default:
        if (/^[0-9]$/.test(event.key)) {
          const typed = Number(event.key);
          const raw = typed === 0 && scale.max >= 10 ? 10 : typed;
          const clamped = Math.max(scale.min, Math.min(scale.max, raw));
          const index = detents.findIndex((d: number) => Math.abs(d - clamped) < scale.step / 2);
          if (index >= 0) next = index;
        }
    }
    if (next === null) return;
    event.preventDefault();
    pick(next, true);
  }

  const seatedPercent = $derived.by(() => {
    if (active == null || detents.length === 0) return null;
    // The ink fills whole cells, so the level lands on the cut, not beside it.
    return ((active + 1) / detents.length) * 100;
  });
</script>

{#if stars}
  <StarRating {scale} {value} {onpreview} {oncommit} {label} {disabled} />
{:else if dense}
  <PrecisionRail {scale} {value} {onpreview} {oncommit} {label} {disabled} />
{:else}
  <div
    class="rail rail--{orientation}"
    class:rail--marks={showMarks}
    class:rail--tiers={tiers !== null}
    style:--tier-ink={TIER_INK}
    style:--tier-edge={TIER_EDGE}
    role="slider"
    tabindex={disabled ? -1 : 0}
    aria-label={label}
    aria-valuemin={scale.min}
    aria-valuemax={scale.max}
    aria-valuenow={currentRaw ?? undefined}
    aria-valuetext={value == null
      ? 'Not yet rated'
      : `${formatRaw(scale, denormalize(scale, value))} on ${scale.label}`}
    aria-orientation={orientation}
    aria-disabled={disabled}
    onkeydown={onKeyDown}
    onmouseleave={() => (hovered = null)}
  >
    <div class="rail__body">
      <div class="rail__spine" aria-hidden="true"></div>
      {#if seatedPercent !== null}
        <div class="rail__ink" aria-hidden="true" style:--seated="{seatedPercent}%"></div>
      {/if}

      {#if orientation === 'horizontal'}
        {#if active !== null}
          <span
            class="rail__reading"
            aria-hidden="true"
            style:--at="{((active + 0.5) / detents.length) * 100}%"
          >
            {#if iconFor(active)}
              <Icon name={iconFor(active)!} size={18} />
            {:else}
              {markFor(active)}
            {/if}
          </span>
        {:else}
          <span class="rail__hint label" aria-hidden="true">Your rating</span>
        {/if}
      {/if}

      {#each detents as _detent, index (index)}
        <button
          type="button"
          class="rail__detent"
          class:is-seated={seated === index}
          class:is-active={active === index}
          class:is-below={active !== null && index < active}
          style:--tier={tiers?.[index]}
          tabindex="-1"
          aria-pressed={seated === index}
          aria-label={labelFor(index)}
          {disabled}
          onclick={() => pick(index, true)}
          onmouseenter={() => (hovered = index)}
        >
          <span class="rail__cut" aria-hidden="true"></span>
          {#if showMarks}
            <span class="rail__mark">
              {#if iconFor(index)}
                <Icon name={iconFor(index)!} size={15} />
              {:else}
                {markFor(index)}
              {/if}
            </span>
          {/if}
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .rail {
    display: block;
  }
  .rail:focus-visible {
    outline: var(--rule-weight) solid var(--accent);
    outline-offset: 5px;
  }

  .rail__body {
    position: relative;
    display: flex;
    /* The rail is one bar. It never wraps: on a narrow screen the detents
       narrow with it, because a rail broken into two rows is not a rail. */
    flex-wrap: nowrap;
    border: var(--rule-weight) solid var(--border-faint);
  }
  .rail--vertical .rail__body {
    flex-direction: column-reverse;
    width: 100%;
    background: var(--surface-sunk);
  }
  /* Standing up, the rail keeps a hand's width. On a phone it takes the column,
     because a narrow strip beside dead space is not a rail either. */
  @media (min-width: 48rem) {
    .rail--vertical .rail__body {
      max-width: 13rem;
    }
  }
  .rail--horizontal .rail__body {
    flex-direction: row;
    width: 100%;
    min-height: 3.5rem;
    background: var(--surface-sunk);
  }

  /* The spine: one ruled line the whole length of the object. */
  .rail__spine {
    position: absolute;
    background: var(--border);
    pointer-events: none;
  }
  .rail--vertical .rail__spine {
    top: 0;
    bottom: 0;
    left: 2.25rem;
    width: var(--rule-weight);
  }
  .rail--horizontal .rail__spine {
    left: 0;
    right: 0;
    bottom: 1.35rem;
    height: var(--rule-weight);
  }

  /* Everything up to the seated detent is inked, so the rail reads as filled to
     a level rather than a dot floating on a line. */
  .rail__ink {
    position: absolute;
    background: var(--accent);
    pointer-events: none;
    transition:
      width var(--dur-2) var(--ease),
      height var(--dur-2) var(--ease);
  }
  .rail--vertical .rail__ink {
    left: calc(2.25rem - 1px);
    width: 3px;
    bottom: 0;
    height: var(--seated);
  }
  .rail--horizontal .rail__ink {
    bottom: calc(1.35rem - 1px);
    height: 3px;
    left: 0;
    width: var(--seated);
  }

  .rail__detent {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--s2);
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    font-family: var(--sans);
    font-size: 0.75rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
    color: var(--ink-quiet);
    transition:
      background-color var(--dur-1) var(--ease),
      color var(--dur-1) var(--ease);
  }
  .rail__detent:disabled {
    cursor: default;
  }
  .rail--vertical .rail__detent {
    justify-content: flex-start;
    min-height: 2.25rem;
    padding: 0 var(--s3);
  }
  /* Laid down, the rail is a bar with cuts across its spine — not a row of
     cells. Nothing divides one detent from the next except its own cut. */
  .rail--horizontal .rail__detent {
    flex: 1 1 0;
    position: relative;
    display: block;
    min-height: 3.5rem;
    padding: 0;
    border-left: 0;
  }

  /* The detent itself: a cut across the spine. */
  .rail__cut {
    display: block;
    background: var(--border);
    transition:
      background-color var(--dur-1) var(--ease),
      width var(--dur-1) var(--ease),
      height var(--dur-1) var(--ease);
  }
  /* Standing up, each detent is a graduation ruled clear across the object. */
  .rail--vertical .rail__cut {
    position: absolute;
    left: 1.75rem;
    right: var(--s3);
    height: var(--rule-weight);
  }
  .rail--horizontal .rail__cut {
    position: absolute;
    left: 50%;
    bottom: calc(1.35rem - 0.42rem);
    transform: translateX(-50%);
    width: var(--rule-weight);
    height: 0.85rem;
  }

  .rail__detent.is-below .rail__cut,
  .rail__detent.is-active .rail__cut {
    background: var(--accent);
  }
  .rail--vertical .rail__detent.is-active .rail__cut {
    left: 1.25rem;
    height: 3px;
  }
  .rail--horizontal .rail__detent.is-active .rail__cut {
    width: 3px;
    height: 1.7rem;
    bottom: calc(1.35rem - 0.85rem);
  }

  /* The index column: the scale's own marks, hanging beside the cuts. */
  .rail__mark {
    min-width: 1.25rem;
    text-align: center;
    transition: color var(--dur-1) var(--ease);
  }
  /* A drawn mark still sits in the text flow, so the column's alignment holds. */
  .rail__mark :global(.icon),
  .rail__reading :global(.icon) {
    display: inline-block;
    vertical-align: -0.15em;
  }
  .rail--vertical .rail__mark {
    order: -1;
    text-align: right;
    margin-right: 2.25rem;
  }
  .rail--horizontal .rail__mark {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0.3rem;
    min-width: 0;
  }

  /* Ink fills the rail up to the seated detent, so a rating reads as a level
     the object is filled to rather than a dot resting on a line. */
  .rail__detent.is-below,
  .rail__detent.is-active {
    background: color-mix(in srgb, var(--accent) 11%, transparent);
  }

  /* The read-out rides above the detent under the hand, so the rail answers
     before the rating is committed. It is held clear of both ends: a reading
     centred on the last detent would otherwise hang off the rail. */
  .rail__reading {
    position: absolute;
    left: clamp(1.75rem, var(--at), calc(100% - 1.75rem));
    top: 0.3rem;
    transform: translateX(-50%);
    font-family: var(--display);
    font-size: 1.375rem;
    line-height: 1;
    color: var(--accent-ink);
    pointer-events: none;
    white-space: nowrap;
    transition: left var(--dur-2) var(--ease);
  }
  .rail__hint {
    position: absolute;
    left: var(--s3);
    top: 0.6rem;
    color: var(--ink-faint);
    pointer-events: none;
  }

  .rail__detent:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    color: var(--ink);
  }
  .rail__detent.is-seated {
    color: var(--accent-ink);
  }
  .rail__detent.is-seated .rail__mark {
    font-weight: 700;
  }

  /* A tier list is drawn in the colours a tier list has. The letter is the
     answer and the colour confirms it, so the swatch carries its own dark ink
     in both themes rather than inheriting the page's. */
  .rail--tiers .rail__mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.75rem;
    min-height: 1.5rem;
    padding: 0 var(--s1);
    background: var(--tier);
    color: var(--tier-ink);
    border: var(--rule-weight) solid var(--tier-edge);
    border-radius: var(--radius-sm);
    font-weight: 700;
  }
  .rail--tiers.rail--vertical .rail__mark {
    margin-right: 1.5rem;
  }
  .rail--tiers.rail--horizontal .rail__mark {
    left: 50%;
    right: auto;
    transform: translateX(-50%);
    width: 1.75rem;
  }
  /* Colour is never the only signal: the seated tier is boxed as well as
     coloured, so it survives greyscale, colour blindness and forced colours. */
  .rail--tiers .rail__detent.is-seated .rail__mark {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  @media (forced-colors: active) {
    .rail--tiers .rail__mark {
      forced-color-adjust: none;
      color: var(--tier-ink);
      border-color: CanvasText;
    }
    .rail--tiers .rail__detent.is-seated .rail__mark {
      outline-color: Highlight;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .rail__ink,
    .rail__cut,
    .rail__mark,
    .rail__reading,
    .rail__detent {
      transition: none;
    }
  }
</style>
