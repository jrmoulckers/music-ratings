<script lang="ts">
  import {
    contextRows,
    contributionFor,
    coverageOf,
    facetsForType,
    scoreFromRows,
    adjustedRating,
    type ContextConfig,
  } from '../lib/domain/context';
  import { denormalize, formatNormalizedOn } from '../lib/domain/scales';
  import type { Entity, FacetJudgement, RatingScale } from '../lib/domain/types';
  import { CONTEXT_SCHEMA_VERSION } from '../lib/domain/types';
  import Icon from '../lib/ui/Icon.svelte';
  import CompactRating from './CompactRating.svelte';

  /**
   * Rating something in context.
   *
   * Three numbers are kept apart on purpose. **Your rating** is what you think
   * of it. **Context** is a weighted answer to a handful of optional questions.
   * **Adjusted** is the two blended, and only if you have asked for that.
   *
   * Every question here is yours to answer. A release year is a fact and is
   * printed as one; whether a record was ahead of its time is not something a
   * catalogue can know, and nothing in this panel pretends otherwise.
   *
   * Nothing is written from here. Each answer lands in the draft the rating
   * editor is holding, and one save records the lot as a single rating.
   */

  interface Props {
    entity: Entity;
    /** The scale the facet controls use — the same one the rating uses. */
    scale: RatingScale;
    /** The direct rating currently held, canonical 0..100. */
    direct: number | null;
    /** Facet answers held in the parent's draft, keyed by facet id. */
    values: Record<string, FacetJudgement>;
    config: ContextConfig;
    onset: (facetId: string, judgement: FacetJudgement | null) => void;
    disabled?: boolean;
  }

  let { entity, scale, direct, values, config, onset, disabled = false }: Props = $props();

  const facets = $derived(facetsForType(config.facets, entity.type));
  const contribution = $derived(contributionFor(config, entity.type));

  /** A fact from the catalogue, printed as a fact. Never an inference. */
  const releaseYear = $derived(entity.releaseDate?.slice(0, 4) ?? null);
  const showsEra = $derived(releaseYear !== null && facets.some((f) => f.temporal));

  const draftSnapshot = $derived({
    v: CONTEXT_SCHEMA_VERSION,
    facets: Object.values(values),
    weights: Object.fromEntries(facets.map((f) => [f.id, f.weight])),
    contribution,
    applicable: facets.length,
  });

  const rows = $derived(contextRows(draftSnapshot, config, entity.type));
  const score = $derived(scoreFromRows(rows));
  const adjusted = $derived(adjustedRating(direct, score, contribution));
  const coverage = $derived(coverageOf(rows, facets.length));

  const say = (value: number | null) => (value === null ? '—' : formatNormalizedOn(scale, value));

  function set(facetId: string, normalized: number) {
    onset(facetId, {
      facetId,
      value: denormalize(scale, normalized),
      scaleId: scale.id,
      normalized,
    });
  }
</script>

<div class="ctx">
  <p class="ctx__lede note">
    Optional. Answer as many or as few as you like — these are your judgements, not Spotify's.
    {#if showsEra}
      <span class="ctx__fact">Released in {releaseYear}.</span>
    {/if}
  </p>

  <ul class="ctx__facets">
    {#each facets as facet (facet.id)}
      {@const held = values[facet.id]?.normalized ?? null}
      <li class="ctx__facet">
        <div class="ctx__ask">
          <span class="ctx__label">{facet.label}</span>
          <span class="note note--small">{facet.description}</span>
        </div>
        <div class="ctx__set">
          <CompactRating
            {scale}
            value={held}
            mode="held"
            label="{facet.label} for {entity.name}"
            subject="{facet.label} for {entity.name}"
            {disabled}
            oncommit={(normalized) => set(facet.id, normalized)}
          />
          {#if held !== null}
            <button
              type="button"
              class="ctx__clear"
              {disabled}
              onclick={() => onset(facet.id, null)}
            >
              <Icon name="close" size={12} />
              <span class="sr-only">Clear {facet.label} for {entity.name}</span>
              <span aria-hidden="true">Not rated</span>
            </button>
          {/if}
        </div>
      </li>
    {/each}
  </ul>

  <div class="ctx__sum">
    <p class="ctx__tally">
      <span class="ctx__part">
        <span class="label">Your rating</span>
        <span class="figure">{say(direct)}</span>
      </span>
      <span class="ctx__part">
        <span class="label">Context</span>
        <span class="figure">{say(score)}</span>
      </span>
      {#if contribution > 0}
        <span class="ctx__part ctx__part--out">
          <span class="label">Adjusted</span>
          <span class="figure">{say(adjusted)}</span>
        </span>
      {/if}
    </p>

    <p class="note note--small">
      {coverage.rated} of {coverage.total} answered.
      {#if score === null}
        Nothing answered yet, so there is no context score.
      {:else if contribution > 0}
        Context carries {Math.round(contribution * 100)}% of the result.
      {:else}
        Saved with this rating, but not counted in any score — turn on context contribution in
        Settings to let it count.
      {/if}
    </p>

    {#if score !== null}
      <details class="ctx__how">
        <summary class="note note--small">How this is calculated</summary>
        <table class="ctx__table">
          <thead>
            <tr>
              <th scope="col">Question</th>
              <th scope="col">Your answer</th>
              <th scope="col">Share</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as row (row.facetId)}
              <tr class:is-out={row.orphaned}>
                <th scope="row">{row.label}</th>
                <td class="figure">{say(row.normalized)}</td>
                <td class="figure">
                  {row.orphaned ? 'not counted' : `${Math.round(row.appliedWeight * 100)}%`}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="note note--small">
          Context is the weighted average of what you answered, so the shares always add up to a
          hundred over the questions you actually answered.
          {#if contribution > 0 && direct !== null}
            Adjusted is {say(direct)} moved {Math.round(contribution * 100)}% of the way towards {say(
              score,
            )}.
          {/if}
        </p>
      </details>
    {/if}
  </div>
</div>

<style>
  .ctx {
    display: flex;
    flex-direction: column;
    gap: var(--s4);
  }

  .ctx__lede {
    max-width: 60ch;
  }
  /* A fact from the catalogue sits apart from the invitation, so nobody reads
     the year as part of the judgement being asked for. */
  .ctx__fact {
    color: var(--ink);
  }

  .ctx__facets {
    display: flex;
    flex-direction: column;
    /* A question and the control that answers it stay within reading distance
       of each other: across a full-width row they drift apart until the two
       stop looking like one thing. */
    max-width: 52rem;
  }
  .ctx__facet {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--s3) var(--s4);
    align-items: center;
    padding: var(--s3) 0;
    border-top: var(--rule-weight) solid var(--border-faint);
  }
  .ctx__facet:last-child {
    border-bottom: var(--rule-weight) solid var(--border-faint);
  }

  .ctx__ask {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .ctx__label {
    font-weight: 600;
  }

  .ctx__set {
    display: flex;
    align-items: center;
    gap: var(--s2);
    justify-content: flex-end;
  }

  .ctx__clear {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    border: 0;
    padding: var(--s1) var(--s2);
    background: transparent;
    color: var(--ink-faint);
    font: inherit;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .ctx__clear:hover:not(:disabled) {
    color: var(--ink);
  }
  .ctx__clear:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .ctx__sum {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }

  .ctx__tally {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s2) var(--s5);
    align-items: baseline;
  }
  .ctx__part {
    display: flex;
    align-items: baseline;
    gap: var(--s2);
  }
  .ctx__part .figure {
    font-size: 1.25rem;
    font-variant-numeric: tabular-nums;
  }
  /* The result of the blend is the one number the reader came for. */
  .ctx__part--out .figure {
    color: var(--accent-ink);
  }

  .ctx__how summary {
    cursor: pointer;
    padding: var(--s1) 0;
  }
  .ctx__table {
    width: 100%;
    border-collapse: collapse;
    margin: var(--s2) 0;
    font-size: 0.8125rem;
  }
  .ctx__table th,
  .ctx__table td {
    text-align: left;
    padding: var(--s1) var(--s3) var(--s1) 0;
    border-bottom: var(--rule-weight) solid var(--border-faint);
    font-weight: 400;
  }
  .ctx__table thead th {
    color: var(--ink-faint);
    font-size: 0.6875rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .ctx__table td {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .ctx__table tr.is-out {
    color: var(--ink-faint);
  }

  @media (max-width: 40rem) {
    .ctx__facet {
      grid-template-columns: minmax(0, 1fr);
    }
    .ctx__set {
      justify-content: flex-start;
    }
  }
</style>
