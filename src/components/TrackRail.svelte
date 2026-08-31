<script lang="ts">
  /**
   * A record's track list, drawn as the rail it earned.
   *
   * This is the app's signature object read back rather than set: the same sunk
   * channel, the same spine, the same cuts, but every cut inked and the spine
   * carried the whole way. A rating rail says "this is where I put it"; this
   * says "it went all the way", in the same handwriting.
   *
   * It is a picture, not a control — no tab stop, no pointer target. The album's
   * real rating lives in the shared rating components and stays there.
   */

  interface Props {
    /** Tracks with a confirmed play. */
    heard: number;
    /** Tracks on this edition that could be heard at all. */
    total: number;
    /** Play the sweep once. Only true for a completion the reader has not seen. */
    fresh?: boolean;
    label?: string;
  }

  let { heard, total, fresh = false, label }: Props = $props();

  const safeTotal = $derived(Math.max(1, total));
  const complete = $derived(heard >= total && total > 0);
  // Above a couple of dozen tracks the cuts stop being countable and start
  // being hatching, so the drawing thins to a filled measure instead.
  const drawCuts = $derived(safeTotal <= 24);
  const cuts = $derived(Array.from({ length: drawCuts ? safeTotal : 0 }, (_, i) => i));
  const filled = $derived(Math.min(1, heard / safeTotal));
</script>

<div
  class="track-rail"
  class:track-rail--complete={complete}
  class:track-rail--fresh={fresh}
  style="--filled: {filled * 100}%; --cuts: {safeTotal}"
  role="img"
  aria-label={label ?? `${heard} of ${total} tracks heard`}
>
  <span class="track-rail__spine"></span>
  <span class="track-rail__ink"></span>
  {#if drawCuts}
    <span class="track-rail__cuts">
      {#each cuts as index (index)}
        <span
          class="track-rail__cut"
          class:track-rail__cut--inked={index < heard}
          style="--i: {index}"
        ></span>
      {/each}
    </span>
  {/if}
</div>

<style>
  .track-rail {
    position: relative;
    display: block;
    height: 1.75rem;
    background: var(--surface-sunk);
    border: var(--rule-weight) solid var(--border-faint);
  }

  .track-rail__spine {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: var(--rule-weight);
    background: var(--border);
  }

  .track-rail__ink {
    position: absolute;
    left: 0;
    top: calc(50% - 1px);
    height: 3px;
    width: var(--filled);
    background: var(--accent);
    transform-origin: left center;
  }

  .track-rail__cuts {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: repeat(var(--cuts), 1fr);
  }

  /* One cut across the spine per track, drawn from the middle of its share of
     the bar so the marks sit where the tracks would. */
  .track-rail__cut {
    position: relative;
  }
  .track-rail__cut::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 0.3rem;
    bottom: 0.3rem;
    width: var(--rule-weight);
    transform: translateX(-50%);
    background: var(--border);
  }
  .track-rail__cut--inked::before {
    top: 0.15rem;
    bottom: 0.15rem;
    width: 2px;
    background: var(--accent);
  }

  /* The one authored moment: the ink runs the length of the spine once, and the
     cuts land behind it. It plays for a completion that has just arrived and
     never again — a record finished last Tuesday does not re-earn itself on
     every reload. */
  .track-rail--fresh .track-rail__ink {
    animation: rail-fill 620ms var(--ease) both;
  }
  .track-rail--fresh .track-rail__cut--inked::before {
    animation: cut-ink 200ms var(--ease) both;
    animation-delay: calc(120ms + var(--i) * 26ms);
  }

  @keyframes rail-fill {
    from {
      transform: scaleX(0);
    }
    to {
      transform: scaleX(1);
    }
  }
  @keyframes cut-ink {
    from {
      opacity: 0;
      transform: translateX(-50%) scaleY(0.4);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) scaleY(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .track-rail--fresh .track-rail__ink,
    .track-rail--fresh .track-rail__cut--inked::before {
      animation: none;
    }
  }
</style>
