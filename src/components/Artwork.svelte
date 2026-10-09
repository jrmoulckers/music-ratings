<script lang="ts">
  import { settings } from '../lib/app/state';
  import { initials } from '../lib/ui/format';

  interface Props {
    src?: string | undefined;
    thumb?: string | undefined;
    name: string;
    size?: 'sm' | 'md' | 'lg';
    /** Loads eagerly for the one art above the fold. */
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

  let failedSource = $state<string>();
</script>

<div class="art art--{size}">
  {#if chosen && chosen !== failedSource}
    <img
      src={chosen}
      alt=""
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      onerror={() => (failedSource = chosen)}
    />
  {:else}
    <span class="art__empty" aria-hidden="true">
      <span class="art__initials">{initials(name)}</span>
    </span>
  {/if}
</div>

<style>
  .art__initials {
    font-family: var(--sans);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .art--lg .art__initials {
    font-size: 1.125rem;
  }
</style>
