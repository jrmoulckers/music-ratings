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
  import { canSaveDraft, restingValue, settleTyped, steppedFrom } from '../lib/ui/draft';
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
    /**
     * Who owns the save.
     *
     * `commit` keeps the whole transaction here: compose a value, press Save,
     * and the rating is written. `compose` says an outer form is holding a
     * larger draft — a note, a confidence, a set of context answers — with one
     * save for all of it. Then this rail reports every change as it is made and
     * drops its own footer, because two save buttons for one rating is one save
     * button too many.
     */
    mode?: 'commit' | 'compose';
  }

  let {
    scale,
    value,
    onpreview,
    oncommit,
    label = 'Rating',
    disabled = false,
    mode = 'commit',
  }: Props = $props();

  const held = $derived(mode === 'compose');

  const uid = $props.id();
  const complaintId = `${uid}-said`;
  const stepHintId = `${uid}-hint`;

  let trackWidth = $state(0);
  /** What is in the number field while it is being typed, before it is legal. */
  let typing = $state<string | null>(null);
  /**
   * The value being worked out, before it is given.
   *
   * A hundred positions cannot be hit once and be right, so a precision rating
   * is composed — dragged, typed, nudged — and then saved. Nothing here writes
   * a rating until Save is pressed, which is the whole difference between this
   * and the coarse rail, where one press *is* the decision.
   */
  let draftRaw = $state<number | null>(null);
  let complaint = $state<string | null>(null);
  let saving = $state(false);

  const seatedRaw = $derived(value == null ? null : denormalize(scale, value));
  /**
   * An unseated rail still needs somewhere to stand, so it stands in the
   * middle. This is furniture, not an answer: it is never read back as a value,
   * never filled in, and the keys that would step off it are held shut until
   * you have said where you are starting from.
   */
  const restingRaw = $derived(restingValue(scale));
  const shownRaw = $derived(draftRaw ?? seatedRaw ?? restingRaw);
  /** The value the reader has actually put somewhere, draft or saved. */
  const heldRaw = $derived(draftRaw ?? seatedRaw);
  const dirty = $derived(canSaveDraft(draftRaw, seatedRaw));

  // A rating landing from anywhere — this control's own Save included — ends
  // the draft, because the draft has become the record.
  $effect(() => {
    void value;
    draftRaw = null;
    typing = null;
    complaint = null;
  });

  const ticks = $derived(
    railTicks(scale, trackWidth > 0 ? railLabelBudget(trackWidth, scale) : RAIL_DEFAULT_LABELS),
  );

  const span = $derived(scale.max - scale.min);
  const fill = $derived(span <= 0 ? 0 : ((shownRaw - scale.min) / span) * 100);

  /** Decimals the scale actually carries, so the number field steps in kind. */
  const decimals = $derived(scale.step < 1 ? (String(scale.step).split('.')[1]?.length ?? 1) : 0);
  const fieldText = $derived(typing ?? (heldRaw === null ? '' : heldRaw.toFixed(decimals)));

  function readingFor(raw: number): string {
    return `${formatRaw(scale, raw)} on ${scale.label}`;
  }

  /** Puts a value into the draft and previews it. Never writes a rating. */
  function draft(raw: number): void {
    const snapped = snapRaw(scale, raw);
    complaint = null;
    draftRaw = snapped;
    const normalized = normalize(scale, snapped);
    onpreview?.(normalized);
    // Composing: the outer form is the one holding this, so it hears every
    // change. It still does not write anything down — its own save does that.
    if (held) oncommit?.(normalized);
  }

  function nudge(direction: 1 | -1): void {
    // Nothing to step from: the resting position is furniture, and stepping off
    // it would invent a rating of five out of ten that nobody chose.
    if (disabled) return;
    const next = steppedFrom(scale, heldRaw, direction);
    if (next !== null) draft(next);
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

  /** Settles typed text into the draft. Clamps, snaps, and says so. Never saves. */
  function settleField(): void {
    const settled = settleTyped(scale, typing);
    typing = null;
    if (settled.kind === 'unchanged') return;
    if (settled.kind === 'rejected') {
      complaint = settled.complaint;
      return;
    }
    draft(settled.value);
    if (settled.kind === 'clamped') complaint = settled.complaint;
  }

  function save(): void {
    if (disabled || saving || !dirty || draftRaw === null || held) return;
    saving = true;
    const giving = draftRaw;
    try {
      // The draft has become the record, so it stops being a draft here rather
      // than waiting for a new value to arrive — which, on a history entry,
      // never does.
      draftRaw = null;
      typing = null;
      complaint = null;
      oncommit?.(normalize(scale, giving));
    } finally {
      saving = false;
    }
  }

  function cancel(): void {
    draftRaw = null;
    typing = null;
    complaint = null;
  }

  function onFieldKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      settleField();
      // Composing: Enter makes the number legal and stops there. The outer
      // form's save is the only thing that records a rating.
      if (!held) save();
      return;
    }
    if (event.key === 'Escape') {
      // Only claimed while there is something to take back, so Escape still
      // reaches whatever opened this control when there is not. Composing, the
      // outer form owns the whole draft, so Escape is always its to answer.
      if (held || (typing === null && draftRaw === null)) return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  }

  /**
   * The slider carries native dragging, touch and keys. Page keys are taken
   * over so they jump to the next printed graduation rather than to some
   * fraction of the range the reader cannot see.
   */
  function onTrackKey(event: KeyboardEvent): void {
    if (disabled) return;
    if (event.key === 'Escape' && draftRaw !== null && !held) {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    if (event.key !== 'PageUp' && event.key !== 'PageDown') return;
    event.preventDefault();
    const target = nextGraduation(ticks, shownRaw, event.key === 'PageUp' ? 1 : -1);
    if (target != null) draft(target);
  }
</script>

<div
  class="prec"
  class:is-disabled={disabled}
  class:is-draft={dirty}
  role="group"
  aria-label={label}
>
  <div class="prec__head">
    <div class="prec__setter">
      <button
        type="button"
        class="prec__step"
        disabled={disabled || heldRaw === null}
        aria-label="Lower the rating"
        aria-describedby={heldRaw === null ? stepHintId : undefined}
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
        aria-describedby={complaint ? complaintId : undefined}
        aria-invalid={complaint ? 'true' : undefined}
        oninput={onFieldInput}
        onblur={() => settleField()}
        onkeydown={onFieldKey}
      />

      <button
        type="button"
        class="prec__step"
        disabled={disabled || heldRaw === null}
        aria-label="Raise the rating"
        aria-describedby={heldRaw === null ? stepHintId : undefined}
        onclick={() => nudge(1)}
      >
        <Icon name="plus" size={16} />
      </button>
    </div>

    <span class="prec__of note note--small">
      {#if dirty}
        Not saved yet
      {:else if seatedRaw === null}
        Not yet rated
      {:else}
        on {scale.label}
      {/if}
    </span>
  </div>

  <div class="prec__track" bind:clientWidth={trackWidth}>
    <div class="prec__graduations" aria-hidden="true">
      <div class="prec__spine"></div>
      {#if heldRaw !== null}
        <div class="prec__ink" style:--fill="{fill}%"></div>
      {/if}
      {#each ticks as tick (tick.value)}
        <span class="prec__tick" class:is-minor={tick.label === null} style:--at="{tick.at * 100}%"
        ></span>
      {/each}
    </div>

    <input
      class="prec__range"
      class:is-unseated={heldRaw === null}
      type="range"
      min={scale.min}
      max={scale.max}
      step={scale.step}
      value={shownRaw}
      {disabled}
      aria-label={label}
      aria-valuetext={heldRaw === null ? 'Not yet rated' : readingFor(shownRaw)}
      oninput={(e) => draft(Number(e.currentTarget.value))}
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

  <div class="prec__settle">
    <p class="prec__said note note--small" id={complaintId} aria-live="polite">
      {#if complaint}
        {complaint}
      {:else if dirty}
        {readingFor(shownRaw)}{held ? '.' : ', not saved yet.'}
      {:else}
        <span id={stepHintId}>
          {#if heldRaw === null}
            Drag or type a value to start{held ? '.' : ', then save it.'}
          {:else if held}
            Adjust as much as you like — this is written down when you save the rating below.
          {:else}
            Adjust as much as you like — nothing is recorded until you save.
          {/if}
        </span>
      {/if}
    </p>
    {#if !held}
      <div class="prec__buttons">
        {#if dirty}
          <button type="button" class="btn btn--small" onclick={cancel}> Cancel </button>
        {/if}
        <button
          type="button"
          class="btn btn--small btn--primary"
          disabled={disabled || saving || !dirty}
          onclick={save}
        >
          {seatedRaw === null ? 'Save rating' : 'Save new rating'}
        </button>
      </div>
    {/if}
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
  /* A draft is a held value, not a recorded one, so the whole instrument says
     so at its edge rather than only in the small print under it. */
  .prec.is-draft {
    border-color: var(--accent);
  }

  /* The settle bar. Everything above it is provisional; this is where a value
     becomes a rating, which is why it is the only primary button in the rail. */
  .prec__settle {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s2) var(--s3);
    margin-top: var(--s2);
    padding: var(--s2) calc(var(--thumb) / 2);
    border-top: var(--rule-weight) solid var(--border-faint);
  }
  .prec__said {
    flex: 1 1 12rem;
    min-width: 0;
    margin: 0;
  }
  .prec__buttons {
    display: flex;
    flex: none;
    gap: var(--s2);
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
