<script lang="ts">
  import { href } from '../lib/app/router';
  import Empty from '../components/Empty.svelte';
</script>

<div class="sheet">
  <header class="head">
    <h1 class="display">No such page</h1>
  </header>
  <Empty
    title="That address does not lead anywhere here"
    body="The link may be from a newer version of the app, or simply mistyped. Nothing has been lost — your ratings are exactly where you left them."
  >
    {#snippet action()}
      <div class="row">
        <a class="btn btn--primary" href={href('/')}>Back to home</a>
        <a class="btn" href={href('/library')}>Browse your library</a>
      </div>
    {/snippet}
  </Empty>
</div>
