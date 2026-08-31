<script lang="ts">
  import { href } from '../lib/app/router';
  import { openSearch } from '../lib/app/search-overlay';
  import { graph, signalsReadAt, suggestions, world } from '../lib/app/state';
  import { TIER_JUST_PLAYED } from '../lib/domain/suggestions';
  import type { EntityType } from '../lib/domain/types';
  import {
    listeningStatus,
    noteListeningFetchedAt,
    refreshListening,
    refreshListeningIfStale,
    spotifySession,
  } from '../lib/spotify/session';
  import { clearQueueState } from '../lib/storage/repo';
  import { plural, relative } from '../lib/ui/format';
  import Empty from '../components/Empty.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import QueueItem from '../components/QueueItem.svelte';

  /**
   * Rate.
   *
   * A queue you work down, not a turnstile that shows one thing at a time. What
   * you actually played comes first and in the order you played it, every line
   * says why it is there, and opening one to rate it never moves the page under
   * you.
   */

  const PAGE = 20;

  let filter = $state<'all' | 'played'>('all');
  let typeFilter = $state<EntityType | 'any'>('any');
  let shown = $state(PAGE);
  let openId = $state<string | null>(null);

  const rows = $derived(
    $suggestions.flatMap((suggestion) => {
      const entity = $graph.entity(suggestion.entityId);
      return entity ? [{ suggestion, entity }] : [];
    }),
  );

  const playedCount = $derived(rows.filter((r) => r.suggestion.tier === TIER_JUST_PLAYED).length);
  const presentTypes = $derived([...new Set(rows.map((row) => row.entity.type))]);

  const filtered = $derived(
    rows.filter(
      (row) =>
        (filter === 'all' || row.suggestion.tier === TIER_JUST_PLAYED) &&
        (typeFilter === 'any' || row.entity.type === typeFilter),
    ),
  );
  const visible = $derived(filtered.slice(0, shown));

  const setAside = $derived(
    $world.queueStates
      .filter((q) => !q.deleted && q.kind !== 'pinned')
      .map((q) => ({ state: q, entity: $graph.entity(q.id) }))
      .filter((row) => row.entity)
      .slice(0, 24),
  );

  const listening = $derived($listeningStatus);
  const freshness = $derived(
    listening.running
      ? 'Reading what you have been playing…'
      : listening.error
        ? listening.error
        : listening.fetchedAt
          ? `Listening read ${relative(listening.fetchedAt)}. Spotify reports only your latest 50 plays.`
          : 'Spotify reports only your latest 50 plays.',
  );

  // Opening the queue is the moment its answer has to be current. The stored
  // queue renders first and re-sorts itself when the fresher one lands.
  $effect(() => {
    refreshListeningIfStale();
  });

  $effect(() => {
    noteListeningFetchedAt($signalsReadAt.listening);
  });

  // Changing the filter is a different question, so it starts at the top again.
  // Rating or dismissing is not: the row leaves and the page holds still.
  $effect(() => {
    void filter;
    void typeFilter;
    shown = PAGE;
  });

  function afterAction(id: string) {
    if (openId === id) openId = null;
  }
</script>

<div class="sheet">
  <header class="head">
    <h1 class="display">Rate</h1>
    <p class="label">
      {plural(filtered.length, 'item')} waiting{playedCount > 0
        ? ` · ${playedCount} you just played`
        : ''}{setAside.length > 0 ? ` · ${setAside.length} set aside` : ''}
    </p>
  </header>

  <div class="controls">
    <div class="controls__filters">
      <div class="seg" role="group" aria-label="Which suggestions to show">
        <button
          type="button"
          class="btn btn--small"
          class:is-on={filter === 'all'}
          aria-pressed={filter === 'all'}
          onclick={() => (filter = 'all')}
        >
          Everything ({rows.length})
        </button>
        <button
          type="button"
          class="btn btn--small"
          class:is-on={filter === 'played'}
          aria-pressed={filter === 'played'}
          onclick={() => (filter = 'played')}
        >
          Recently played ({playedCount})
        </button>
      </div>

      {#if presentTypes.length > 1}
        <label class="inline-field">
          <span class="label">Kind</span>
          <select class="select" bind:value={typeFilter}>
            <option value="any">Any kind</option>
            {#each presentTypes as type (type)}
              <option value={type}>{type}</option>
            {/each}
          </select>
        </label>
      {/if}
    </div>

    {#if $spotifySession.connected}
      <button
        type="button"
        class="btn btn--small"
        disabled={listening.running}
        onclick={() => void refreshListening()}
      >
        <Icon name="refresh" size={13} />
        {listening.running ? 'Refreshing…' : 'Refresh listening'}
      </button>
    {/if}
  </div>

  <p class="freshness note" class:is-warn={Boolean(listening.error)} aria-live="polite">
    {freshness}
  </p>

  {#if filtered.length > 0}
    <ol class="queue">
      {#each visible as row (row.entity.id)}
        <QueueItem
          entity={row.entity}
          suggestion={row.suggestion}
          expanded={openId === row.entity.id}
          ontoggle={() => (openId = openId === row.entity.id ? null : row.entity.id)}
          onafter={() => afterAction(row.entity.id)}
        />
      {/each}
      <span class="queue__cap" aria-hidden="true"></span>
    </ol>

    {#if filtered.length > visible.length}
      <div class="queue__more">
        <button type="button" class="btn" onclick={() => (shown += PAGE)}>
          Show {Math.min(PAGE, filtered.length - visible.length)} more
        </button>
        <span class="label">{filtered.length - visible.length} still waiting</span>
      </div>
    {/if}
  {:else if rows.length > 0}
    <Empty
      title="Nothing matches this filter"
      body="The queue has {plural(
        rows.length,
        'item',
      )} in it, but none of them are what you are looking at right now."
    >
      {#snippet action()}
        <button
          type="button"
          class="btn btn--primary"
          onclick={() => {
            filter = 'all';
            typeFilter = 'any';
          }}
        >
          Show everything
        </button>
      {/snippet}
    </Empty>
  {:else}
    <Empty
      title="Nothing waiting to be rated"
      body="Either everything you have enabled was rated recently, or there is nothing in your library yet. You can always search for something specific, or compare two things you have already rated."
    >
      {#snippet action()}
        <div class="row">
          <button type="button" class="btn btn--primary" onclick={() => openSearch()}>
            <Icon name="search" size={14} /> Search for something to rate
          </button>
          <a class="btn" href={href('/compare')}>Compare two</a>
          <a class="btn" href={href('/library')}>Browse your library</a>
        </div>
      {/snippet}
    </Empty>
  {/if}

  {#if setAside.length > 0}
    <section class="aside" aria-labelledby="aside-head">
      <div class="head">
        <h2 id="aside-head" class="title">Set aside</h2>
        <span class="label">{setAside.length}</span>
      </div>
      <ul class="aside__rows">
        {#each setAside as row (row.state.id)}
          <li>
            <span class="aside__name">{row.entity?.name}</span>
            <span class="label">
              {row.state.kind === 'skipped'
                ? `skipped ${relative(row.state.at)}, back after six hours`
                : row.state.kind}{row.state.until ? ` until ${relative(row.state.until)}` : ''}
            </span>
            <button
              type="button"
              class="btn btn--small btn--quiet"
              onclick={() => void clearQueueState(row.state.id)}
            >
              Put it back
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s3) var(--s5);
    align-items: flex-end;
    justify-content: space-between;
    margin-top: var(--s5);
  }
  .controls__filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s3) var(--s5);
    align-items: center;
  }
  .seg {
    display: flex;
    gap: var(--s2);
  }
  .seg .btn.is-on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .inline-field {
    display: flex;
    align-items: center;
    gap: var(--s2);
  }

  .freshness {
    margin-top: var(--s3);
    color: var(--ink-faint);
  }
  .freshness.is-warn {
    color: var(--ink);
  }

  /*
   * The queue hangs off one rail the whole length of the page — the same
   * detented spine the old sidebar used, promoted to the page's own structure
   * so the list is the work rather than an index beside it.
   */
  .queue {
    position: relative;
    display: flex;
    flex-direction: column;
    --rail-inset: 1.6rem;
    margin-top: var(--s5);
    padding-left: var(--rail-inset);
  }
  .queue::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 2px;
    background: var(--accent);
  }
  .queue__cap {
    margin-left: calc(var(--rail-inset) * -1);
    width: 0.85rem;
    height: 3px;
    background: var(--accent);
  }

  .queue__more {
    display: flex;
    align-items: center;
    gap: var(--s4);
    margin-top: var(--s4);
    padding-left: 1.6rem;
  }

  .aside {
    margin-top: var(--s7);
  }
  .aside__rows {
    display: flex;
    flex-direction: column;
  }
  .aside__rows li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: var(--s3);
    align-items: center;
    padding: var(--s2) 0;
    border-bottom: var(--rule-weight) solid var(--border-faint);
  }
  .aside__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.9375rem;
  }

  @media (max-width: 52rem) {
    .controls {
      align-items: stretch;
    }
    .queue {
      --rail-inset: 1rem;
    }
    .queue__more {
      padding-left: 1rem;
    }
  }
</style>
