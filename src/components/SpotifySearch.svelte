<script lang="ts">
  import { notify } from '../lib/app/notices';
  import { rememberSearch } from '../lib/app/recent-searches';
  import { entityHref } from '../lib/app/router';
  import { graph, entityLabelCap, explicitRatings, settings } from '../lib/app/state';
  import type { Entity } from '../lib/domain/types';
  import { editionMarks } from '../lib/domain/editions';
  import { SpotifyClient } from '../lib/spotify/client';
  import { searchCatalogue, type SearchResult } from '../lib/spotify/library';
  import { spotifyConfig, spotifySession } from '../lib/spotify/session';
  import { saveMemberships, upsertEntities } from '../lib/storage/repo';
  import Icon from '../lib/ui/Icon.svelte';
  import Artwork from './Artwork.svelte';
  import AutoLoad from './AutoLoad.svelte';
  import EntityTypeIcon from './EntityTypeIcon.svelte';
  import InlineRating from './InlineRating.svelte';
  import RecentSearches from './RecentSearches.svelte';

  /**
   * Reaching past your library into Spotify's catalogue.
   *
   * Results are not written to your library until something is added, so a search
   * never quietly fills the database with things you did not ask for.
   */

  interface Props {
    initialTerm?: string;
  }

  let { initialTerm = '' }: Props = $props();

  let term = $state('');
  // Seeded from the library search box, then owned here: typing in this field
  // should not disturb the filter behind it.
  let seeded = false;
  $effect(() => {
    if (seeded) return;
    seeded = true;
    term = initialTerm;
  });
  let running = $state(false);
  let shown = $state(20);
  let found = $state<SearchResult>({ entities: [], memberships: [], hits: [] });
  let error = $state<string | null>(null);
  /** The term `found` and `error` belong to, so neither outlives its query. */
  let resultsFor = $state<string | null>(null);
  let lastResult: SearchResult | null = null;

  const needle = $derived(term.trim());
  const current = $derived(resultsFor === needle);
  const searched = $derived(current && resultsFor !== null);
  const failure = $derived(current ? error : null);

  // Only what Spotify answered with, in its balanced order. The rest of
  // `entities` is the metadata those answers needed, not results in itself.
  const results = $derived.by((): Entity[] => {
    if (!current) return [];
    const byId = new Map(found.entities.map((e) => [e.id, e]));
    // `hits` is already unique by id; the guard keeps that true if a caller
    // ever composes results some other way, since a repeated key would break
    // the keyed block as well as waste a slot.
    return found.hits
      .map((id) => byId.get(id))
      .filter((e): e is Entity => e !== undefined)
      .filter((e, i, list) => list.findIndex((other) => other.id === e.id) === i);
  });

  const marks = $derived(editionMarks(results));

  async function run() {
    if (!needle || running) return;
    running = true;
    error = null;
    const asked = needle;
    try {
      const client = new SpotifyClient({
        config: spotifyConfig(),
        onBackoff: (seconds) =>
          notify(`Spotify asked us to wait ${seconds}s. Holding off, then retrying.`),
      });
      const result = await searchCatalogue(client, term, $settings.enabledTypes);
      lastResult = result;
      found = result;
      rememberSearch(asked);
    } catch (caught) {
      lastResult = null;
      found = { entities: [], memberships: [], hits: [] };
      error = caught instanceof Error ? caught.message : 'The search failed.';
    } finally {
      // Attribute the outcome to the term that was asked for, so editing the
      // box clears the last answer instead of leaving it to look current.
      resultsFor = asked;
      shown = 20;
      running = false;
    }
  }

  /** Run a remembered query: fill the field, then search as if it had been typed. */
  function rerun(recent: string) {
    term = recent;
    void run();
  }

  async function add(entity: Entity) {
    if (!lastResult) return;
    await upsertEntities([entity]);
    // Bring across only the links that touch this item, so adding one track does
    // not silently import a whole search page.
    const links = lastResult.memberships.filter(
      (m) => m.childId === entity.id || m.parentId === entity.id,
    );
    const related = lastResult.entities.filter(
      (e) => links.some((m) => m.parentId === e.id || m.childId === e.id) && e.id !== entity.id,
    );
    if (related.length > 0) await upsertEntities(related);
    if (links.length > 0) await saveMemberships(links);
    notify(`${entity.name} added to your library.`);
  }
</script>

<section class="find" aria-labelledby="find-head">
  <div class="head">
    <h2 id="find-head" class="title">Find something not here yet</h2>
    <span class="label">Spotify catalogue</span>
  </div>

  {#if !$spotifySession.connected}
    <p class="note">
      Connect Spotify in Settings to search the catalogue. Everything already in your library stays
      searchable without a connection.
    </p>
  {:else}
    <form
      class="find__form"
      onsubmit={(event) => {
        event.preventDefault();
        void run();
      }}
    >
      <label class="field field--grow">
        <span class="sr-only">Search Spotify</span>
        <input
          class="input"
          type="search"
          bind:value={term}
          placeholder="Artist, release, track, playlist…"
        />
      </label>
      <button type="submit" class="btn" disabled={running || !term.trim()}>
        <Icon name="search" size={14} />
        {running ? 'Searching…' : 'Search Spotify'}
      </button>
    </form>

    {#if needle.length === 0 && !running}
      <RecentSearches id="find-recent" onpick={rerun} />
    {/if}

    {#if failure}
      <p class="note note--warn">{failure}</p>
    {:else if searched && results.length === 0}
      <p class="note">Spotify returned nothing for that, in the types you have enabled.</p>
    {:else if results.length > 0}
      <ul class="find__rows">
        {#each results.slice(0, shown) as entity (entity.id)}
          {@const already = $graph.has(entity.id)}
          <li>
            <Artwork src={entity.artworkThumbUrl} name={entity.name} size="sm" />
            <span class="find__id">
              <span class="find__name">{entity.name}</span>
              {#if entity.subtitle || marks.has(entity.id)}
                <span class="note note--small">
                  {[entity.subtitle, marks.get(entity.id)].filter(Boolean).join(' · ')}
                </span>
              {/if}
            </span>
            <span class="label find__kind">
              <EntityTypeIcon type={entity.type} size={14} />
              <span>{entityLabelCap(entity.type)}</span>
            </span>
            {#if already}
              <InlineRating
                entity={$graph.entity(entity.id) ?? entity}
                value={$explicitRatings.get(entity.id)?.normalized ?? null}
                variant="compact"
                where="detail"
              />
              <a class="btn btn--small btn--quiet" href={entityHref(entity.id)}>Open</a>
            {:else}
              <button type="button" class="btn btn--small" onclick={() => void add(entity)}>
                Add
              </button>
            {/if}
          </li>
        {/each}
      </ul>

      <AutoLoad
        hasMore={results.length > shown}
        count={Math.min(shown, results.length)}
        noun="results"
        onload={() => (shown += 20)}
      />
    {/if}
  {/if}
</section>

<style>
  .find {
    margin-top: var(--s7);
    padding-top: var(--s5);
    border-top: var(--rule-weight) solid var(--border);
  }

  .find__form {
    display: flex;
    gap: var(--s3);
    align-items: flex-end;
    margin-bottom: var(--s4);
  }

  .find__rows {
    display: flex;
    flex-direction: column;
  }
  .find__rows li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    gap: var(--s3);
    align-items: center;
    padding: var(--s2) 0;
    border-bottom: var(--rule-weight) solid var(--border-faint);
  }
  .find__id {
    min-width: 0;
  }
  .find__name {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .find__kind {
    display: flex;
    align-items: center;
    gap: var(--s2);
    white-space: nowrap;
  }
</style>
