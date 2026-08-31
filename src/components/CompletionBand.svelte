<script lang="ts">
  import { href } from '../lib/app/router';
  import { openCompletions, settings } from '../lib/app/state';
  import AlbumComplete from './AlbumComplete.svelte';

  /**
   * The album-complete band.
   *
   * Kept apart from the rating queue on purpose. The queue is a list of guesses
   * about what you might want to rate, ordered by a score; this is a statement
   * that something happened, and it would lose its meaning ranked among
   * guesses. So it sits above the queue, under its own rule, and it does not
   * compete for the same row.
   *
   * It shows the newest completion in full and names the rest, rather than
   * stacking every outstanding one — three earned moments at once is a backlog,
   * and a backlog is exactly what this should not feel like.
   */

  interface Props {
    /** How many to draw in full before the band collapses to a count. */
    limit?: number;
    heading?: string;
  }

  let { limit = 1, heading = 'Heard all the way through' }: Props = $props();

  const shown = $derived($openCompletions.slice(0, limit));
  const rest = $derived(Math.max(0, $openCompletions.length - shown.length));

  /** Newly arrived, so the rail earns its one sweep. Anything older stays still. */
  const FRESH_MS = 6 * 60 * 60 * 1000;
</script>

{#if $settings.completionPrompts && shown.length > 0}
  <section class="band" aria-labelledby="completions-head">
    <div class="head">
      <h2 class="title" id="completions-head">{heading}</h2>
      <a class="label" href={href('/listening')}>All listening</a>
    </div>

    {#each shown as completion (completion.id)}
      <AlbumComplete {completion} fresh={Date.now() - completion.createdAt < FRESH_MS} />
    {/each}

    {#if rest > 0}
      <p class="note note--small band__rest">
        {rest === 1 ? 'One more record' : `${rest} more records`} finished and not yet answered.
        <a href={href('/listening')}>See them</a>
      </p>
    {/if}
  </section>
{/if}

<style>
  .band {
    display: grid;
    gap: var(--s3);
  }
  .band__rest {
    margin: 0;
  }
</style>
