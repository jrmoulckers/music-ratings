<script lang="ts">
  import { href } from '../lib/app/router';
  import Empty from '../components/Empty.svelte';
</script>

<div class="sheet">
  <header class="head">
    <h1 class="display">Page not found</h1>
  </header>
  <Empty
    title="This link is unavailable"
    body="Check the address or return to your library. Your ratings are unchanged."
  >
    {#snippet action()}
      <div class="row">
        <a class="btn btn--primary" href={href('/')}>Home</a>
        <a class="btn" href={href('/library')}>Library</a>
      </div>
    {/snippet}
  </Empty>
</div>
