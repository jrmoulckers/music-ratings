<script lang="ts">
  import { entityHref } from '../lib/app/router';
  import {
    entityLabel,
    entityLabelCap,
    graph,
    scaleForType,
    settings,
    world,
  } from '../lib/app/state';
  import { formatScore } from '../lib/domain/ratings';
  import type { EntityType } from '../lib/domain/types';
  import { deleteRating, retractRating } from '../lib/storage/repo';
  import { dateAndTime, fullDate } from '../lib/ui/format';
  import Empty from '../components/Empty.svelte';

  /**
   * The record.
   *
   * Every rating, in the order it was made, grouped by day. Nothing is
   * silently rewritten: an amendment is a new entry, a withdrawal is struck
   * through rather than erased.
   */

  let typeFilter = $state<EntityType | 'all'>('all');
  let showRetracted = $state(false);
  let search = $state('');
  let limit = $state(120);

  const events = $derived.by(() => {
    const needle = search.trim().toLowerCase();
    return [...$world.ratings]
      .filter((event) => {
        if (event.deleted) return false;
        if (event.retracted && !showRetracted) return false;
        if (typeFilter !== 'all' && event.entityType !== typeFilter) return false;
        if (!needle) return true;
        const entity = $graph.entity(event.entityId);
        return (
          (entity?.name.toLowerCase().includes(needle) ?? false) ||
          (event.note?.toLowerCase().includes(needle) ?? false)
        );
      })
      .sort((a, b) => b.at - a.at);
  });

  const days = $derived.by(() => {
    // Local scratch collection inside a derivation, not reactive state.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const groups = new Map<string, typeof events>();
    for (const event of events.slice(0, limit)) {
      const key = fullDate(event.at);
      const bucket = groups.get(key);
      if (bucket) bucket.push(event);
      else groups.set(key, [event]);
    }
    return [...groups.entries()];
  });

  const swing = $derived.by(() => {
    // Mean rating this month against the twelve before it: the simplest honest
    // statement about whether you have got harsher or softer.
    const now = Date.now();
    const month = 30 * 86_400_000;
    const recent = events.filter((e) => e.at > now - month);
    const before = events.filter((e) => e.at <= now - month && e.at > now - 13 * month);
    if (recent.length < 5 || before.length < 5) return null;
    const mean = (list: typeof events) =>
      list.reduce((sum, e) => sum + e.normalized, 0) / list.length;
    return { recent: mean(recent), before: mean(before), n: recent.length };
  });
</script>

<div class="sheet setting">
  <div class="stack">
    <header class="head">
      <h1 class="display">History</h1>
      <p class="label">{events.length.toLocaleString()} entries</p>
    </header>

    {#if days.length > 0}
      <div class="record">
        {#each days as [day, entries] (day)}
          <section class="day">
            <h2 class="day__label label">{day}</h2>
            <ol class="day__entries">
              {#each entries as event (event.id)}
                {@const entity = $graph.entity(event.entityId)}
                <li class:is-retracted={event.retracted}>
                  <span class="entry__mark figure">
                    {formatScore(event.normalized, $scaleForType(event.entityType))}
                  </span>
                  <span class="entry__body">
                    {#if entity}
                      <a class="entry__name" href={entityHref(event.entityId)}>{entity.name}</a>
                    {:else}
                      <span class="entry__name entry__name--gone">
                        {event.entityId} — no longer in the catalogue
                      </span>
                    {/if}
                    <span class="label">
                      {entityLabel(event.entityType)} · {dateAndTime(event.at)}
                      {#if event.confidence && event.confidence !== 'medium'}
                        · {event.confidence} confidence
                      {/if}
                    </span>
                    {#if event.note}<span class="note">“{event.note}”</span>{/if}
                    {#if event.tags?.length}
                      <span class="label">{event.tags.join(' · ')}</span>
                    {/if}
                  </span>
                  <span class="entry__acts">
                    {#if !event.retracted}
                      <button
                        type="button"
                        class="btn btn--small btn--quiet"
                        onclick={() => void retractRating(event.id)}
                      >
                        Withdraw
                      </button>
                    {/if}
                    <button
                      type="button"
                      class="btn btn--small btn--quiet"
                      onclick={() => void deleteRating(event.id)}
                    >
                      Delete
                    </button>
                  </span>
                </li>
              {/each}
            </ol>
          </section>
        {/each}
      </div>

      {#if events.length > limit}
        <button type="button" class="btn btn--wide" onclick={() => (limit += 120)}>
          Show earlier entries
        </button>
      {/if}
    {:else}
      <Empty
        title="Nothing recorded yet"
        body="Ratings appear here the moment you make them, with the note and the context they were made in. Nothing is ever overwritten."
      />
    {/if}
  </div>

  <aside class="margin">
    <div class="stack stack--tight">
      <h2 class="label">Filter</h2>
      <label class="field">
        <span class="label">Kind</span>
        <select class="select" bind:value={typeFilter}>
          <option value="all">Everything</option>
          {#each $settings.enabledTypes as t (t)}
            <option value={t}>{entityLabelCap(t, true)}</option>
          {/each}
        </select>
      </label>
      <label class="field">
        <span class="label">Contains</span>
        <input class="input" type="search" bind:value={search} placeholder="Name or note" />
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={showRetracted} />
        <span>Include withdrawn</span>
      </label>
    </div>

    {#if swing}
      <div class="stack stack--tight">
        <h2 class="label">Drift</h2>
        <p class="note">
          Your average this month is {Math.round(swing.recent)} against {Math.round(swing.before)} over
          the year before it — {Math.abs(swing.recent - swing.before) < 3
            ? 'no real change'
            : swing.recent > swing.before
              ? 'you are marking more generously'
              : 'you are marking harder'}.
        </p>
        <p class="note note--small">
          Based on {swing.n} recent entries. Descriptive only.
        </p>
      </div>
    {/if}
  </aside>
</div>

<style>
  .record {
    display: flex;
    flex-direction: column;
    gap: var(--s5);
  }

  .day__label {
    padding-bottom: var(--s1);
    border-bottom: var(--rule-weight) solid var(--ink);
    color: var(--ink);
  }

  .day__entries {
    display: flex;
    flex-direction: column;
  }
  .day__entries li {
    display: grid;
    grid-template-columns: 3.5rem minmax(0, 1fr) auto;
    gap: var(--s3);
    align-items: baseline;
    padding: var(--s3) 0;
    border-bottom: var(--rule-weight) solid var(--border-faint);
  }
  .day__entries li.is-retracted .entry__mark,
  .day__entries li.is-retracted .entry__name {
    text-decoration: line-through;
    color: var(--ink-faint);
  }

  .entry__mark {
    color: var(--accent-ink);
    font-size: 1rem;
  }
  .entry__body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .entry__name {
    color: var(--ink);
    font-size: 0.9375rem;
  }
  .entry__name--gone {
    color: var(--ink-faint);
    font-family: var(--mono);
    font-size: 0.75rem;
  }
  .entry__acts {
    display: flex;
    gap: var(--s1);
  }

  @media (max-width: 48rem) {
    .day__entries li {
      grid-template-columns: 3rem minmax(0, 1fr);
    }
    .entry__acts {
      grid-column: 2;
    }
  }
</style>
