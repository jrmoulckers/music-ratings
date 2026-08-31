<script lang="ts">
  import { entityHref } from '../lib/app/router';
  import { graph } from '../lib/app/state';
  import { formatComputedOn, formatNormalizedOn } from '../lib/domain/scales';
  import type { RatingScale, ScoreBreakdown } from '../lib/domain/types';
  import { percent, plural } from '../lib/ui/format';

  /**
   * The label behind a computed score.
   *
   * Every channel is shown even when it contributed nothing, with the weight the
   * reader configured next to the weight actually applied, because the gap
   * between those two numbers is usually the answer to "why is this score odd?".
   */

  interface Props {
    breakdown: ScoreBreakdown;
    scale: RatingScale;
    /** Off when a disclosure already names this panel, so the label is not read twice. */
    heading?: boolean;
  }

  let { breakdown, scale, heading = true }: Props = $props();

  const context = $derived(breakdown.context ?? null);

  const CHANNEL_NAME: Record<string, string> = {
    explicit: 'Your own rating',
    directChildren: 'Direct contents',
    descendants: 'Everything further down',
    comparison: 'Head-to-head record',
  };

  const METHOD_NAME: Record<string, string> = {
    mean: 'weighted mean',
    median: 'weighted median',
    trimmed: 'trimmed mean',
    bayesian: 'Bayesian mean',
  };

  /** Channel values are computed quantities, so they keep the same resolution
      as the headline score they add up to. The explicit channel is the one
      exception: that number is a rating the reader actually seated. */
  const grade = (value: number | null, channel?: string) =>
    value === null
      ? '—'
      : channel === 'explicit'
        ? formatNormalizedOn(scale, value)
        : formatComputedOn(scale, value);
</script>

<div class="why">
  {#if heading}
    <h3 class="label">How this score was reached</h3>
  {/if}

  <ol class="why__channels">
    {#each breakdown.channels as channel (channel.channel)}
      <li
        class="why__channel"
        class:is-unused={channel.value === null || channel.appliedWeight === 0}
      >
        <div class="why__line">
          <span class="why__name">{CHANNEL_NAME[channel.channel]}</span>
          <span class="why__value figure">{grade(channel.value, channel.channel)}</span>
        </div>
        <p class="why__weights">
          {percent(channel.requestedWeight)} set
          <span aria-hidden="true">·</span>
          <span class:why__applied={channel.appliedWeight > 0}>
            {percent(channel.appliedWeight)} applied
          </span>
        </p>
        <p class="why__detail note note--small">{channel.detail}</p>
      </li>
    {/each}
  </ol>

  <p class="note">
    Aggregated with the {METHOD_NAME[breakdown.method]}. Weights are renormalised over the evidence
    that actually exists, so a missing channel raises the others rather than dragging the score
    down.
  </p>

  {#if context}
    <div class="why__context">
      <h3 class="label">Deeper rating</h3>
      <p class="why__blend">
        <span class="why__part">
          <span class="note note--small">Your rating</span>
          <span class="figure">{grade(breakdown.explicit, 'explicit')}</span>
        </span>
        <span class="why__part">
          <span class="note note--small">Deeper</span>
          <span class="figure">{grade(context.score, 'explicit')}</span>
        </span>
        {#if context.adjusted !== null}
          <span class="why__part why__part--out">
            <span class="note note--small">Adjusted</span>
            <span class="figure">{grade(context.adjusted, 'explicit')}</span>
          </span>
        {/if}
      </p>

      <ul class="why__list">
        {#each context.rows as row (row.facetId)}
          <li class:is-out={row.orphaned}>
            <span>{row.label}</span>
            <span class="figure">{grade(row.normalized, 'explicit')}</span>
            <span class="note">
              {row.orphaned ? 'not counted' : `${percent(row.appliedWeight)} of deeper`}
            </span>
          </li>
        {/each}
      </ul>

      <p class="note note--small">
        {context.coverage.rated} of {context.coverage.total} deeper questions answered.
        {#if context.enabled && context.contribution > 0}
          Deeper carries {percent(context.contribution)} of your rating, so the adjusted figure is what
          the channel above uses.
        {:else}
          Deeper contribution is switched off, so these answers are recorded but change nothing.
        {/if}
        These are your judgements, not Spotify data.
      </p>

      {#if context.savedWith}
        <p class="note note--small">
          Rated with different weights than the ones set today, so the figure above is calculated
          from your current settings.
        </p>
      {/if}
    </div>
  {/if}

  {#if breakdown.coverage.total > 0}
    <p class="note">
      Coverage: {breakdown.coverage.rated} of {breakdown.coverage.total} rated ({percent(
        breakdown.coverage.ratio,
      )}).
      {#if !breakdown.coverage.meetsMinimum}
        That is below your minimum, so this score is marked provisional.
      {/if}
    </p>
  {/if}

  {#if breakdown.ranking}
    <p class="note">
      {plural(breakdown.ranking.comparisons, 'head-to-head comparison')} so far — {breakdown.ranking
        .wins}
      won, {breakdown.ranking.losses} lost, {breakdown.ranking.draws} drawn.
    </p>
  {/if}

  {#each breakdown.channels as channel (channel.channel)}
    {#if channel.contributors?.length}
      <details class="why__more">
        <summary class="label"
          >Top contributions from {CHANNEL_NAME[channel.channel]?.toLowerCase()}</summary
        >
        <ul class="why__list">
          {#each channel.contributors.slice(0, 8) as contributor (contributor.entityId)}
            {@const entity = $graph.entity(contributor.entityId)}
            <li>
              {#if entity}
                <a href={entityHref(contributor.entityId)}>{contributor.name}</a>
              {:else}
                <span>{contributor.name}</span>
              {/if}
              <span class="figure">{grade(contributor.normalized)}</span>
              <span class="note"
                >weight {contributor.weight.toFixed(2)}{contributor.via
                  ? ` · via ${contributor.via}`
                  : ''}</span
              >
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  {/each}

  {#if breakdown.exclusions.length > 0}
    <div class="why__excluded">
      <h3 class="label">Left out on purpose</h3>
      <ul class="why__list">
        {#each breakdown.exclusions as exclusion (exclusion.code)}
          <li><span class="note">{exclusion.detail}</span></li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .why {
    display: flex;
    flex-direction: column;
    gap: var(--s4);
  }

  .why__channels {
    display: flex;
    flex-direction: column;
    margin: 0;
  }
  .why__channel {
    padding: var(--s3) 0;
    border-bottom: var(--rule-weight) solid var(--border-faint);
  }
  .why__channel:first-child {
    border-top: var(--rule-weight) solid var(--border);
  }

  .why__line {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s3);
  }
  .why__name {
    font-family: var(--display);
    font-size: 0.9375rem;
  }
  .why__value {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .why__weights {
    font-family: var(--sans);
    font-size: 0.625rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-faint);
    font-variant-numeric: tabular-nums;
  }
  .why__applied {
    color: var(--accent-ink);
  }

  .why__detail {
    margin-top: 2px;
  }

  .why__channel.is-unused .why__name,
  .why__channel.is-unused .why__value {
    color: var(--ink-faint);
  }

  .why__more summary {
    cursor: pointer;
    padding: var(--s2) 0;
  }
  .why__more summary:hover {
    color: var(--accent-ink);
  }

  .why__list {
    display: flex;
    flex-direction: column;
    gap: var(--s1);
  }
  .why__list li {
    display: flex;
    gap: var(--s2);
    align-items: baseline;
    flex-wrap: wrap;
    font-size: 0.875rem;
  }
  .why__list .figure {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }

  .why__excluded {
    border-top: var(--rule-weight) solid var(--border-faint);
    padding-top: var(--s3);
  }

  /* Context is set apart from the channels: it does not add a fifth source, it
     moves the first one. Printing it inside the channel list would suggest
     otherwise, and double counting is exactly what this model rules out. */
  .why__context {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    padding: var(--s3);
    background: var(--surface-sunk);
    border: var(--rule-weight) solid var(--border-faint);
  }
  .why__blend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s2) var(--s5);
    align-items: baseline;
  }
  .why__part {
    display: flex;
    align-items: baseline;
    gap: var(--s2);
    font-variant-numeric: tabular-nums;
  }
  .why__part--out .figure {
    color: var(--accent-ink);
    font-size: 1.125rem;
  }
  .why__list li.is-out {
    color: var(--ink-faint);
  }
</style>
