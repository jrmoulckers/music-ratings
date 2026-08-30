<script lang="ts">
  import { onMount } from 'svelte';

  import { entityHref, href } from '../lib/app/router';
  import { graph, settings, world } from '../lib/app/state';
  import { resolveConflict, syncNow } from '../lib/app/sync';
  import { UNAVAILABLE_FEATURES } from '../lib/spotify/capabilities';
  import { spotifySession } from '../lib/spotify/session';
  import { syncState } from '../lib/storage/autosync';
  import { countAll, storageEstimate } from '../lib/storage/db';
  import { countRecords } from '../lib/storage/sync';
  import { bytes, dateAndTime, percent } from '../lib/ui/format';
  import { pwa } from '../lib/app/pwa';

  /**
   * Data health.
   *
   * The place to look when something is wrong, and the place that admits what
   * this app cannot do. Every count here is read from storage, not remembered.
   */

  interface Props {
    online: boolean;
  }

  let { online }: Props = $props();

  let counts = $state<Record<string, number> | null>(null);
  let estimate = $state<{ usage: number; quota: number } | null>(null);
  let persisted = $state<boolean | null>(null);

  /** Store keys are code. These are what the reader is actually looking at. */
  const STORE_LABEL: Record<string, string> = {
    entities: 'Items',
    memberships: 'Containment links',
    ratings: 'Rating events',
    comparisons: 'Comparisons',
    queueStates: 'Queue decisions',
    lists: 'Your lists',
    listItems: 'Items in lists',
    signals: 'Spotify signals',
    settings: 'Settings',
    meta: 'Bookkeeping',
  };

  const storeLabel = (key: string) => STORE_LABEL[key] ?? key;

  onMount(() => {
    void (async () => {
      counts = await countAll();
      estimate = await storageEstimate();
      persisted = (await navigator.storage?.persisted?.()) ?? null;
    })();
  });

  const orphans = $derived.by(() => {
    const missing: { id: string; kind: string }[] = [];
    for (const rating of $world.ratings) {
      if (!rating.deleted && !$graph.has(rating.entityId)) {
        missing.push({ id: rating.entityId, kind: 'rating of a missing item' });
      }
    }
    for (const link of $world.memberships) {
      if (link.deleted) continue;
      if (!$graph.has(link.parentId))
        missing.push({ id: link.parentId, kind: 'link to a missing parent' });
      if (!$graph.has(link.childId))
        missing.push({ id: link.childId, kind: 'link to a missing child' });
    }
    // Local scratch collections inside a derivation: built, read, discarded.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const seen = new Set<string>();
    return missing.filter((row) => {
      const key = `${row.kind}|${row.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

  const duplicates = $derived.by(() => {
    // Same name, same kind, different id: usually a reissue or a regional
    // edition. Shown, not merged — merging someone's ratings is not our call.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const byKey = new Map<string, string[]>();
    for (const entity of $graph.allEntities()) {
      if (entity.type !== 'album' && entity.type !== 'track') continue;
      const key = `${entity.type}|${entity.name.toLowerCase()}|${(entity.subtitle ?? '').toLowerCase()}`;
      byKey.set(key, [...(byKey.get(key) ?? []), entity.id]);
    }
    return [...byKey.values()].filter((ids) => ids.length > 1).slice(0, 20);
  });
</script>

<div class="sheet">
  <header class="head">
    <h1 class="display">Data health</h1>
    <p class="apparatus">{online ? 'online' : 'offline'}</p>
  </header>

  <div class="groups">
    {#if $syncState.conflict}
      <section class="group group--alert" aria-labelledby="d-conflict">
        <h2 id="d-conflict" class="group__head title">Two versions of the truth</h2>
        <p class="note">
          This device and the copy in OneDrive have both changed since they last agreed. Nothing has
          been overwritten. Choose which one wins; the other is still in your OneDrive version
          history.
        </p>
        <dl class="pair">
          <div>
            <dt class="apparatus">This device</dt>
            <dd>
              {countRecords($syncState.conflict.local)} records · saved
              {dateAndTime($syncState.conflict.local.savedAt)}
            </dd>
          </div>
          <div>
            <dt class="apparatus">OneDrive</dt>
            <dd>
              {countRecords($syncState.conflict.remote)} records · saved
              {dateAndTime($syncState.conflict.remote.savedAt)}
            </dd>
          </div>
        </dl>
        <div class="row">
          <button
            type="button"
            class="btn btn--primary"
            onclick={() => void resolveConflict('local')}
          >
            Keep this device
          </button>
          <button type="button" class="btn" onclick={() => void resolveConflict('remote')}>
            Keep OneDrive
          </button>
        </div>
      </section>
    {/if}

    <section class="group" aria-labelledby="d-store">
      <h2 id="d-store" class="group__head title">What is stored here</h2>
      {#if counts}
        <ul class="rows">
          {#each Object.entries(counts) as [name, count] (name)}
            <li>
              <span class="rows__label">{storeLabel(name)}</span>
              <span class="figure">{count.toLocaleString()}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="note">Counting…</p>
      {/if}

      {#if estimate}
        <p class="note">
          Roughly {bytes(estimate.usage)} used of about {bytes(estimate.quota)} the browser will allow
          — {percent(estimate.usage / Math.max(estimate.quota, 1))}.
        </p>
      {/if}
      <p class="note note--small">
        Storage is {persisted === true
          ? 'marked persistent, so the browser will not evict it under pressure.'
          : persisted === false
            ? 'not marked persistent: a browser short of space could evict it. Export a backup, or install the app, which usually grants persistence.'
            : 'of unknown persistence in this browser.'}
      </p>
    </section>

    <section class="group" aria-labelledby="d-sync">
      <h2 id="d-sync" class="group__head title">Sync</h2>
      <p class="note">{$syncState.message}</p>
      {#if $syncState.account}
        <p class="note note--small">Account: {$syncState.account}</p>
      {/if}
      {#if $syncState.detail.length > 0}
        <ul class="rows">
          {#each $syncState.detail as line (line.store)}
            <li>
              <span class="rows__label">{storeLabel(line.store)}</span>
              <span class="figure">
                {line.added} added · {line.updated} updated
              </span>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="row">
        <button
          type="button"
          class="btn"
          disabled={!$settings.syncEnabled}
          onclick={() => void syncNow()}
        >
          Sync now
        </button>
        <a class="btn btn--quiet" href={href('/settings')}>Sync settings</a>
      </div>
    </section>

    {#if orphans.length > 0 || duplicates.length > 0}
      <section class="group" aria-labelledby="d-anomalies">
        <h2 id="d-anomalies" class="group__head title">Worth a look</h2>

        {#if orphans.length > 0}
          <div>
            <p class="apparatus">Records pointing at items that are gone ({orphans.length})</p>
            <p class="note note--small">
              Usually a catalogue item removed from Spotify, or one you deleted while a rating
              survived. Ratings are never deleted automatically — your judgement outlives the
              catalogue.
            </p>
            <ul class="rows">
              {#each orphans.slice(0, 10) as row (row.kind + row.id)}
                <li>
                  <span class="machine">{row.id}</span>
                  <span class="apparatus">{row.kind}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if duplicates.length > 0}
          <div>
            <p class="apparatus">Possible alternate releases ({duplicates.length})</p>
            <p class="note note--small">
              Same title and credit, different Spotify identifier — reissues, remasters, regional
              editions. They are listed rather than merged, because merging would silently combine
              ratings you made separately.
            </p>
            <ul class="rows">
              {#each duplicates as group (group.join('|'))}
                <li class="rows__group">
                  {#each group as id (id)}
                    <a class="machine" href={entityHref(id)}>{$graph.entity(id)?.name ?? id}</a>
                  {/each}
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </section>
    {/if}

    <section class="group" aria-labelledby="d-limits">
      <h2 id="d-limits" class="group__head title">What this app cannot do</h2>
      <p class="note">
        Spotify withdrew several endpoints from new applications in November 2024. Rather than
        approximate them, this app does without and says so.
      </p>
      <ul class="rows rows--stacked">
        {#each UNAVAILABLE_FEATURES as feature (feature.name)}
          <li>
            <span class="rows__label">{feature.name}</span>
            <span class="note note--small">{feature.reason}</span>
          </li>
        {/each}
      </ul>
      <p class="note note--small">
        Spotify connection: {$spotifySession.connected ? 'active' : 'not connected'}. Service
        worker:
        {$pwa.offlineReady ? 'offline shell ready' : 'not yet cached'}.
      </p>
    </section>
  </div>
</div>

<style>
  .groups {
    display: flex;
    flex-direction: column;
    gap: var(--s7);
    max-width: 46rem;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
  }
  .group--alert {
    padding: var(--s4);
    border: var(--rule-weight) solid var(--rubric);
  }
  .group__head {
    padding-bottom: var(--s2);
    border-bottom: var(--rule-weight) solid var(--ink);
  }

  .rows {
    display: flex;
    flex-direction: column;
  }
  .rows li {
    display: flex;
    justify-content: space-between;
    gap: var(--s4);
    align-items: baseline;
    padding: var(--s1) 0;
    border-bottom: var(--rule-weight) solid var(--rule-faint);
  }
  .rows--stacked li {
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: var(--s2) 0;
  }
  .rows__label {
    font-size: 0.875rem;
  }
  .rows__group {
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }

  .pair {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(14rem, 100%), 1fr));
    gap: var(--s4);
  }
  .pair dd {
    margin: 0;
    font-size: 0.875rem;
  }
</style>
