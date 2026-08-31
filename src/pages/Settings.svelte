<script lang="ts">
  import { notify } from '../lib/app/notices';
  import { RECENT_LIMIT, clearRecentSearches, recentSearches } from '../lib/app/recent-searches';
  import { installApp, pwa } from '../lib/app/pwa';
  import { href } from '../lib/app/router';
  import {
    allScales,
    entityLabel,
    entityLabelCap,
    ENTITY_MEANING,
    loadAll,
    settings,
    updateSettings,
    world,
  } from '../lib/app/state';
  import { connectOneDrive, disconnectOneDrive, syncNow } from '../lib/app/sync';
  import { defaultFacets, MAX_CONTEXT_CONTRIBUTION } from '../lib/domain/context';
  import { uid } from '../lib/domain/ids';
  import { SCORE_VIEW_LABEL } from '../lib/domain/ratings';
  import { ROLLUP_CHANNELS, ENTITY_TYPES, PARENT_TYPES, SCORE_VIEWS } from '../lib/domain/types';
  import type { EntityType, FacetConfig, RollupChannel, ScoreView } from '../lib/domain/types';
  import type { AppSettings } from '../lib/storage/settings';
  import { SUGGESTION_SOURCES } from '../lib/domain/types';
  import { equivalenceRows } from '../lib/domain/scales';
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
  import { countPlays, listPlays, purgeListeningHistory } from '../lib/storage/repo';
  import { PLAY_SCHEMA_VERSION, RECENTLY_PLAYED_WINDOW } from '../lib/domain/listening';
  import { completions } from '../lib/app/state';
  import { dateAndTime, fullDate, relative } from '../lib/ui/format';
  import Icon from '../lib/ui/Icon.svelte';
  import ScaleReadingCell from '../components/ScaleReadingCell.svelte';

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

  // The equivalence table: what each step of your default scale reads as on
  // every other scale, computed from the same conversion the app itself uses.
  const defaultScale = $derived(
    $allScales.find((scale) => scale.id === $settings.defaultScaleId) ?? $allScales[0]!,
  );
  const otherScales = $derived($allScales.filter((scale) => scale.id !== defaultScale.id));
  const equivalence = $derived(equivalenceRows(defaultScale, otherScales));

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

  /* --- contextual ratings ------------------------------------------------- */

  let facetType = $state<EntityType>('album');
  let newLabel = $state('');
  let newDescription = $state('');
  let newTypes = $state<EntityType[]>(['album']);

  /** Every question that could apply here, switched off ones included. */
  const facetsHere = $derived(
    $settings.facets
      .filter((facet) => facet.types.includes(facetType))
      .sort((a, b) => (a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : 1)),
  );
  const typeOverride = $derived($settings.contextByType?.[facetType]);
  const contextHere = $derived(typeOverride ?? $settings.contextContribution);

  async function saveFacets(facets: FacetConfig[]) {
    await updateSettings({ facets });
  }

  async function patchFacet(id: string, patch: Partial<FacetConfig>) {
    await saveFacets($settings.facets.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  /** Moves a question past its neighbour here, renumbering the whole list so
      the order is stable whatever else shares these ids. */
  async function moveFacet(id: string, by: 1 | -1) {
    const here = [...facetsHere];
    const at = here.findIndex((f) => f.id === id);
    const to = at + by;
    if (at < 0 || to < 0 || to >= here.length) return;
    const moved = here[at]!;
    here[at] = here[to]!;
    here[to] = moved;
    const orders = new Map(here.map((f, index) => [f.id, index]));
    await saveFacets(
      $settings.facets.map((f) => (orders.has(f.id) ? { ...f, order: orders.get(f.id)! } : f)),
    );
  }

  async function addFacet() {
    const label = newLabel.trim();
    if (!label || newTypes.length === 0) return;
    const id = `custom-${
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'question'
    }-${uid()}`;
    await saveFacets([
      ...$settings.facets,
      {
        id,
        label,
        description: newDescription.trim() || 'Your own judgement.',
        types: [...newTypes],
        weight: 1,
        enabled: true,
        builtin: false,
        order: $settings.facets.length,
      },
    ]);
    newLabel = '';
    newDescription = '';
    notify(`Added “${label}”. Existing ratings keep the answers they were saved with.`);
  }

  async function removeFacet(facet: FacetConfig) {
    await saveFacets($settings.facets.filter((f) => f.id !== facet.id));
    notify(`Removed “${facet.label}”. Ratings that answered it keep the answer, uncounted.`);
  }

  async function restoreFacets() {
    await saveFacets(defaultFacets());
    notify('The built-in questions are back as they started.');
  }

  async function setTypeContribution(value: number | null) {
    const next = { ...($settings.contextByType ?? {}) };
    if (value === null) delete next[facetType];
    else next[facetType] = value;
    await updateSettings({ contextByType: next });
  }

  async function exportBackup() {
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

  async function importBackup(event: Event) {
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

  /* -------------------------------------------------------------------- */
  /* Listening history                                                    */
  /* -------------------------------------------------------------------- */

  let playCount = $state<number | null>(null);
  let confirmForget = $state(false);
  let forgetTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    // Re-counted whenever the log changes, so the figure beside the delete
    // button is never stale enough to make the button feel dishonest.
    void $completions;
    void countPlays().then((n) => (playCount = n));
  });

  async function exportListening(): Promise<void> {
    const plays = await listPlays();
    const payload = {
      kind: 'music-ratings.listening',
      schemaVersion: PLAY_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      observedFrom: $settings.listeningObservedFrom
        ? new Date($settings.listeningObservedFrom).toISOString()
        : null,
      note: 'Plays confirmed by Spotify recently-played only. Not a complete listening history: Spotify returns the latest 50 plays per request, so anything played while this app was closed was never observed.',
      plays,
      completions: $completions,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `music-ratings-listening-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify(`Exported ${plays.length.toLocaleString()} plays as plain JSON.`);
  }

  /**
   * Deleting takes two taps rather than a browser confirm box.
   *
   * The dialog would be the easy thing, but it hands the sentence to the
   * browser to render and gives no room to say what survives. The button says
   * what it is about to do, waits, and reverts if it is left alone.
   */
  async function deleteListening(): Promise<void> {
    if (!confirmForget) {
      confirmForget = true;
      forgetTimer = setTimeout(() => (confirmForget = false), 5000);
      return;
    }
    clearTimeout(forgetTimer);
    confirmForget = false;
    busy = true;
    try {
      const removed = await purgeListeningHistory();
      await updateSettings({ listeningObservedFrom: 0 });
      await loadAll();
      notify(
        `Deleted ${removed.plays.toLocaleString()} plays and ${removed.completions.toLocaleString()} completions. Your ratings are untouched.`,
      );
    } finally {
      busy = false;
    }
  }
</script>

<div class="sheet">
  <header class="head">
    <h1 class="display">Settings</h1>
    <p class="label">saved as you change them</p>
  </header>

  <div class="groups">
    <!-- ---------------------------------------------------------------- -->
    <section class="group" aria-labelledby="s-rating">
      <h2 id="s-rating" class="group__head title">What you rate, and how</h2>

      <div class="field">
        <span class="label">Kinds of things</span>
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
                  <span class="opts__name">{entityLabelCap(type, true)}</span>
                  <span class="note note--small">{ENTITY_MEANING[type]}</span>
                  {#if ENTITY_SUPPORT[type].note}
                    <span class="note note--small opts__limit">
                      <span class="opts__tag">Spotify limit</span>
                      {ENTITY_SUPPORT[type].note}
                    </span>
                  {/if}
                </span>
              </label>
            </li>
          {/each}
        </ul>
      </div>

      <label class="field">
        <span class="label">Default scale</span>
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
        <span class="label">Scale per kind</span>
        <ul class="opts">
          {#each $settings.enabledTypes as type (type)}
            <li class="opts__row">
              <span class="opts__name">{entityLabelCap(type, true)}</span>
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

      <div class="field">
        <span class="label">How the scales line up</span>
        <p class="note note--small">
          Every rating is stored once, on a shared 0–100 basis. This is what each step of your
          default scale means everywhere else, so switching scales relabels your history rather than
          rewriting it.
        </p>
        <div class="equiv__scroll">
          <table class="equiv">
            <thead>
              <tr>
                <th scope="col">{defaultScale.label}</th>
                {#each otherScales as other (other.id)}
                  <th scope="col">{other.label}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each equivalence as row (row.key)}
                <tr>
                  <th scope="row">
                    <ScaleReadingCell reading={row.head} />
                  </th>
                  {#each row.on as cell, index (otherScales[index]?.id ?? index)}
                    <td class="figure"><ScaleReadingCell reading={cell} /></td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- ---------------------------------------------------------------- -->
    <section class="group" aria-labelledby="s-scores">
      <h2 id="s-scores" class="group__head title">How computed scores are worked out</h2>

      <label class="field">
        <span class="label">Weights for</span>
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
          <span class="label">Averaging</span>
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
          <span class="label">
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
          <span class="label">
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
        <span class="label">Which score is shown by default</span>
        <select
          class="select"
          value={$settings.scoreView}
          onchange={(event) =>
            void updateSettings({ scoreView: event.currentTarget.value as ScoreView })}
        >
          {#each SCORE_VIEWS as view (view)}
            <option value={view}>{SCORE_VIEW_LABEL[view]}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span class="label">
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
    <section class="group" aria-labelledby="s-context">
      <h2 id="s-context" class="group__head title">Deeper rating</h2>

      <p class="note">
        Beside your own rating you can answer a few optional questions — how original it was for its
        time, how well it holds up, how well made it is. Those answers make a deeper score, which is
        your judgement rather than Spotify data. It only moves rankings and computed scores when you
        switch it on below.
      </p>

      <label class="check">
        <input
          type="checkbox"
          checked={$settings.contextEnabled}
          onchange={(event) => void updateSettings({ contextEnabled: event.currentTarget.checked })}
        />
        <span>Let deeper answers change your ratings</span>
      </label>

      <label class="field">
        <span class="label">
          {$settings.contextEnabled
            ? `Deeper carries ${Math.round($settings.contextContribution * 100)}% of a rating`
            : 'Recorded but not counted — answers are saved either way'}
        </span>
        <input
          class="slider"
          type="range"
          min="0"
          max={MAX_CONTEXT_CONTRIBUTION}
          step="0.05"
          value={$settings.contextContribution}
          disabled={!$settings.contextEnabled}
          oninput={(event) =>
            void updateSettings({ contextContribution: Number(event.currentTarget.value) })}
        />
      </label>
      <p class="note note--small">
        Capped at {Math.round(MAX_CONTEXT_CONTRIBUTION * 100)}%. It is there to inform your
        judgement, never to outvote it.
      </p>

      <label class="field">
        <span class="label">Questions for</span>
        <select class="select" bind:value={facetType}>
          {#each ENTITY_TYPES as type (type)}
            <option value={type}>{entityLabelCap(type, true)}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span class="label">
          {typeOverride === undefined
            ? `${entityLabelCap(facetType, true)} follow the setting above (${Math.round($settings.contextContribution * 100)}%)`
            : `${entityLabelCap(facetType, true)} use ${Math.round(typeOverride * 100)}% instead`}
        </span>
        <input
          class="slider"
          type="range"
          min="0"
          max={MAX_CONTEXT_CONTRIBUTION}
          step="0.05"
          value={contextHere}
          disabled={!$settings.contextEnabled}
          oninput={(event) => void setTypeContribution(Number(event.currentTarget.value))}
        />
      </label>
      {#if typeOverride !== undefined}
        <p>
          <button
            type="button"
            class="btn btn--small"
            onclick={() => void setTypeContribution(null)}
          >
            Follow the setting above again
          </button>
        </p>
      {/if}

      <ul class="facets">
        {#each facetsHere as facet, index (facet.id)}
          <li class="facet" class:is-off={!facet.enabled}>
            <div class="facet__top">
              <label class="check facet__on">
                <input
                  type="checkbox"
                  checked={facet.enabled}
                  onchange={(event) =>
                    void patchFacet(facet.id, { enabled: event.currentTarget.checked })}
                />
                <span class="sr-only">Ask “{facet.label}” about {entityLabel(facetType, true)}</span
                >
              </label>
              <input
                class="input facet__label"
                value={facet.label}
                aria-label="Name of this question"
                onchange={(event) =>
                  void patchFacet(facet.id, {
                    label: event.currentTarget.value.trim() || facet.label,
                  })}
              />
              <span class="facet__move">
                <button
                  type="button"
                  class="btn btn--small btn--quiet"
                  disabled={index === 0}
                  onclick={() => void moveFacet(facet.id, -1)}
                >
                  <Icon name="arrow-up" size={13} />
                  <span class="sr-only">Move {facet.label} up</span>
                </button>
                <button
                  type="button"
                  class="btn btn--small btn--quiet"
                  disabled={index === facetsHere.length - 1}
                  onclick={() => void moveFacet(facet.id, 1)}
                >
                  <Icon name="arrow-down" size={13} />
                  <span class="sr-only">Move {facet.label} down</span>
                </button>
                {#if !facet.builtin}
                  <button
                    type="button"
                    class="btn btn--small btn--quiet"
                    onclick={() => void removeFacet(facet)}
                  >
                    Remove
                    <span class="sr-only">{facet.label}</span>
                  </button>
                {/if}
              </span>
            </div>

            <input
              class="input facet__desc"
              value={facet.description}
              aria-label="What “{facet.label}” asks"
              onchange={(event) =>
                void patchFacet(facet.id, {
                  description: event.currentTarget.value.trim() || facet.description,
                })}
            />

            <div class="facet__weight">
              <input
                class="slider"
                type="range"
                min="0"
                max="3"
                step="0.25"
                value={facet.weight}
                disabled={!facet.enabled}
                aria-label="Weight of {facet.label}"
                oninput={(event) =>
                  void patchFacet(facet.id, { weight: Number(event.currentTarget.value) })}
              />
              <span class="figure">×{facet.weight}</span>
            </div>
          </li>
        {/each}
      </ul>
      {#if facetsHere.length === 0}
        <p class="note">
          No questions apply to {entityLabel(facetType, true)} yet. Add one below.
        </p>
      {/if}
      <p class="note note--small">
        Weights are relative and renormalised over whatever you actually answer, so leaving a
        question blank raises the others rather than dragging the score down. Changing weights
        changes what today's scores read; the answers on each entry stay exactly as you gave them.
      </p>

      <details class="facets__add">
        <summary class="label">Add a question</summary>
        <label class="field">
          <span class="label">Name</span>
          <input class="input" bind:value={newLabel} placeholder="Lyrics" />
        </label>
        <label class="field">
          <span class="label">What it asks</span>
          <input class="input" bind:value={newDescription} placeholder="How good the writing is." />
        </label>
        <fieldset class="types">
          <legend class="label">Ask it about</legend>
          <div class="types__grid">
            {#each ENTITY_TYPES as type (type)}
              <label class="check">
                <input
                  type="checkbox"
                  checked={newTypes.includes(type)}
                  onchange={() =>
                    (newTypes = newTypes.includes(type)
                      ? newTypes.filter((t) => t !== type)
                      : [...newTypes, type])}
                />
                <span>{entityLabelCap(type, true)}</span>
              </label>
            {/each}
          </div>
        </fieldset>
        <p>
          <button
            type="button"
            class="btn btn--primary"
            disabled={!newLabel.trim() || newTypes.length === 0}
            onclick={() => void addFacet()}
          >
            Add question
          </button>
        </p>
      </details>

      <p>
        <button type="button" class="btn btn--small" onclick={() => void restoreFacets()}>
          Restore the built-in questions
        </button>
      </p>
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
        <span class="label">
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
        <span class="label">
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
          <span class="label">Target {$settings.dailyGoal} a day</span>
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
        <span class="label">Theme</span>
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
        <span class="label">Density</span>
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
        <span class="label">Motion</span>
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
        <span class="label">Artwork</span>
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
          <span class="label">Client ID</span>
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
          <span class="label">Redirect URI</span>
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
    <section class="group" aria-labelledby="s-playback">
      <h2 id="s-playback" class="group__head title">Playing and rating live</h2>

      <p class="note">
        This app can control Spotify playback on your devices and show what is playing, so you can
        rate it as you listen. Spotify only allows this for Premium accounts. Nothing about playback
        is stored or synced.
      </p>

      {#if $spotifySession.connected && $spotifySession.missingPlaybackScopes}
        <p class="note note--warn">
          Your connection was made before this app could read playback. Reconnect above to grant
          those permissions.
        </p>
      {/if}

      <label class="check">
        <input
          type="checkbox"
          checked={$settings.browserPlayer}
          onchange={(event) => void updateSettings({ browserPlayer: event.currentTarget.checked })}
        />
        <span>
          <span>Let this browser be a Spotify device</span>
          <span class="note note--small">
            Adds Spotify's player to this tab so sound can come out here. Needs Premium and one more
            Spotify permission, so reconnect after turning it on. It stops when the tab closes.
          </span>
        </span>
      </label>

      {#if $settings.browserPlayer && $spotifySession.connected && $spotifySession.missingStreamingScope}
        <p class="note note--warn">
          Reconnect Spotify to grant the playback permission this needs.
          <button type="button" class="btn btn--small" onclick={() => void connectSpotify()}>
            Reconnect
          </button>
        </p>
      {/if}

      <label class="field">
        <span class="label">How often to check what is playing</span>
        <select
          class="select"
          value={$settings.playbackPolling}
          onchange={(event) =>
            void updateSettings({
              playbackPolling: event.currentTarget.value as AppSettings['playbackPolling'],
            })}
        >
          <option value="responsive">Responsive — every few seconds while playing</option>
          <option value="relaxed">Relaxed — less often, fewer requests</option>
          <option value="manual">Only when I ask</option>
        </select>
        <span class="note note--small">
          Checking stops entirely when this tab is hidden or offline, whichever you pick.
        </span>
      </label>

      <label class="check">
        <input
          type="checkbox"
          checked={$settings.autoAlbumMode}
          onchange={(event) => void updateSettings({ autoAlbumMode: event.currentTarget.checked })}
        />
        <span>
          <span>Offer track-by-track rating when I play a record</span>
          <span class="note note--small">
            When Spotify is playing an album from start to finish, Now Playing offers its track list
            so you can rate as you go.
          </span>
        </span>
      </label>

      <p class="note note--small">
        Preferred device: {$settings.preferredDeviceId
          ? 'set on this device'
          : 'none — the app uses whatever Spotify is already playing on'}. Choose one from the
        device list in Now Playing.
      </p>
    </section>

    <!-- ---------------------------------------------------------------- -->
    <section class="group" aria-labelledby="s-listening">
      <h2 id="s-listening" class="group__head title">Listening history</h2>

      <p class="note">
        With this on, the app keeps a record of what Spotify says you played. It only counts a play
        once Spotify itself lists it in your recently played — never from how far a track got in
        this app. That log is yours: it stays on your devices, travels in your OneDrive copy if you
        sync, and can be exported or deleted here at any time.
      </p>

      <label class="check">
        <input
          type="checkbox"
          checked={$settings.listeningEnabled}
          onchange={(event) =>
            void updateSettings({ listeningEnabled: event.currentTarget.checked })}
        />
        <span>
          <span>Keep a record of what I played</span>
          <span class="note note--small">
            {#if $settings.listeningObservedFrom > 0}
              Watching since {fullDate($settings.listeningObservedFrom)}. Turning this off stops new
              plays being recorded and leaves what is already stored alone.
            {:else}
              Nothing recorded yet. Recording starts the next time listening is refreshed.
            {/if}
          </span>
        </span>
      </label>

      <p class="note note--small">
        Spotify returns only the latest {RECENTLY_PLAYED_WINDOW} plays each time it is asked, so anything
        played while this app was closed for a long stretch was never visible to it. Nothing here is a
        lifetime total, and Spotify publishes no comparison with other listeners, so this app shows none.
      </p>

      <label class="check">
        <input
          type="checkbox"
          checked={$settings.completionPrompts}
          disabled={!$settings.listeningEnabled}
          onchange={(event) =>
            void updateSettings({ completionPrompts: event.currentTarget.checked })}
        />
        <span>
          <span>Tell me when I finish a record</span>
          <span class="note note--small">
            Shows a card on Home and Rate once every available track on an album has a confirmed
            play inside the window below. It waits to be answered; it never interrupts playback and
            never rates anything for you.
          </span>
        </span>
      </label>

      <label class="field">
        <span class="label">Completion window</span>
        <select
          class="select"
          value={String($settings.completionWindowDays)}
          disabled={!$settings.listeningEnabled}
          onchange={(event) =>
            void updateSettings({ completionWindowDays: Number(event.currentTarget.value) })}
        >
          <option value="1">One day — a record heard in a single stretch</option>
          <option value="7">A week</option>
          <option value="30">A month (default)</option>
          <option value="90">Three months</option>
          <option value="365">A year — very forgiving</option>
        </select>
        <span class="note note--small">
          How close together the plays have to be. Every track must be heard inside this span for
          the record to count as finished, so a long window means tracks heard months apart can
          still close an album.
        </span>
      </label>

      <label class="field">
        <span class="label">Finishing a record again</span>
        <select
          class="select"
          value={$settings.recompletionMode}
          disabled={!$settings.listeningEnabled}
          onchange={(event) =>
            void updateSettings({
              recompletionMode: event.currentTarget.value as AppSettings['recompletionMode'],
            })}
        >
          <option value="off">Only ever record the first time</option>
          <option value="fresh">Every fresh listen through (default)</option>
          <option value="cooldown">A fresh listen, but not too soon</option>
        </select>
        <span class="note note--small">
          A fresh listen means every track heard again after the last completion ended — the same
          evidence can never close a record twice.
        </span>
      </label>

      {#if $settings.recompletionMode === 'cooldown'}
        <label class="field">
          <span class="label">Wait at least</span>
          <select
            class="select"
            value={String($settings.recompletionCooldownDays)}
            onchange={(event) =>
              void updateSettings({ recompletionCooldownDays: Number(event.currentTarget.value) })}
          >
            <option value="30">A month</option>
            <option value="90">Three months (default)</option>
            <option value="180">Six months</option>
            <option value="365">A year</option>
          </select>
        </label>
      {/if}

      <label class="field">
        <span class="label">Rank listening by</span>
        <select
          class="select"
          value={$settings.listeningBasis}
          onchange={(event) =>
            void updateSettings({
              listeningBasis: event.currentTarget.value as AppSettings['listeningBasis'],
            })}
        >
          <option value="plays">Number of plays</option>
          <option value="minutes">Estimated minutes</option>
        </select>
        <span class="note note--small">
          Minutes are worked out from track lengths. Spotify does not say how much of a track was
          actually heard, so it is the length of what was played, not time spent listening.
        </span>
      </label>

      <label class="field">
        <span class="label">Keep plays for</span>
        <select
          class="select"
          value={String($settings.listeningRetentionDays)}
          onchange={(event) =>
            void updateSettings({ listeningRetentionDays: Number(event.currentTarget.value) })}
        >
          <option value="0">As long as I keep them</option>
          <option value="365">A year</option>
          <option value="730">Two years</option>
          <option value="1825">Five years</option>
        </select>
        <span class="note note--small">
          Older plays are removed on the next refresh. Completions already recorded are kept — they
          store their own evidence.
        </span>
      </label>

      <div class="row">
        <div>
          <p class="row__label">What is stored</p>
          <p class="note note--small">
            {playCount === null ? '…' : playCount.toLocaleString()} plays · {$completions.length.toLocaleString()}
            completions{$settings.listeningObservedFrom > 0
              ? ` · since ${fullDate($settings.listeningObservedFrom)}`
              : ''}
          </p>
        </div>
        <button type="button" class="btn btn--small" onclick={() => void exportListening()}>
          Export listening history
        </button>
      </div>

      <div class="row">
        <div>
          <p class="row__label">Forget what I played</p>
          <p class="note note--small">
            Deletes every play and every completion, here and on your other devices next time they
            sync. Your ratings are untouched — they are separate records and always were.
          </p>
        </div>
        <button
          type="button"
          class="btn btn--small btn--danger"
          onclick={() => void deleteListening()}
        >
          {confirmForget ? 'Tap again to delete' : 'Delete listening history'}
        </button>
      </div>
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
        <span class="label">Microsoft client ID</span>
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
        <span class="label">File name</span>
        <input
          class="input"
          value={$settings.syncFileName}
          onchange={(event) =>
            void updateSettings({
              syncFileName: event.currentTarget.value.trim() || 'music-ratings.json',
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
        <button type="button" class="btn" onclick={() => void exportBackup()}>
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
          onchange={(event) => void importBackup(event)}
        />
        <a class="btn btn--quiet" href={href('/diagnostics')}>Data health</a>
      </div>

      <div class="setting">
        <div>
          <p class="label">Recent searches</p>
          <p class="note note--small">
            The last {RECENT_LIMIT} things you searched for, kept in this browser only — never in your
            library and never synced.
          </p>
        </div>
        <button
          type="button"
          class="btn btn--small"
          disabled={$recentSearches.length === 0}
          onclick={() => clearRecentSearches()}
        >
          {$recentSearches.length === 0 ? 'None kept' : `Clear ${$recentSearches.length}`}
        </button>
      </div>

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
    border-bottom: var(--rule-weight) solid var(--border-faint);
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
  /* A limitation is not a definition, so it is marked as coming from Spotify
     rather than sitting in the same voice as the description above it. */
  .opts__limit {
    display: block;
    margin-top: 2px;
  }
  .opts__tag {
    font-size: 0.6875rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-quiet);
    border: var(--rule-weight) solid var(--border);
    padding: 0 4px;
    margin-right: 2px;
    white-space: nowrap;
  }

  .weights {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }

  /* Each question is one editable object: what it is called, what it asks, and
     how much it counts, on three lines that stay in that order at any width. */
  .facets {
    display: flex;
    flex-direction: column;
  }
  .facet {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    padding: var(--s3) 0;
    border-top: var(--rule-weight) solid var(--border-faint);
  }
  .facet:last-child {
    border-bottom: var(--rule-weight) solid var(--border-faint);
  }
  .facet.is-off {
    opacity: 0.55;
  }
  .facet__top {
    display: flex;
    align-items: center;
    gap: var(--s2);
    flex-wrap: wrap;
  }
  .facet__on {
    flex: none;
  }
  .facet__label {
    flex: 1 1 12rem;
    min-width: 0;
    font-weight: 600;
  }
  .facet__move {
    display: flex;
    gap: var(--s1);
    flex: none;
  }
  .facet__desc {
    width: 100%;
    font-size: 0.875rem;
  }
  .facet__weight {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 3rem;
    gap: var(--s3);
    align-items: center;
  }
  .facet__weight .figure {
    font-variant-numeric: tabular-nums;
    font-size: 0.875rem;
  }

  .facets__add summary {
    cursor: pointer;
    padding: var(--s2) 0;
  }
  .types {
    border: 0;
    padding: 0;
    margin: 0 0 var(--s3);
  }
  .types__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: var(--s2);
    margin-top: var(--s2);
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
    border-bottom: var(--rule-weight) solid var(--border-faint);
  }
  .steps__label {
    font-size: 0.8125rem;
  }

  .danger {
    margin-top: var(--s3);
    padding: var(--s4);
    border: var(--rule-weight) solid var(--accent);
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
  .equiv__scroll {
    overflow-x: auto;
    margin-top: var(--s3);
    border: var(--rule-weight) solid var(--border);
    border-radius: var(--radius);
  }
  .equiv {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
    white-space: nowrap;
  }
  .equiv th,
  .equiv td {
    padding: var(--s2) var(--s3);
    text-align: left;
    border-bottom: var(--rule-weight) solid var(--border-faint);
  }
  .equiv thead th {
    color: var(--ink-quiet);
    font-weight: 600;
    background: var(--surface-sunk);
  }
  .equiv tbody th {
    color: var(--accent-ink);
    font-weight: 650;
  }
  .equiv tbody tr:last-child th,
  .equiv tbody tr:last-child td {
    border-bottom: 0;
  }
</style>
