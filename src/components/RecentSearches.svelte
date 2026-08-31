<script lang="ts">
  import { forgetSearch, recentSearches } from '../lib/app/recent-searches';
  import Icon from '../lib/ui/Icon.svelte';

  /**
   * The last few things you looked for.
   *
   * Shown only while the field is empty, so it never competes with results. It
   * is a shortcut, not a record: each row runs its query, each has its own
   * dismissal, and the whole thing disappears the moment you start typing.
   */

  interface Props {
    /** Run this query again. The caller repopulates its own field. */
    onpick: (term: string) => void;
    /** Rows sit inside a form on some surfaces; buttons must not submit it. */
    id?: string;
  }

  let { onpick, id = 'recent-searches' }: Props = $props();
</script>

{#if $recentSearches.length > 0}
  <section class="recent" aria-labelledby="{id}-head">
    <div class="recent__head">
      <p id="{id}-head" class="label">Recent searches</p>
      <button
        type="button"
        class="btn btn--small btn--quiet"
        onclick={() => $recentSearches.forEach((term) => forgetSearch(term))}
      >
        Clear
      </button>
    </div>
    <ul class="recent__list">
      {#each $recentSearches as term (term)}
        <li class="recent__row">
          <button type="button" class="recent__term" onclick={() => onpick(term)}>
            <Icon name="search" size={14} />
            <span class="recent__text">{term}</span>
          </button>
          <button
            type="button"
            class="recent__drop"
            onclick={() => forgetSearch(term)}
            title="Remove {term} from recent searches"
          >
            <Icon name="close" size={13} />
            <span class="sr-only">Remove {term} from recent searches</span>
          </button>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .recent {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }

  .recent__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s3);
  }

  .recent__list {
    display: flex;
    flex-direction: column;
  }

  .recent__row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    border-bottom: var(--rule-weight) solid var(--border-faint);
  }
  .recent__row:last-child {
    border-bottom: 0;
  }

  .recent__term,
  .recent__drop {
    display: flex;
    align-items: center;
    gap: var(--s3);
    min-height: 2.75rem;
    padding: var(--s2) var(--s2);
    color: var(--ink);
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .recent__term {
    min-width: 0;
    color: var(--ink-quiet);
  }
  .recent__drop {
    justify-content: center;
    min-width: 2.75rem;
    color: var(--ink-faint);
  }

  .recent__term:hover,
  .recent__term:focus-visible {
    color: var(--ink);
    background: var(--surface-sunk);
  }
  .recent__drop:hover,
  .recent__drop:focus-visible {
    color: var(--ink);
    background: var(--surface-sunk);
  }

  .recent__text {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
