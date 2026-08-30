<script lang="ts">
  import { entityHref, href } from '../lib/app/router';
  import {
    entityLabelCap,
    explicitRatings,
    graph,
    rankings,
    scores,
    settings,
    world,
  } from '../lib/app/state';
  import { selectPairs, type PairCandidate } from '../lib/domain/elo';
  import type { EntityType } from '../lib/domain/types';
  import { undoComparison } from '../lib/storage/repo';
  import { relative } from '../lib/ui/format';
  import ComparePanel from '../components/ComparePanel.svelte';
  import Empty from '../components/Empty.svelte';

  /**
   * Compare.
   *
   * Direct ratings tell you what you think of a thing on its own. This tells you
   * what you think of it next to something else, which is the only way an
   * ordering ever becomes honest.
   */

  const comparableTypes = $derived(
    $settings.enabledTypes.filter((type) => $graph.entitiesOfType(type).length >= 2),
  );

  let chosenType = $state<EntityType | null>(null);
  const type = $derived(chosenType ?? comparableTypes[0] ?? null);

  // The picker must show the type actually in play, not an empty slot.
  $effect(() => {
    if (chosenType === null && comparableTypes.length > 0) chosenType = comparableTypes[0]!;
  });

  const pair = $derived.by(() => {
    if (!type) return null;
    const candidates: PairCandidate[] = $graph.entitiesOfType(type).flatMap((entity) => {
      const breakdown = $scores.get(entity.id);
      const explicit = $explicitRatings.get(entity.id);
      const estimate = explicit?.normalized ?? breakdown?.rollup ?? null;
      // Something with no standing at all cannot be placed usefully yet.
      if (estimate === null) return [];
      const ranking = $rankings.get(type)?.get(entity.id);
      return [{ entityId: entity.id, estimate, ...(ranking ? { ranking } : {}) }];
    });
    const [selected] = selectPairs(candidates, $world.comparisons, { limit: 1 });
    if (!selected) return null;
    const a = $graph.entity(selected.aId);
    const b = $graph.entity(selected.bId);
    return a && b ? { a, b, reason: selected.reason } : null;
  });

  const history = $derived(
    [...$world.comparisons]
      .filter((c) => !c.deleted)
      .sort((x, y) => y.at - x.at)
      .slice(0, 12),
  );

  function outcomeLine(outcome: string, aName: string, bName: string): string {
    switch (outcome) {
      case 'a':
        return `${aName} over ${bName}`;
      case 'b':
        return `${bName} over ${aName}`;
      case 'tie':
        return `${aName} level with ${bName}`;
      case 'unfamiliar':
        return `Neither known: ${aName} / ${bName}`;
      default:
        return `Skipped: ${aName} / ${bName}`;
    }
  }
</script>

<div class="sheet">
  <header class="head">
    <h1 class="display">Compare</h1>
    {#if comparableTypes.length > 1}
      <label class="field field--inline">
        <span class="label">Comparing</span>
        <select class="select" bind:value={chosenType}>
          {#each comparableTypes as option (option)}
            <option value={option}>{entityLabelCap(option, true)}</option>
          {/each}
        </select>
      </label>
    {/if}
  </header>

  {#if pair}
    <ComparePanel a={pair.a} b={pair.b} reason={pair.reason} />
  {:else}
    <Empty
      title="Not enough to compare"
      body="A comparison needs two items of the same kind that already have some standing — either a rating of their own or a score computed from their contents. Rate a few things first and pairs will appear here."
    >
      {#snippet action()}
        <a class="btn btn--primary" href={href('/rate')}>Go to the queue</a>
      {/snippet}
    </Empty>
  {/if}

  {#if history.length > 0}
    <section class="record" aria-labelledby="record-head">
      <div class="head">
        <h2 id="record-head" class="title">What you decided</h2>
        <span class="label">last {history.length}</span>
      </div>
      <ul class="record__rows">
        {#each history as entry (entry.id)}
          {@const a = $graph.entity(entry.aId)}
          {@const b = $graph.entity(entry.bId)}
          <li>
            <span class="record__line">
              {#if a && b}
                <a href={entityHref(entry.aId)}>{a.name}</a>
                <span class="record__verb"
                  >{entry.outcome === 'tie'
                    ? 'level with'
                    : entry.outcome === 'a'
                      ? 'over'
                      : entry.outcome === 'b'
                        ? 'under'
                        : '/'}</span
                >
                <a href={entityHref(entry.bId)}>{b.name}</a>
              {:else}
                {outcomeLine(entry.outcome, a?.name ?? 'removed item', b?.name ?? 'removed item')}
              {/if}
            </span>
            <span class="label">{relative(entry.at)}</span>
            <button
              type="button"
              class="btn btn--small btn--quiet"
              onclick={() => void undoComparison(entry.id)}
            >
              Undo
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .record {
    margin-top: var(--s7);
  }
  .record__rows {
    display: flex;
    flex-direction: column;
  }
  .record__rows li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: var(--s3);
    align-items: baseline;
    padding: var(--s2) 0;
    border-bottom: var(--rule-weight) solid var(--border-faint);
  }
  .record__line {
    font-size: 0.9375rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .record__verb {
    color: var(--accent-ink);
    font-family: var(--sans);
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    padding: 0 0.25rem;
  }
</style>
