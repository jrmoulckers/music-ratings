<script lang="ts">
  import { onMount } from 'svelte';

  /**
   * The end of a list, watched.
   *
   * A "show more" button asks you to confirm that you meant to keep reading,
   * which is a strange thing to ask of someone who is already scrolling. This
   * watches for the end of the list coming into view — well before it arrives —
   * and asks for the next batch itself.
   *
   * It still announces what happened, because a list that grows silently is
   * unusable without sight of it.
   */

  interface Props {
    /** Whether there is anything left to append. */
    hasMore: boolean;
    /** Append the next batch. Called at most once per batch. */
    onload: () => void;
    /** How many rows are on screen now, for the announcement. */
    count?: number | undefined;
    /** What the rows are, e.g. "tracks". Used in the announcement. */
    noun?: string;
    /** Distance ahead of the viewport at which to start loading. */
    rootMargin?: string;
    /** Said once when the list has no more to give. */
    endLabel?: string | undefined;
  }

  let {
    hasMore,
    onload,
    count,
    noun = 'items',
    rootMargin = '800px 0px',
    endLabel,
  }: Props = $props();

  let sentinel = $state<HTMLDivElement | null>(null);
  // Guards a second request while the first batch is still being rendered. The
  // sentinel keeps intersecting until layout catches up, and an observer that
  // fired twice on the same view would skip a batch. Released only when the
  // caller's rows have actually landed, which is the thing that moves it.
  let pending = $state(false);
  let requestedAt = $state<number | undefined>(undefined);
  let announcement = $state('');

  function request() {
    if (pending || !hasMore) return;
    pending = true;
    requestedAt = count;
    onload();
  }

  $effect(() => {
    if (pending && count !== requestedAt) pending = false;
  });

  $effect(() => {
    if (!hasMore) return;
    announcement = count === undefined ? `More ${noun} loaded.` : `${count} ${noun} loaded.`;
  });

  onMount(() => {
    const node = sentinel;
    if (!node) return;

    // Without IntersectionObserver the same question is answered by measuring
    // on scroll. Older browsers get the behaviour, not a button.
    if (typeof IntersectionObserver === 'undefined') {
      const check = () => {
        const box = node.getBoundingClientRect();
        if (box.top < window.innerHeight + 800) request();
      };
      window.addEventListener('scroll', check, { passive: true });
      window.addEventListener('resize', check, { passive: true });
      check();
      return () => {
        window.removeEventListener('scroll', check);
        window.removeEventListener('resize', check);
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) request();
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  });
</script>

<div bind:this={sentinel} class="sentinel" aria-hidden="true"></div>

{#if hasMore || endLabel}
  <p class="status note note--small" role="status" aria-live="polite">
    {#if hasMore}
      {announcement}
    {:else}
      {endLabel}
    {/if}
  </p>
{/if}

<style>
  /* Tall enough that a fast flick cannot jump clean over it between frames. */
  .sentinel {
    height: 1px;
    margin-top: -1px;
    pointer-events: none;
  }

  .status {
    min-height: 1.25rem;
    padding-top: var(--s3);
    color: var(--ink-faint);
  }
</style>
