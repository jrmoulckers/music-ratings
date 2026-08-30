<script lang="ts">
  import { entityHref } from '../lib/app/router';
  import { scaleForType } from '../lib/app/state';
  import type { Entity, ScoreBreakdown, ScoreView } from '../lib/domain/types';
  import { duration, releaseYear } from '../lib/ui/format';
  import Plate from './Plate.svelte';
  import ScoreMark from './ScoreMark.svelte';

  /**
   * One line of the catalogue. Not a card: a ruled entry with a position in the
   * left margin, the item set in the measure, and its grade in the right.
   */

  interface Props {
    entity: Entity;
    breakdown?: ScoreBreakdown | undefined;
    view?: ScoreView;
    /** Rank position, when the list is a ranked one. */
    position?: number | undefined;
    tied?: boolean;
    note?: string | undefined;
    current?: boolean;
  }

  let {
    entity,
    breakdown,
    view = 'blended',
    position,
    tied = false,
    note,
    current = false,
  }: Props = $props();

  const scale = $derived($scaleForType(entity.type));
  const meta = $derived(
    [
      entity.subtitle,
      releaseYear(entity.releaseDate),
      duration(entity.durationMs),
      entity.available === false ? 'unavailable in your market' : '',
    ]
      .filter(Boolean)
      .join(' · '),
  );
</script>

<a class="entry" href={entityHref(entity.id)} aria-current={current ? 'true' : undefined}>
  {#if position !== undefined}
    <span class="entry__position figure" aria-label={tied ? `Tied at ${position}` : undefined}>
      {tied ? '=' : ''}{position}
    </span>
  {:else}
    <Plate src={entity.artworkUrl} thumb={entity.artworkThumbUrl} name={entity.name} />
  {/if}

  <span class="entry__body">
    <span class="entry__name">{entity.name}</span>
    {#if meta}<span class="entry__sub">{meta}</span>{/if}
    {#if note}<span class="entry__note note">{note}</span>{/if}
  </span>

  <ScoreMark {breakdown} {scale} {view} showKind={false} />
</a>

<style>
  .entry {
    text-decoration: none;
    color: inherit;
  }
  .entry__body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .entry__name {
    font-family: var(--serif);
    font-size: 1rem;
    line-height: 1.3;
  }
  .entry__note {
    font-size: 0.8125rem;
    color: var(--ink-quiet);
    margin-top: 2px;
  }
</style>
