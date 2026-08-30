<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * An empty state that says what is actually true and what to do about it —
   * never a shrug. `reasons` carries the honest account of what was filtered
   * out, which is how a list with strict filters explains itself.
   */

  interface Props {
    title: string;
    body: string;
    reasons?: { reason: string; count: number }[];
    action?: Snippet;
  }

  let { title, body, reasons = [], action }: Props = $props();
</script>

<div class="empty">
  <p class="empty__title">{title}</p>
  <p class="note empty__body">{body}</p>

  {#if reasons.length > 0}
    <dl class="empty__reasons">
      {#each reasons as entry (entry.reason)}
        <div>
          <dt class="note">{entry.reason}</dt>
          <dd class="figure">{entry.count}</dd>
        </div>
      {/each}
    </dl>
  {/if}

  {#if action}
    <div class="empty__action">{@render action()}</div>
  {/if}
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
    align-items: flex-start;
    padding: var(--s5) 0;
    border-top: var(--rule-weight) solid var(--border);
    max-width: var(--measure);
  }

  .empty__title {
    font-family: var(--display);
    font-size: 1.125rem;
    line-height: 1.3;
  }

  .empty__body {
    max-width: 46ch;
  }

  .empty__reasons {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    max-width: 28rem;
  }
  .empty__reasons div {
    display: flex;
    justify-content: space-between;
    gap: var(--s3);
    padding: 2px 0;
    border-bottom: var(--rule-weight) solid var(--border-faint);
  }
  .empty__reasons dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
    color: var(--ink-quiet);
  }

  .empty__action {
    margin-top: var(--s2);
  }
</style>
