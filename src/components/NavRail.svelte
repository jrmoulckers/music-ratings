<script lang="ts">
  import { href, isActive, type Route } from '../lib/app/router';
  import { settings, suggestions } from '../lib/app/state';
  import { syncState } from '../lib/storage/autosync';
  import Icon from '../lib/ui/Icon.svelte';
  import type { IconName } from '../lib/ui/icons';
  import RegisterMark from './RegisterMark.svelte';

  /**
   * The centre rail: the app's spine. On a wide screen it is a printed contents
   * column; on a narrow one it becomes the bottom bar, carrying the same five
   * primary stops so muscle memory survives the change of shape.
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
    { path: '/', label: 'Desk', icon: 'ledger', primary: true },
    { path: '/queue', label: 'Queue', icon: 'queue', primary: true },
    { path: '/duel', label: 'Weigh up', icon: 'balance', primary: true },
    { path: '/library', label: 'Shelf', icon: 'shelf', primary: true },
    { path: '/lists', label: 'Standings', icon: 'ranks', primary: true },
    { path: '/timeline', label: 'Record', icon: 'timeline', primary: false },
    { path: '/insights', label: 'Findings', icon: 'lens', primary: false },
    { path: '/settings', label: 'Settings', icon: 'settings', primary: false },
  ];

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
    <RegisterMark size={13} />
    <span class="rail__wordmark">Ledger</span>
  </a>

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
          {#if stop.path === '/queue' && waiting > 0}
            <span class="stop__count figure" aria-label="{waiting} waiting">{waiting}</span>
          {/if}
        </a>
      </li>
    {/each}
  </ul>

  <a class="rail__state" href={href('/diagnostics')}>
    <Icon name={online ? ($settings.syncEnabled ? 'cloud' : 'ledger') : 'offline'} size={14} />
    <span class="apparatus">{syncWord}</span>
  </a>
</nav>

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
    border-right: var(--rule-weight) solid var(--rule);
    background: var(--paper);
    z-index: var(--z-rail);
  }

  .rail__mast {
    display: flex;
    align-items: center;
    gap: var(--s2);
    text-decoration: none;
    color: var(--rubric-ink);
  }
  .rail__wordmark {
    font-family: var(--serif);
    font-size: 1.375rem;
    letter-spacing: -0.01em;
    color: var(--ink);
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
    border-top: var(--rule-weight) solid var(--rule-faint);
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
    background: var(--paper-raised);
  }
  /* A served stop stays lit: the current section is inked, not tinted. */
  .stop.is-current {
    color: var(--ink);
    border-left-color: var(--rubric);
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
    color: var(--rubric-ink);
  }

  .rail__state {
    display: flex;
    align-items: center;
    gap: var(--s2);
    padding-top: var(--s3);
    border-top: var(--rule-weight) solid var(--rule-faint);
    text-decoration: none;
    color: var(--ink-faint);
  }
  .rail__state:hover {
    color: var(--ink);
  }

  @media (max-width: 60rem) {
    .rail {
      position: fixed;
      inset: auto 0 0 0;
      height: auto;
      flex-direction: row;
      align-items: center;
      gap: 0;
      padding: 0;
      border-right: 0;
      border-top: var(--rule-weight) solid var(--rule);
      padding-bottom: env(safe-area-inset-bottom);
    }
    .rail__mast,
    .rail__state,
    .rail__stops li.is-secondary {
      display: none;
    }
    .rail__stops {
      flex-direction: row;
      width: 100%;
      gap: 0;
    }
    .rail__stops li {
      flex: 1;
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
      border-top-color: var(--rubric);
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
      background: var(--paper);
      font-size: 0.625rem;
      line-height: 1.2;
    }
  }
</style>
