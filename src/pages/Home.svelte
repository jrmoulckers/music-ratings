<script lang="ts">
  import { entityHref, href } from '../lib/app/router';
  import {
    coverageByType,
    entityLabelCap,
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
  import { suggestionSourceLabel, TIER_JUST_PLAYED } from '../lib/domain/suggestions';
  import { openSearch } from '../lib/app/search-overlay';
  import { syncState } from '../lib/storage/autosync';
  import { relative } from '../lib/ui/format';
  import Icon from '../lib/ui/Icon.svelte';
  import Empty from '../components/Empty.svelte';
  import Artwork from '../components/Artwork.svelte';
  import EntityTypeIcon from '../components/EntityTypeIcon.svelte';
  import RatableRow from '../components/RatableRow.svelte';

  /**
   * Home.
   *
   * What to rate next, and what you have rated lately. Things you actually
   * played come first and are labelled as such, because a suggestion you can
   * trace back to your own listening is worth more than one that was inferred.
   */

  interface Props {
    online: boolean;
  }

  let { online }: Props = $props();

  let openId = $state<string | null>(null);

  const queued = $derived(
    $suggestions.slice(0, 6).flatMap((suggestion) => {
      const entity = $graph.entity(suggestion.entityId);
      return entity ? [{ suggestion, entity }] : [];
    }),
  );

  /** Everything you genuinely played recently, in priority order. */
  const justPlayed = $derived(
    $suggestions
      .filter((suggestion) => suggestion.tier === TIER_JUST_PLAYED)
      .flatMap((suggestion) => {
        const entity = $graph.entity(suggestion.entityId);
        return entity ? [{ suggestion, entity }] : [];
      }),
  );

  const shown = $derived(queued[0]?.suggestion);
  const shownEntity = $derived(shown ? $graph.entity(shown.entityId) : undefined);
  const shownIsPlayed = $derived(shown?.tier === TIER_JUST_PLAYED);

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
    <header class="home__head">
      <h1 class="display">Home</h1>
      <p class="note">
        What to rate next, and what you have rated lately. {ratedTotal.toLocaleString()} ratings · {comparisonTotal.toLocaleString()}
        comparisons · {todayCount} today
      </p>
      <button type="button" class="home__find" onclick={() => openSearch()}>
        <Icon name="search" size={16} />
        <span>Search for something to rate</span>
        <kbd class="home__key">/</kbd>
      </button>
    </header>

    <div class="home">
      <section class="home__now" aria-labelledby="next-head">
        <div class="head">
          <h2 id="next-head" class="title">
            {shownIsPlayed ? 'You just played this' : 'Next to rate'}
          </h2>
          <a class="label" href={href('/rate')}>Open the queue</a>
        </div>

        {#if shownEntity && shown}
          <a class="next" class:next--played={shownIsPlayed} href={entityHref(shownEntity.id)}>
            <Artwork
              src={shownEntity.artworkUrl}
              thumb={shownEntity.artworkThumbUrl}
              name={shownEntity.name}
              size="md"
              priority
            />
            <div class="next__body">
              <p class="label next__kind">
                <EntityTypeIcon type={shownEntity.type} size={14} />
                <span>{entityLabelCap(shownEntity.type)}</span>
              </p>
              <p class="next__name display">{shownEntity.name}</p>
              {#if shownEntity.subtitle}<p class="note">{shownEntity.subtitle}</p>{/if}
              <ul class="next__reasons">
                {#each shown.reasons.slice(0, 2) as reason (reason.source)}
                  <li>
                    <span class="label label--accent">{suggestionSourceLabel(reason.source)}</span>
                    <span class="note">{reason.detail}</span>
                  </li>
                {/each}
              </ul>
            </div>
          </a>

          <a class="btn btn--primary home__seat" href={href('/rate')}>
            <Icon name="queue" size={15} /> Rate this
          </a>
          <a class="btn home__alt" href={href('/compare')}>
            <Icon name="versus" size={15} /> Compare two instead
          </a>
        {:else}
          <Empty
            title="Nothing waiting"
            body="Either everything you have enabled was rated recently, or there is nothing in your library yet. Connect Spotify, or search for something to rate."
          >
            {#snippet action()}
              <button type="button" class="btn btn--primary" onclick={() => openSearch()}>
                Search for something to rate
              </button>
            {/snippet}
          </Empty>
        {/if}
      </section>

      <section class="home__record" aria-labelledby="recent-head">
        {#if justPlayed.length > 0}
          <div class="head">
            <h2 class="title">Recently played, not yet rated</h2>
            <span class="label">First in the queue</span>
          </div>
          <ul class="played">
            {#each justPlayed.slice(0, 5) as row (row.entity.id)}
              <RatableRow
                entity={row.entity}
                suggestion={row.suggestion}
                queueActions
                expanded={openId === row.entity.id}
                ontoggle={() => (openId = openId === row.entity.id ? null : row.entity.id)}
                onafter={() => {
                  if (openId === row.entity.id) openId = null;
                }}
              />
            {/each}
          </ul>
        {/if}

        <div class="head" class:head--spaced={justPlayed.length > 0}>
          <h2 id="recent-head" class="title">Recently rated</h2>
          <a class="label" href={href('/history')}>Full history</a>
        </div>
        {#if $recentActivity.length > 0}
          <ul class="lately">
            {#each $recentActivity.slice(0, justPlayed.length > 0 ? 5 : 9) as event (event.id)}
              {@const entity = $graph.entity(event.entityId)}
              <li>
                <a class="lately__row" href={entityHref(event.entityId)}>
                  <span class="lately__mark figure"
                    >{formatScore(event.normalized, $scaleForType(event.entityType))}</span
                  >
                  <span class="lately__name"
                    >{entity?.name ?? 'Item no longer in the catalogue'}</span
                  >
                  <span class="label">{relative(event.at)}</span>
                </a>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="note">Nothing rated yet. Your first rating appears here.</p>
        {/if}
      </section>
    </div>
  </div>

  <aside class="margin">
    <div class="stack stack--tight">
      <h2 class="label">Sync status</h2>
      <p class="note">{syncLine}</p>
      <a class="label" href={href('/diagnostics')}>Data health</a>
    </div>

    <div class="stack stack--tight">
      <h2 class="label">Coverage</h2>
      {#each $coverageByType as row (row.type)}
        <div class="cover">
          <span class="cover__label">{entityLabelCap(row.type, true)}</span>
          <span class="cover__bar" aria-hidden="true">
            <span class="cover__fill" style:width="{Math.round(row.ratio * 100)}%"></span>
          </span>
          <span class="cover__figure figure">{row.rated}/{row.total}</span>
        </div>
      {/each}
      {#if $coverageByType.every((row) => row.total === 0)}
        <p class="note">Nothing in your library yet.</p>
      {/if}
    </div>

    {#if $settings.goalsEnabled}
      <div class="stack stack--tight">
        <h2 class="label">Today</h2>
        <p class="figure figure--large">{todayCount} / {$settings.dailyGoal}</p>
        <p class="note">
          A target you set yourself. Turn it off in Settings if it starts feeling like homework.
        </p>
      </div>
    {/if}

    {#if $pwa.installable}
      <div class="stack stack--tight">
        <h2 class="label">Install</h2>
        <p class="note">Keep this in its own window, and open it offline.</p>
        <button type="button" class="btn btn--small" onclick={() => void installApp()}>
          Install the app
        </button>
      </div>
    {/if}
  </aside>
</div>

<style>
  .home__head {
    padding-bottom: var(--s3);
    border-bottom: var(--rule-weight) solid var(--ink);
  }

  .home__find {
    display: flex;
    align-items: center;
    gap: var(--s3);
    width: 100%;
    margin-top: var(--s4);
    padding: var(--s3) var(--s4);
    background: var(--surface-raised);
    border: var(--rule-weight) solid var(--border);
    border-radius: var(--radius);
    color: var(--ink-quiet);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      border-color var(--dur-1) var(--ease),
      color var(--dur-1) var(--ease);
  }
  .home__find:hover {
    border-color: var(--ink);
    color: var(--ink);
  }
  .home__find span {
    flex: 1;
  }
  .home__key {
    font-family: var(--mono);
    font-size: 0.6875rem;
    padding: 2px 6px;
    border: var(--rule-weight) solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--ink-faint);
  }

  /* Two plain columns: what to do next on the left, what has happened on the
     right. They stack on narrow screens. */
  .home {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s6);
    align-items: start;
  }

  @media (min-width: 64rem) {
    .home {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      column-gap: var(--s7);
    }
  }

  .next {
    display: flex;
    gap: var(--s4);
    align-items: flex-start;
    padding: var(--s4);
    background: var(--surface-raised);
    border: var(--rule-weight) solid var(--border);
    border-radius: var(--radius);
    text-decoration: none;
    color: inherit;
    transition: border-color var(--dur-1) var(--ease);
  }
  .next:hover {
    border-color: var(--ink);
  }
  /* Something you genuinely played is marked on its rule, not slabbed down one
     edge: the reason list underneath already says why it is here. */
  .next--played {
    border-top-color: var(--accent);
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
    border-top: var(--rule-weight) solid var(--border-faint);
  }
  .next__reasons li {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .home__seat {
    margin-top: var(--s4);
    width: 100%;
    justify-content: center;
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .home__seat:hover:not(:disabled) {
    background: var(--accent-ink);
    border-color: var(--accent-ink);
    color: var(--on-accent);
  }
  .home__alt {
    margin-top: var(--s2);
    width: 100%;
    justify-content: center;
  }

  .next__kind {
    display: flex;
    align-items: center;
    gap: var(--s2);
  }

  .played {
    display: flex;
    flex-direction: column;
    margin-bottom: var(--s5);
  }

  .head--spaced {
    margin-top: var(--s5);
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
    border-bottom: var(--rule-weight) solid var(--border-faint);
    text-decoration: none;
    color: inherit;
  }
  .lately__row:hover {
    background: var(--surface-raised);
  }
  .lately__mark {
    color: var(--accent-ink);
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
    background: var(--surface-sunk);
    border: var(--rule-weight) solid var(--border-faint);
    border-radius: var(--radius-sm);
  }
  .cover__fill {
    display: block;
    height: 100%;
    background: var(--accent);
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
