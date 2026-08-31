<script lang="ts">
  import { navigate } from '../lib/app/router';
  import { entityLabelCap, graph, scaleForType, scores, settings } from '../lib/app/state';
  import { ENTITY_TYPES, type EntityType } from '../lib/domain/types';
  import { autofocus } from '../lib/ui/actions';
  import Icon from '../lib/ui/Icon.svelte';
  import AutoLoad from '../components/AutoLoad.svelte';
  import Empty from '../components/Empty.svelte';
  import RatableRow from '../components/RatableRow.svelte';
  import SpotifySearch from '../components/SpotifySearch.svelte';

  /**
   * Library.
   *
   * Everything in your library, searchable and filterable, with a way to
   * reach past it into Spotify's catalogue for something not here yet.
   */

  interface Props {
    query: URLSearchParams;
  }

  let { query }: Props = $props();

  let term = $state('');
  let typeFilter = $state<EntityType | 'all'>('all');
  let ratedOnly = $state(false);
  let limit = $state(60);
  let openId = $state<string | null>(null);

  // The address bar is the shareable copy of these filters. It seeds them on
  // arrival and follows them afterwards; `applied` stops the two from chasing
  // each other in a circle.
  let applied = '';
  $effect(() => {
    const key = query.toString();
    if (key === applied) return;
    applied = key;
    term = query.get('q') ?? '';
    typeFilter = (query.get('type') as EntityType | null) ?? 'all';
    ratedOnly = query.get('rated') === '1';
  });

  const enabled = $derived(ENTITY_TYPES.filter((t) => $settings.enabledTypes.includes(t)));

  const results = $derived.by(() => {
    const needle = term.trim().toLowerCase();
    const pool =
      typeFilter === 'all'
        ? enabled.flatMap((t) => $graph.entitiesOfType(t))
        : $graph.entitiesOfType(typeFilter);

    const matched = pool.filter((entity) => {
      if (!$settings.showExplicitContent && entity.explicitContent) return false;
      if (ratedOnly && $scores.get(entity.id)?.explicit === null) return false;
      if (!needle) return true;
      return (
        entity.name.toLowerCase().includes(needle) ||
        (entity.subtitle?.toLowerCase().includes(needle) ?? false)
      );
    });

    matched.sort((a, b) => {
      const sa = $scores.get(a.id)?.blended ?? -1;
      const sb = $scores.get(b.id)?.blended ?? -1;
      if (sa !== sb) return sb - sa;
      return a.name.localeCompare(b.name);
    });
    return matched;
  });

  // Keeps the address bar in step so a search can be shared or bookmarked.
  function syncUrl() {
    // Local scratch value, thrown away after the URL is written.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const params = new URLSearchParams();
    if (term.trim()) params.set('q', term.trim());
    if (typeFilter !== 'all') params.set('type', typeFilter);
    if (ratedOnly) params.set('rated', '1');
    applied = params.toString();
    navigate(`/library${params.size ? `?${params}` : ''}`, { replace: true });
  }
</script>

<div class="sheet">
  <header class="head">
    <h1 class="display">Library</h1>
    <p class="label">
      {results.length.toLocaleString()} of {$graph.allEntities().length.toLocaleString()}
    </p>
  </header>

  <div class="filters">
    <label class="field field--grow">
      <span class="sr-only">Search your library</span>
      <span class="search">
        <Icon name="search" size={15} />
        <input
          class="input"
          type="search"
          bind:value={term}
          oninput={syncUrl}
          placeholder="Search your library"
          use:autofocus
        />
      </span>
    </label>

    <label class="field field--inline">
      <span class="label">Kind</span>
      <select class="select" bind:value={typeFilter} onchange={syncUrl}>
        <option value="all">Everything</option>
        {#each enabled as t (t)}
          <option value={t}>{entityLabelCap(t, true)}</option>
        {/each}
      </select>
    </label>

    <label class="check check--inline">
      <input type="checkbox" bind:checked={ratedOnly} onchange={syncUrl} />
      <span>Rated only</span>
    </label>
  </div>

  {#if results.length > 0}
    <ul class="library">
      {#each results.slice(0, limit) as entity (entity.id)}
        <RatableRow
          {entity}
          expanded={openId === entity.id}
          ontoggle={() => (openId = openId === entity.id ? null : entity.id)}
        />
      {/each}
    </ul>
    <AutoLoad
      hasMore={results.length > limit}
      count={Math.min(limit, results.length)}
      noun="entries"
      onload={() => (limit += 60)}
    />
  {:else}
    <Empty
      title={term ? `Nothing here matches “${term}”` : 'Your library is empty'}
      body={term
        ? 'Nothing in your library matches. Searching Spotify below reaches the wider catalogue and adds what you pick.'
        : 'Load the demo catalogue or connect Spotify from Settings, or search Spotify below to add something specific.'}
    />
  {/if}

  <SpotifySearch initialTerm={term} />

  <p class="scale-note note note--small">
    Scores use the {$scaleForType('track').label} scale where a scale is shown. Blended, computed and
    explicit views are switched in Settings.
  </p>
</div>

<style>
  .filters {
    display: flex;
    gap: var(--s4);
    align-items: flex-end;
    flex-wrap: wrap;
    padding-bottom: var(--s4);
    border-bottom: var(--rule-weight) solid var(--border);
    margin-bottom: var(--s4);
  }

  .search {
    display: flex;
    align-items: center;
    gap: var(--s2);
    border-bottom: 2px solid var(--ink);
    padding-bottom: 2px;
    color: var(--ink-quiet);
  }
  .search :global(input) {
    border: 0;
    background: transparent;
    padding: var(--s2) 0;
  }
  .search :global(input:focus) {
    outline: none;
  }
  .search:focus-within {
    border-bottom-color: var(--accent);
    color: var(--accent-ink);
  }

  .library {
    display: flex;
    flex-direction: column;
  }

  .scale-note {
    margin-top: var(--s6);
    padding-top: var(--s3);
    border-top: var(--rule-weight) solid var(--border-faint);
  }
</style>
