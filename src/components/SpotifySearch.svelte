<script lang="ts">
  import { notify } from '../lib/app/notices';
  import { entityHref } from '../lib/app/router';
  import { graph, settings } from '../lib/app/state';
  import type { Entity, Membership } from '../lib/domain/types';
  import { SpotifyClient } from '../lib/spotify/client';
  import { searchCatalogue } from '../lib/spotify/library';
  import { spotifyConfig, spotifySession } from '../lib/spotify/session';
  import { saveMemberships, upsertEntities } from '../lib/storage/repo';
  import Icon from '../lib/ui/Icon.svelte';
  import Artwork from './Artwork.svelte';

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
  let found = $state<{ entities: Entity[]; memberships: Membership[] }>({
    entities: [],
    memberships: [],
  });
  let error = $state<string | null>(null);
  /** The term `found` and `error` belong to, so neither outlives its query. */
  let resultsFor = $state<string | null>(null);
  let lastResult: { entities: Entity[]; memberships: Membership[] } | null = null;

  const needle = $derived(term.trim());
  const current = $derived(resultsFor === needle);
  const searched = $derived(current && resultsFor !== null);
  const failure = $derived(current ? error : null);
  const results = $derived(current ? found.entities : []);

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
    } catch (caught) {
      lastResult = null;
      found = { entities: [], memberships: [] };
      error = caught instanceof Error ? caught.message : 'The search failed.';
    } finally {
      // Attribute the outcome to the term that was asked for, so editing the
      // box clears the last answer instead of leaving it to look current.
      resultsFor = asked;
      running = false;
    }
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

    {#if failure}
      <p class="note note--warn">{failure}</p>
    {:else if searched && results.length === 0}
      <p class="note">Spotify returned nothing for that, in the types you have enabled.</p>
    {:else if results.length > 0}
      <ul class="find__rows">
        {#each results.slice(0, 20) as entity (entity.id)}
          {@const already = $graph.has(entity.id)}
          <li>
            <Artwork src={entity.artworkThumbUrl} name={entity.name} size="sm" />
            <span class="find__id">
              <span class="find__name">{entity.name}</span>
              {#if entity.subtitle}<span class="note note--small">{entity.subtitle}</span>{/if}
            </span>
            <span class="label">{entity.type}</span>
            {#if already}
              <a class="btn btn--small btn--quiet" href={entityHref(entity.id)}>In your library</a>
            {:else}
              <button type="button" class="btn btn--small" onclick={() => void add(entity)}>
                Add
              </button>
            {/if}
          </li>
        {/each}
      </ul>
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
</style>
