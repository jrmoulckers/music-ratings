<script lang="ts">
  import { rate } from '../lib/app/actions';
  import { notify } from '../lib/app/notices';
  import { entityHref } from '../lib/app/router';
  import { closeSearch } from '../lib/app/search-overlay';
  import { entityLabelCap, explicitRatings, graph, scaleForType, settings } from '../lib/app/state';
  import { formatComputedOn } from '../lib/domain/scales';
  import type { Entity, Membership } from '../lib/domain/types';
  import { SpotifyClient } from '../lib/spotify/client';
  import { searchCatalogue } from '../lib/spotify/library';
  import { spotifyConfig, spotifySession } from '../lib/spotify/session';
  import { saveMemberships, upsertEntities } from '../lib/storage/repo';
  import Icon from '../lib/ui/Icon.svelte';
  import Artwork from './Artwork.svelte';
  import RatingRail from './RatingRail.svelte';

  /**
   * Search anything, rate it on the spot.
   *
   * Your own library answers instantly and offline. Spotify is a second,
   * deliberate step, because reaching the network should be something you asked
   * for rather than something that happens on every keystroke.
   */

  let term = $state('');
  let input = $state<HTMLInputElement | null>(null);
  let picked = $state<Entity | null>(null);
  let running = $state(false);
  let error = $state<string | null>(null);
  let remote = $state<{ entities: Entity[]; memberships: Membership[] }>({
    entities: [],
    memberships: [],
  });
  /** The term `remote` and `error` belong to, so neither outlives its query. */
  let resultsFor = $state<string | null>(null);
  let busy = $state(false);

  $effect(() => {
    input?.focus();
  });

  const needle = $derived(term.trim().toLowerCase());

  const mine = $derived.by(() => {
    if (needle.length < 1) return [];
    const enabled = new Set($settings.enabledTypes);
    return $graph
      .allEntities()
      .filter(
        (entity) =>
          enabled.has(entity.type) &&
          (entity.name.toLowerCase().includes(needle) ||
            (entity.subtitle ?? '').toLowerCase().includes(needle)),
      )
      .slice(0, 40);
  });

  // Editing the term invalidates the last answer rather than leaving it on
  // screen, so results and errors always belong to what is in the box.
  const current = $derived(resultsFor === needle);
  const searched = $derived(current && resultsFor !== null);
  const failure = $derived(current ? error : null);

  // Anything Spotify returned that is genuinely new; the rest is already listed above.
  const fresh = $derived(
    current ? remote.entities.filter((entity) => !$graph.has(entity.id)).slice(0, 20) : [],
  );

  async function searchSpotify() {
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
      remote = await searchCatalogue(client, term, $settings.enabledTypes);
    } catch (caught) {
      remote = { entities: [], memberships: [] };
      error = caught instanceof Error ? caught.message : 'The search failed.';
    } finally {
      // Attribute the outcome to the term that was asked for, not to whatever
      // has been typed since, so a slow answer cannot overwrite a newer one.
      resultsFor = asked;
      running = false;
    }
  }

  /** Pulls a catalogue result into the library, then puts it in front of you to rate. */
  async function adopt(entity: Entity) {
    await upsertEntities([entity]);
    const links = remote.memberships.filter(
      (m) => m.childId === entity.id || m.parentId === entity.id,
    );
    const related = remote.entities.filter(
      (e) => links.some((m) => m.parentId === e.id || m.childId === e.id) && e.id !== entity.id,
    );
    if (related.length > 0) await upsertEntities(related);
    if (links.length > 0) await saveMemberships(links);
    picked = entity;
  }

  async function commit(normalized: number) {
    const entity = picked;
    if (!entity || busy) return;
    busy = true;
    try {
      await rate(entity, normalized, { context: 'detail' });
      notify(`${entity.name} rated.`);
      picked = null;
      term = '';
      input?.focus();
    } finally {
      busy = false;
    }
  }

  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (picked) picked = null;
    else closeSearch();
  }
</script>

<svelte:window onkeydown={onKey} />

<div
  class="scrim"
  role="button"
  tabindex="-1"
  aria-label="Close search"
  onclick={(event) => {
    if (event.target === event.currentTarget) closeSearch();
  }}
  onkeydown={() => {}}
>
  <div class="panel" role="dialog" aria-modal="true" aria-label="Search to rate">
    <form
      class="panel__bar"
      onsubmit={(event) => {
        event.preventDefault();
        void searchSpotify();
      }}
    >
      <Icon name="search" size={17} />
      <label class="sr-only" for="overlay-search">Search your library or Spotify</label>
      <input
        id="overlay-search"
        class="panel__input"
        type="search"
        bind:this={input}
        bind:value={term}
        placeholder="Search anything to rate it…"
        autocomplete="off"
      />
      <button type="button" class="btn btn--small btn--quiet" onclick={() => closeSearch()}>
        <Icon name="close" size={14} />
        <span class="sr-only">Close</span>
      </button>
    </form>

    {#if picked}
      {@const scale = $scaleForType(picked.type)}
      {@const existing = $explicitRatings.get(picked.id)}
      <div class="seat">
        <div class="seat__head">
          <Artwork src={picked.artworkThumbUrl} name={picked.name} size="md" />
          <div class="seat__id">
            <h2 class="title">{picked.name}</h2>
            {#if picked.subtitle}<p class="note">{picked.subtitle}</p>{/if}
            <p class="label">
              {entityLabelCap(picked.type)}
              {#if existing}
                · rated {formatComputedOn(scale, existing.normalized)}
              {/if}
            </p>
          </div>
          <button type="button" class="btn btn--small btn--quiet" onclick={() => (picked = null)}>
            Back to results
          </button>
        </div>

        <RatingRail
          {scale}
          value={existing?.normalized ?? null}
          orientation="horizontal"
          showMarks
          disabled={busy}
          label="Rating for {picked.name}"
          oncommit={(value) => void commit(value)}
        />

        <a class="panel__more" href={entityHref(picked.id)} onclick={() => closeSearch()}>
          Open the full page for more options
        </a>
      </div>
    {:else}
      <div class="panel__body">
        {#if needle.length === 0}
          <p class="note panel__hint">
            Type to find anything in your library. Press Enter to search the Spotify catalogue as
            well.
          </p>
        {:else}
          {#if mine.length > 0}
            <p class="label panel__group">In your library</p>
            <ul class="rows">
              {#each mine as entity (entity.id)}
                {@const existing = $explicitRatings.get(entity.id)}
                <li>
                  <button type="button" class="row" onclick={() => (picked = entity)}>
                    <Artwork src={entity.artworkThumbUrl} name={entity.name} size="sm" />
                    <span class="row__id">
                      <span class="row__name">{entity.name}</span>
                      {#if entity.subtitle}
                        <span class="note note--small">{entity.subtitle}</span>
                      {/if}
                    </span>
                    <span class="label">{entityLabelCap(entity.type)}</span>
                    <span class="row__state">
                      {existing
                        ? formatComputedOn($scaleForType(entity.type), existing.normalized)
                        : 'Rate'}
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="note panel__hint">Nothing in your library matches that.</p>
          {/if}

          {#if failure}
            <p class="note note--warn panel__group">{failure}</p>
            <button
              type="button"
              class="btn btn--small panel__retry"
              disabled={running}
              onclick={() => void searchSpotify()}
            >
              <Icon name="refresh" size={14} />
              {running ? 'Searching Spotify…' : 'Try Spotify again'}
            </button>
          {:else if fresh.length > 0}
            <p class="label panel__group">From Spotify</p>
            <ul class="rows">
              {#each fresh as entity (entity.id)}
                <li>
                  <button type="button" class="row" onclick={() => void adopt(entity)}>
                    <Artwork src={entity.artworkThumbUrl} name={entity.name} size="sm" />
                    <span class="row__id">
                      <span class="row__name">{entity.name}</span>
                      {#if entity.subtitle}
                        <span class="note note--small">{entity.subtitle}</span>
                      {/if}
                    </span>
                    <span class="label">{entityLabelCap(entity.type)}</span>
                    <span class="row__state">Add &amp; rate</span>
                  </button>
                </li>
              {/each}
            </ul>
          {:else if searched}
            <p class="note panel__group">
              Spotify returned nothing new for that, in the types you have enabled.
            </p>
          {:else if $spotifySession.connected}
            <button
              type="button"
              class="btn btn--small panel__group"
              disabled={running}
              onclick={() => void searchSpotify()}
            >
              <Icon name="search" size={14} />
              {running ? 'Searching Spotify…' : 'Also search Spotify'}
            </button>
          {:else}
            <p class="note panel__group">
              This searches what is already on this device. Connect Spotify in Settings to search
              the full catalogue and add things from it.
            </p>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: var(--s5) var(--s4);
    background: var(--scrim);
    cursor: default;
  }

  .panel {
    width: min(46rem, 100%);
    max-height: min(38rem, calc(100dvh - 2 * var(--s5)));
    display: flex;
    flex-direction: column;
    background: var(--surface-raised);
    border: var(--rule-weight) solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 18px 48px -12px color-mix(in srgb, var(--ink) 40%, transparent);
    overflow: hidden;
  }

  .panel__bar {
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding: var(--s3) var(--s4);
    border-bottom: var(--rule-weight) solid var(--border);
    color: var(--ink-faint);
  }

  .panel__input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    color: var(--ink);
    font: inherit;
    font-size: 1.125rem;
    padding: var(--s2) 0;
  }
  .panel__input:focus {
    outline: none;
  }
  .panel__input::-webkit-search-cancel-button {
    display: none;
  }

  .panel__body {
    overflow-y: auto;
    padding: var(--s3) var(--s4) var(--s4);
  }

  .panel__hint {
    padding: var(--s4) 0;
  }

  .panel__group {
    margin-top: var(--s4);
    margin-bottom: var(--s2);
  }
  .panel__group:first-child {
    margin-top: var(--s2);
  }
  .panel__retry {
    margin-top: var(--s2);
  }

  .rows {
    display: flex;
    flex-direction: column;
  }

  .row {
    width: 100%;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    gap: var(--s3);
    align-items: center;
    padding: var(--s2);
    border: 0;
    border-bottom: var(--rule-weight) solid var(--border-faint);
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row:hover {
    background: var(--surface-sunk);
  }

  .row__id {
    min-width: 0;
  }
  .row__name {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row__state {
    color: var(--accent-ink);
    white-space: nowrap;
  }

  .seat {
    padding: var(--s4);
    overflow-y: auto;
  }
  .seat__head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: var(--s4);
    align-items: start;
    margin-bottom: var(--s5);
  }
  .seat__id {
    min-width: 0;
  }

  .panel__more {
    display: inline-block;
    margin-top: var(--s5);
  }

  @media (max-width: 40rem) {
    .scrim {
      padding: 0;
      align-items: stretch;
    }
    .panel {
      width: 100%;
      max-height: none;
      border: 0;
      border-radius: 0;
    }
    .seat__head {
      grid-template-columns: auto minmax(0, 1fr);
    }
    .seat__head > :global(button) {
      grid-column: 1 / -1;
    }
  }
</style>
