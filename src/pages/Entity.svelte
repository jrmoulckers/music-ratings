<script lang="ts">
  import { onMount } from 'svelte';

  import { pin, rate, setStandingNote, setTags } from '../lib/app/actions';
  import { notify } from '../lib/app/notices';
  import { entityHref, href } from '../lib/app/router';
  import {
    annotationsById,
    entityLabel,
    explicitRatings,
    graph,
    rankings,
    scaleForType,
    scores,
    settings,
    world,
  } from '../lib/app/state';
  import { rankingConfidence } from '../lib/domain/elo';
  import { entityId } from '../lib/domain/ids';
  import { formatScore, historyFor } from '../lib/domain/ratings';
  import type { EntityType, Provider } from '../lib/domain/types';
  import { SpotifyClient } from '../lib/spotify/client';
  import { expandEntity } from '../lib/spotify/library';
  import { spotifyConfig, spotifySession } from '../lib/spotify/session';
  import { deleteRating, saveMemberships, upsertEntities } from '../lib/storage/repo';
  import { dateAndTime, duration, relative, releaseYear } from '../lib/ui/format';
  import Icon from '../lib/ui/Icon.svelte';
  import Empty from '../components/Empty.svelte';
  import EntryRow from '../components/EntryRow.svelte';
  import Plate from '../components/Plate.svelte';
  import RatingRail from '../components/RatingRail.svelte';
  import ScoreMark from '../components/ScoreMark.svelte';
  import WhyThisScore from '../components/WhyThisScore.svelte';

  /**
   * One item, in full.
   *
   * The explicit rating and the computed score are shown side by side and never
   * merged into a single number without saying so — the whole point of the app
   * is that those are different claims.
   */

  interface Props {
    params: Record<string, string>;
  }

  let { params }: Props = $props();

  const id = $derived(
    entityId(
      (params.type ?? 'track') as EntityType,
      (params.provider ?? 'spotify') as Provider,
      params.id ?? '',
    ),
  );
  const entity = $derived($graph.entity(id));
  const scale = $derived(entity ? $scaleForType(entity.type) : $scaleForType('track'));
  const breakdown = $derived($scores.get(id));
  const explicit = $derived($explicitRatings.get(id));
  const annotation = $derived($annotationsById.get(id));
  const ranking = $derived(entity ? $rankings.get(entity.type)?.get(id) : undefined);
  const children = $derived(entity ? $graph.children(id) : []);
  const parents = $derived(entity ? $graph.parents(id) : []);
  const history = $derived(historyFor($world.ratings, id));

  let noteDraft = $state('');
  let tagDraft = $state('');
  let expanding = $state(false);

  $effect(() => {
    void id;
    noteDraft = annotation?.note ?? '';
    tagDraft = (annotation?.tags ?? []).join(', ');
  });

  const position = $derived.by(() => {
    if (!entity) return null;
    const view = $settings.scoreView;
    const peers = $graph
      .entitiesOfType(entity.type)
      .map((e) => ({ id: e.id, score: pickScore(e.id, view) }))
      .filter((row): row is { id: string; score: number } => row.score !== null)
      .sort((a, b) => b.score - a.score);
    const index = peers.findIndex((row) => row.id === id);
    if (index === -1) return null;
    const mine = peers[index]?.score;
    const tied = peers.filter((row) => row.score === mine).length > 1;
    // Dense position: everyone on the same score shares the same place.
    const place = peers.findIndex((row) => row.score === mine) + 1;
    return { place, of: peers.length, tied };
  });

  function pickScore(entity_: string, view: string): number | null {
    const b = $scores.get(entity_);
    if (!b) return null;
    if (view === 'explicit') return b.explicit;
    if (view === 'rollup') return b.rollup;
    return b.blended;
  }

  async function expand() {
    if (!entity || expanding) return;
    expanding = true;
    try {
      const client = new SpotifyClient({ config: spotifyConfig() });
      const result = await expandEntity(client, entity);
      if (result.entities.length === 0) {
        notify('Spotify returned nothing further for this item.');
        return;
      }
      await upsertEntities(result.entities);
      await saveMemberships(result.memberships);
      notify(`Loaded ${result.entities.length} more items.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not load the contents.', {
        tone: 'warn',
      });
    } finally {
      expanding = false;
    }
  }

  onMount(() => {
    if (entity) document.title = `${entity.name} · Ledger`;
    return () => {
      document.title = 'Ledger';
    };
  });
</script>

{#if !entity}
  <div class="sheet">
    <Empty
      title="Not on the shelf"
      body="Nothing with that identifier is in the ledger. It may have been removed, or the link may be from another device whose data has not synced here yet."
    >
      {#snippet action()}
        <a class="btn btn--primary" href={href('/library')}>Back to the shelf</a>
      {/snippet}
    </Empty>
  </div>
{:else}
  <div class="sheet setting">
    <div class="stack stack--loose">
      <header class="item">
        <Plate
          src={entity.artworkUrl}
          thumb={entity.artworkThumbUrl}
          name={entity.name}
          size="lg"
          priority
        />
        <div class="item__id">
          <p class="apparatus">
            {entityLabel(entity.type)}
            {#if entity.releaseDate}· {releaseYear(entity.releaseDate)}{/if}
            {#if entity.durationMs}· {duration(entity.durationMs)}{/if}
            {#if entity.explicitContent}· explicit{/if}
            {#if entity.available === false}· unavailable in your market{/if}
          </p>
          <h1 class="item__name display">{entity.name}</h1>
          {#if entity.subtitle}<p class="item__sub">{entity.subtitle}</p>{/if}
          {#if entity.description}<p class="note item__desc">{entity.description}</p>{/if}

          <div class="row item__links">
            {#if entity.externalUrl}
              <a
                class="btn btn--small"
                href={entity.externalUrl}
                target="_blank"
                rel="noreferrer noopener"
                data-external
              >
                <Icon name="link" size={13} /> Open in Spotify
              </a>
            {/if}
            <button
              type="button"
              class="btn btn--small"
              aria-pressed={annotation?.pinned === 'favorite'}
              onclick={() =>
                void pin(entity, annotation?.pinned === 'favorite' ? null : 'favorite')}
            >
              <Icon name="pin" size={13} />
              {annotation?.pinned === 'favorite' ? 'Pinned as a favourite' : 'Pin as a favourite'}
            </button>
            <button
              type="button"
              class="btn btn--small"
              aria-pressed={annotation?.pinned === 'avoid'}
              onclick={() => void pin(entity, annotation?.pinned === 'avoid' ? null : 'avoid')}
            >
              {annotation?.pinned === 'avoid' ? 'Pinned to avoid' : 'Pin to avoid'}
            </button>
          </div>
        </div>
      </header>

      <section class="verdict" aria-labelledby="verdict-head">
        <h2 id="verdict-head" class="sr-only">Your verdict</h2>
        <div class="verdict__rail">
          <RatingRail
            {scale}
            value={explicit?.normalized ?? null}
            label="Your rating for {entity.name}"
            orientation="horizontal"
            oncommit={(value) => void rate(entity, value, { context: 'detail' })}
          />
        </div>
        <div class="verdict__marks">
          <div>
            <p class="apparatus">You said</p>
            <p class="verdict__figure figure">
              {explicit ? formatScore(explicit.normalized, scale) : '—'}
            </p>
            {#if explicit}
              <p class="note note--small">{relative(explicit.at)}</p>
            {:else}
              <p class="note note--small">not rated directly</p>
            {/if}
          </div>
          <div>
            <p class="apparatus">Computed</p>
            <ScoreMark {breakdown} {scale} view="rollup" size="lg" showKind={false} />
            {#if breakdown && !breakdown.coverage.meetsMinimum}
              <p class="note note--small">provisional — thin coverage</p>
            {/if}
          </div>
          {#if position}
            <div>
              <p class="apparatus">Standing</p>
              <p class="verdict__figure figure">
                {position.place}<span class="verdict__of">/{position.of}</span>
              </p>
              <p class="note note--small">
                {position.tied
                  ? 'tied at this score'
                  : 'among rated ' + entityLabel(entity.type, true)}
              </p>
            </div>
          {/if}
          {#if ranking}
            <div>
              <p class="apparatus">Weigh-ins</p>
              <p class="verdict__figure figure">{ranking.comparisons}</p>
              <p class="note note--small">
                {Math.round(rankingConfidence(ranking) * 100)}% settled · {ranking.wins}W {ranking.losses}L
                {ranking.draws}D
              </p>
            </div>
          {/if}
        </div>
      </section>

      {#if children.length > 0}
        <section aria-labelledby="contents-head">
          <div class="head">
            <h2 id="contents-head" class="title">What's inside</h2>
            <span class="apparatus"
              >{children.length} of {entity.totalChildren ?? children.length}</span
            >
          </div>
          <ul class="contents">
            {#each children.slice(0, 60) as edge (edge.childId)}
              {@const child = $graph.entity(edge.childId)}
              {#if child}
                <li>
                  <a class="contents__link" href={entityHref(child.id)}>
                    <EntryRow
                      entity={child}
                      breakdown={$scores.get(child.id)}
                      view={$settings.scoreView}
                      position={edge.position !== undefined ? edge.position + 1 : undefined}
                    />
                  </a>
                </li>
              {/if}
            {/each}
          </ul>
        </section>
      {:else if entity.provider === 'spotify' && $spotifySession.connected}
        <section>
          <div class="head"><h2 class="title">What's inside</h2></div>
          <p class="note">Nothing loaded yet for this item.</p>
          <button type="button" class="btn" disabled={expanding} onclick={() => void expand()}>
            {expanding ? 'Loading…' : 'Load its contents from Spotify'}
          </button>
        </section>
      {/if}

      {#if history.length > 0}
        <section aria-labelledby="history-head">
          <div class="head">
            <h2 id="history-head" class="title">How your view changed</h2>
            <span class="apparatus">{history.length} entries</span>
          </div>
          <ol class="history">
            {#each history as event (event.id)}
              <li class:is-retracted={event.retracted}>
                <span class="history__mark figure">{formatScore(event.normalized, scale)}</span>
                <span class="history__body">
                  <span class="history__when">{dateAndTime(event.at)}</span>
                  {#if event.note}<span class="note">“{event.note}”</span>{/if}
                  {#if event.retracted}<span class="apparatus">withdrawn</span>{/if}
                  {#if event.context}<span class="apparatus">from the {event.context}</span>{/if}
                </span>
                <button
                  type="button"
                  class="btn btn--small btn--quiet"
                  onclick={() => void deleteRating(event.id)}
                >
                  Delete
                </button>
              </li>
            {/each}
          </ol>
        </section>
      {/if}
    </div>

    <aside class="margin">
      {#if breakdown}
        <WhyThisScore {breakdown} {scale} />
      {/if}

      {#if parents.length > 0}
        <div class="stack stack--tight">
          <h2 class="apparatus">Belongs to</h2>
          {#each parents.slice(0, 10) as edge (edge.parentId)}
            {@const parent = $graph.entity(edge.parentId)}
            {#if parent}
              <a class="margin__link" href={entityHref(parent.id)}>{parent.name}</a>
            {/if}
          {/each}
        </div>
      {/if}

      <div class="stack stack--tight">
        <h2 class="apparatus">Your notes</h2>
        <label class="field">
          <span class="sr-only">A standing note about {entity.name}</span>
          <textarea
            class="textarea"
            rows="3"
            bind:value={noteDraft}
            onblur={() => void setStandingNote(id, noteDraft)}
            placeholder="Kept with the item, not with any one rating."
          ></textarea>
        </label>
        <label class="field">
          <span class="apparatus">Tags</span>
          <input
            class="input"
            bind:value={tagDraft}
            onblur={() =>
              void setTags(
                id,
                tagDraft
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean),
              )}
            placeholder="comma, separated"
          />
        </label>
      </div>

      <div class="stack stack--tight">
        <h2 class="apparatus">Where this came from</h2>
        <p class="note note--small">
          {#if entity.provider === 'demo'}
            Invented for the demonstration catalogue. No real artist, release or recording is
            described here.
          {:else}
            Read from the Spotify Web API{entity.provenance ? ` (${entity.provenance})` : ''}. Only
            catalogue metadata is stored; your ratings are yours and are never sent to Spotify.
          {/if}
        </p>
        <p class="machine">{entity.id}</p>
      </div>
    </aside>
  </div>
{/if}

<style>
  .item {
    display: flex;
    gap: var(--s5);
    align-items: flex-start;
    padding-bottom: var(--s5);
    border-bottom: var(--rule-weight) solid var(--ink);
  }
  .item__id {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s2);
  }
  .item__name {
    font-size: clamp(1.75rem, 1.2rem + 2.2vw, 2.75rem);
    line-height: 1.05;
  }
  .item__sub {
    font-family: var(--serif);
    font-size: 1.0625rem;
    color: var(--ink-quiet);
  }
  .item__desc {
    max-width: 58ch;
  }
  .item__links {
    margin-top: var(--s2);
  }

  .verdict {
    display: flex;
    flex-direction: column;
    gap: var(--s5);
    padding: var(--s5);
    background: var(--paper-raised);
    border: var(--rule-weight) solid var(--rule);
  }
  .verdict__marks {
    display: flex;
    gap: var(--s6);
    flex-wrap: wrap;
    padding-top: var(--s4);
    border-top: var(--rule-weight) solid var(--rule-faint);
  }
  .verdict__figure {
    font-size: 1.75rem;
    line-height: 1.1;
    letter-spacing: -0.02em;
  }
  .verdict__of {
    font-size: 0.875rem;
    color: var(--ink-faint);
  }

  .contents,
  .history {
    display: flex;
    flex-direction: column;
  }
  .contents__link {
    display: block;
    text-decoration: none;
    color: inherit;
  }

  .history li {
    display: grid;
    grid-template-columns: 3.5rem minmax(0, 1fr) auto;
    gap: var(--s3);
    align-items: baseline;
    padding: var(--s2) 0;
    border-bottom: var(--rule-weight) solid var(--rule-faint);
  }
  .history li.is-retracted .history__mark {
    text-decoration: line-through;
    color: var(--ink-faint);
  }
  .history__mark {
    color: var(--rubric-ink);
  }
  .history__body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .history__when {
    font-size: 0.8125rem;
  }

  .margin__link {
    font-size: 0.875rem;
    color: var(--ink);
  }

  @media (max-width: 48rem) {
    .item {
      flex-direction: column;
      gap: var(--s4);
    }
    .verdict {
      padding: var(--s4);
    }
  }
</style>
