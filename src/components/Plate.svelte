<script lang="ts">
  import { settings } from '../lib/app/state';
  import { initials } from '../lib/ui/format';

  /**
   * Artwork is tipped in like a plate in a printed book: bordered, never bled to
   * the edge, and never allowed to set the page's colour. When it is missing —
   * or when the reader has turned images off to save data — the plate prints the
   * item's initials instead of collapsing.
   */

  interface Props {
    src?: string | undefined;
    thumb?: string | undefined;
    name: string;
    size?: 'sm' | 'md' | 'lg';
    /** Loads eagerly for the one plate above the fold. */
    priority?: boolean;
  }

  let { src, thumb, name, size = 'sm', priority = false }: Props = $props();

  const preference = $derived($settings.artwork);
  const chosen = $derived(
    preference === 'none'
      ? undefined
      : preference === 'thumbnails'
        ? (thumb ?? src)
        : (src ?? thumb),
  );

  let failed = $state(false);
</script>

<div class="plate plate--{size}">
  {#if chosen && !failed}
    <img
      src={chosen}
      alt=""
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      onerror={() => (failed = true)}
    />
  {:else}
    <span class="plate__empty" aria-hidden="true">
      <span class="plate__initials">{initials(name)}</span>
    </span>
  {/if}
</div>

<style>
  .plate__initials {
    font-family: var(--sans);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.14em;
  }
  .plate--lg .plate__initials {
    font-size: 1.125rem;
  }
</style>
