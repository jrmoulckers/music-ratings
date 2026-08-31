<script lang="ts">
  import {
    denormalize,
    formatRaw,
    nextGraduation,
    normalize,
    railLabelBudget,
    railTicks,
    snapRaw,
    RAIL_DEFAULT_LABELS,
  } from '../lib/domain/scales';
  import type { RatingScale } from '../lib/domain/types';
  import Icon from '../lib/ui/Icon.svelte';

  /**
   * The rail, for scales too fine to seat one detent at a time.
   *
   * A hundred detents is not a hundred choices, it is an unreadable ruler. So
   * the object changes state rather than shrinking: the same spine, the same
   * ink, the same accent cut for the seated value — but the cut slides instead
   * of being one of a hundred, and only round graduations are printed.
   *
   * The reading does not ride the value. It sits in a fixed place above the
   * track, where it cannot run off either end, and it is the field you type
   * into. One number, one position, editable — rather than a figure that drifts
   * under your thumb and clips at 100.
   *
   * Always laid down. A precision instrument is read along its length, and a
   * standing hundred-position slider is no easier on a phone than off it.
   */

  interface Props {
    scale: RatingScale;
    /** Canonical 0..100, or null when nothing has been seated yet. */
    value: number | null;
    onpreview?: (normalized: number) => void;
    oncommit?: (normalized: number) => void;
    label?: string;
    disabled?: boolean;
  }

  let { scale, value, onpreview, oncommit, label = 'Rating', disabled = false }: Props = $props();

  let trackWidth = $state(0);
  /** What is in the number field while it is being typed, before it is legal. */
  let typing = $state<string | null>(null);

  const seatedRaw = $derived(value == null ? null : denormalize(scale, value));
  /** An unseated rail still needs somewhere to stand, so it stands in the middle. */
  const restingRaw = $derived(snapRaw(scale, (scale.min + scale.max) / 2));
  const shownRaw = $derived(seatedRaw ?? restingRaw);

  const ticks = $derived(
    railTicks(scale, trackWidth > 0 ? railLabelBudget(trackWidth, scale) : RAIL_DEFAULT_LABELS),
  );

  const span = $derived(scale.max - scale.min);
  const fill = $derived(span <= 0 ? 0 : ((shownRaw - scale.min) / span) * 100);

  /** Decimals the scale actually carries, so the number field steps in kind. */
  const decimals = $derived(scale.step < 1 ? (String(scale.step).split('.')[1]?.length ?? 1) : 0);
  const fieldText = $derived(typing ?? (seatedRaw == null ? '' : seatedRaw.toFixed(decimals)));

  function readingFor(raw: number): string {
    return `${formatRaw(scale, raw)} on ${scale.label}`;
  }

  function put(raw: number, commit: boolean): void {
    const snapped = snapRaw(scale, raw);
    const normalized = normalize(scale, snapped);
    if (commit) {
      typing = null;
      oncommit?.(normalized);
    } else {
      onpreview?.(normalized);
    }
  }

  function nudge(direction: 1 | -1): void {
    if (disabled) return;
    put(shownRaw + direction * scale.step, true);
  }

  /**
   * The number field accepts anything while you type — half-finished numbers
   * included — and is only made legal when you leave it or press Enter, so a
   * value cannot be snatched away mid-keystroke.
   *
   * A number input reports a half-typed "4." as the empty string, so `typing`
   * briefly goes empty mid-decimal. That is harmless: writing the empty string
   * back to an input already reporting empty leaves the text the reader can
   * see alone, and an empty field on settle means "left it alone", not "unrate".
   */
  function onFieldInput(event: Event): void {
    typing = (event.currentTarget as HTMLInputElement).value;
  }

  function settleField(): void {
    const text = typing;
    typing = null;
    if (text == null) return;
    if (text.trim() === '') return;
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return;
    put(parsed, true);
  }

  function onFieldKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      settleField();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      typing = null;
    }
  }

  /**
   * The slider carries native dragging, touch and keys. Page keys are taken
   * over so they jump to the next printed graduation rather than to some
   * fraction of the range the reader cannot see.
   */
  function onTrackKey(event: KeyboardEvent): void {
    if (disabled) return;
    if (event.key !== 'PageUp' && event.key !== 'PageDown') return;
    event.preventDefault();
    const target = nextGraduation(ticks, shownRaw, event.key === 'PageUp' ? 1 : -1);
    if (target != null) put(target, true);
  }
</script>

<div class="prec" class:is-disabled={disabled} role="group" aria-label={label}>
  <div class="prec__head">
    <div class="prec__setter">
      <button
        type="button"
        class="prec__step"
        {disabled}
        aria-label="Lower the rating"
        onclick={() => nudge(-1)}
      >
        <Icon name="minus" size={16} />
      </button>

      <input
        class="prec__field"
        type="number"
        inputmode="decimal"
        min={scale.min}
        max={scale.max}
        step={scale.step}
        value={fieldText}
        placeholder="—"
        {disabled}
        aria-label="Exact value"
        oninput={onFieldInput}
        onblur={settleField}
        onkeydown={onFieldKey}
      />

      <button
        type="button"
        class="prec__step"
        {disabled}
        aria-label="Raise the rating"
        onclick={() => nudge(1)}
      >
        <Icon name="plus" size={16} />
      </button>
    </div>

    <span class="prec__of note note--small">
      {seatedRaw == null ? 'Not yet rated' : `on ${scale.label}`}
    </span>
  </div>

  <div class="prec__track" bind:clientWidth={trackWidth}>
    <div class="prec__graduations" aria-hidden="true">
      <div class="prec__spine"></div>
      {#if seatedRaw !== null}
        <div class="prec__ink" style:--fill="{fill}%"></div>
      {/if}
      {#each ticks as tick (tick.value)}
        <span class="prec__tick" class:is-minor={tick.label === null} style:--at="{tick.at * 100}%"
        ></span>
      {/each}
    </div>

    <input
      class="prec__range"
      class:is-unseated={seatedRaw === null}
      type="range"
      min={scale.min}
      max={scale.max}
      step={scale.step}
      value={shownRaw}
      {disabled}
      aria-label={label}
      aria-valuetext={seatedRaw == null ? 'Not yet rated' : readingFor(shownRaw)}
      oninput={(e) => put(Number(e.currentTarget.value), false)}
      onchange={(e) => put(Number(e.currentTarget.value), true)}
      onkeydown={onTrackKey}
    />
  </div>

  <div class="prec__scale" aria-hidden="true">
    <div class="prec__graduations">
      {#each ticks as tick (tick.value)}
        {#if tick.label !== null}
          <span class="prec__label" style:--at="{tick.at * 100}%">{tick.label}</span>
        {/if}
      {/each}
    </div>
  </div>
</div>

<style>
  /* The thumb's centre travels from half its own width to half a width short
     of the end, so everything drawn behind it is inset to match and the
     graduations sit exactly under the cut. */
  .prec {
    --thumb: 1.25rem;
    --track-h: 2.75rem;
    display: block;
    width: 100%;
    padding: var(--s2) var(--s2) 0;
    background: var(--surface-sunk);
    border: var(--rule-weight) solid var(--border-faint);
  }

  .prec__head {
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding: 0 calc(var(--thumb) / 2);
  }

  /* Down, the number, up: one seated unit sharing a single hairline, so the
     reading is plainly the thing the two keys move — not three loose parts. */
  .prec__setter {
    display: flex;
    align-items: stretch;
    flex: none;
    border: var(--rule-weight) solid var(--border);
  }
  .prec__setter:focus-within {
    border-color: var(--accent);
  }

  .prec__step {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.75rem;
    flex: none;
    padding: 0;
    background: transparent;
    border: 0;
    color: var(--ink-quiet);
    cursor: pointer;
    transition: color var(--dur-1) var(--ease);
  }
  .prec__step:hover:not(:disabled) {
    color: var(--ink);
  }
  .prec__step:focus-visible {
    outline: var(--rule-weight) solid var(--accent);
    outline-offset: -3px;
  }
  .prec__step:disabled {
    cursor: default;
    opacity: 0.5;
  }

  /* The reading is the field. One number, in one place, that you can also
     type into — never a figure drifting under the thumb. */
  .prec__field {
    width: 4.5ch;
    flex: none;
    padding: 0;
    background: transparent;
    border: 0;
    border-inline: var(--rule-weight) solid var(--border);
    color: var(--accent-ink);
    font-family: var(--display);
    font-size: 1.5rem;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    text-align: center;
    -moz-appearance: textfield;
    appearance: textfield;
  }
  .prec__field:focus {
    /* The group's border already went accent and the caret is showing, so a
       second box inside the first would only read as a nested frame. */
    outline: none;
  }
  .prec__field::placeholder {
    color: var(--ink-faint);
  }
  .prec__field:disabled {
    opacity: 0.5;
  }
  /* The spinners are redundant beside real buttons, and too small to hit. */
  .prec__field::-webkit-outer-spin-button,
  .prec__field::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .prec__of {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .prec__track {
    position: relative;
    height: var(--track-h);
  }

  .prec__graduations {
    position: absolute;
    inset: 0 calc(var(--thumb) / 2);
    pointer-events: none;
  }

  .prec__spine {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 1.05rem;
    height: var(--rule-weight);
    background: var(--border);
  }

  /* Inked to the seated value, as on the detent rail. Deliberately untransitioned:
     the ink has to stay welded to the thumb through a drag, and a transition
     would let it trail behind the hand. */
  .prec__ink {
    position: absolute;
    left: 0;
    width: var(--fill);
    bottom: calc(1.05rem - 1px);
    height: 3px;
    background: var(--accent);
  }

  .prec__tick {
    position: absolute;
    left: var(--at);
    bottom: calc(1.05rem - 0.34rem);
    width: var(--rule-weight);
    height: 0.68rem;
    background: var(--border);
    transform: translateX(-50%);
  }
  .prec__tick.is-minor {
    bottom: calc(1.05rem - 0.17rem);
    height: 0.34rem;
    background: var(--border-faint);
  }

  /* The native control does the dragging, the touch handling and the keys. It
     is transparent: what you see is the spine, the graduations and the cut. */
  .prec__range {
    position: absolute;
    inset: 0;
    width: 100%;
    height: var(--track-h);
    margin: 0;
    padding: 0;
    background: transparent;
    -webkit-appearance: none;
    appearance: none;
    cursor: pointer;
  }
  .prec__range:disabled {
    cursor: default;
    opacity: 0.5;
  }
  .prec__range:focus-visible {
    outline: var(--rule-weight) solid var(--accent);
    outline-offset: 2px;
  }
  .prec__range::-webkit-slider-runnable-track {
    height: var(--track-h);
    background: transparent;
  }
  .prec__range::-moz-range-track {
    height: var(--track-h);
    background: transparent;
  }

  /* The seated cut: the same 3px accent mark the detent rail seats, in a hit
     box big enough for a thumb. The bar is painted inside a transparent box so
     the target is 44px tall while the mark stays a hairline-sharp cut. */
  .prec__range::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: var(--thumb);
    height: var(--track-h);
    border: 0;
    border-radius: 0;
    background: linear-gradient(var(--accent), var(--accent)) no-repeat center bottom 0.35rem / 3px
      2rem;
  }
  .prec__range::-moz-range-thumb {
    width: var(--thumb);
    height: var(--track-h);
    border: 0;
    border-radius: 0;
    background: linear-gradient(var(--accent), var(--accent)) no-repeat center bottom 0.35rem / 3px
      2rem;
  }
  /* Nothing is seated yet, so the cut shows where the rail stands without
     claiming to be a rating. */
  .prec__range.is-unseated::-webkit-slider-thumb {
    background-image: linear-gradient(var(--ink-faint), var(--ink-faint));
  }
  .prec__range.is-unseated::-moz-range-thumb {
    background-image: linear-gradient(var(--ink-faint), var(--ink-faint));
  }

  .prec__scale {
    position: relative;
    height: 1.35rem;
  }
  .prec__scale .prec__graduations {
    inset: 0 calc(var(--thumb) / 2);
  }
  .prec__label {
    position: absolute;
    left: var(--at);
    top: 0;
    transform: translateX(-50%);
    font-family: var(--sans);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    font-variant-numeric: tabular-nums;
    color: var(--ink-quiet);
    white-space: nowrap;
  }

  .prec.is-disabled {
    opacity: 0.7;
  }

  @media (forced-colors: active) {
    .prec__spine,
    .prec__tick {
      background: CanvasText;
    }
    .prec__ink {
      background: Highlight;
    }
    .prec__range::-webkit-slider-thumb {
      width: 8px;
      background: Highlight;
    }
    .prec__range::-moz-range-thumb {
      width: 8px;
      background: Highlight;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .prec__step {
      transition: none;
    }
  }
</style>
