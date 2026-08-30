<script lang="ts">
  import { onMount } from 'svelte';

  import { announcement } from './lib/app/notices';
  import { dismissUpdate, pwa, reloadForUpdate } from './lib/app/pwa';
  import { navigate, route, startRouter } from './lib/app/router';
  import { ready, settings, startStateSync } from './lib/app/state';
  import { startSyncController } from './lib/app/sync';
  import NavRail from './components/NavRail.svelte';
  import Notices from './components/Notices.svelte';
  import Callback from './pages/Callback.svelte';
  import Diagnostics from './pages/Diagnostics.svelte';
  import Duel from './pages/Duel.svelte';
  import Entity from './pages/Entity.svelte';
  import Home from './pages/Home.svelte';
  import Insights from './pages/Insights.svelte';
  import Library from './pages/Library.svelte';
  import Lists from './pages/Lists.svelte';
  import NotFound from './pages/NotFound.svelte';
  import Onboarding from './pages/Onboarding.svelte';
  import Queue from './pages/Queue.svelte';
  import Settings from './pages/Settings.svelte';
  import Timeline from './pages/Timeline.svelte';

  let online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);

  onMount(() => {
    const stopRouter = startRouter();
    const stopState = startStateSync();
    const stopSync = startSyncController();

    const up = () => (online = true);
    const down = () => (online = false);
    addEventListener('online', up);
    addEventListener('offline', down);

    return () => {
      stopRouter();
      stopState();
      stopSync();
      removeEventListener('online', up);
      removeEventListener('offline', down);
    };
  });

  // Anyone who has not been through the front door gets sent there once.
  $effect(() => {
    if (!$ready) return;
    const needsStart = !$settings.onboarded;
    const exempt = $route.name === 'onboarding' || $route.name === 'callback';
    if (needsStart && !exempt) navigate('/start', { replace: true });
  });

  const showRail = $derived($route.name !== 'onboarding' && $route.name !== 'callback');
</script>

<a class="skip-link" href="#main">Skip to content</a>

<div class="shell" class:shell--bare={!showRail}>
  {#if showRail}
    <NavRail route={$route} {online} />
  {/if}

  <main id="main" tabindex="-1">
    {#if !$ready}
      <div class="booting" role="status">
        <span class="apparatus">Opening the ledger…</span>
      </div>
    {:else if $route.name === 'onboarding'}
      <Onboarding />
    {:else if $route.name === 'callback'}
      <Callback />
    {:else if $route.name === 'home'}
      <Home {online} />
    {:else if $route.name === 'queue'}
      <Queue />
    {:else if $route.name === 'duel'}
      <Duel />
    {:else if $route.name === 'library'}
      <Library query={$route.query} />
    {:else if $route.name === 'entity'}
      <Entity params={$route.params} />
    {:else if $route.name === 'lists'}
      <Lists query={$route.query} />
    {:else if $route.name === 'timeline'}
      <Timeline />
    {:else if $route.name === 'insights'}
      <Insights />
    {:else if $route.name === 'settings'}
      <Settings />
    {:else if $route.name === 'diagnostics'}
      <Diagnostics {online} />
    {:else}
      <NotFound />
    {/if}
  </main>
</div>

{#if $pwa.updateReady}
  <div class="update" role="status">
    <p class="update__text">A newer version is ready. Reloading keeps everything you have saved.</p>
    <button
      type="button"
      class="btn btn--small btn--primary"
      onclick={() => void reloadForUpdate()}
    >
      Reload
    </button>
    <button type="button" class="btn btn--small btn--quiet" onclick={dismissUpdate}>Later</button>
  </div>
{/if}

<Notices />

<!-- One polite region for the whole app; every screen speaks through it. -->
<div class="sr-only" aria-live="polite" aria-atomic="true">{$announcement}</div>

<style>
  .shell--bare {
    grid-template-columns: minmax(0, 1fr);
    padding-bottom: 0;
  }

  .booting {
    padding: var(--s7) var(--s5);
  }

  .update {
    position: fixed;
    inset: auto var(--s5) var(--s5) auto;
    z-index: var(--z-toast);
    display: flex;
    align-items: center;
    gap: var(--s3);
    max-width: min(28rem, calc(100vw - 2rem));
    padding: var(--s3) var(--s4);
    background: var(--paper-raised);
    border: var(--rule-weight) solid var(--ink);
    box-shadow: 3px 3px 0 0 var(--paper-sunk);
  }
  .update__text {
    font-size: 0.875rem;
    line-height: 1.35;
  }

  @media (max-width: 60rem) {
    .update {
      inset: auto var(--s3) 4.75rem var(--s3);
      max-width: none;
    }
  }
</style>
