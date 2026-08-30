<script lang="ts">
  import { href } from '../lib/app/router';
  import { openSearch } from '../lib/app/search-overlay';
  import { graph, settings, suggestions, world } from '../lib/app/state';
  import { TIER_JUST_PLAYED } from '../lib/domain/suggestions';
  import { clearQueueState } from '../lib/storage/repo';
  import { relative } from '../lib/ui/format';
  import Empty from '../components/Empty.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import RatePanel from '../components/RatePanel.svelte';

  /**
   * Rate.
   *
   * One item at a time, with the reasons it was chosen shown before the
   * controls. Things you actually played sit at the front of the queue and say
   * so; everything else is an inference and is labelled as one.
   */

  let cursor = $state(0);

  const rows = $derived(
    $suggestions.flatMap((suggestion) => {
      const entity = $graph.entity(suggestion.entityId);
      return entity ? [{ suggestion, entity }] : [];
    }),
  );

  const currentRow = $derived(rows[Math.min(cursor, Math.max(rows.length - 1, 0))]);
  const playedCount = $derived(
    $suggestions.filter((suggestion) => suggestion.tier === TIER_JUST_PLAYED).length,
  );

  const setAside = $derived(
    $world.queueStates
      .filter((q) => !q.deleted && q.kind !== 'pinned')
      .map((q) => ({ state: q, entity: $graph.entity(q.id) }))
      .filter((row) => row.entity)
      .slice(0, 24),
  );

  // A rating removes the item from the suggestion list, so the cursor stays put
  // and the next stop slides into place on its own.
  function afterAction() {
    cursor = 0;
  }
</script>

<div class="sheet">
  <header class="head">
    <h1 class="display">Rate</h1>
    <p class="label">
      {rows.length} waiting{playedCount > 0 ? ` · ${playedCount} you just played` : ''} · {$settings
        .enabledTypes.length} types enabled · {setAside.length} set aside
    </p>
  </header>

  {#if currentRow}
    <div class="queue__body">
      <div class="queue__panel">
        <RatePanel
          entity={currentRow.entity}
          suggestion={currentRow.suggestion}
          onafter={afterAction}
        />
      </div>

      {#if rows.length > 1}
        <section class="line" aria-labelledby="line-head">
          <h2 id="line-head" class="label">Up next</h2>
          <ol class="line__stops">
            <li class="line__seated">
              <span class="stop stop--seated">
                <span class="stop__cut" aria-hidden="true"></span>
                <span class="stop__name">{currentRow.entity.name}</span>
                <span class="label label--accent">Rating this now</span>
              </span>
            </li>
            {#each rows.slice(1, 9) as row, index (row.entity.id)}
              <li>
                <button type="button" class="stop" onclick={() => (cursor = index + 1)}>
                  <span class="stop__cut" aria-hidden="true"></span>
                  <span class="stop__name">{row.entity.name}</span>
                  <span class="note">{row.suggestion.reasons[0]?.detail ?? ''}</span>
                </button>
              </li>
            {/each}
          </ol>
          {#if rows.length > 9}
            <p class="line__tail label">{rows.length - 9} more waiting</p>
          {/if}
          <span class="line__cap" aria-hidden="true"></span>
        </section>
      {/if}
    </div>
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
              {row.state.kind}{row.state.until ? ` until ${relative(row.state.until)}` : ''}
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
  /* The stops behind the current one hang off the same accent rail. */

  /*
   * Twinned around the rail: the item being rated on one side, the queue
   * and everything still on it on the other, so the queue's first viewport
   * reads the same way the home screen does.
   */
  .queue__body {
    display: grid;
    gap: var(--s6);
    align-items: start;
  }
  @media (min-width: 76rem) {
    .queue__body {
      grid-template-columns: minmax(0, 1fr) minmax(18rem, 24rem);
      gap: 0;
    }
    .queue__panel {
      padding-right: var(--s6);
    }
    .line {
      margin-top: 0;
      align-self: stretch;
      height: 100%;
    }
  }

  .line {
    position: relative;
    display: flex;
    flex-direction: column;
    margin-top: var(--s6);
    padding-left: 1.6rem;
  }
  /* The rail, run the height of the pair and resolved at a mark. */
  .line::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 2px;
    background: var(--accent);
  }
  .line__cap {
    margin-top: auto;
    margin-left: -1.6rem;
    width: 0.85rem;
    height: 3px;
    background: var(--accent);
  }
  .line__stops {
    position: relative;
    display: flex;
    flex-direction: column;
    margin-top: var(--s2);
  }
  .line__tail {
    margin-top: var(--s2);
    color: var(--ink-faint);
  }

  .stop {
    position: relative;
    display: grid;
    grid-template-columns: 14rem minmax(0, 1fr);
    gap: var(--s3);
    align-items: baseline;
    width: 100%;
    text-align: left;
    padding: var(--s2) 0;
    background: transparent;
    border: 0;
    border-bottom: var(--rule-weight) solid var(--border-faint);
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .stop:hover {
    background: var(--surface-raised);
  }
  .stop--seated {
    cursor: default;
    border-bottom-color: var(--border);
  }
  .stop--seated .stop__name {
    font-weight: 600;
  }

  /* A detent cut across the rail, in line with the stop it belongs to. */
  .stop__cut {
    position: absolute;
    left: -1.6rem;
    top: 1.05rem;
    width: 1.6rem;
    height: var(--rule-weight);
    background: var(--accent);
    transform: scaleX(0.72);
    transform-origin: left center;
    transition: transform var(--dur-1) var(--ease);
  }
  .stop:hover .stop__cut,
  .stop--seated .stop__cut {
    transform: scaleX(1);
  }
  .stop--seated .stop__cut {
    height: 3px;
  }

  .stop__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stop .note {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  @media (max-width: 48rem) {
    .stop {
      grid-template-columns: minmax(0, 1fr);
    }
    .stop .note {
      display: none;
    }
    .stop--seated .label {
      font-size: 0.5625rem;
    }
  }

  /* In the narrow twin column the reason sits under the name, not beside it. */
  @media (min-width: 76rem) {
    .stop {
      grid-template-columns: minmax(0, 1fr);
      gap: 1px;
      align-items: start;
    }
    .stop .note {
      font-size: 0.8125rem;
    }
    .stop--seated .label {
      font-size: 0.5625rem;
    }
  }
</style>
