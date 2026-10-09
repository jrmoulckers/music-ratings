<script lang="ts">
  import SearchOverlay from '../components/SearchOverlay.svelte';
  import { route } from '../lib/app/router';
  import { openSearch, searchOpen } from '../lib/app/search-overlay';
  import Settings from '../pages/Settings.svelte';
</script>

<main id="main" tabindex="-1">
  {#if $route.name === 'settings'}
    <Settings />
  {:else}
    <button type="button" onclick={openSearch}>Find music</button>
  {/if}
</main>

{#if $searchOpen}
  <SearchOverlay />
{/if}
