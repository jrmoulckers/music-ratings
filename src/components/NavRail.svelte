<script lang="ts">
  import { href, isActive, type Route } from '../lib/app/router';
  import { settings, suggestions } from '../lib/app/state';
  import { syncState } from '../lib/storage/autosync';
  import Icon from '../lib/ui/Icon.svelte';
  import type { IconName } from '../lib/ui/icons';
  import { openSearch } from '../lib/app/search-overlay';

  /**
   * The centre rail. On a wide screen it is the app's contents column; on a
   * narrow one it becomes the bottom bar, carrying the same five primary stops
   * so muscle memory survives the change of shape.
   */

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
    { path: '/compare', label: 'Compare', icon: 'versus', primary: true },
    { path: '/library', label: 'Library', icon: 'library', primary: true },
    { path: '/rankings', label: 'Rankings', icon: 'ranks', primary: true },
    { path: '/now-playing', label: 'Now Playing', icon: 'play', primary: false },
    { path: '/history', label: 'History', icon: 'timeline', primary: false },
    { path: '/insights', label: 'Insights', icon: 'lens', primary: false },
    { path: '/settings', label: 'Settings', icon: 'settings', primary: false },
  ];

  /**
   * On phones the bar can only hold so many stops, so the secondary ones move
   * into a sheet. Nothing becomes unreachable; it just takes one more tap.
   */
  let moreOpen = $state(false);
  const secondary = stops.filter((stop) => !stop.primary);
  const inSecondary = $derived(secondary.some((stop) => isActive(route, stop.path)));

  $effect(() => {
    void route;
    moreOpen = false;
  });

  const waiting = $derived($suggestions.length);

  const syncWord = $derived.by(() => {
    if (!online) return 'offline';
    if (!$settings.syncEnabled) return 'on this device';
    switch ($syncState.status) {
      case 'syncing':
        return 'syncing';
      case 'pending':
        return 'changes waiting';
      case 'conflict':
        return 'conflict';
      case 'error':
        return 'sync failed';
      case 'synced':
      case 'idle':
        return 'synced';
      default:
        return 'on this device';
    }
  });
</script>

<nav class="rail" aria-label="Sections">
  <a class="rail__mast" href={href('/')}>
    <span class="rail__wordmark">Music Ratings</span>
  </a>

  <button type="button" class="rail__search" onclick={() => openSearch()}>
    <Icon name="search" size={16} />
    <span class="rail__search-label">Search to rate</span>
    <span class="rail__search-short">Search</span>
    <kbd class="rail__key">/</kbd>
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
          <Icon name={stop.icon} size={17} />
          <span class="stop__label">{stop.label}</span>
          {#if stop.path === '/rate' && waiting > 0}
            <span class="stop__count figure" aria-label="{waiting} waiting">{waiting}</span>
          {/if}
        </a>
      </li>
    {/each}
  </ul>

  <button
    type="button"
    class="stop rail__more"
    class:is-current={inSecondary}
    aria-expanded={moreOpen}
    onclick={() => (moreOpen = !moreOpen)}
  >
    <Icon name="menu" size={17} />
    <span class="stop__label">More</span>
  </button>

  <a class="rail__state" href={href('/diagnostics')}>
    <Icon name={online ? ($settings.syncEnabled ? 'cloud' : 'home') : 'offline'} size={14} />
    <span class="label">{syncWord}</span>
  </a>
</nav>

{#if moreOpen}
  <button
    type="button"
    class="rail__scrim"
    aria-label="Close menu"
    onclick={() => (moreOpen = false)}
  ></button>
  <div class="rail__sheet">
    <ul>
      {#each secondary as stop (stop.path)}
        <li>
          <a
            class="sheet-stop"
            class:is-current={isActive(route, stop.path)}
            href={href(stop.path)}
            aria-current={isActive(route, stop.path) ? 'page' : undefined}
          >
            <Icon name={stop.icon} size={17} />
            {stop.label}
          </a>
        </li>
      {/each}
      <li>
        <a class="sheet-stop" href={href('/diagnostics')}>
          <Icon name={online ? ($settings.syncEnabled ? 'cloud' : 'home') : 'offline'} size={17} />
          Data health · {syncWord}
        </a>
      </li>
    </ul>
  </div>
{/if}

<style>
  .rail {
    position: sticky;
    top: 0;
    align-self: start;
    height: 100dvh;
    display: flex;
    flex-direction: column;
    gap: var(--s5);
    padding: var(--s5) var(--s4);
    border-right: var(--rule-weight) solid var(--border);
    background: var(--surface);
    z-index: var(--z-rail);
  }

  .rail__mast {
    display: flex;
    align-items: center;
    gap: var(--s2);
    text-decoration: none;
    color: var(--accent-ink);
  }
  .rail__wordmark {
    font-family: var(--display);
    font-size: 1.375rem;
    letter-spacing: -0.01em;
    color: var(--ink);
  }

  .rail__search-short {
    display: none;
  }

  .rail__stops {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
  }

  /* The secondary stops sit below a rule, the way a contents page separates
     front matter from the body. */
  .rail__stops li.is-secondary:first-of-type {
    margin-top: var(--s4);
    padding-top: var(--s3);
    border-top: var(--rule-weight) solid var(--border-faint);
  }

  .stop {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding: 0.45rem var(--s2);
    text-decoration: none;
    color: var(--ink-quiet);
    border-left: 2px solid transparent;
    transition:
      color var(--dur-1) var(--ease),
      background-color var(--dur-1) var(--ease);
  }
  .stop:hover {
    color: var(--ink);
    background: var(--surface-raised);
  }
  /* A served stop stays lit: the current section is inked, not tinted. */
  .stop.is-current {
    color: var(--ink);
    border-left-color: var(--accent);
  }

  .stop__label {
    font-family: var(--sans);
    font-size: 0.8125rem;
    font-weight: 500;
    letter-spacing: 0.01em;
  }
  .stop.is-current .stop__label {
    font-weight: 650;
  }

  .stop__count {
    margin-left: auto;
    font-size: 0.6875rem;
    font-variant-numeric: tabular-nums;
    color: var(--accent-ink);
  }

  .rail__state {
    display: flex;
    align-items: center;
    gap: var(--s2);
    padding-top: var(--s3);
    border-top: var(--rule-weight) solid var(--border-faint);
    text-decoration: none;
    color: var(--ink-faint);
  }
  .rail__state:hover {
    color: var(--ink);
  }

  /* Desktop keeps every stop in the rail, so the phone-only "More" tab and its
     sheet stay out of the way until the bar cannot hold everything. */
  .rail__more,
  .rail__scrim,
  .rail__sheet {
    display: none;
  }

  @media (max-width: 60rem) {
    .rail {
      position: fixed;
      inset: auto 0 0 0;
      height: auto;
      flex-direction: row;
      align-items: stretch;
      gap: 0;
      padding: 0;
      border-right: 0;
      border-top: var(--rule-weight) solid var(--border);
      padding-bottom: env(safe-area-inset-bottom);
    }
    .rail__mast,
    .rail__state,
    .rail__stops li.is-secondary {
      display: none;
    }
    .rail__stops {
      flex-direction: row;
      width: auto;
      gap: 0;
    }
    .rail__stops li {
      flex: 1;
    }
    /* Search is the way into anything not already queued, so it earns a tab of
       its own rather than hiding behind the overflow sheet. */
    .rail__search {
      flex: 1;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      margin: 0;
      padding: 0.5rem 0.25rem;
      border: 0;
      border-top: 2px solid transparent;
      border-radius: 0;
      background: none;
      min-height: 3.5rem;
      justify-content: center;
      text-align: center;
    }
    .rail__search-label {
      display: none;
    }
    .rail__search-short {
      display: block;
      font-size: 0.625rem;
      letter-spacing: 0.04em;
      color: var(--ink-quiet);
    }
    .rail__key {
      display: none;
    }
    .rail__more {
      display: flex;
      flex: 1;
      background: none;
      border: 0;
      border-top: 2px solid transparent;
      font: inherit;
      cursor: pointer;
      color: var(--ink-quiet);
    }
    .rail__more.is-current {
      color: var(--ink);
      border-top-color: var(--accent);
    }
    .stop {
      flex-direction: column;
      gap: 2px;
      padding: 0.5rem 0.25rem;
      border-left: 0;
      border-top: 2px solid transparent;
      justify-content: center;
      min-height: 3.5rem;
    }
    .stop.is-current {
      border-left-color: transparent;
      border-top-color: var(--accent);
    }
    .stop__label {
      font-size: 0.625rem;
      letter-spacing: 0.04em;
    }
    /* Clear of the icon rather than printed over it: the count is an
       annotation on the stop, not part of its symbol. */
    .stop__count {
      position: absolute;
      top: 0.3rem;
      left: 50%;
      margin: 0 0 0 0.55rem;
      padding: 0 0.15rem;
      background: var(--surface);
      font-size: 0.625rem;
      line-height: 1.2;
    }

    .rail__scrim {
      display: block;
      position: fixed;
      inset: 0;
      border: 0;
      background: var(--scrim);
      z-index: calc(var(--z-rail) - 1);
    }
    .rail__sheet {
      display: block;
      position: fixed;
      inset: auto 0 calc(3.5rem + env(safe-area-inset-bottom)) 0;
      background: var(--surface);
      border-top: var(--rule-weight) solid var(--border);
      z-index: var(--z-rail);
    }
    .sheet-stop {
      display: flex;
      align-items: center;
      gap: var(--s3);
      padding: var(--s4);
      color: var(--ink-dim);
      text-decoration: none;
      border-bottom: var(--rule-weight) solid var(--border-faint);
    }
    .sheet-stop.is-current {
      color: var(--ink);
      box-shadow: inset 2px 0 0 var(--accent);
    }
  }
</style>
