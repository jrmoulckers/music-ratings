<script lang="ts">
  import { announce } from '../lib/app/notices';
  import { entityHref } from '../lib/app/router';
  import {
    entityLabelCap,
    explicitRatings,
    graph,
    scaleForType,
    settings,
    world,
  } from '../lib/app/state';
  import { formatScore } from '../lib/domain/ratings';
  import type { EntityType, RatingEvent } from '../lib/domain/types';
  import { deleteRating, retractRating } from '../lib/storage/repo';
  import { dateAndTime, fullDate } from '../lib/ui/format';
  import { entryAction, entryStanding, seedFrom } from '../lib/ui/history';
  import { TIER_EDGE, TIER_INK, isTierScale, tierColor } from '../lib/ui/tiers';
  import AutoLoad from '../components/AutoLoad.svelte';
  import Empty from '../components/Empty.svelte';
  import EntityTypeIcon from '../components/EntityTypeIcon.svelte';
  import QuickRate from '../components/QuickRate.svelte';
  import RatePanel from '../components/RatePanel.svelte';

  /**
   * The record.
   *
   * Every rating, in the order it was made, grouped by day. Nothing is ever
   * rewritten: rating something again writes a new entry above the old one, and
   * the old one stays exactly as it was made.
   *
   * Which is why each entry is also a place to rate from. Opening one hands you
   * the shared editor filled in from *that* entry — its value, its note, its
   * confidence — so "I would give this a seven now" starts from the six you
   * gave it in March rather than from nothing. Saving still writes a new entry.
   *
   * Two things can be done to an entry itself, and they are deliberately not
   * offered at the same time. A live entry can be withdrawn: it stays in the
   * record, struck through, and stops counting. Only a withdrawn entry can then
   * be deleted outright, which is the one action here that loses something.
   */

  let typeFilter = $state<EntityType | 'all'>('all');
  let showRetracted = $state(false);
  let search = $state('');
  let limit = $state(120);
  /** At most one entry is open for editing, so a long day stays a list. */
  let openId = $state<string | null>(null);
  /** Deleting asks first, in place, rather than throwing up a dialog. */
  let confirmId = $state<string | null>(null);

  const events = $derived.by(() => {
    const needle = search.trim().toLowerCase();
    return [...$world.ratings]
      .filter((event) => {
        if (event.deleted) return false;
        if (event.retracted && !showRetracted) return false;
        if (typeFilter !== 'all' && event.entityType !== typeFilter) return false;
        if (!needle) return true;
        const entity = $graph.entity(event.entityId);
        return (
          (entity?.name.toLowerCase().includes(needle) ?? false) ||
          (event.note?.toLowerCase().includes(needle) ?? false)
        );
      })
      .sort((a, b) => b.at - a.at);
  });

  const days = $derived.by(() => {
    // Local scratch collection inside a derivation, not reactive state.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const groups = new Map<string, typeof events>();
    for (const event of events.slice(0, limit)) {
      const key = fullDate(event.at);
      const bucket = groups.get(key);
      if (bucket) bucket.push(event);
      else groups.set(key, [event]);
    }
    return [...groups.entries()];
  });

  /** Where this entry stands: the rating in force, an earlier one, or withdrawn. */
  function standing(event: RatingEvent) {
    return entryStanding(event, $explicitRatings.get(event.entityId)?.eventId);
  }

  function markFor(event: RatingEvent): { text: string; swatch: string | null } {
    const scale = $scaleForType(event.entityType);
    const text = formatScore(event.normalized, scale);
    return { text, swatch: isTierScale(scale) ? tierColor(text) : null };
  }

  function toggle(event: RatingEvent): void {
    openId = openId === event.id ? null : event.id;
    confirmId = null;
  }

  async function withdraw(event: RatingEvent): Promise<void> {
    const entity = $graph.entity(event.entityId);
    // Read before the write: once the world reloads this entry is no longer
    // anybody's current rating, and the message would be about the wrong thing.
    const wasCurrent = standing(event) === 'current';
    await retractRating(event.id);
    announce(
      wasCurrent
        ? `Withdrawn. ${entity?.name ?? 'That entry'} now takes its previous rating, if there is one.`
        : `Entry withdrawn. It no longer counts towards ${entity?.name ?? 'this'}.`,
    );
  }

  async function remove(event: RatingEvent): Promise<void> {
    confirmId = null;
    if (openId === event.id) openId = null;
    await deleteRating(event.id);
    announce('Entry deleted from your history.');
  }

  function onEntryKey(event: KeyboardEvent, id: string): void {
    if (event.key !== 'Escape') return;
    if (confirmId === id) {
      event.stopPropagation();
      confirmId = null;
    } else if (openId === id) {
      event.stopPropagation();
      openId = null;
    }
  }

  const swing = $derived.by(() => {
    // Mean rating this month against the twelve before it: the simplest honest
    // statement about whether you have got harsher or softer.
    const now = Date.now();
    const month = 30 * 86_400_000;
    const recent = events.filter((e) => e.at > now - month);
    const before = events.filter((e) => e.at <= now - month && e.at > now - 13 * month);
    if (recent.length < 5 || before.length < 5) return null;
    const mean = (list: typeof events) =>
      list.reduce((sum, e) => sum + e.normalized, 0) / list.length;
    return { recent: mean(recent), before: mean(before), n: recent.length };
  });
</script>

<div class="sheet setting">
  <div class="stack">
    <header class="head">
      <h1 class="display">History</h1>
      <p class="label">{events.length.toLocaleString()} entries</p>
    </header>

    {#if days.length > 0}
      <div class="record">
        {#each days as [day, entries] (day)}
          <section class="day">
            <h2 class="day__label label">{day}</h2>
            <ol class="day__entries">
              {#each entries as event (event.id)}
                {@const entity = $graph.entity(event.entityId)}
                {@const stands = standing(event)}
                {@const mark = markFor(event)}
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <li
                  class:is-retracted={event.retracted}
                  class:is-open={openId === event.id}
                  onkeydown={(e) => onEntryKey(e, event.id)}
                >
                  <div class="entry__line">
                    <span
                      class="entry__mark figure"
                      class:entry__mark--tier={mark.swatch}
                      style:--tier={mark.swatch}
                      style:--tier-ink={TIER_INK}
                      style:--tier-edge={TIER_EDGE}
                    >
                      {mark.text}
                    </span>

                    <span class="entry__body">
                      {#if entity}
                        <a class="entry__name" href={entityHref(event.entityId)}>{entity.name}</a>
                      {:else}
                        <span class="entry__name entry__name--gone">
                          {event.entityId} — no longer in your library
                        </span>
                      {/if}
                      <span class="label entry__kind">
                        <EntityTypeIcon type={event.entityType} size={13} />
                        {entityLabelCap(event.entityType)} · {dateAndTime(event.at)}
                        {#if event.confidence && event.confidence !== 'medium'}
                          · {event.confidence} confidence
                        {/if}
                        ·
                        <span class="entry__state" class:entry__state--odd={stands === 'earlier'}>
                          {#if stands === 'withdrawn'}
                            Withdrawn
                          {:else if stands === 'current'}
                            Your rating
                          {:else}
                            Replaced by a later rating
                          {/if}
                        </span>
                      </span>
                      {#if event.note}<span class="note">“{event.note}”</span>{/if}
                      {#if event.tags?.length}
                        <span class="label">{event.tags.join(' · ')}</span>
                      {/if}
                    </span>

                    <span class="entry__acts">
                      {#if entity}
                        <QuickRate {entity} value={event.normalized} />
                        <button
                          type="button"
                          class="btn btn--small entry__open"
                          aria-expanded={openId === event.id}
                          onclick={() => toggle(event)}
                        >
                          {openId === event.id ? 'Close' : 'Rate again'}
                          <span class="sr-only">{entity.name}</span>
                        </button>
                      {:else}
                        <span class="note entry__unratable">
                          Nothing left to rate — this one is out of your library.
                        </span>
                      {/if}

                      {#if entryAction(event) === 'delete'}
                        {#if confirmId === event.id}
                          <span class="entry__confirm">
                            <button
                              type="button"
                              class="btn btn--small btn--danger"
                              onclick={() => void remove(event)}
                            >
                              Delete for good
                            </button>
                            <button
                              type="button"
                              class="btn btn--small btn--quiet"
                              onclick={() => (confirmId = null)}
                            >
                              Keep it
                            </button>
                          </span>
                        {:else}
                          <button
                            type="button"
                            class="btn btn--small btn--quiet"
                            onclick={() => (confirmId = event.id)}
                          >
                            Delete permanently
                            <span class="sr-only">this withdrawn entry</span>
                          </button>
                        {/if}
                      {:else}
                        <button
                          type="button"
                          class="btn btn--small btn--quiet"
                          onclick={() => void withdraw(event)}
                        >
                          Withdraw
                          <span class="sr-only">this entry</span>
                        </button>
                      {/if}
                    </span>
                  </div>

                  {#if confirmId === event.id}
                    <p class="entry__warn note" role="alert">
                      Deleting removes this entry from your history here and, once they sync, on
                      your other devices. Withdrawing already stopped it counting — this only
                      removes the record of it, and it cannot be undone.
                    </p>
                  {/if}

                  {#if openId === event.id && entity}
                    <div class="entry__editor">
                      <RatePanel
                        {entity}
                        inline
                        shortcuts={false}
                        seed={seedFrom(event)}
                        aboutSaving="Filled in from this entry, made {dateAndTime(
                          event.at,
                        )}. Saving writes a new entry at today's date and makes it your rating; this one stays in the record as it is."
                        onafter={() => (openId = null)}
                      />
                    </div>
                  {/if}
                </li>
              {/each}
            </ol>
          </section>
        {/each}
      </div>

      <AutoLoad
        hasMore={events.length > limit}
        count={Math.min(limit, events.length)}
        noun="entries"
        onload={() => (limit += 120)}
        endLabel="That is the whole record."
      />
    {:else}
      <Empty
        title="Nothing recorded yet"
        body="Ratings appear here the moment you make them, with the note and the context they were made in. Nothing is ever overwritten."
      />
    {/if}
  </div>

  <aside class="margin">
    <div class="stack stack--tight">
      <h2 class="label">Filter</h2>
      <label class="field">
        <span class="label">Kind</span>
        <select class="select" bind:value={typeFilter}>
          <option value="all">Everything</option>
          {#each $settings.enabledTypes as t (t)}
            <option value={t}>{entityLabelCap(t, true)}</option>
          {/each}
        </select>
      </label>
      <label class="field">
        <span class="label">Contains</span>
        <input class="input" type="search" bind:value={search} placeholder="Name or note" />
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={showRetracted} />
        <span>Show withdrawn entries</span>
      </label>
    </div>

    <div class="stack stack--tight">
      <h2 class="label">Withdraw or delete</h2>
      <p class="note note--small">
        Withdraw keeps the entry in History but stops it counting as your rating. Delete permanently
        removes a withdrawn entry from synced history.
      </p>
      <p class="note note--small">
        Rating something again never changes an old entry. It writes a new one.
      </p>
    </div>

    {#if swing}
      <div class="stack stack--tight">
        <h2 class="label">Drift</h2>
        <p class="note">
          Your average this month is {Math.round(swing.recent)} against {Math.round(swing.before)} over
          the year before it — {Math.abs(swing.recent - swing.before) < 3
            ? 'no real change'
            : swing.recent > swing.before
              ? 'you are marking more generously'
              : 'you are marking harder'}.
        </p>
        <p class="note note--small">
          Based on {swing.n} recent entries. Descriptive only.
        </p>
      </div>
    {/if}
  </aside>
</div>

<style>
  .record {
    display: flex;
    flex-direction: column;
    gap: var(--s5);
  }

  .day__label {
    padding-bottom: var(--s1);
    border-bottom: var(--rule-weight) solid var(--ink);
    color: var(--ink);
  }

  .day__entries {
    display: flex;
    flex-direction: column;
  }
  .day__entries li {
    padding: var(--s3) 0;
    border-bottom: var(--rule-weight) solid var(--border-faint);
  }
  .day__entries li.is-open {
    padding-bottom: var(--s5);
    border-bottom-color: var(--border);
  }
  .entry__line {
    display: grid;
    grid-template-columns: 3.5rem minmax(0, 1fr) auto;
    gap: var(--s3);
    align-items: start;
  }
  .day__entries li.is-retracted .entry__mark,
  .day__entries li.is-retracted .entry__name {
    text-decoration: line-through;
    color: var(--ink-faint);
  }
  .day__entries li.is-retracted .entry__mark--tier {
    opacity: 0.45;
  }

  .entry__mark {
    color: var(--accent-ink);
    font-size: 1rem;
    line-height: 1.6;
  }
  /* A tier keeps its own colour in the record too, so scanning a month of
     ratings does not mean reading six letters one at a time. */
  .entry__mark--tier {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    padding: 0 var(--s1);
    background: var(--tier);
    color: var(--tier-ink);
    border: var(--rule-weight) solid var(--tier-edge);
    border-radius: var(--radius-sm);
    font-weight: 700;
    line-height: 1.4;
  }

  .entry__body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .entry__name {
    color: var(--ink);
    font-size: 0.9375rem;
  }
  /* Plain inline flow rather than a flex row: the line ends in a phrase that
     can be several words long, and a flex item wrapping alone to the right
     leaves a hole in the middle of the sentence. */
  .entry__kind {
    display: block;
  }
  .entry__kind :global(.type-icon) {
    display: inline-block;
    vertical-align: -2px;
    margin-right: var(--s1);
  }
  .entry__name--gone {
    color: var(--ink-faint);
    font-family: var(--mono);
    font-size: 0.75rem;
  }
  /* Most entries in a young record are the rating in force, so saying so on
     every line is noise. The accent goes on the exception instead: the entry a
     later rating has already replaced, which is the one where withdrawing
     changes nothing the reader can see. */
  .entry__state {
    color: var(--ink-faint);
  }
  .entry__state--odd {
    color: var(--accent-ink);
  }

  .entry__acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--s2);
  }
  .entry__unratable {
    max-width: 14rem;
    text-align: right;
  }
  .entry__confirm {
    display: flex;
    gap: var(--s1);
  }
  /* The disclosure carries the weight of the row's main verb; withdraw and
     delete sit beside it as quiet ones. */
  .entry__open[aria-expanded='true'] {
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  .entry__warn {
    margin-top: var(--s2);
    padding: var(--s2) var(--s3);
    background: var(--accent-wash);
    border-left: 2px solid var(--accent);
  }
  .entry__editor {
    margin-top: var(--s3);
    padding-top: var(--s3);
    border-top: var(--rule-weight) solid var(--border-faint);
  }

  @media (max-width: 48rem) {
    .entry__line {
      grid-template-columns: 3rem minmax(0, 1fr);
    }
    .entry__acts {
      grid-column: 2;
      justify-content: flex-start;
    }
  }
</style>
