<script lang="ts">
  import { get } from 'svelte/store';

  import { entityHref, navigate } from '../lib/app/router';
  import {
    annotationsById,
    entityLabel,
    entityLabelCap,
    explicitRatings,
    graph,
    scaleForType,
    scores,
    settings,
  } from '../lib/app/state';
  import { buildRankedList, TIME_RANGES } from '../lib/domain/lists';
  import type { EntityType, ScoreView } from '../lib/domain/types';
  import Empty from '../components/Empty.svelte';
  import EntryRow from '../components/EntryRow.svelte';

  /**
   * Standings.
   *
   * Ties are shown as ties. A list that quietly breaks them by alphabet is
   * pretending to a precision the evidence does not support.
   */

  interface Props {
    query: URLSearchParams;
  }

  let { query }: Props = $props();

  let type = $state<EntityType>('album');
  let direction = $state<'top' | 'bottom'>('top');
  let view = $state<ScoreView>('blended');
  let rangeId = $state('all');
  let minCoverage = $state(0);
  let minComparisons = $state(0);
  let requireExplicit = $state(false);
  let tag = $state('');

  // As on the shelf: the address bar carries the list so it can be shared, and
  // `applied` keeps the URL and the controls from chasing each other.
  let applied = '';
  $effect(() => {
    const key = query.toString();
    if (key === applied) return;
    applied = key;
    type = (query.get('type') as EntityType | null) ?? 'album';
    direction = query.get('dir') === 'bottom' ? 'bottom' : 'top';
    view = (query.get('view') as ScoreView | null) ?? get(settings).scoreView;
    rangeId = query.get('range') ?? 'all';
  });

  const enabled = $derived($settings.enabledTypes);
  const range = $derived(TIME_RANGES.find((r) => r.id === rangeId) ?? TIME_RANGES[0]!);

  const allTags = $derived.by(() => {
    // Local scratch collection inside a derivation, not reactive state.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const set = new Set<string>();
    for (const annotation of $annotationsById.values()) {
      for (const t of annotation.tags ?? []) set.add(t);
    }
    return [...set].sort();
  });

  const list = $derived(
    buildRankedList(
      {
        graph: $graph,
        scores: $scores,
        explicit: $explicitRatings,
        annotations: $annotationsById,
      },
      {
        type,
        view,
        direction,
        withinMs: range.ms,
        minCoverage,
        minComparisons,
        requireExplicit,
        ...(tag ? { tags: [tag] } : {}),
        limit: 100,
      },
    ),
  );

  const scale = $derived($scaleForType(type));

  function syncUrl() {
    const params = new URLSearchParams({ type, dir: direction, view, range: rangeId });
    applied = params.toString();
    navigate(`/lists?${params}`, { replace: true });
  }
</script>

<div class="sheet setting">
  <div class="stack">
    <header class="head">
      <h1 class="display">{direction === 'top' ? 'Best' : 'Worst'} {entityLabel(type, true)}</h1>
      <p class="apparatus">
        {list.rows.length} shown · {list.considered} considered
      </p>
    </header>

    {#if list.rows.length > 0}
      <ol class="standings">
        {#each list.rows as row (row.entityId)}
          {@const entity = $graph.entity(row.entityId)}
          {#if entity}
            <li>
              <a class="standings__link" href={entityHref(row.entityId)}>
                <EntryRow
                  {entity}
                  breakdown={row.breakdown}
                  {view}
                  position={row.position}
                  tied={row.tied}
                />
              </a>
            </li>
          {/if}
        {/each}
      </ol>
    {:else}
      <Empty
        title="Nothing clears these filters"
        body="Every candidate was excluded. The counts below say why, so you can loosen the one that matters."
        reasons={list.dropped}
      />
    {/if}
  </div>

  <aside class="margin">
    <div class="stack stack--tight">
      <h2 class="apparatus">The list</h2>

      <label class="field">
        <span class="apparatus">Kind</span>
        <select class="select" bind:value={type} onchange={syncUrl}>
          {#each enabled as option (option)}
            <option value={option}>{entityLabelCap(option, true)}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span class="apparatus">End</span>
        <select class="select" bind:value={direction} onchange={syncUrl}>
          <option value="top">Best first</option>
          <option value="bottom">Worst first</option>
        </select>
      </label>

      <label class="field">
        <span class="apparatus">Score shown</span>
        <select class="select" bind:value={view} onchange={syncUrl}>
          <option value="blended">Blended</option>
          <option value="explicit">What you said</option>
          <option value="rollup">Computed</option>
        </select>
      </label>

      <label class="field">
        <span class="apparatus">Rated within</span>
        <select class="select" bind:value={rangeId} onchange={syncUrl}>
          {#each TIME_RANGES as option (option.id)}
            <option value={option.id}>{option.label}</option>
          {/each}
        </select>
      </label>
    </div>

    <div class="stack stack--tight">
      <h2 class="apparatus">Only count it if…</h2>

      <label class="field">
        <span class="apparatus">Coverage at least {Math.round(minCoverage * 100)}%</span>
        <input class="slider" type="range" min="0" max="1" step="0.05" bind:value={minCoverage} />
      </label>

      <label class="field">
        <span class="apparatus">Weigh-ins at least {minComparisons}</span>
        <input class="slider" type="range" min="0" max="20" step="1" bind:value={minComparisons} />
      </label>

      <label class="check">
        <input type="checkbox" bind:checked={requireExplicit} />
        <span>You rated it yourself</span>
      </label>

      {#if allTags.length > 0}
        <label class="field">
          <span class="apparatus">Tag</span>
          <select class="select" bind:value={tag}>
            <option value="">Any</option>
            {#each allTags as option (option)}
              <option value={option}>{option}</option>
            {/each}
          </select>
        </label>
      {/if}
    </div>

    {#if list.dropped.length > 0 && list.rows.length > 0}
      <div class="stack stack--tight">
        <h2 class="apparatus">Left out</h2>
        <dl class="dropped">
          {#each list.dropped as entry (entry.reason)}
            <div>
              <dt class="note">{entry.reason}</dt>
              <dd class="figure">{entry.count}</dd>
            </div>
          {/each}
        </dl>
      </div>
    {/if}

    <p class="note note--small">
      Places are decided on each score in full, so two rows can print the same rounded figure
      without being tied; a genuine tie is marked as one. Scores are shown on the {scale.label} scale,
      and computed ones keep a decimal so a close order stays readable.
    </p>
  </aside>
</div>

<style>
  .standings {
    display: flex;
    flex-direction: column;
  }
  .standings__link {
    display: block;
    text-decoration: none;
    color: inherit;
  }

  .dropped {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .dropped div {
    display: flex;
    justify-content: space-between;
    gap: var(--s3);
    border-bottom: var(--rule-weight) solid var(--rule-faint);
    padding: 2px 0;
  }
  .dropped dd {
    margin: 0;
    color: var(--ink-quiet);
  }
</style>
