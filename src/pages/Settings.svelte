<script lang="ts">
  import { installDemo, removeDemo } from '../lib/app/demo';
  import { notify } from '../lib/app/notices';
  import { installApp, pwa } from '../lib/app/pwa';
  import { href } from '../lib/app/router';
  import {
    allScales,
    entityLabel,
    entityLabelCap,
    loadAll,
    settings,
    updateSettings,
    world,
  } from '../lib/app/state';
  import { connectOneDrive, disconnectOneDrive, syncNow } from '../lib/app/sync';
  import { ROLLUP_CHANNELS, ENTITY_TYPES, PARENT_TYPES } from '../lib/domain/types';
  import type { EntityType, RollupChannel } from '../lib/domain/types';
  import { SUGGESTION_SOURCES } from '../lib/domain/types';
  import { suggestionSourceLabel } from '../lib/domain/suggestions';
  import { DEVELOPMENT_MODE_USER_LIMIT, ENTITY_SUPPORT } from '../lib/spotify/capabilities';
  import {
    connectSpotify,
    disconnectSpotify,
    importProgress,
    runImport,
    spotifySession,
  } from '../lib/spotify/session';
  import { syncState } from '../lib/storage/autosync';
  import { clearStore, SYNCED_STORES } from '../lib/storage/db';
  import {
    buildSnapshot,
    parseSnapshot,
    restoreSnapshot,
    serializeSnapshot,
    snapshotCounts,
    snapshotFileName,
  } from '../lib/storage/snapshot';
  import { markDataChanged } from '../lib/storage/changes';
  import { dateAndTime, relative } from '../lib/ui/format';
  import Icon from '../lib/ui/Icon.svelte';

  /**
   * Settings.
   *
   * Grouped by the question each answers, not by the shape of the data model.
   * Anything that changes what a score means says so where it is changed.
   */

  const CHANNEL_LABEL: Record<RollupChannel, string> = {
    explicit: 'Your own rating of it',
    directChildren: 'Ratings of what it directly contains',
    descendants: 'Ratings further down',
    comparison: 'Head-to-head standing',
  };

  let rollupType = $state<EntityType>('artist');
  let importFile = $state<HTMLInputElement | null>(null);
  let busy = $state(false);

  const rollupConfig = $derived($settings.rollup[rollupType]);

  async function setWeight(channel: RollupChannel, value: number) {
    const current = $settings.rollup[rollupType];
    if (!current) return;
    await updateSettings({
      rollup: {
        ...$settings.rollup,
        [rollupType]: { ...current, weights: { ...current.weights, [channel]: value } },
      },
    });
  }

  async function setRollupField(patch: Record<string, unknown>) {
    const current = $settings.rollup[rollupType];
    if (!current) return;
    await updateSettings({
      rollup: { ...$settings.rollup, [rollupType]: { ...current, ...patch } },
    });
  }

  async function toggleType(type: EntityType) {
    const next = $settings.enabledTypes.includes(type)
      ? $settings.enabledTypes.filter((t) => t !== type)
      : [...$settings.enabledTypes, type];
    await updateSettings({ enabledTypes: next.length > 0 ? next : [type] });
  }

  async function exportLedger() {
    const snapshot = await buildSnapshot($settings);
    const blob = new Blob([serializeSnapshot(snapshot)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = snapshotFileName();
    anchor.click();
    URL.revokeObjectURL(url);
    notify('Backup downloaded. It is plain JSON you can read yourself.');
  }

  async function importLedger(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    busy = true;
    try {
      const snapshot = parseSnapshot(await file.text());
      const counts = snapshotCounts(snapshot);
      await restoreSnapshot(snapshot, { markChanged: true, keepLocalSettings: true });
      await loadAll();
      notify(
        `Restored ${counts.map((c) => `${c.count} ${c.label}`).join(', ')} from ${file.name}.`,
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : 'That file could not be restored.', {
        tone: 'warn',
      });
    } finally {
      busy = false;
      input.value = '';
    }
  }

  async function eraseEverything() {
    const confirmed = confirm(
      'This deletes every rating, comparison, note and catalogue item stored in this browser. If sync is on, the next sync will propagate the deletion. There is no undo. Continue?',
    );
    if (!confirmed) return;
    busy = true;
    try {
      for (const store of SYNCED_STORES) await clearStore(store);
      markDataChanged();
      await loadAll();
      notify('Everything local has been erased.');
    } finally {
      busy = false;
    }
  }
</script>

<div class="sheet">
  <header class="head">
    <h1 class="display">Settings</h1>
    <p class="apparatus">saved as you change them</p>
  </header>

  <div class="groups">
    <!-- ---------------------------------------------------------------- -->
    <section class="group" aria-labelledby="s-rating">
      <h2 id="s-rating" class="group__head title">What you rate, and how</h2>

      <div class="field">
        <span class="apparatus">Kinds of thing</span>
        <ul class="opts">
          {#each ENTITY_TYPES as type (type)}
            <li>
              <label class="check">
                <input
                  type="checkbox"
                  checked={$settings.enabledTypes.includes(type)}
                  onchange={() => void toggleType(type)}
                />
                <span>
                  <span class="opts__name">{entityLabel(type, true)}</span>
                  {#if ENTITY_SUPPORT[type].note}
                    <span class="note note--small">{ENTITY_SUPPORT[type].note}</span>
                  {/if}
                </span>
              </label>
            </li>
          {/each}
        </ul>
      </div>

      <label class="field">
        <span class="apparatus">Default scale</span>
        <select
          class="select"
          value={$settings.defaultScaleId}
          onchange={(event) => void updateSettings({ defaultScaleId: event.currentTarget.value })}
        >
          {#each $allScales as scale (scale.id)}
            <option value={scale.id}>{scale.label}</option>
          {/each}
        </select>
      </label>
      <p class="note note--small">
        Ratings are stored on a common 0–100 basis, so changing scale re-labels your history instead
        of rewriting it. Per-kind overrides sit below.
      </p>

      <div class="field">
        <span class="apparatus">Scale per kind</span>
        <ul class="opts">
          {#each $settings.enabledTypes as type (type)}
            <li class="opts__row">
              <span class="opts__name">{entityLabel(type, true)}</span>
              <select
                class="select select--small"
                value={$settings.scaleByType[type] ?? ''}
                onchange={(event) =>
                  void updateSettings({
                    scaleByType: {
                      ...$settings.scaleByType,
                      [type]: event.currentTarget.value || undefined,
                    },
                  })}
              >
                <option value="">Same as default</option>
                {#each $allScales as scale (scale.id)}
                  <option value={scale.id}>{scale.label}</option>
                {/each}
              </select>
            </li>
          {/each}
        </ul>
      </div>
    </section>

    <!-- ---------------------------------------------------------------- -->
    <section class="group" aria-labelledby="s-scores">
      <h2 id="s-scores" class="group__head title">How computed scores are worked out</h2>

      <label class="field">
        <span class="apparatus">Weights for</span>
        <select class="select" bind:value={rollupType}>
          {#each PARENT_TYPES as type (type)}
            <option value={type}>{entityLabelCap(type, true)}</option>
          {/each}
        </select>
      </label>

      {#if rollupConfig}
        <ul class="weights">
          {#each ROLLUP_CHANNELS as channel (channel)}
            <li>
              <span class="weights__label">{CHANNEL_LABEL[channel]}</span>
              <input
                class="slider"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={rollupConfig.weights[channel] ?? 0}
                oninput={(event) => void setWeight(channel, Number(event.currentTarget.value))}
                aria-label="{CHANNEL_LABEL[channel]} weight"
              />
              <span class="figure">{Math.round((rollupConfig.weights[channel] ?? 0) * 100)}%</span>
            </li>
          {/each}
        </ul>
        <p class="note note--small">
          Weights are renormalised over whatever evidence actually exists, so an item with no
          comparisons is not punished for it. A track reachable through several playlists is only
          counted once, by its shortest path.
        </p>

        <label class="field">
          <span class="apparatus">Averaging</span>
          <select
            class="select"
            value={rollupConfig.method}
            onchange={(event) => void setRollupField({ method: event.currentTarget.value })}
          >
            <option value="mean">Mean</option>
            <option value="median">Median</option>
            <option value="trimmed">Trimmed mean</option>
            <option value="bayesian">Bayesian (pulls thin evidence to the middle)</option>
          </select>
        </label>

        <label class="field">
          <span class="apparatus">
            Coverage below {Math.round((rollupConfig.minCoverage ?? 0) * 100)}% is marked
            provisional
          </span>
          <input
            class="slider"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={rollupConfig.minCoverage ?? 0}
            oninput={(event) =>
              void setRollupField({ minCoverage: Number(event.currentTarget.value) })}
          />
        </label>

        <label class="field">
          <span class="apparatus">
            {rollupConfig.recencyHalfLifeDays
              ? `Older ratings count half as much after ${rollupConfig.recencyHalfLifeDays} days`
              : 'Recency decay off — an old rating counts as much as a new one'}
          </span>
          <input
            class="slider"
            type="range"
            min="0"
            max="1460"
            step="30"
            value={rollupConfig.recencyHalfLifeDays ?? 0}
            oninput={(event) =>
              void setRollupField({
                recencyHalfLifeDays: Number(event.currentTarget.value) || undefined,
              })}
          />
        </label>
      {/if}

      <label class="field">
        <span class="apparatus">Which score is shown by default</span>
        <select
          class="select"
          value={$settings.scoreView}
          onchange={(event) =>
            void updateSettings({ scoreView: event.currentTarget.value as 'blended' })}
        >
          <option value="blended">Blended</option>
          <option value="explicit">Only what you said</option>
          <option value="rollup">Only what was computed</option>
        </select>
      </label>

      <label class="field">
        <span class="apparatus">
          In the blend, your own rating counts {Math.round($settings.blendExplicitWeight * 100)}%
        </span>
        <input
          class="slider"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={$settings.blendExplicitWeight}
          oninput={(event) =>
            void updateSettings({ blendExplicitWeight: Number(event.currentTarget.value) })}
        />
      </label>
    </section>

    <!-- ---------------------------------------------------------------- -->
    <section class="group" aria-labelledby="s-queue">
      <h2 id="s-queue" class="group__head title">What the queue puts in front of you</h2>

      <ul class="weights">
        {#each SUGGESTION_SOURCES as source (source)}
          <li>
            <span class="weights__label">{suggestionSourceLabel(source)}</span>
            <input
              class="slider"
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={$settings.suggestionWeights[source] ?? 0}
              oninput={(event) =>
                void updateSettings({
                  suggestionWeights: {
                    ...$settings.suggestionWeights,
                    [source]: Number(event.currentTarget.value),
                  },
                })}
              aria-label="{suggestionSourceLabel(source)} weight"
            />
            <span class="figure">{($settings.suggestionWeights[source] ?? 0).toFixed(1)}</span>
          </li>
        {/each}
      </ul>

      <label class="field">
        <span class="apparatus">
          A rating counts as stale after {$settings.staleAfterDays} days
        </span>
        <input
          class="slider"
          type="range"
          min="30"
          max="1460"
          step="30"
          value={$settings.staleAfterDays}
          oninput={(event) =>
            void updateSettings({ staleAfterDays: Number(event.currentTarget.value) })}
        />
      </label>

      <label class="field">
        <span class="apparatus">
          Offer a head-to-head {Math.round($settings.comparisonFrequency * 100)}% of the time
        </span>
        <input
          class="slider"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={$settings.comparisonFrequency}
          oninput={(event) =>
            void updateSettings({ comparisonFrequency: Number(event.currentTarget.value) })}
        />
      </label>

      <label class="check">
        <input
          type="checkbox"
          checked={$settings.goalsEnabled}
          onchange={(event) => void updateSettings({ goalsEnabled: event.currentTarget.checked })}
        />
        <span>
          <span class="opts__name">Show a daily target</span>
          <span class="note note--small"
            >Off by default. Rating music should not feel like a streak to protect.</span
          >
        </span>
      </label>

      {#if $settings.goalsEnabled}
        <label class="field">
          <span class="apparatus">Target {$settings.dailyGoal} a day</span>
          <input
            class="slider"
            type="range"
            min="1"
            max="50"
            step="1"
            value={$settings.dailyGoal}
            oninput={(event) =>
              void updateSettings({ dailyGoal: Number(event.currentTarget.value) })}
          />
        </label>
      {/if}
    </section>

    <!-- ---------------------------------------------------------------- -->
    <section class="group" aria-labelledby="s-look">
      <h2 id="s-look" class="group__head title">How it looks and behaves</h2>

      <label class="field">
        <span class="apparatus">Theme</span>
        <select
          class="select"
          value={$settings.theme}
          onchange={(event) =>
            void updateSettings({ theme: event.currentTarget.value as 'system' })}
        >
          <option value="system">Follow the system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>

      <label class="field">
        <span class="apparatus">Density</span>
        <select
          class="select"
          value={$settings.density}
          onchange={(event) =>
            void updateSettings({ density: event.currentTarget.value as 'cozy' })}
        >
          <option value="cozy">Cozy</option>
          <option value="compact">Compact</option>
        </select>
      </label>

      <label class="field">
        <span class="apparatus">Motion</span>
        <select
          class="select"
          value={$settings.motion}
          onchange={(event) =>
            void updateSettings({ motion: event.currentTarget.value as 'system' })}
        >
          <option value="system">Follow the system</option>
          <option value="full">Full</option>
          <option value="reduce">Reduced</option>
        </select>
      </label>

      <label class="field">
        <span class="apparatus">Artwork</span>
        <select
          class="select"
          value={$settings.artwork}
          onchange={(event) =>
            void updateSettings({ artwork: event.currentTarget.value as 'full' })}
        >
          <option value="full">Full size</option>
          <option value="thumbnails">Thumbnails only — less data, less storage</option>
          <option value="none">None</option>
        </select>
      </label>

      <label class="check">
        <input
          type="checkbox"
          checked={$settings.highContrast}
          onchange={(event) => void updateSettings({ highContrast: event.currentTarget.checked })}
        />
        <span>Stronger contrast</span>
      </label>

      <label class="check">
        <input
          type="checkbox"
          checked={$settings.showExplicitContent}
          onchange={(event) =>
            void updateSettings({ showExplicitContent: event.currentTarget.checked })}
        />
        <span>Show items Spotify marks explicit</span>
      </label>

      {#if $pwa.installable}
        <button type="button" class="btn" onclick={() => void installApp()}>
          <Icon name="download" size={14} /> Install as an app
        </button>
      {/if}
    </section>

    <!-- ---------------------------------------------------------------- -->
    <section class="group" aria-labelledby="s-spotify">
      <h2 id="s-spotify" class="group__head title">Spotify</h2>

      {#if $spotifySession.connected}
        <p class="note">
          Connected{$spotifySession.profileName ? ` as ${$spotifySession.profileName}` : ''}.
          {#if $spotifySession.expiresAt}
            Access renews automatically; the current token expires {relative(
              $spotifySession.expiresAt,
            )}.
          {/if}
        </p>
        {#if $spotifySession.missingPodcastScope && ($settings.enabledTypes.includes('show') || $settings.enabledTypes.includes('episode'))}
          <p class="note note--warn">
            Shows and episodes are enabled but the playback-position permission was not granted.
            Reconnect to ask for it.
          </p>
        {/if}
        <div class="row">
          <button
            type="button"
            class="btn"
            disabled={$importProgress.running}
            onclick={() => void runImport()}
          >
            <Icon name="download" size={14} />
            {$importProgress.running ? 'Reading your library…' : 'Read my library again'}
          </button>
          <button type="button" class="btn btn--quiet" onclick={() => void connectSpotify()}>
            Reconnect
          </button>
          <button type="button" class="btn btn--quiet" onclick={disconnectSpotify}>
            Disconnect
          </button>
        </div>

        {#if $importProgress.running || $importProgress.steps.length > 0}
          <ul class="steps">
            {#each $importProgress.steps as step (step.label)}
              <li>
                <span class="steps__label">{step.label}</span>
                <span class="figure">{step.count}</span>
                {#if step.detail}<span class="note note--small">{step.detail}</span>{/if}
              </li>
            {/each}
          </ul>
        {/if}
        {#if $importProgress.backoffSeconds}
          <p class="note">
            Spotify asked us to slow down. Waiting {$importProgress.backoffSeconds}s, then carrying
            on where we left off.
          </p>
        {/if}
      {:else}
        <label class="field">
          <span class="apparatus">Client ID</span>
          <input
            class="input"
            value={$settings.spotifyClientId}
            onchange={(event) =>
              void updateSettings({ spotifyClientId: event.currentTarget.value.trim() })}
            placeholder="From your Spotify developer dashboard"
            spellcheck="false"
          />
        </label>
        <label class="field">
          <span class="apparatus">Redirect URI</span>
          <input
            class="input"
            value={$settings.spotifyRedirectUri}
            onchange={(event) =>
              void updateSettings({ spotifyRedirectUri: event.currentTarget.value.trim() })}
            spellcheck="false"
          />
        </label>
        <button
          type="button"
          class="btn btn--primary"
          disabled={!$settings.spotifyClientId}
          onclick={() => void connectSpotify()}
        >
          <Icon name="link" size={14} /> Connect Spotify
        </button>
      {/if}

      <p class="note note--small">
        This app uses Authorization Code with PKCE and never handles a client secret. In Spotify's
        development mode an app may authorise at most {DEVELOPMENT_MODE_USER_LIMIT} accounts, and each
        must be added to the app in the dashboard.
      </p>
    </section>

    <!-- ---------------------------------------------------------------- -->
    <section class="group" aria-labelledby="s-sync">
      <h2 id="s-sync" class="group__head title">Your copy in OneDrive</h2>

      <label class="check">
        <input
          type="checkbox"
          checked={$settings.syncEnabled}
          onchange={(event) => void updateSettings({ syncEnabled: event.currentTarget.checked })}
        />
        <span>
          <span class="opts__name">Keep a synced copy in my OneDrive</span>
          <span class="note note--small">
            Written to an app-specific folder only this app can see. Nothing is stored on any server
            of ours, because there isn't one.
          </span>
        </span>
      </label>

      <label class="field">
        <span class="apparatus">Microsoft client ID</span>
        <input
          class="input"
          value={$settings.onedriveClientId}
          onchange={(event) =>
            void updateSettings({ onedriveClientId: event.currentTarget.value.trim() })}
          placeholder="From your Azure app registration"
          spellcheck="false"
        />
      </label>

      <label class="field">
        <span class="apparatus">File name</span>
        <input
          class="input"
          value={$settings.syncFileName}
          onchange={(event) =>
            void updateSettings({
              syncFileName: event.currentTarget.value.trim() || 'ledger.json',
            })}
        />
      </label>

      <p class="note">{$syncState.message}</p>
      {#if $syncState.lastSyncedAt}
        <p class="note note--small">Last synced {dateAndTime($syncState.lastSyncedAt)}.</p>
      {/if}

      <div class="row">
        <button
          type="button"
          class="btn"
          disabled={!$settings.syncEnabled || !$settings.onedriveClientId}
          onclick={() => void connectOneDrive()}
        >
          <Icon name="cloud" size={14} /> Connect OneDrive
        </button>
        <button type="button" class="btn btn--quiet" onclick={() => void syncNow()}>Sync now</button
        >
        <button type="button" class="btn btn--quiet" onclick={() => void disconnectOneDrive()}>
          Disconnect
        </button>
      </div>
    </section>

    <!-- ---------------------------------------------------------------- -->
    <section class="group" aria-labelledby="s-data">
      <h2 id="s-data" class="group__head title">Your data</h2>

      <p class="note">
        {$world.entities.length.toLocaleString()} catalogue items · {$world.ratings.length.toLocaleString()}
        rating events · {$world.comparisons.length.toLocaleString()} comparisons, all held in this browser.
      </p>

      <div class="row">
        <button type="button" class="btn" onclick={() => void exportLedger()}>
          <Icon name="download" size={14} /> Export a backup
        </button>
        <button type="button" class="btn" onclick={() => importFile?.click()} disabled={busy}>
          Restore from a backup
        </button>
        <input
          bind:this={importFile}
          type="file"
          accept="application/json,.json"
          class="sr-only"
          onchange={(event) => void importLedger(event)}
        />
        <a class="btn btn--quiet" href={href('/diagnostics')}>Data health</a>
      </div>

      {#if $settings.demoMode}
        <button
          type="button"
          class="btn btn--quiet"
          disabled={busy}
          onclick={() => void removeDemo()}
        >
          Remove the demonstration catalogue
        </button>
      {:else}
        <button
          type="button"
          class="btn btn--quiet"
          disabled={busy}
          onclick={() => void installDemo()}
        >
          Load the demonstration catalogue
        </button>
      {/if}

      <div class="danger">
        <p class="note">
          Erasing removes every rating, comparison, note and catalogue item in this browser. If sync
          is on, the deletion travels to your OneDrive copy at the next sync. Export first.
        </p>
        <button
          type="button"
          class="btn btn--danger"
          disabled={busy}
          onclick={() => void eraseEverything()}
        >
          Erase everything
        </button>
      </div>
    </section>
  </div>
</div>

<style>
  .groups {
    display: flex;
    flex-direction: column;
    gap: var(--s7);
    max-width: 42rem;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--s4);
  }
  .group__head {
    padding-bottom: var(--s2);
    border-bottom: var(--rule-weight) solid var(--ink);
  }

  .opts {
    display: flex;
    flex-direction: column;
  }
  .opts li {
    border-bottom: var(--rule-weight) solid var(--rule-faint);
    padding: var(--s1) 0;
  }
  .opts__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s3);
  }
  .opts__name {
    display: block;
    font-size: 0.9375rem;
  }

  .weights {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }
  .weights li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 9rem 3rem;
    gap: var(--s3);
    align-items: center;
  }
  .weights__label {
    font-size: 0.875rem;
    color: var(--ink-quiet);
  }
  .weights .figure {
    text-align: right;
    font-size: 0.8125rem;
  }

  .steps {
    display: flex;
    flex-direction: column;
  }
  .steps li {
    display: grid;
    grid-template-columns: 12rem 3rem minmax(0, 1fr);
    gap: var(--s3);
    align-items: baseline;
    padding: 2px 0;
    border-bottom: var(--rule-weight) solid var(--rule-faint);
  }
  .steps__label {
    font-size: 0.8125rem;
  }

  .danger {
    margin-top: var(--s3);
    padding: var(--s4);
    border: var(--rule-weight) solid var(--rubric);
    display: flex;
    flex-direction: column;
    gap: var(--s3);
    align-items: flex-start;
  }

  @media (max-width: 40rem) {
    .weights li {
      grid-template-columns: minmax(0, 1fr) 3rem;
    }
    .weights input[type='range'] {
      grid-column: 1 / -1;
    }
    .steps li {
      grid-template-columns: minmax(0, 1fr) 3rem;
    }
  }
</style>
