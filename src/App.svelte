<script lang="ts">
  import { onMount } from 'svelte';

  import { announcement } from './lib/app/notices';
  import { dismissUpdate, pwa, reloadForUpdate } from './lib/app/pwa';
  import { onboardingResumePath } from './lib/app/onboarding';
  import { navigate, route, startRouter } from './lib/app/router';
  import { closeSearch, openSearch, searchOpen } from './lib/app/search-overlay';
  import { bootFailure, ready, settings, startStateSync } from './lib/app/state';
  import { startSyncController } from './lib/app/sync';
  import { watchListening } from './lib/listening/watch';
  import NavRail from './components/NavRail.svelte';
  import MiniPlayer from './components/MiniPlayer.svelte';
  import Notices from './components/Notices.svelte';
  import SearchOverlay from './components/SearchOverlay.svelte';
  import Callback from './pages/Callback.svelte';
  import Compare from './pages/Compare.svelte';
  import Diagnostics from './pages/Diagnostics.svelte';
  import Entity from './pages/Entity.svelte';
  import History from './pages/History.svelte';
  import Home from './pages/Home.svelte';
  import Insights from './pages/Insights.svelte';
  import Library from './pages/Library.svelte';
  import Listening from './pages/Listening.svelte';
  import NotFound from './pages/NotFound.svelte';
  import NowPlaying from './pages/NowPlaying.svelte';
  import Onboarding from './pages/Onboarding.svelte';
  import Rankings from './pages/Rankings.svelte';
  import Rate from './pages/Rate.svelte';
  import Settings from './pages/Settings.svelte';

  let online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);

  onMount(() => {
    const stopRouter = startRouter();
    const stopState = startStateSync();
    const stopSync = startSyncController();
    const stopListening = watchListening();

    const up = () => (online = true);
    const down = () => (online = false);
    addEventListener('online', up);
    addEventListener('offline', down);

    return () => {
      stopRouter();
      stopState();
      stopSync();
      stopListening();
      removeEventListener('online', up);
      removeEventListener('offline', down);
    };
  });

  // Anyone who has not been through the front door gets sent there once —
  // to the step they had reached, not back to the beginning.
  $effect(() => {
    if (!$ready) return;
    const needsStart = !$settings.onboarded;
    const exempt = $route.name === 'onboarding' || $route.name === 'callback';
    if (needsStart && !exempt) navigate(onboardingResumePath(), { replace: true });
  });

  const showRail = $derived($route.name !== 'onboarding' && $route.name !== 'callback');

  // Search is reachable from anywhere: "/" the way a reader jumps to find, and
  // ctrl/cmd-K the way every other tool on the mono does it.
  function onKey(event: KeyboardEvent) {
    if (!showRail) return;
    const target = event.target as HTMLElement | null;
    const typing =
      !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
    if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if ($searchOpen) closeSearch();
      else openSearch();
      return;
    }
    if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      openSearch();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<a class="skip-link" href="#main">Skip to content</a>

<div class="shell" class:shell--bare={!showRail}>
  {#if showRail}
    <NavRail route={$route} {online} />
  {/if}

  <main id="main" tabindex="-1">
    {#if $bootFailure}
      <div class="booting booting--failed" role="alert">
        <p class="title">Your ratings could not be opened</p>
        <p class="note booting__why">{$bootFailure}</p>
        <button type="button" class="btn btn--small" onclick={() => location.reload()}>
          Try again
        </button>
      </div>
    {:else if !$ready}
      <div class="booting" role="status">
        <span class="label">Loading your ratings…</span>
      </div>
    {:else if $route.name === 'onboarding'}
      <Onboarding />
    {:else if $route.name === 'callback'}
      <Callback />
    {:else if $route.name === 'home'}
      <Home {online} />
    {:else if $route.name === 'rate'}
      <Rate />
    {:else if $route.name === 'compare'}
      <Compare />
    {:else if $route.name === 'library'}
      <Library query={$route.query} />
    {:else if $route.name === 'entity'}
      <Entity params={$route.params} />
    {:else if $route.name === 'rankings'}
      <Rankings query={$route.query} />
    {:else if $route.name === 'history'}
      <History />
    {:else if $route.name === 'insights'}
      <Insights />
    {:else if $route.name === 'listening'}
      <Listening />
    {:else if $route.name === 'now-playing'}
      <NowPlaying />
    {:else if $route.name === 'settings'}
      <Settings />
    {:else if $route.name === 'diagnostics'}
      <Diagnostics {online} />
    {:else}
      <NotFound />
    {/if}
  </main>
</div>

{#if showRail && $ready}
  <MiniPlayer />
{/if}

{#if showRail && $searchOpen}
  <SearchOverlay />
{/if}
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

  .booting--failed {
    display: grid;
    gap: var(--s3);
    justify-items: start;
    max-width: 46ch;
  }

  .booting__why {
    margin: 0;
  }

  .update {
    position: fixed;
    inset: auto var(--s5) calc(var(--s5) + var(--player-h, 0px)) auto;
    z-index: var(--z-toast);
    display: flex;
    align-items: center;
    gap: var(--s3);
    max-width: min(28rem, calc(100vw - 2rem));
    padding: var(--s3) var(--s4);
    background: var(--surface-raised);
    border: var(--rule-weight) solid var(--ink);
    box-shadow: 3px 3px 0 0 var(--surface-sunk);
  }
  .update__text {
    font-size: 0.875rem;
    line-height: 1.35;
  }

  @media (max-width: 60rem) {
    .update {
      inset: auto var(--s3) calc(4.75rem + var(--player-h, 0px)) var(--s3);
      max-width: none;
    }
  }
</style>
