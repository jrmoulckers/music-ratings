<script lang="ts">
  import { onMount } from 'svelte';

  import { href, isActive, type Route } from '../lib/app/router';
  import { settings, suggestions } from '../lib/app/state';
  import { syncState } from '../lib/storage/autosync';
  import Icon from '../lib/ui/Icon.svelte';
  import type { IconName } from '../lib/ui/icons';
  import { openSearch } from '../lib/app/search-overlay';

  interface Props {
    route: Route;
    online: boolean;
  }

  let { route, online }: Props = $props();

  interface Stop {
    path: string;
    label: string;
    icon: IconName;
    primary: boolean;
  }

  const stops: Stop[] = [
    { path: '/', label: 'Home', icon: 'home', primary: true },
    { path: '/rate', label: 'Rate', icon: 'queue', primary: true },
    { path: '/library', label: 'Library', icon: 'library', primary: true },
    { path: '/compare', label: 'Compare', icon: 'versus', primary: false },
    { path: '/rankings', label: 'Rankings', icon: 'ranks', primary: false },
    { path: '/now-playing', label: 'Now playing', icon: 'play', primary: false },
    { path: '/history', label: 'History', icon: 'timeline', primary: false },
    { path: '/listening', label: 'Listening', icon: 'speaker', primary: false },
    { path: '/insights', label: 'Insights', icon: 'lens', primary: false },
    { path: '/settings', label: 'Settings', icon: 'settings', primary: false },
  ];

  let moreOpen = $state(false);
  let moreButton = $state<HTMLButtonElement>();
  let moreSheet = $state<HTMLDialogElement>();
  const secondary = stops.filter((stop) => !stop.primary);
  const inSecondary = $derived(secondary.some((stop) => isActive(route, stop.path)));
  const waiting = $derived($suggestions.length);

  $effect(() => {
    void route;
    moreSheet?.close();
    moreOpen = false;
  });

  onMount(() => {
    const mobile = matchMedia('(max-width: 60rem), (hover: none) and (pointer: coarse)');
    const onChange = () => {
      if (!mobile.matches) moreSheet?.close();
    };
    mobile.addEventListener('change', onChange);
    return () => mobile.removeEventListener('change', onChange);
  });

  function openMore() {
    moreSheet?.showModal();
    moreOpen = true;
  }

  function closeMore() {
    moreSheet?.close();
    moreButton?.focus();
  }

  const syncWord = $derived.by(() => {
    if (!online) return 'Offline';
    if (!$settings.syncEnabled) return 'Local only';
    switch ($syncState.status) {
      case 'syncing':
        return 'Syncing…';
      case 'pending':
        return 'Sync queued';
      case 'conflict':
        return 'Sync conflict';
      case 'error':
        return 'Sync failed';
      case 'offline':
        return 'Offline';
      case 'synced':
        return 'Synced';
      case 'idle':
        return 'Sync connected';
      default:
        return 'Local only';
    }
  });
  const syncWarning = $derived(
    online &&
      $settings.syncEnabled &&
      ($syncState.status === 'conflict' || $syncState.status === 'error'),
  );
  const statusIcon = $derived<IconName>(
    syncWarning
      ? 'warning'
      : !online || ($settings.syncEnabled && $syncState.status === 'offline')
        ? 'offline'
        : $settings.syncEnabled
          ? 'cloud'
          : 'device',
  );
</script>

<nav class="rail" aria-label="Main navigation">
  <a class="rail__mast" href={href('/')}>Music Ratings</a>

  <button type="button" class="rail__search" onclick={() => openSearch()}>
    <Icon name="search" size={18} />
    <span class="rail__search-label">Search</span>
    <kbd class="rail__key" aria-hidden="true">/</kbd>
  </button>

  <ul class="rail__stops">
    {#each stops as stop (stop.path)}
      <li class:is-secondary={!stop.primary}>
        <a
          class="stop"
          class:is-current={isActive(route, stop.path)}
          href={href(stop.path)}
          aria-current={isActive(route, stop.path) ? 'page' : undefined}
        >
          <Icon name={stop.icon} size={18} />
          <span class="stop__label">{stop.label}</span>
          {#if stop.path === '/rate' && waiting > 0}
            <span class="stop__count figure" aria-label="{waiting} queued">{waiting}</span>
          {/if}
        </a>
      </li>
    {/each}
  </ul>

  <button
    type="button"
    class="stop rail__more"
    class:is-current={inSecondary}
    bind:this={moreButton}
    aria-controls="more-sections"
    aria-expanded={moreOpen}
    aria-haspopup="dialog"
    onclick={openMore}
  >
    <Icon name="menu" size={18} />
    <span class="stop__label">More</span>
  </button>

  <a class="rail__state" class:is-warning={syncWarning} href={href('/diagnostics')}>
    <Icon name={statusIcon} size={16} />
    <span>{syncWord}</span>
    <span class="sr-only"> · Data health</span>
  </a>
</nav>

<dialog
  id="more-sections"
  class="rail__sheet"
  bind:this={moreSheet}
  aria-labelledby="more-sections-title"
  onclose={() => (moreOpen = false)}
  oncancel={(event) => {
    event.preventDefault();
    closeMore();
  }}
>
  <div class="rail__sheet-head">
    <h2 id="more-sections-title" class="subtitle">More</h2>
    <button type="button" class="btn btn--quiet" onclick={closeMore} aria-label="Close menu">
      <Icon name="close" size={18} />
    </button>
  </div>
  <ul>
    {#each secondary as stop (stop.path)}
      <li>
        <a
          class="sheet-stop"
          class:is-current={isActive(route, stop.path)}
          href={href(stop.path)}
          aria-current={isActive(route, stop.path) ? 'page' : undefined}
        >
          <Icon name={stop.icon} size={18} />
          {stop.label}
        </a>
      </li>
    {/each}
    <li>
      <a class="sheet-stop sheet-stop--status" href={href('/diagnostics')}>
        <Icon name={statusIcon} size={18} />
        Data health
        <span class="note">{syncWord}</span>
      </a>
    </li>
  </ul>
</dialog>

<style>
  .rail {
    position: sticky;
    top: 0;
    align-self: start;
    height: 100dvh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--s5);
    padding: var(--s5) var(--s3);
    border-right: var(--rule-weight) solid var(--border-faint);
    background: var(--surface);
    z-index: var(--z-rail);
  }

  .rail__mast {
    padding: var(--s2);
    text-decoration: none;
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  .rail__search {
    display: flex;
    align-items: center;
    gap: var(--s3);
    min-height: var(--target-min);
    padding: var(--s2) var(--s3);
    border: var(--rule-weight) solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-raised);
    color: var(--ink-quiet);
    font-size: 0.875rem;
    cursor: pointer;
  }

  .rail__search:hover {
    color: var(--ink);
    border-color: var(--ink-quiet);
  }

  .rail__key {
    margin-left: auto;
    font-family: var(--sans);
    color: var(--ink-faint);
  }

  .rail__stops {
    display: flex;
    flex-direction: column;
    gap: var(--s1);
    flex: 1;
  }

  .rail__stops li:not(.is-secondary) + li.is-secondary {
    margin-top: var(--s3);
  }

  .stop {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--s3);
    min-height: var(--target-min);
    padding: var(--s2) var(--s3);
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    text-decoration: none;
    color: var(--ink-quiet);
    transition:
      color var(--dur-1) var(--ease),
      background-color var(--dur-1) var(--ease);
  }

  .stop:hover {
    color: var(--ink);
    background: var(--surface-raised);
  }

  .stop.is-current {
    color: var(--ink);
    background: var(--surface-sunk);
  }

  .stop__label {
    font-size: 0.875rem;
    font-weight: 450;
  }

  .stop.is-current .stop__label {
    font-weight: 650;
  }

  .stop__count {
    margin-left: auto;
    font-size: 0.75rem;
    color: var(--ink-quiet);
  }

  .rail__state {
    display: flex;
    align-items: center;
    gap: var(--s2);
    min-height: var(--target-min);
    padding: var(--s2) var(--s3);
    text-decoration: none;
    color: var(--ink-quiet);
    font-size: 0.8125rem;
  }

  .rail__state:hover {
    color: var(--ink);
  }

  .rail__state.is-warning {
    color: var(--accent-ink);
  }

  .rail__more {
    display: none;
  }

  .rail__sheet {
    position: fixed;
    inset: auto 0 0;
    margin: 0;
    width: 100%;
    max-width: none;
    max-height: calc(100dvh - var(--s6));
    padding: var(--s3) var(--s4) calc(var(--s4) + env(safe-area-inset-bottom, 0px));
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--surface-raised);
    color: var(--ink);
    border: var(--rule-weight) solid var(--border);
    border-radius: var(--radius) var(--radius) 0 0;
  }

  .rail__sheet::backdrop {
    background: var(--scrim);
  }

  .rail__sheet-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--s2);
  }

  .sheet-stop {
    display: flex;
    align-items: center;
    gap: var(--s3);
    min-height: var(--target-min);
    padding: var(--s3);
    border-radius: var(--radius);
    color: var(--ink-quiet);
    text-decoration: none;
  }

  .sheet-stop:hover,
  .sheet-stop.is-current {
    background: var(--surface-sunk);
    color: var(--ink);
  }

  .sheet-stop.is-current {
    font-weight: 650;
  }

  .sheet-stop--status {
    margin-top: var(--s2);
  }

  .sheet-stop--status .note {
    margin-left: auto;
  }

  @media (max-width: 60rem), (hover: none) and (pointer: coarse) {
    .rail {
      position: fixed;
      inset: auto 0 0;
      height: var(--nav-h);
      flex-direction: row;
      align-items: stretch;
      gap: 0;
      padding: 0 0 env(safe-area-inset-bottom, 0px);
      border-right: 0;
      border-top: var(--rule-weight) solid var(--border);
      background: var(--surface-raised);
      overflow: visible;
    }

    .rail__mast,
    .rail__state,
    .rail__key,
    .rail__stops li.is-secondary {
      display: none;
    }

    .rail__stops {
      flex-direction: row;
      flex: 3 1 0;
      min-width: 0;
      gap: 0;
    }

    .rail__stops li {
      flex: 1;
      min-width: 0;
    }

    .rail__search,
    .rail__more {
      flex: 1 1 0;
      min-width: 0;
      cursor: pointer;
    }

    .rail__search,
    .stop {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: var(--s1);
      height: 100%;
      padding: var(--s2) var(--s1);
      border: 0;
      border-radius: 0;
      background: transparent;
    }

    .stop.is-current {
      background: var(--surface-sunk);
    }

    .rail__search-label,
    .stop__label {
      font-size: 0.75rem;
      line-height: 1.2;
    }

    .stop__count {
      position: absolute;
      top: var(--s1);
      left: calc(50% + 0.6rem);
      margin: 0;
      font-size: 0.625rem;
      line-height: 1.2;
    }
  }
</style>
