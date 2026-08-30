<script lang="ts">
  import { formatComputedOn, formatRaw, denormalize } from '../lib/domain/scales';
  import type { RatingScale, ScoreBreakdown, ScoreView } from '../lib/domain/types';

  /**
   * A score printed in the margin: the grade a reference edition sets beside the
   * entry. Explicit and computed are visibly different marks, because conflating
   * them is the one thing this product must never do.
   */

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
    !breakdown
      ? null
      : view === 'explicit'
        ? breakdown.explicit
        : view === 'rollup'
          ? breakdown.rollup
          : breakdown.blended,
  );

  // Which evidence actually produced the number on show.
  const kind = $derived(
    !breakdown || value === null
      ? 'unrated'
      : view === 'explicit' || breakdown.explicit === null
        ? breakdown.explicit === null
          ? 'computed'
          : 'explicit'
        : view === 'rollup'
          ? 'computed'
          : breakdown.rollup === null
            ? 'explicit'
            : 'blended',
  );

  const KIND_WORD: Record<string, string> = {
    explicit: 'your rating',
    computed: 'computed',
    blended: 'blended',
    unrated: 'not yet rated',
  };

  const printed = $derived(
    value === null
      ? '—'
      : kind === 'explicit'
        ? formatRaw(scale, denormalize(scale, value))
        : formatComputedOn(scale, value),
  );
  const provisional = $derived(
    Boolean(breakdown && value !== null && kind !== 'explicit' && !breakdown.coverage.meetsMinimum),
  );
</script>

<div class="mark mark--{size}" class:mark--absent={value === null}>
  <span
    class="mark__figure figure"
    class:mark__figure--computed={kind === 'computed' || kind === 'blended'}
  >
    {printed}
  </span>
  {#if showKind}
    <span class="mark__kind label">
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

  /* A computed figure is set in italic outline, so it can never be mistaken for
     a rating the reader actually made. */
  .mark__figure--computed {
    font-style: italic;
    color: var(--ink-quiet);
  }

  .mark--absent .mark__figure {
    color: var(--ink-faint);
  }

  .mark__kind {
    font-size: 0.5625rem;
    letter-spacing: 0.11em;
    color: var(--ink-faint);
  }
</style>
