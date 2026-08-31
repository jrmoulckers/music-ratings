<script lang="ts">
  import { onMount } from 'svelte';

  import { entityHref, href } from '../lib/app/router';
  import { graph, refreshWorld, settings, world } from '../lib/app/state';
  import { resolveConflict, syncNow } from '../lib/app/sync';
  import { UNAVAILABLE_FEATURES } from '../lib/spotify/capabilities';
  import { spotifySession } from '../lib/spotify/session';
  import { syncState } from '../lib/storage/autosync';
  import { countAll, storageEstimate } from '../lib/storage/db';
  import { countRecords } from '../lib/storage/sync';
  import { readCoverage } from '../lib/listening/ingest';
  import { observedSince, coverageNotes } from '../lib/listening/phrasing';
  import type { ListeningCoverage } from '../lib/domain/listening';
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
  let coverage = $state<ListeningCoverage | null>(null);
  let seeding = $state(false);
  let seeded = $state('');

  /** Store keys are code. These are what the reader is actually looking at. */
  const STORE_LABEL: Record<string, string> = {
    entities: 'Items',
    memberships: 'Containment links',
    ratings: 'Rating events',
    comparisons: 'Comparisons',
    queueStates: 'Queue decisions',
    plays: 'Confirmed plays',
    completions: 'Finished records',
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
      coverage = await readCoverage();
    })();
  });

  /**
   * Development only. The Listening surface cannot be judged empty, and a real
   * account takes weeks to fill, so this writes a few months of made-up history
   * — including a record finished minutes ago — under locally-added items that
   * can never be confused with anything Spotify confirmed.
   */
  const seedDemo = async () => {
    seeding = true;
    seeded = '';
    try {
      const { seedDemoListening } = await import('../lib/listening/demo');
      const result = await seedDemoListening();
      await refreshWorld();
      counts = await countAll();
      seeded = `Wrote ${result.plays.toLocaleString()} plays and ${result.completions.length} finished ${result.completions.length === 1 ? 'record' : 'records'}.`;
    } catch (error) {
      seeded =
        error instanceof Error ? error.message : 'Could not write the demonstration history.';
    } finally {
      seeding = false;
    }
  };

  const removeDemo = async () => {
    seeding = true;
    seeded = '';
    try {
      const { clearDemoListening } = await import('../lib/listening/demo');
      const removed = await clearDemoListening();
      await refreshWorld();
      counts = await countAll();
      seeded = `Removed ${removed.plays.toLocaleString()} plays and ${removed.completions} completions. The invented items themselves stay in the library until you delete them there.`;
    } catch (error) {
      seeded =
        error instanceof Error ? error.message : 'Could not remove the demonstration history.';
    } finally {
      seeding = false;
    }
  };

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
    <p class="label">{online ? 'online' : 'offline'}</p>
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
            <dt class="label">This device</dt>
            <dd>
              {countRecords($syncState.conflict.local)} records · saved
              {dateAndTime($syncState.conflict.local.savedAt)}
            </dd>
          </div>
          <div>
            <dt class="label">OneDrive</dt>
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

    <section class="group" aria-labelledby="d-listening">
      <h2 id="d-listening" class="group__head title">Listening history</h2>
      {#if coverage && coverage.firstFetchAt}
        <p class="note">{observedSince(coverage.firstFetchAt)}</p>
        <ul class="rows">
          <li>
            <span class="rows__label">Last checked</span>
            <span class="figure"
              >{coverage.lastFetchAt ? dateAndTime(coverage.lastFetchAt) : 'never'}</span
            >
          </li>
          <li>
            <span class="rows__label">Returned last time</span>
            <span class="figure">
              {coverage.lastFetchCount} plays · {coverage.lastFetchNew} new
            </span>
          </li>
          <li>
            <span class="rows__label">Newest play seen</span>
            <span class="figure"
              >{coverage.newestSeenAt ? dateAndTime(coverage.newestSeenAt) : 'none yet'}</span
            >
          </li>
          <li>
            <span class="rows__label">Checks that came back full</span>
            <span class="figure">{coverage.saturatedFetches}</span>
          </li>
          <li>
            <span class="rows__label">Known gaps</span>
            <span class="figure">{coverage.gaps.length}</span>
          </li>
        </ul>
        {#each coverageNotes(coverage) as line (line)}
          <p class="note note--small note--warn">{line}</p>
        {/each}
      {:else}
        <p class="note">
          No listening has been observed yet. Connect Spotify and refresh, and plays it confirms
          will be recorded from that moment on.
        </p>
      {/if}
      <p class="note note--small">
        Spotify returns only the fifty most recent plays per check, so anything played between two
        checks that pushed past fifty is gone for good. Nothing here is a lifetime total.
      </p>
      <div class="row">
        <a class="btn btn--quiet" href={href('/listening')}>Listening</a>
        <a class="btn btn--quiet" href={href('/settings')}>History settings</a>
      </div>

      {#if import.meta.env.DEV}
        <div class="row">
          <button
            type="button"
            class="btn btn--small"
            disabled={seeding}
            onclick={() => void seedDemo()}
          >
            {seeding ? 'Writing…' : 'Seed demonstration history'}
          </button>
          <button
            type="button"
            class="btn btn--small btn--quiet"
            disabled={seeding}
            onclick={() => void removeDemo()}
          >
            Remove it
          </button>
        </div>
        <p class="note note--small">
          Development only. Writes a few months of invented listening under locally-added items,
          including a record finished minutes ago. Running it again replaces what it wrote last time
          rather than layering a second history on top.
        </p>
        {#if seeded}
          <p class="note note--small" role="status">{seeded}</p>
        {/if}
      {/if}
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
            <p class="label">Records pointing at items that are gone ({orphans.length})</p>
            <p class="note note--small">
              Usually a catalogue item removed from Spotify, or one you deleted while a rating
              survived. Ratings are never deleted automatically — your ratings outlive the
              catalogue.
            </p>
            <ul class="rows">
              {#each orphans.slice(0, 10) as row (row.kind + row.id)}
                <li>
                  <span class="mono">{row.id}</span>
                  <span class="label">{row.kind}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if duplicates.length > 0}
          <div>
            <p class="label">Possible alternate releases ({duplicates.length})</p>
            <p class="note note--small">
              Same title and credit, different Spotify identifier — reissues, remasters, regional
              editions. They are listed rather than merged, because merging would silently combine
              ratings you made separately.
            </p>
            <ul class="rows">
              {#each duplicates as group (group.join('|'))}
                <li class="rows__group">
                  {#each group as id (id)}
                    <a class="mono" href={entityHref(id)}>{$graph.entity(id)?.name ?? id}</a>
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
    border: var(--rule-weight) solid var(--accent);
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
    border-bottom: var(--rule-weight) solid var(--border-faint);
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
