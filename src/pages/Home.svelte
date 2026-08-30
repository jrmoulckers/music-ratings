<script lang="ts">
  import { entityHref, href } from '../lib/app/router';
  import {
    coverageByType,
    entityLabel,
    explicitRatings,
    graph,
    recentActivity,
    scaleForType,
    settings,
    suggestions,
    world,
  } from '../lib/app/state';
  import { installApp, pwa } from '../lib/app/pwa';
  import { formatScore } from '../lib/domain/ratings';
  import { suggestionSourceLabel } from '../lib/domain/suggestions';
  import { syncState } from '../lib/storage/autosync';
  import { relative } from '../lib/ui/format';
  import Icon from '../lib/ui/Icon.svelte';
  import Empty from '../components/Empty.svelte';
  import Plate from '../components/Plate.svelte';
  import QueueSpine, { type Stop } from '../components/QueueSpine.svelte';
  import SpecimenNote from '../components/SpecimenNote.svelte';

  /**
   * The desk.
   *
   * The queue is the spine of this page, not a list beside it. What is seated on
   * the rail sits to its left; the record of what has been served sits to its
   * right. Nothing about the next decision is hidden behind a summary.
   */

  interface Props {
    online: boolean;
  }

  let { online }: Props = $props();

  /** Which detent the reader has picked off the rail, if not the seated one. */
  let picked = $state<string | undefined>(undefined);

  const queued = $derived(
    $suggestions.slice(0, 6).flatMap((suggestion) => {
      const entity = $graph.entity(suggestion.entityId);
      return entity ? [{ suggestion, entity }] : [];
    }),
  );

  const shown = $derived(
    queued.find((row) => row.suggestion.entityId === picked)?.suggestion ?? queued[0]?.suggestion,
  );
  const shownEntity = $derived(shown ? $graph.entity(shown.entityId) : undefined);

  /** Served stops keep their place on the rail; they are struck, not removed. */
  const served = $derived(
    $recentActivity.slice(0, 3).flatMap((event) => {
      const entity = $graph.entity(event.entityId);
      return entity ? [{ id: `served:${event.id}`, name: entity.name, served: true }] : [];
    }),
  );

  const stops = $derived<Stop[]>([
    ...[...served].reverse(),
    ...queued.map((row) => ({ id: row.entity.id, name: row.entity.name, served: false })),
  ]);

  const ratedTotal = $derived($explicitRatings.size);
  const comparisonTotal = $derived($world.comparisons.filter((c) => !c.deleted).length);

  const todayCount = $derived.by(() => {
    // Local scratch value inside a derivation, not reactive state.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return $world.ratings.filter((r) => !r.deleted && !r.retracted && r.at >= start.getTime())
      .length;
  });

  const syncLine = $derived.by(() => {
    if (!online) return 'Offline. Everything you do is saved here and sent when you reconnect.';
    if (!$settings.syncEnabled) return 'Saved on this device only. Sync is off.';
    switch ($syncState.status) {
      case 'syncing':
        return 'Sending changes to your OneDrive…';
      case 'pending':
        return 'Changes are waiting to go to OneDrive.';
      case 'conflict':
        return 'Another device wrote to the same file. Open diagnostics to choose which version wins.';
      case 'error':
        return $syncState.message;
      default:
        return $syncState.lastSyncedAt
          ? `Synced to OneDrive ${relative($syncState.lastSyncedAt)}.`
          : 'Sync is on; nothing has been sent yet.';
    }
  });
</script>

<div class="sheet setting">
  <div class="stack stack--loose">
    <header class="desk__head">
      <h1 class="display">The desk</h1>
      <p class="note">
        {ratedTotal.toLocaleString()} ratings · {comparisonTotal.toLocaleString()} weigh-ins · {todayCount}
        today
      </p>
      {#if $settings.demoMode}
        <div class="desk__stamp"><SpecimenNote /></div>
      {/if}
    </header>

    <div class="desk">
      <section class="desk__now" aria-labelledby="next-head">
        <div class="head">
          <h2 id="next-head" class="title">On the rail</h2>
          <a class="apparatus" href={href('/queue')}>Open the queue</a>
        </div>

        {#if shownEntity && shown}
          <a class="next" href={entityHref(shownEntity.id)}>
            <Plate
              src={shownEntity.artworkUrl}
              thumb={shownEntity.artworkThumbUrl}
              name={shownEntity.name}
              size="md"
              priority
            />
            <div class="next__body">
              <p class="apparatus">{entityLabel(shownEntity.type)}</p>
              <p class="next__name display">{shownEntity.name}</p>
              {#if shownEntity.subtitle}<p class="note">{shownEntity.subtitle}</p>{/if}
              <ul class="next__reasons">
                {#each shown.reasons.slice(0, 2) as reason (reason.source)}
                  <li>
                    <span class="apparatus apparatus--rubric"
                      >{suggestionSourceLabel(reason.source)}</span
                    >
                    <span class="note">{reason.detail}</span>
                  </li>
                {/each}
              </ul>
            </div>
          </a>

          <a class="btn btn--primary desk__seat" href={href('/queue')}>
            <Icon name="queue" size={15} /> Seat a grade
          </a>
          <a class="btn desk__alt" href={href('/duel')}>
            <Icon name="balance" size={15} /> Weigh two up instead
          </a>
        {:else}
          <Empty
            title="Nothing waiting"
            body="Either everything enabled has been rated recently, or there is no catalogue yet. Connect Spotify, load the demo catalogue, or widen what you rate."
          >
            {#snippet action()}
              <a class="btn btn--primary" href={href('/settings')}>Open settings</a>
            {/snippet}
          </Empty>
        {/if}
      </section>

      {#if stops.length > 0}
        <div class="desk__spine">
          <QueueSpine
            {stops}
            selectedId={shown?.entityId}
            remaining={$suggestions.length}
            onselect={(id) => (picked = id)}
          />
        </div>
      {/if}

      <section class="desk__record" aria-labelledby="recent-head">
        <div class="head">
          <h2 id="recent-head" class="title">Lately</h2>
          <a class="apparatus" href={href('/timeline')}>The whole record</a>
        </div>
        {#if $recentActivity.length > 0}
          <ul class="lately">
            {#each $recentActivity.slice(0, 9) as event (event.id)}
              {@const entity = $graph.entity(event.entityId)}
              <li>
                <a class="lately__row" href={entityHref(event.entityId)}>
                  <span class="lately__mark figure"
                    >{formatScore(event.normalized, $scaleForType(event.entityType))}</span
                  >
                  <span class="lately__name"
                    >{entity?.name ?? 'Item no longer in the catalogue'}</span
                  >
                  <span class="apparatus">{relative(event.at)}</span>
                </a>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="note">Nothing seated yet. The first grade you seat appears here.</p>
        {/if}
      </section>
    </div>
  </div>

  <aside class="margin">
    <div class="stack stack--tight">
      <h2 class="apparatus">State of the record</h2>
      <p class="note">{syncLine}</p>
      <a class="apparatus" href={href('/diagnostics')}>Data health</a>
    </div>

    <div class="stack stack--tight">
      <h2 class="apparatus">Coverage</h2>
      {#each $coverageByType as row (row.type)}
        <div class="cover">
          <span class="cover__label">{entityLabel(row.type, true)}</span>
          <span class="cover__bar" aria-hidden="true">
            <span class="cover__fill" style:width="{Math.round(row.ratio * 100)}%"></span>
          </span>
          <span class="cover__figure figure">{row.rated}/{row.total}</span>
        </div>
      {/each}
      {#if $coverageByType.every((row) => row.total === 0)}
        <p class="note">No catalogue loaded yet.</p>
      {/if}
    </div>

    {#if $settings.goalsEnabled}
      <div class="stack stack--tight">
        <h2 class="apparatus">Today</h2>
        <p class="figure figure--large">{todayCount} / {$settings.dailyGoal}</p>
        <p class="note">
          A target you set yourself. Turn it off in Settings if it starts feeling like homework.
        </p>
      </div>
    {/if}

    {#if $pwa.installable}
      <div class="stack stack--tight">
        <h2 class="apparatus">Install</h2>
        <p class="note">Keep the ledger in its own window, and open it offline.</p>
        <button type="button" class="btn btn--small" onclick={() => void installApp()}>
          Install the app
        </button>
      </div>
    {/if}
  </aside>
</div>

<style>
  .desk__head {
    padding-bottom: var(--s3);
    border-bottom: var(--rule-weight) solid var(--ink);
  }
  .desk__stamp {
    margin-top: var(--s3);
  }

  /* Twinned columns either side of the rail, which runs the desk's full height. */
  .desk {
    display: grid;
    grid-template-columns: 1.9rem minmax(0, 1fr);
    grid-template-areas:
      'spine now'
      'spine record';
    column-gap: 0;
    row-gap: var(--s6);
    align-items: start;
  }
  .desk__now {
    grid-area: now;
    padding-left: var(--s4);
  }
  .desk__record {
    grid-area: record;
    padding-left: var(--s4);
  }
  .desk__spine {
    grid-area: spine;
    align-self: stretch;
    height: 100%;
  }

  @media (min-width: 64rem) {
    .desk {
      grid-template-columns: minmax(0, 1fr) 2.75rem minmax(0, 1fr);
      grid-template-areas: 'now spine record';
      min-height: min(30rem, calc(100vh - 22rem));
    }
    .desk__now {
      padding-left: 0;
      padding-right: var(--s5);
    }
    .desk__record {
      padding-left: var(--s5);
    }
  }

  .next {
    display: flex;
    gap: var(--s4);
    align-items: flex-start;
    padding: var(--s4);
    background: var(--paper-raised);
    border: var(--rule-weight) solid var(--rule);
    text-decoration: none;
    color: inherit;
    transition: border-color var(--dur-1) var(--ease);
  }
  .next:hover {
    border-color: var(--ink);
  }
  .next__body {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }
  .next__name {
    font-size: clamp(1.25rem, 1rem + 1.1vw, 1.875rem);
    line-height: 1.1;
  }
  .next__reasons {
    display: flex;
    flex-direction: column;
    gap: var(--s1);
    margin-top: var(--s2);
    padding-top: var(--s3);
    border-top: var(--rule-weight) solid var(--rule-faint);
  }
  .next__reasons li {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  /*
   * The primary action is not a button beside the rail; it is a length of the
   * same rubric ink running into it. Its edge lands exactly on the line and it
   * carries its own bracketed detent there, so the grade seats at a mark of its
   * own rather than appearing to dock at whichever stop it happens to pass.
   */
  .desk__seat {
    position: relative;
    margin-top: var(--s4);
    margin-left: calc((var(--s4) + 1.9rem) * -1);
    width: calc(100% + var(--s4) + 1.9rem);
    justify-content: center;
    background: var(--rubric);
    border-color: var(--rubric);
    color: var(--on-rubric);
  }
  .desk__seat:hover:not(:disabled) {
    background: var(--rubric-ink);
    border-color: var(--rubric-ink);
    color: var(--on-rubric);
  }
  .desk__seat::before,
  .desk__seat::after {
    content: '';
    position: absolute;
    left: 0;
    width: 0.5rem;
    height: var(--rule-weight);
    background: var(--rubric);
  }
  .desk__seat::before {
    top: -0.4rem;
  }
  .desk__seat::after {
    bottom: -0.4rem;
  }
  .desk__alt {
    margin-top: var(--s2);
    width: 100%;
    justify-content: center;
  }
  @media (min-width: 64rem) {
    .desk__seat {
      margin-left: 0;
      margin-right: calc(var(--s5) * -1);
      width: calc(100% + var(--s5));
    }
    .desk__seat::before,
    .desk__seat::after {
      left: auto;
      right: -0.5rem;
    }
  }

  .lately {
    display: flex;
    flex-direction: column;
  }
  .lately__row {
    display: grid;
    grid-template-columns: 3rem minmax(0, 1fr) auto;
    gap: var(--s3);
    align-items: baseline;
    padding: var(--s2) 0;
    border-bottom: var(--rule-weight) solid var(--rule-faint);
    text-decoration: none;
    color: inherit;
  }
  .lately__row:hover {
    background: var(--paper-raised);
  }
  .lately__mark {
    color: var(--rubric-ink);
  }
  .lately__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cover {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 4rem auto;
    gap: var(--s2);
    align-items: center;
  }
  .cover__label {
    font-size: 0.8125rem;
    color: var(--ink-quiet);
  }
  .cover__bar {
    height: 6px;
    background: var(--paper-sunk);
    border: var(--rule-weight) solid var(--rule-faint);
  }
  .cover__fill {
    display: block;
    height: 100%;
    background: var(--rubric);
  }
  .cover__figure {
    font-size: 0.6875rem;
    color: var(--ink-faint);
  }

  @media (max-width: 48rem) {
    .next {
      flex-direction: column;
      gap: var(--s4);
      padding: var(--s4);
    }
  }
</style>
