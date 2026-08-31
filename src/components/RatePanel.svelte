<script lang="ts">
  import { untrack } from 'svelte';

  import { rate, skip, snooze } from '../lib/app/actions';
  import {
    annotationsById,
    contextConfig,
    entityLabelCap,
    explicitRatings,
    scaleForType,
    scores,
  } from '../lib/app/state';
  import { facetsForType, judgementsById, makeSnapshot } from '../lib/domain/context';
  import { CONFIDENCE_LABEL } from '../lib/domain/ratings';
  import { formatComputedOn, isDenseScale, isStarScale } from '../lib/domain/scales';
  import type {
    ContextSnapshot,
    Entity,
    FacetJudgement,
    RatingConfidence,
    RatingContext,
    Suggestion,
  } from '../lib/domain/types';
  import { suggestionSourceLabel } from '../lib/domain/suggestions';
  import { swipe } from '../lib/ui/actions';
  import { wideEnoughForRail } from '../lib/ui/media';
  import Icon from '../lib/ui/Icon.svelte';
  import { relative } from '../lib/ui/format';
  import Artwork from './Artwork.svelte';
  import ContextEditor from './ContextEditor.svelte';
  import EntityTypeIcon from './EntityTypeIcon.svelte';
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
    /**
     * Set when the panel sits inside a queue row that already prints the name,
     * the artwork and the reasons. It drops its own frame and heading so the
     * row reads as one record rather than a card inside a card.
     */
    inline?: boolean;
    /**
     * Queue semantics. Skip and snooze only mean something where there is a
     * queue to leave, so on a detail page or a search result the panel is a
     * rating editor and nothing else.
     */
    shortcuts?: boolean;
    /**
     * Where the editor starts, when that is not simply the current rating.
     *
     * History opens an editor on the entry you clicked, so the value, note and
     * confidence in front of you are the ones that entry records — even when a
     * newer rating has since replaced it. Saving still writes a new entry at
     * the top; nothing in the record is edited in place.
     */
    seed?:
      | {
          normalized: number;
          note?: string;
          confidence?: RatingConfidence;
          contextual?: ContextSnapshot | undefined;
        }
      | undefined;
    /** Replaces the standing line about what saving will do. */
    aboutSaving?: string | undefined;
    /** Recorded on the event, so the timeline can say where you rated from. */
    where?: RatingContext;
  }

  let {
    entity,
    suggestion,
    onafter,
    inline = false,
    shortcuts = true,
    seed,
    aboutSaving,
    where = 'queue',
  }: Props = $props();

  const uid = $props.id();
  const contextId = `${uid}-context`;

  const scale = $derived($scaleForType(entity.type));
  const composed = $derived(isDenseScale(scale) && !isStarScale(scale));
  const existing = $derived($explicitRatings.get(entity.id));
  const breakdown = $derived($scores.get(entity.id));
  const annotation = $derived($annotationsById.get(entity.id));
  const offered = $derived(facetsForType($contextConfig.facets, entity.type));

  let note = $state('');
  let confidence = $state<RatingConfidence>('medium');
  let dragOffset = $state(0);
  let busy = $state(false);
  /** Open puts the whole editor into composing mode: one save for the lot. */
  let contextOpen = $state(false);
  let facets = $state<Record<string, FacetJudgement>>({});
  /** The direct value being composed, held rather than written. */
  let directDraft = $state<number | null>(null);
  /** The answers this editor opened on: a seed's, or the entity's own rating's. */
  let seatedContext = $state<ContextSnapshot | null>(null);

  // A new item arrives with a clean slip; nothing carries over from the last.
  // Where a seed is given, the slip is filled in from it instead of from blank
  // — its note, its confidence and the context answers it was saved with.
  // Without a seed the entity's current rating fills it, read untracked so that
  // saving does not re-seed the editor from the thing it just wrote.
  $effect(() => {
    void entity.id;
    void seed;
    const from = seed ? (seed.contextual ?? null) : untrack(() => existing?.contextual ?? null);
    seatedContext = from;
    note = seed?.note ?? '';
    confidence = seed?.confidence ?? 'medium';
    facets = Object.fromEntries(judgementsById(from));
    directDraft = null;
    contextOpen = (from?.facets.length ?? 0) > 0;
  });

  /**
   * The rating of record: the entry this editor was opened on, or the entity's
   * current one. Deliberately not a preview — feeding a control's own preview
   * back to it as its value makes it believe the reader has already committed,
   * and a dense control would then have nothing left to save. Every control
   * here draws its own hover, scrub and draft internally.
   */
  const seated = $derived(seed?.normalized ?? existing?.normalized ?? null);
  /** What would be saved right now: the composed value, or the seated one. */
  const holding = $derived(directDraft ?? seated);
  const answered = $derived(Object.keys(facets).length);

  function setFacet(facetId: string, judgement: FacetJudgement | null): void {
    const next = { ...facets };
    if (judgement === null) delete next[facetId];
    else next[facetId] = judgement;
    facets = next;
  }

  function discard(): void {
    directDraft = null;
    facets = Object.fromEntries(judgementsById(seatedContext));
    note = seed?.note ?? '';
    confidence = seed?.confidence ?? 'medium';
    contextOpen = false;
  }

  async function commit(normalized: number): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const contextual = makeSnapshot(Object.values(facets), $contextConfig, entity.type);
      await rate(entity, normalized, {
        note,
        confidence,
        context: where,
        ...(annotation?.tags?.length ? { tags: annotation.tags } : {}),
        ...(contextual ? { contextual } : {}),
      });
      directDraft = null;
      onafter?.();
    } finally {
      busy = false;
    }
  }

  /** The one save, when the editor is composing a whole rating at once. */
  function saveComposed(): void {
    if (holding === null) return;
    void commit(holding);
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
    // Window-level, so only the open editor may claim these keys.
    if (!shortcuts) return;
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (event.key === 's' || event.key === 'S') {
      event.preventDefault();
      void run(() => skip(entity));
    } else if (event.key === 'z' || event.key === 'Z') {
      event.preventDefault();
      void run(() => snooze(entity));
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<article
  class="panel"
  class:panel--inline={inline}
  class:is-dragging={dragOffset !== 0}
  style:--drag="{dragOffset}px"
  use:swipe={{
    onMove: (dx) => (dragOffset = shortcuts ? Math.max(-140, Math.min(140, dx)) : 0),
    onLeft: () => shortcuts && void run(() => skip(entity)),
    onRight: () => shortcuts && void run(() => snooze(entity)),
    onEnd: () => (dragOffset = 0),
  }}
>
  {#if !inline}
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
        <p class="label panel__kind">
          <EntityTypeIcon type={entity.type} size={14} />
          <span>{entityLabelCap(entity.type)}</span>
        </p>
      </div>
    </header>
  {/if}

  {#if suggestion && !inline}
    <ul class="panel__reasons">
      {#each suggestion.reasons.slice(0, 3) as reason (reason.source)}
        <li>
          <span class="label label--accent">{suggestionSourceLabel(reason.source)}</span>
          <span class="note">{reason.detail}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if aboutSaving}
    <p class="panel__prior note">{aboutSaving}</p>
  {:else if existing}
    <p class="panel__prior note">
      You last rated this {relative(existing.at)}. A new rating is saved alongside the old one, not
      over it.
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
      value={seated}
      label="Rating for {entity.name}"
      orientation={$wideEnoughForRail ? 'horizontal' : 'vertical'}
      mode={contextOpen ? 'compose' : 'commit'}
      oncommit={(value) => (contextOpen ? (directDraft = value) : void commit(value))}
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

  {#if offered.length > 0}
    <section class="panel__context">
      <button
        type="button"
        class="panel__disclose"
        aria-expanded={contextOpen}
        aria-controls={contextId}
        onclick={() => (contextOpen = !contextOpen)}
      >
        <Icon name="chevron" size={13} />
        <span>{contextOpen ? 'Rating in context' : 'Rate in context'}</span>
        <span class="note note--small">
          {#if answered > 0}
            {answered} of {offered.length} answered
          {:else}
            Optional — {offered.length} short questions
          {/if}
        </span>
      </button>

      <div id={contextId} hidden={!contextOpen}>
        {#if contextOpen}
          <ContextEditor
            {entity}
            {scale}
            direct={holding}
            values={facets}
            config={$contextConfig}
            onset={setFacet}
            disabled={busy}
          />
          <div class="panel__save">
            <p class="note note--small">
              {#if holding === null}
                Choose your own rating above — context is saved with a rating, never instead of one.
              {:else}
                Saved as one rating: your value, this note, and every answer above.
              {/if}
            </p>
            <div class="row row--tight">
              <button type="button" class="btn btn--small" disabled={busy} onclick={discard}>
                Cancel
              </button>
              <button
                type="button"
                class="btn btn--small btn--primary"
                disabled={busy || holding === null}
                onclick={saveComposed}
              >
                {existing ? 'Save new rating' : 'Save rating'}
              </button>
            </div>
          </div>
        {/if}
      </div>
    </section>
  {/if}

  {#if inline || shortcuts}
    <footer class="panel__actions">
      {#if inline}
        <!-- The row above already carries skip and snooze. -->
        <p class="note">
          {#if contextOpen}
            Set a value above, answer what you like, then save. It is all recorded as one rating.
          {:else if composed}
            Set a value above, then save it. The note and confidence are saved with it.
          {:else if existing}
            Choose a new value above to rate this again.
          {:else}
            Choose a value above to rate this.
          {/if}
          {#if shortcuts}
            <kbd>S</kbd> skips, <kbd>Z</kbd> snoozes.
          {/if}
        </p>
      {:else}
        <button type="button" class="btn btn--small" onclick={() => void run(() => skip(entity))}>
          <Icon name="arrow-right" size={13} /> Skip <kbd>S</kbd>
        </button>
        <button type="button" class="btn btn--small" onclick={() => void run(() => snooze(entity))}>
          <Icon name="clock" size={13} /> Snooze <kbd>Z</kbd>
        </button>
      {/if}
    </footer>
  {/if}
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
      'context context'
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

  /*
   * Inside a queue row the frame is the row's, not the panel's: a bordered
   * panel within a bordered row reads as two objects for one item. Flow, not
   * grid, so the parts the row already printed leave no empty band behind.
   */
  .panel--inline {
    display: flex;
    flex-direction: column;
    /* The grid above sets `align-items: start`, which in a column flex box
       means every child hugs its content — and a rail asked to be as wide as
       its own width collapses to nothing. */
    align-items: stretch;
    gap: var(--s4);
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
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
  .panel__kind {
    display: flex;
    align-items: center;
    gap: var(--s2);
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

  /* Context is a second question, asked only when the reader opens it. It is
     ruled off above so the fast path — a value and nothing else — stays the
     obvious one. */
  .panel__context {
    grid-area: context;
    display: flex;
    flex-direction: column;
    gap: var(--s3);
    padding-top: var(--s4);
    border-top: var(--rule-weight) solid var(--border-faint);
  }

  .panel__disclose {
    display: flex;
    align-items: center;
    gap: var(--s2);
    padding: var(--s1) 0;
    border: 0;
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }
  .panel__disclose:hover {
    color: var(--accent-ink);
  }
  .panel__disclose :global(.icon) {
    flex: none;
    color: var(--ink-faint);
    transition: transform var(--dur-1) var(--ease);
  }
  .panel__disclose[aria-expanded='true'] :global(.icon) {
    transform: rotate(90deg);
  }

  .panel__save {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s3) var(--s4);
    align-items: center;
    justify-content: space-between;
    margin-top: var(--s4);
    padding-top: var(--s3);
    border-top: var(--rule-weight) solid var(--border-faint);
  }
  .panel__save .note {
    flex: 1 1 18rem;
    min-width: 0;
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
        'context'
        'actions';
      padding: var(--s4);
    }
  }
</style>
