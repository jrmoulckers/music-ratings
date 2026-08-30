<script lang="ts">
  import { settings } from '../lib/app/state';

  /**
   * Provenance, stated where the work happens.
   *
   * The specimen catalogue is real data in the real database, so nothing in the
   * interface can tell you it is invented. This line does, and it stays put
   * rather than appearing once at onboarding and then never again.
   */

  interface Props {
    /** Shorter form, for pages that already carry a lot of apparatus. */
    terse?: boolean;
  }

  let { terse = false }: Props = $props();
</script>

{#if $settings.demoMode}
  <p class="stamp apparatus">
    <span class="stamp__mark apparatus--rubric">Specimen catalogue</span>
    <span class="stamp__body">
      {#if terse}
        Invented artists and releases. Nothing here comes from Spotify.
      {:else}
        Invented artists, releases and plays. Nothing here comes from Spotify. Your judgements are
        kept when you clear it, in Settings.
      {/if}
    </span>
  </p>
{/if}

<style>
  .stamp {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s1) var(--s3);
    align-items: baseline;
    padding: var(--s2) var(--s3);
    border: var(--rule-weight) solid var(--rule);
    background: var(--paper-sunk);
    text-transform: none;
    letter-spacing: 0.02em;
    color: var(--ink-quiet);
  }
  .stamp__mark {
    white-space: nowrap;
  }
  .stamp__body {
    min-width: 0;
  }
</style>
