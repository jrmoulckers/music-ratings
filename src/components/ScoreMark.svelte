<script lang="ts">
  import { formatComputedOn, formatRaw, denormalize } from '../lib/domain/scales';
  import type { RatingScale, ScoreBreakdown, ScoreView } from '../lib/domain/types';

  interface Props {
    breakdown: ScoreBreakdown | undefined;
    scale: RatingScale;
    view: ScoreView;
    size?: 'sm' | 'lg';
    /** Prints the provenance word under the figure. */
    showKind?: boolean;
  }

  let { breakdown, scale, view, size = 'sm', showKind = true }: Props = $props();

  const value = $derived(
    breakdown
      ? {
          explicit: breakdown.explicit,
          context: breakdown.contextScore,
          contextAdjusted: breakdown.contextAdjusted,
          rollup: breakdown.rollup,
          blended: breakdown.blended,
        }[view]
      : null,
  );

  // Which evidence actually produced the number on show.
  const kind = $derived.by(() => {
    if (!breakdown || value === null) return 'unrated';
    if (view === 'explicit') return 'explicit';
    if (view === 'context') return 'context';
    if (view === 'contextAdjusted') return 'context-adjusted';
    if (view === 'rollup' || breakdown.explicit === null) return 'computed';
    return breakdown.rollup === null ? 'explicit' : 'blended';
  });

  const KIND_WORD: Record<string, string> = {
    explicit: 'your rating',
    computed: 'computed',
    blended: 'blended',
    context: 'context',
    'context-adjusted': 'context-adjusted',
    unrated: 'unrated',
  };

  const printed = $derived(
    value === null
      ? '—'
      : kind === 'explicit'
        ? formatRaw(scale, denormalize(scale, value))
        : formatComputedOn(scale, value),
  );
  const provisional = $derived(
    Boolean(
      breakdown &&
      value !== null &&
      kind !== 'explicit' &&
      (view === 'context' || view === 'contextAdjusted'
        ? breakdown.context && !breakdown.context.coverage.meetsMinimum
        : !breakdown.coverage.meetsMinimum),
    ),
  );
</script>

<div class="mark mark--{size}" class:mark--absent={value === null}>
  <span
    class="mark__figure figure"
    class:mark__figure--computed={kind !== 'explicit' && kind !== 'unrated'}
  >
    <span class="sr-only">{KIND_WORD[kind]}{provisional ? ', provisional' : ''}: </span>{printed}
  </span>
  {#if showKind}
    <span class="mark__kind label" aria-hidden="true">
      {KIND_WORD[kind]}{#if provisional}&nbsp;· provisional{/if}
    </span>
  {/if}
</div>

<style>
  .mark {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 1px;
    text-align: right;
  }

  .mark__figure {
    font-size: 1.375rem;
    font-weight: 500;
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--ink);
  }
  .mark--lg .mark__figure {
    font-size: 2.75rem;
    font-weight: 400;
  }

  .mark__figure--computed {
    font-style: italic;
    color: var(--ink-quiet);
  }

  .mark--absent .mark__figure {
    color: var(--ink-faint);
  }

  .mark__kind {
    font-size: 0.75rem;
    letter-spacing: normal;
    color: var(--ink-faint);
  }
</style>
