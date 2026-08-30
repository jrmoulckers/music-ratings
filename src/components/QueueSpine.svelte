<script module lang="ts">
  export interface Stop {
    id: string;
    name: string;
    /** Served stops are struck; waiting stops stay lit. */
    served: boolean;
  }
</script>

<script lang="ts">
  /**
   * The work rail.
   *
   * The queue is not a list beside the work; it is the spine the work hangs on.
   * Every item waiting is a detent cut into the rail, and a detent stays lit
   * until the item is served — then it is struck and the next one is seated.
   *
   * The rail carries no data of its own. It is given stops and reports which
   * one the reader picked.
   */

  interface Props {
    stops: Stop[];
    selectedId?: string | undefined;
    onselect?: (id: string) => void;
    /** How many are waiting in total, including those past the last detent. */
    remaining?: number;
  }

  let { stops, selectedId, onselect, remaining = 0 }: Props = $props();

  const waiting = $derived(stops.filter((s) => !s.served).length);
</script>

<nav class="spine" aria-label="The work rail">
  <span class="spine__line" aria-hidden="true"></span>

  <ol class="spine__stops">
    {#each stops as stop (stop.id)}
      {@const current = stop.id === selectedId}
      <li class="spine__stop" class:is-served={stop.served} class:is-current={current}>
        <button
          type="button"
          class="spine__detent"
          aria-current={current ? 'true' : undefined}
          onclick={() => onselect?.(stop.id)}
        >
          <span class="spine__tick" aria-hidden="true"></span>
          <span class="sr-only">
            {stop.served ? 'Served' : 'Waiting'}: {stop.name}
          </span>
        </button>
      </li>
    {/each}
  </ol>

  <!-- The rail resolves at a mark, and prints what is still on it. -->
  <p class="spine__foot apparatus" aria-hidden="true">
    {#if remaining > waiting}+{remaining - waiting}{/if}
  </p>
  <span class="spine__cap" aria-hidden="true"></span>
</nav>

<style>
  .spine {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    align-self: stretch;
    min-height: 100%;
    padding: var(--s2) 0;
  }

  /*
   * The rail itself. It stops short of the bottom by the height of its own
   * terminal mark, so the line resolves at a cut rather than trailing off.
   */
  .spine__line {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 2px;
    background: var(--rubric);
  }

  .spine__stops {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    gap: var(--s4);
    width: 100%;
    margin: 0;
  }

  .spine__detent {
    position: relative;
    display: flex;
    align-items: center;
    gap: 3px;
    width: 100%;
    min-height: 1.6rem;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ink-quiet);
    cursor: pointer;
    font: inherit;
  }
  .spine__detent:focus-visible {
    outline: var(--rule-weight) solid var(--rubric);
    outline-offset: 2px;
  }

  /* A detent is a cut off the rail, not a dot on it. */
  .spine__tick {
    flex: none;
    width: 0.85rem;
    height: var(--rule-weight);
    background: var(--rubric);
    transition:
      width var(--dur-1) var(--ease),
      height var(--dur-1) var(--ease),
      background-color var(--dur-1) var(--ease);
  }
  .spine__detent:hover .spine__tick {
    width: 1.4rem;
  }

  /* Seated: the stop the desk is currently working, bracketed above and below. */
  .spine__stop.is-current .spine__tick {
    height: 3px;
    width: 1.5rem;
  }
  .spine__stop.is-current .spine__detent::before,
  .spine__stop.is-current .spine__detent::after {
    content: '';
    position: absolute;
    left: 0;
    width: 0.5rem;
    height: var(--rule-weight);
    background: var(--rubric);
  }
  .spine__stop.is-current .spine__detent::before {
    top: calc(50% - 0.5rem);
  }
  .spine__stop.is-current .spine__detent::after {
    top: calc(50% + 0.5rem);
  }

  /* Served: struck, still on the rail, because the record keeps it. */
  .spine__stop.is-served .spine__tick {
    background: var(--rule);
    width: 0.45rem;
  }

  .spine__foot {
    position: relative;
    margin-top: auto;
    font-size: 0.5625rem;
    line-height: 1;
    color: var(--ink-quiet);
    white-space: nowrap;
    padding: 0 0 var(--s1) 0.3rem;
  }
  /* The terminal mark: the rail stops here rather than trailing away. */
  .spine__cap {
    position: relative;
    flex: none;
    width: 0.85rem;
    height: 3px;
    background: var(--rubric);
  }

  @media (prefers-reduced-motion: reduce) {
    .spine__tick {
      transition: none;
    }
  }
</style>
