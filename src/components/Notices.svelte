<script lang="ts">
  import { dismiss, notices } from '../lib/app/notices';
  import Icon from '../lib/ui/Icon.svelte';
</script>

<div class="slips" role="region" aria-label="Notices">
  {#each $notices as notice (notice.id)}
    <div
      class="slip"
      class:slip--warn={notice.tone === 'warn'}
      role={notice.tone === 'warn' ? 'alert' : undefined}
    >
      {#if notice.tone === 'warn'}
        <Icon name="warning" size={17} label="Warning" />
      {/if}
      <p class="slip__text">{notice.message}</p>
      {#if notice.action}
        <button
          type="button"
          class="btn btn--small"
          onclick={() => {
            void notice.action?.run();
            dismiss(notice.id);
          }}
        >
          {notice.action.label}
        </button>
      {/if}
      <button
        type="button"
        class="slip__close"
        onclick={() => dismiss(notice.id)}
        aria-label="Dismiss notice"
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  {/each}
</div>

<style>
  .slips {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    width: 100%;
    pointer-events: none;
  }

  .slip {
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding: var(--s3);
    background: var(--surface-raised);
    border: var(--rule-weight) solid var(--border);
    border-radius: var(--radius);
    pointer-events: auto;
  }
  .slip--warn {
    border-color: var(--accent);
  }

  .slip__text {
    flex: 1;
    font-size: 0.9375rem;
    line-height: 1.4;
  }

  .slip__close {
    flex: none;
    background: transparent;
    border: 0;
    padding: var(--s1);
    min-width: var(--target-min);
    min-height: var(--target-min);
    display: grid;
    place-items: center;
    color: var(--ink-quiet);
    cursor: pointer;
  }
  .slip__close:hover {
    color: var(--ink);
  }
</style>
