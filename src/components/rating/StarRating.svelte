<script lang="ts">
  import {
    clampRaw,
    denormalize,
    normalize,
    snapRaw,
    starCount,
    starFills,
    starRawFromRatio,
    starValueText,
  } from '../../lib/domain/scales';
  import type { RatingScale } from '../../lib/domain/types';
  import { ICON_PATHS } from '../../lib/ui/icons';

  /**
   * Stars.
   *
   * The rail is this product's own gesture, but stars are everybody's, and a
   * five-star rating drawn as five detents with the numbers 1 to 5 printed in
   * them is a rating control that has to be learned. So star scales get the
   * shape they have always had: five stars, filled up to where you are.
   *
   * One row, one tab stop, one reading. The pointer previews as it crosses,
   * a press commits, and a drag across the row fills continuously and commits
   * where it is let go — which is how a rating gets given in one motion on a
   * phone. Leaving without pressing puts back whatever was there before.
   *
   * Half steps fill half a star, cut down the middle, rather than doubling the
   * count: ten small stars is a different control wearing the same glyph.
   */

  interface Props {
    scale: RatingScale;
    /** Canonical 0..100, or null when nothing has been rated yet. */
    value: number | null;
    onpreview?: (normalized: number) => void;
    oncommit?: (normalized: number) => void;
    label?: string;
    disabled?: boolean;
    /** Row-sized: the same targets, a smaller glyph, no frame. */
    compact?: boolean;
  }

  let {
    scale,
    value,
    onpreview,
    oncommit,
    label = 'Rating',
    disabled = false,
    compact = false,
  }: Props = $props();

  let row = $state<HTMLDivElement | null>(null);
  /** What the pointer is currently proposing, before it is given. */
  let previewRaw = $state<number | null>(null);
  let scrubbing = $state(false);

  const count = $derived(starCount(scale));
  const seatedRaw = $derived(value == null ? null : denormalize(scale, value));
  const shownRaw = $derived(previewRaw ?? seatedRaw);
  const fills = $derived(starFills(scale, shownRaw));
  const valueText = $derived(starValueText(scale, shownRaw));
  const star = ICON_PATHS.star;

  function propose(raw: number): void {
    const snapped = snapRaw(scale, raw);
    if (snapped === previewRaw) return;
    previewRaw = snapped;
    onpreview?.(normalize(scale, snapped));
  }

  function give(raw: number | null): void {
    if (raw == null) return;
    const snapped = snapRaw(scale, raw);
    previewRaw = null;
    oncommit?.(normalize(scale, snapped));
  }

  function rawAt(clientX: number): number | null {
    const rect = row?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return starRawFromRatio(scale, (clientX - rect.left) / rect.width);
  }

  function onPointerDown(event: PointerEvent): void {
    if (disabled || event.button > 0) return;
    const raw = rawAt(event.clientX);
    if (raw == null) return;
    scrubbing = true;
    // Captured so the drag keeps reporting once the finger leaves the row.
    row?.setPointerCapture(event.pointerId);
    propose(raw);
  }

  function onPointerMove(event: PointerEvent): void {
    if (disabled) return;
    // A mouse merely passing over previews too; a finger only reports while down.
    if (!scrubbing && event.pointerType !== 'mouse') return;
    const raw = rawAt(event.clientX);
    if (raw != null) propose(raw);
  }

  function onPointerUp(event: PointerEvent): void {
    if (!scrubbing) return;
    scrubbing = false;
    if (row?.hasPointerCapture(event.pointerId)) row.releasePointerCapture(event.pointerId);
    give(rawAt(event.clientX) ?? previewRaw);
  }

  function onPointerLeave(): void {
    if (scrubbing) return;
    previewRaw = null;
  }

  function cancel(): void {
    scrubbing = false;
    previewRaw = null;
  }

  /**
   * Arrows move by the scale's own step and give the value straight away, the
   * way a slider does. Enter and space give whatever is currently shown, so a
   * value arrived at by hovering can be confirmed without the pointer.
   */
  function onKeyDown(event: KeyboardEvent): void {
    if (disabled) return;
    const from = shownRaw ?? scale.min - scale.step;
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = from + scale.step;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = shownRaw == null ? scale.max : from - scale.step;
        break;
      case 'Home':
        next = scale.min;
        break;
      case 'End':
        next = scale.max;
        break;
      case 'Enter':
      case ' ':
        if (shownRaw == null) return;
        event.preventDefault();
        give(shownRaw);
        return;
      case 'Escape':
        if (previewRaw == null) return;
        event.preventDefault();
        cancel();
        return;
      default:
        if (/^[1-9]$/.test(event.key) && Number(event.key) <= count) next = Number(event.key);
    }
    if (next === null) return;
    event.preventDefault();
    give(clampRaw(scale, next));
  }
</script>

<div
  class="stars"
  class:stars--compact={compact}
  class:is-disabled={disabled}
  bind:this={row}
  role="slider"
  tabindex={disabled ? -1 : 0}
  aria-label={label}
  aria-valuemin={scale.min}
  aria-valuemax={scale.max}
  aria-valuenow={shownRaw ?? undefined}
  aria-valuetext={valueText}
  aria-disabled={disabled}
  onkeydown={onKeyDown}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={cancel}
  onpointerleave={onPointerLeave}
  onblur={cancel}
>
  {#each fills as fill, index (index)}
    <span class="stars__cell" class:is-lit={fill > 0}>
      <svg class="stars__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path class="stars__empty" d={star} />
        {#if fill > 0}
          <path class="stars__fill" d={star} style:clip-path="inset(0 {(1 - fill) * 100}% 0 0)" />
        {/if}
      </svg>
    </span>
  {/each}
  <span class="sr-only" aria-hidden="true">{valueText}</span>
</div>

<style>
  /* Five stars on one line, always. A star row that wraps is a bar chart. */
  .stars {
    --cell: 2.75rem;
    --glyph: 1.5rem;
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    width: max-content;
    max-width: 100%;
    touch-action: none;
    cursor: pointer;
  }
  .stars--compact {
    --cell: 2.75rem;
    --glyph: 1.125rem;
  }
  .stars.is-disabled {
    cursor: default;
    opacity: 0.55;
  }
  .stars:focus-visible {
    outline: var(--rule-weight) solid var(--accent);
    outline-offset: 3px;
  }

  /* The target is the full cell in both directions; the glyph inside it is
     whatever size the surface can carry. */
  .stars__cell {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: var(--cell);
    min-height: var(--cell);
  }

  .stars__glyph {
    width: var(--glyph);
    height: var(--glyph);
    overflow: visible;
  }

  .stars__empty {
    fill: none;
    stroke: var(--border);
    stroke-width: 1.6;
    stroke-linejoin: round;
  }
  .is-lit .stars__empty {
    stroke: var(--star-edge);
  }
  .stars__fill {
    fill: var(--star);
    stroke: var(--star-edge);
    stroke-width: 1.6;
    stroke-linejoin: round;
    transition: fill var(--dur-1) var(--ease);
  }

  @media (prefers-reduced-motion: reduce) {
    .stars__fill {
      transition: none;
    }
  }

  /* Under forced colours the fill cannot be trusted to survive, so the lit
     stars are told apart by the system's own highlight instead. */
  @media (forced-colors: active) {
    .stars__fill {
      fill: Highlight;
      stroke: Highlight;
    }
    .stars__empty {
      stroke: CanvasText;
    }
    .stars:focus-visible {
      outline: 2px solid Highlight;
    }
  }
</style>
