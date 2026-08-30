<script lang="ts">
  import { dismiss, notices } from '../lib/app/notices';
  import Icon from '../lib/ui/Icon.svelte';

  /**
   * Notices are set as slips: a bordered strip with the message and, where an
   * action can still be taken back, the way to take it back.
   */
</script>

<div class="slips" role="region" aria-label="Notices">
  {#each $notices as notice (notice.id)}
    <div class="slip" class:slip--warn={notice.tone === 'warn'}>
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
    position: fixed;
    left: 50%;
    bottom: var(--s5);
    transform: translateX(-50%);
    z-index: var(--z-toast);
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    width: min(30rem, calc(100vw - 2rem));
    pointer-events: none;
  }

  .slip {
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding: var(--s3);
    background: var(--paper-raised);
    border: var(--rule-weight) solid var(--ink);
    pointer-events: auto;
    box-shadow: 3px 3px 0 0 var(--paper-sunk);
  }
  .slip--warn {
    border-color: var(--rubric);
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
    color: var(--ink-quiet);
    cursor: pointer;
  }
  .slip__close:hover {
    color: var(--ink);
  }

  @media (max-width: 60rem) {
    .slips {
      bottom: 4.75rem;
    }
  }
</style>
