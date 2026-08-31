<script lang="ts">
  import { get } from 'svelte/store';

  import { navigate } from '../lib/app/router';
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
  import { SCORE_VIEW_LABEL } from '../lib/domain/ratings';
  import { SCORE_VIEWS } from '../lib/domain/types';
  import type { EntityType, ScoreView } from '../lib/domain/types';
  import AutoLoad from '../components/AutoLoad.svelte';
  import Empty from '../components/Empty.svelte';
  import RatableRow from '../components/RatableRow.svelte';

  /**
   * Rankings.
   *
   * Ties are shown as ties. A list that quietly breaks them by alphabet is
   * pretending to a precision the evidence does not support.
   */

  interface Props {
    query: URLSearchParams;
  }

  let { query }: Props = $props();

  const PAGE = 40;

  let type = $state<EntityType>('album');
  let direction = $state<'top' | 'bottom'>('top');
  let view = $state<ScoreView>('blended');
  let rangeId = $state('all');
  let minCoverage = $state(0);
  let minComparisons = $state(0);
  let requireExplicit = $state(false);
  let tag = $state('');
  let limit = $state(PAGE);
  let openId = $state<string | null>(null);

  // As in the library: the address bar carries the list so it can be shared, and
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
        limit,
      },
    ),
  );

  const scale = $derived($scaleForType(type));

  // A different question starts at the top of its own answer.
  $effect(() => {
    void type;
    void direction;
    void view;
    void rangeId;
    void minCoverage;
    void minComparisons;
    void requireExplicit;
    void tag;
    limit = PAGE;
  });

  /**
   * The kind and the direction are filter state, not the identity of the page,
   * so they live in the query string and the page stays `/rankings`.
   */
  function syncUrl() {
    const params = new URLSearchParams({ type, dir: direction, view, range: rangeId });
    applied = params.toString();
    navigate(`/rankings?${params}`, { replace: true });
  }
</script>

<div class="sheet setting">
  <div class="stack">
    <header class="head">
      <h1 class="display">Rankings</h1>
      <div class="head__meta">
        <h2 class="label">{direction === 'top' ? 'Best' : 'Worst'} {entityLabel(type, true)}</h2>
        <p class="label head__count">
          {list.rows.length} shown · {list.considered} considered
        </p>
      </div>
    </header>

    {#if list.rows.length > 0}
      <ol class="ranks">
        {#each list.rows as row (row.entityId)}
          {@const entity = $graph.entity(row.entityId)}
          {#if entity}
            <RatableRow
              {entity}
              {view}
              position={row.position}
              tied={row.tied}
              expanded={openId === row.entityId}
              ontoggle={() => (openId = openId === row.entityId ? null : row.entityId)}
            />
          {/if}
        {/each}
      </ol>

      <AutoLoad
        hasMore={list.rows.length >= limit && list.considered > limit}
        count={list.rows.length}
        noun="ranked entries"
        onload={() => (limit += PAGE)}
      />
    {:else}
      <Empty
        title="Nothing to show"
        body="Every candidate was filtered out. The counts below say why, so you can relax the filter that is doing it."
        reasons={list.dropped}
      />
    {/if}
  </div>

  <aside class="margin">
    <div class="stack stack--tight">
      <h2 class="label">What to show</h2>

      <label class="field">
        <span class="label">Kind</span>
        <select class="select" bind:value={type} onchange={syncUrl}>
          {#each enabled as option (option)}
            <option value={option}>{entityLabelCap(option, true)}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span class="label">Order</span>
        <select class="select" bind:value={direction} onchange={syncUrl}>
          <option value="top">Best first</option>
          <option value="bottom">Worst first</option>
        </select>
      </label>

      <label class="field">
        <span class="label">Score shown</span>
        <select class="select" bind:value={view} onchange={syncUrl}>
          {#each SCORE_VIEWS as option (option)}
            <option value={option}>{SCORE_VIEW_LABEL[option]}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span class="label">Time range</span>
        <select class="select" bind:value={rangeId} onchange={syncUrl}>
          {#each TIME_RANGES as option (option.id)}
            <option value={option.id}>{option.label}</option>
          {/each}
        </select>
      </label>
    </div>

    <div class="stack stack--tight">
      <h2 class="label">Requirements</h2>

      <label class="field">
        <span class="label">Coverage at least {Math.round(minCoverage * 100)}%</span>
        <input class="slider" type="range" min="0" max="1" step="0.05" bind:value={minCoverage} />
      </label>

      <label class="field">
        <span class="label">Comparisons at least {minComparisons}</span>
        <input class="slider" type="range" min="0" max="20" step="1" bind:value={minComparisons} />
      </label>

      <label class="check">
        <input type="checkbox" bind:checked={requireExplicit} />
        <span>Only things you rated yourself</span>
      </label>

      {#if allTags.length > 0}
        <label class="field">
          <span class="label">Tag</span>
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
        <h2 class="label">Not shown</h2>
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
      Positions use the full score, so two rows can show the same rounded number without being tied.
      A real tie is marked as one. Scores use the {scale.label} scale, and computed scores keep a decimal
      so a close order stays readable.
    </p>
  </aside>
</div>

<style>
  /* The page is always "Rankings"; which slice you are looking at is filter
     state, so it reads as a quiet second line rather than a second title. */
  .head__meta {
    display: flex;
    align-items: baseline;
    gap: var(--s3);
    flex-wrap: wrap;
  }
  .head__meta h2 {
    color: var(--ink);
  }
  .head__count {
    color: var(--ink-quiet);
  }

  .ranks {
    display: flex;
    flex-direction: column;
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
    border-bottom: var(--rule-weight) solid var(--border-faint);
    padding: 2px 0;
  }
  .dropped dd {
    margin: 0;
    color: var(--ink-quiet);
  }
</style>
