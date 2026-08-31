<script lang="ts">
  import { onMount } from 'svelte';

  import { pin, setStandingNote, setTags } from '../lib/app/actions';
  import { topUpArtistArtwork } from '../lib/app/artwork';
  import { notify } from '../lib/app/notices';
  import {
    ensureRelease,
    releaseLooksComplete,
    retryRelease,
    type ReleaseFill,
  } from '../lib/app/release';
  import { entityHref, href, navigate } from '../lib/app/router';
  import {
    annotationsById,
    canonical,
    entityLabel,
    entityLabelCap,
    explicitRatings,
    graph,
    rankings,
    scaleForType,
    scores,
    settings,
    world,
  } from '../lib/app/state';
  import { rankingConfidence } from '../lib/domain/elo';
  import { editionMarks } from '../lib/domain/editions';
  import { entityId } from '../lib/domain/ids';
  import { formatScore, historyFor, pickView } from '../lib/domain/ratings';
  import {
    canContain,
    canExpand,
    contentsHeading,
    expectedChildType,
    expectedOwnerType,
    groupParents,
    scoreGist,
    trimContext,
  } from '../lib/domain/relations';
  import type { Entity, EntityType, Provider, ScoreView } from '../lib/domain/types';
  import { startAlbumSession } from '../lib/playback/album';
  import { playbackEnqueue, playbackPlay } from '../lib/playback/store';
  import { SpotifyClient } from '../lib/spotify/client';
  import { artistNeedsArtwork } from '../lib/spotify/artwork';
  import { expandEntity } from '../lib/spotify/library';
  import { spotifyConfig, spotifySession } from '../lib/spotify/session';
  import { deleteRating, saveMemberships, upsertEntities } from '../lib/storage/repo';
  import { dateAndTime, duration, plural, relative, releaseYear } from '../lib/ui/format';
  import { contextWords } from '../lib/ui/history';
  import Icon from '../lib/ui/Icon.svelte';
  import AutoLoad from '../components/AutoLoad.svelte';
  import CombinePanel from '../components/CombinePanel.svelte';
  import Empty from '../components/Empty.svelte';
  import EntityTypeIcon from '../components/EntityTypeIcon.svelte';
  import EntityListening from '../components/EntityListening.svelte';
  import Artwork from '../components/Artwork.svelte';
  import RatableRow from '../components/RatableRow.svelte';
  import RatePanel from '../components/RatePanel.svelte';
  import ScoreMark from '../components/ScoreMark.svelte';
  import WhyThisScore from '../components/WhyThisScore.svelte';

  /**
   * One item, in full.
   *
   * The explicit rating and the computed score are shown side by side and never
   * merged into a single number without saying so — the whole point of the app
   * is that those are different claims.
   *
   * A link to a source that has been combined into another lands here on the
   * record that stands for it, with every source listed and individually
   * reachable. Following a URL must never be how somebody discovers that half
   * their library has quietly gone missing.
   */

  interface Props {
    params: Record<string, string>;
  }

  let { params }: Props = $props();

  const requested = $derived(
    entityId(
      (params.type ?? 'track') as EntityType,
      (params.provider ?? 'spotify') as Provider,
      params.id ?? '',
    ),
  );
  const id = $derived($canonical.resolve(requested));
  const entity = $derived($graph.entity(id));
  const scale = $derived(entity ? $scaleForType(entity.type) : $scaleForType('track'));
  const breakdown = $derived($scores.get(id));
  const explicit = $derived($explicitRatings.get(id));
  const annotation = $derived($annotationsById.get(id));
  const ranking = $derived(entity ? $rankings.get(entity.type)?.get(id) : undefined);
  const children = $derived(entity ? $graph.children(id) : []);
  const parents = $derived(entity ? $graph.parents(id) : []);
  const history = $derived(
    historyFor($world.ratings, id, { resolve: (raw) => $canonical.resolve(raw) }),
  );
  const arrivedByAlias = $derived(requested !== id && $graph.source(requested) !== undefined);

  let noteDraft = $state('');
  let tagDraft = $state('');
  let expanding = $state(false);
  let childLimit = $state(60);
  let openChildId = $state<string | null>(null);

  /**
   * Owning relationships, grouped by kind and shown as links.
   *
   * These used to be ten names under "Belongs to" in the margin, which made the
   * one fact a track page owes the reader — the record it is from — the same
   * weight as the eleventh playlist someone put it on.
   */
  const relations = $derived.by(() => {
    const groups = groupParents(parents);
    return groups
      .map((group) => ({
        ...group,
        entities: group.ids
          .map((pid) => $graph.entity(pid))
          .filter((e): e is Entity => e !== undefined),
      }))
      .filter((group) => group.entities.length > 0);
  });
  /** Two editions of one record are two rows; say which is which. */
  const relationMarks = $derived(editionMarks(relations.flatMap((group) => group.entities)));

  /** The line under the title, unless the links below already say it. */
  const heroSubtitle = $derived(
    trimContext(
      entity?.subtitle,
      relations.flatMap((group) => group.entities.map((e) => e.name)),
    ),
  );

  /**
   * What this page has already said out loud, kept out of its own rows.
   *
   * On Rain Ledger, every track's subtitle is "Kestrel Harbour · Rain Ledger" —
   * ten identical lines under ten different titles. The page is the context, so
   * the rows only have to carry what differs.
   */
  const established = $derived([
    ...(entity ? [entity.name] : []),
    ...relations.flatMap((group) => group.entities.map((e) => e.name)),
  ]);

  /** Contents, split by kind so an artist's releases and tracks are not one heap. */
  const CHILD_ORDER: EntityType[] = ['album', 'track', 'episode', 'chapter', 'playlist', 'artist'];
  const childGroups = $derived.by(() => {
    if (!entity || !canContain(entity.type)) return [];
    const types = children
      .map((edge) => edge.childType)
      .filter((type, i, list) => list.indexOf(type) === i);
    return types
      .map((type) => {
        const edges = children.filter((edge) => edge.childType === type);
        return {
          type,
          edges,
          heading: contentsHeading(entity.type, type),
          rated: edges.filter((edge) => $explicitRatings.has(edge.childId)).length,
        };
      })
      .sort((a, b) => order(a.type) - order(b.type));
  });

  function order(type: EntityType): number {
    const index = CHILD_ORDER.indexOf(type);
    return index === -1 ? CHILD_ORDER.length : index;
  }

  const gist = $derived(scoreGist(breakdown));

  $effect(() => {
    void id;
    noteDraft = annotation?.note ?? '';
    tagDraft = (annotation?.tags ?? []).join(', ');
  });

  // Artists reached through a track, a playlist or a playback event carry a
  // name and no picture. Ask for the ones this page is about to draw.
  $effect(() => {
    const nearby = [entity, ...children.map((e) => $graph.entity(e.childId))];
    for (const edge of parents) nearby.push($graph.entity(edge.parentId));
    void topUpArtistArtwork(
      nearby.filter((e): e is Entity => e !== undefined).filter(artistNeedsArtwork),
    );
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
    return pickView(view as ScoreView, b);
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

  /**
   * A record is shown whole or it says it is not.
   *
   * Tracks arrive here piecemeal — two heard last week, one from a search — and
   * a thirteen-track album drawn from the two you happen to have played is a
   * lie the page tells by omission. So opening a release asks for the rest of
   * it before drawing the list, once, and says so plainly if it cannot.
   */
  let filling = $state(false);
  let fill = $state<ReleaseFill | null>(null);

  $effect(() => {
    const subject = entity;
    if (!subject || subject.type !== 'album') {
      fill = null;
      return;
    }
    // Read once, outside the async work, so a route change cannot land its
    // answer on a different record.
    const wanted = subject.id;
    const seen = $graph;
    filling = true;
    void ensureRelease(subject, seen)
      .then((result) => {
        if (wanted !== entity?.id) return;
        fill = result;
      })
      .finally(() => {
        if (wanted === entity?.id) filling = false;
      });
  });

  async function retryFill() {
    if (!entity || filling) return;
    filling = true;
    fill = await retryRelease(entity, $graph);
    filling = false;
  }

  /** Loaded, which is a different fact from rated and is labelled as one. */
  const loadedTracks = $derived(
    entity?.type === 'album' ? $graph.childrenOfType(entity.id, 'track').length : children.length,
  );
  const shortOfWhole = $derived(
    entity?.type === 'album' &&
      fill?.status === 'incomplete' &&
      !releaseLooksComplete(entity, loadedTracks),
  );

  /**
   * Start playing this record and follow it track by track.
   *
   * The listening session is started before playback so the page you land on is
   * already the one you wanted, even if Spotify takes a moment to catch up or
   * refuses because no device is awake.
   */
  async function listenAndRate(subject: Entity) {
    const uri = `spotify:${subject.type}:${subject.providerId}`;
    if (subject.type === 'album') {
      // Never walk a record track by track from a set known to be partial —
      // the session would silently skip whatever has not been discovered yet.
      const whole = await ensureRelease(subject, $graph);
      if (whole.status === 'incomplete') {
        notify(
          `Only ${whole.known} of ${whole.total ?? whole.known} tracks are loaded. ${whole.reason}`,
          { tone: 'warn' },
        );
      }
      startAlbumSession(subject.id, uri);
    }
    navigate(href('/now-playing'));
    try {
      await playbackPlay({ contextUri: uri });
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Spotify would not start that.', {
        tone: 'warn',
      });
    }
  }

  async function addToQueue(subject: Entity) {
    try {
      await playbackEnqueue(`spotify:track:${subject.providerId}`);
      notify(`${subject.name} is queued.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Spotify would not queue that.', {
        tone: 'warn',
      });
    }
  }

  onMount(() => {
    if (entity) document.title = `${entity.name} · Music Ratings`;
    return () => {
      document.title = 'home';
    };
  });
</script>

{#if !entity}
  <div class="sheet">
    <Empty
      title="Not in your library"
      body="Nothing with that identifier is in your library. It may have been removed, or the link may be from another device whose data has not synced here yet."
    >
      {#snippet action()}
        <a class="btn btn--primary" href={href('/library')}>Back to your library</a>
      {/snippet}
    </Empty>
  </div>
{:else}
  <div class="sheet setting">
    <div class="stack stack--loose">
      <header class="item">
        <Artwork
          src={entity.artworkUrl}
          thumb={entity.artworkThumbUrl}
          name={entity.name}
          size="lg"
          priority
        />
        <div class="item__id">
          <p class="label item__kind">
            <EntityTypeIcon type={entity.type} size={14} />
            <span>{entityLabelCap(entity.type)}</span>
            {#if entity.releaseDate}<span>· {releaseYear(entity.releaseDate)}</span>{/if}
            {#if entity.durationMs}<span>· {duration(entity.durationMs)}</span>{/if}
            {#if entity.explicitContent}<span>· explicit</span>{/if}
            {#if entity.available === false}<span>· unavailable in your market</span>{/if}
          </p>
          <h1 class="item__name display">{entity.name}</h1>
          {#if heroSubtitle}<p class="item__sub">{heroSubtitle}</p>{/if}
          {#if entity.description}<p class="note item__desc">{entity.description}</p>{/if}
          {#if arrivedByAlias}
            <p class="note note--small item__alias">
              You followed a link to {$graph.source(requested)?.name ?? 'another copy'}, which you
              combined into this record. Every source is listed below with its own Spotify link.
            </p>
          {/if}

          <div class="row item__links">
            {#if entity.type === 'album' || entity.type === 'playlist'}
              <button
                type="button"
                class="btn btn--small"
                onclick={() => void listenAndRate(entity)}
              >
                <Icon name="play" size={13} />
                {entity.type === 'album' ? 'Listen & rate' : 'Play'}
              </button>
            {:else if entity.type === 'track' && entity.providerId}
              <button type="button" class="btn btn--small" onclick={() => void addToQueue(entity)}>
                <Icon name="queue-add" size={13} /> Add to queue
              </button>
            {/if}
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

      <section class="rating" aria-labelledby="rating-head">
        <h2 id="rating-head" class="sr-only">Your rating</h2>
        <div class="rating__rail">
          <RatePanel {entity} inline shortcuts={false} where="detail" />
        </div>
        <div class="rating__marks">
          <div>
            <p class="label">You said</p>
            <p class="rating__figure figure">
              {explicit ? formatScore(explicit.normalized, scale) : '—'}
            </p>
            {#if explicit}
              <p class="note note--small">{relative(explicit.at)}</p>
            {:else}
              <p class="note note--small">not rated directly</p>
            {/if}
          </div>
          <div>
            <p class="label">Computed</p>
            <ScoreMark {breakdown} {scale} view="rollup" size="lg" showKind={false} />
            {#if breakdown && !breakdown.coverage.meetsMinimum}
              <p class="note note--small">provisional — thin coverage</p>
            {/if}
          </div>
          {#if position}
            <div>
              <p class="label">Standing</p>
              <p class="rating__figure figure">
                {position.place}<span class="rating__of">/{position.of}</span>
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
              <p class="label">Comparisons</p>
              <p class="rating__figure figure">{ranking.comparisons}</p>
              <p class="note note--small">
                {Math.round(rankingConfidence(ranking) * 100)}% confident · {ranking.wins}W {ranking.losses}L
                {ranking.draws}D
              </p>
            </div>
          {/if}
        </div>
      </section>

      {#if relations.length > 0}
        <div class="rel">
          {#each relations as group (group.type)}
            <section class="rel__group" aria-labelledby="rel-{group.type}">
              <h2 id="rel-{group.type}" class="label">{group.heading}</h2>
              <ul class="rel__list">
                {#each group.entities.slice(0, 6) as related (related.id)}
                  <li>
                    <a class="rel__row" href={entityHref(related.id)}>
                      <Artwork
                        src={related.artworkUrl}
                        thumb={related.artworkThumbUrl}
                        name={related.name}
                        size="sm"
                      />
                      <span class="rel__text">
                        <span class="rel__name">{related.name}</span>
                        {#if relationMarks.get(related.id)}
                          <span class="note note--small">{relationMarks.get(related.id)}</span>
                        {/if}
                      </span>
                    </a>
                  </li>
                {/each}
              </ul>
              {#if group.entities.length > 6}
                <details class="rel__more">
                  <summary class="label">
                    {group.entities.length - 6} more {entityLabel(
                      group.type,
                      group.entities.length - 6 !== 1,
                    )}
                  </summary>
                  <ul class="rel__list">
                    {#each group.entities.slice(6) as related (related.id)}
                      <li>
                        <a class="rel__row" href={entityHref(related.id)}>
                          <Artwork
                            src={related.artworkUrl}
                            thumb={related.artworkThumbUrl}
                            name={related.name}
                            size="sm"
                          />
                          <span class="rel__text">
                            <span class="rel__name">{related.name}</span>
                            {#if relationMarks.get(related.id)}
                              <span class="note note--small">{relationMarks.get(related.id)}</span>
                            {/if}
                          </span>
                        </a>
                      </li>
                    {/each}
                  </ul>
                </details>
              {/if}
            </section>
          {/each}
        </div>
      {:else if !canContain(entity.type) && expectedOwnerType(entity.type)}
        <p class="note note--small">
          No {entityLabel(expectedOwnerType(entity.type) ?? 'album')} is recorded for this {entityLabel(
            entity.type,
          )} yet.
        </p>
      {/if}

      {#if childGroups.length > 0}
        {#each childGroups as group (group.type)}
          <section aria-labelledby="contents-{group.type}">
            <div class="head">
              <h2 id="contents-{group.type}" class="title">{group.heading}</h2>
              <span class="label">
                {plural(
                  entity.type === 'album' && group.type === 'track'
                    ? loadedTracks
                    : group.edges.length,
                  entityLabel(group.type),
                )}{#if group.rated > 0}
                  · {group.rated} rated{/if}
              </span>
            </div>

            {#if entity.type === 'album' && group.type === 'track'}
              {#if filling && shortOfWhole !== true}
                <p class="note note--small" role="status">Loading the rest of this release…</p>
              {/if}

              {#if shortOfWhole && fill?.status === 'incomplete'}
                <div class="short panel panel--sunk stack stack--tight" role="status">
                  <p class="note">
                    This tracklist is incomplete — {loadedTracks} of {fill.total ?? loadedTracks} tracks
                    loaded. {fill.reason}
                  </p>
                  <div class="row">
                    <button
                      type="button"
                      class="btn btn--small"
                      disabled={filling}
                      onclick={() => void retryFill()}
                    >
                      {filling ? 'Trying…' : 'Try again'}
                    </button>
                    {#if entity.externalUrl}
                      <a
                        class="btn btn--small btn--quiet"
                        href={entity.externalUrl}
                        target="_blank"
                        rel="noopener"
                      >
                        Open in Spotify
                      </a>
                    {/if}
                  </div>
                </div>
              {/if}
            {/if}

            <ul class="contents">
              {#each group.edges.slice(0, childLimit) as edge (edge.childId)}
                {@const child = $graph.entity(edge.childId)}
                {#if child}
                  <RatableRow
                    entity={child}
                    view={$settings.scoreView}
                    position={child.trackNumber ??
                      (edge.position !== undefined ? edge.position + 1 : undefined)}
                    expanded={openChildId === child.id}
                    ontoggle={() => (openChildId = openChildId === child.id ? null : child.id)}
                    omit={established}
                  />
                {/if}
              {/each}
            </ul>

            <AutoLoad
              hasMore={group.edges.length > childLimit}
              count={Math.min(childLimit, group.edges.length)}
              noun={entityLabel(group.type, true)}
              onload={() => (childLimit += 60)}
            />
          </section>
        {/each}
      {:else if entity.type === 'album' && filling}
        <section aria-labelledby="contents-loading">
          <div class="head">
            <h2 id="contents-loading" class="title">{contentsHeading('album', 'track')}</h2>
          </div>
          <p class="note" role="status">Loading this release…</p>
        </section>
      {:else if canExpand(entity.type) && entity.provider === 'spotify' && $spotifySession.connected}
        {@const noun = entityLabel(expectedChildType(entity.type), true)}
        <section aria-labelledby="contents-empty">
          <div class="head">
            <h2 id="contents-empty" class="title">
              {contentsHeading(entity.type, expectedChildType(entity.type))}
            </h2>
          </div>
          <p class="note">No {noun} loaded yet.</p>
          <button type="button" class="btn" disabled={expanding} onclick={() => void expand()}>
            {expanding ? 'Loading…' : `Load the ${noun} from Spotify`}
          </button>
        </section>
      {:else if canExpand(entity.type)}
        <section aria-labelledby="contents-offline">
          <div class="head">
            <h2 id="contents-offline" class="title">
              {contentsHeading(entity.type, expectedChildType(entity.type))}
            </h2>
          </div>
          <p class="note">
            No {entityLabel(expectedChildType(entity.type), true)} loaded. Connect Spotify to fetch them.
          </p>
        </section>
      {/if}

      <EntityListening {entity} />
      <CombinePanel {entity} />

      {#if history.length > 0}
        <section aria-labelledby="history-head">
          <div class="head">
            <h2 id="history-head" class="title">How your view changed</h2>
            <span class="label">{history.length} entries</span>
          </div>
          <ol class="history">
            {#each history as event (event.id)}
              {@const source = $graph.source(event.entityId)}
              <li class:is-retracted={event.retracted}>
                <span class="history__mark figure">{formatScore(event.normalized, scale)}</span>
                <span class="history__body">
                  <span class="history__when">{dateAndTime(event.at)}</span>
                  {#if event.note}<span class="note">“{event.note}”</span>{/if}
                  {#if event.retracted}<span class="label">withdrawn</span>{/if}
                  {#if event.context}<span class="label">{contextWords(event.context)}</span>{/if}
                  {#if source && source.id !== entity.id}
                    <span class="label">on {source.name}, since combined</span>
                  {/if}
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
        <div class="stack stack--tight">
          <h2 class="label">Score</h2>
          {#if gist}<p class="note note--small">{gist}</p>{/if}
          <details class="disclose">
            <summary class="disclose__head">How this score was reached</summary>
            <div class="disclose__body">
              <WhyThisScore {breakdown} {scale} heading={false} />
            </div>
          </details>
        </div>
      {/if}

      <div class="stack stack--tight">
        <h2 class="label">Your notes and tags</h2>
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
          <span class="label">Tags</span>
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

      <details class="disclose">
        <summary class="disclose__head">Details</summary>
        <div class="disclose__body stack stack--tight">
          <p class="note note--small">
            {#if entity.provider === 'local'}
              Added by hand on this device. Nothing about it came from Spotify.
            {:else}
              Read from the Spotify Web API{entity.provenance ? ` (${entity.provenance})` : ''}.
              Only catalogue metadata is stored; your ratings are yours and are never sent to
              Spotify.
            {/if}
          </p>
          <p class="mono">{entity.id}</p>
          <p class="note note--small">Last updated {dateAndTime(entity.updatedAt)}</p>
        </div>
      </details>
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
  .item__kind {
    display: flex;
    align-items: center;
    gap: var(--s2);
    flex-wrap: wrap;
  }
  .item__sub {
    font-family: var(--display);
    font-size: 1.0625rem;
    color: var(--ink-quiet);
  }
  .item__desc {
    max-width: 58ch;
  }
  .item__alias {
    max-width: 58ch;
    color: var(--ink-quiet);
  }
  .item__links {
    margin-top: var(--s2);
  }

  .rating {
    display: flex;
    flex-direction: column;
    gap: var(--s5);
    padding: var(--s5);
    background: var(--surface-raised);
    border: var(--rule-weight) solid var(--border);
  }
  .rating__marks {
    display: flex;
    gap: var(--s6);
    flex-wrap: wrap;
    padding-top: var(--s4);
    border-top: var(--rule-weight) solid var(--border-faint);
  }
  .rating__figure {
    font-size: 1.75rem;
    line-height: 1.1;
    letter-spacing: -0.02em;
  }
  .rating__of {
    font-size: 0.875rem;
    color: var(--ink-faint);
  }

  .short {
    margin-bottom: var(--s3);
  }

  .rel {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: var(--s5);
    padding-bottom: var(--s5);
    border-bottom: var(--rule-weight) solid var(--border-faint);
  }
  .rel__group {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    min-width: 0;
  }
  .rel__list {
    display: flex;
    flex-direction: column;
  }
  .rel__row {
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding: var(--s2) 0;
    min-height: 44px;
    color: var(--ink);
    text-decoration: none;
  }
  .rel__row:hover .rel__name {
    color: var(--accent-ink);
  }
  .rel__text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .rel__name {
    font-family: var(--display);
    font-size: 0.9375rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rel__more summary {
    cursor: pointer;
    padding: var(--s2) 0;
  }
  .rel__more summary:hover {
    color: var(--accent-ink);
  }

  .disclose__head {
    cursor: pointer;
    padding: var(--s2) 0;
    font-size: 0.8125rem;
  }
  .disclose__head:hover {
    color: var(--accent-ink);
  }
  .disclose__body {
    padding-top: var(--s2);
  }

  .contents,
  .history {
    display: flex;
    flex-direction: column;
  }

  .history li {
    display: grid;
    grid-template-columns: 3.5rem minmax(0, 1fr) auto;
    gap: var(--s3);
    align-items: baseline;
    padding: var(--s2) 0;
    border-bottom: var(--rule-weight) solid var(--border-faint);
  }
  .history li.is-retracted .history__mark {
    text-decoration: line-through;
    color: var(--ink-faint);
  }
  .history__mark {
    color: var(--accent-ink);
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

  .margin {
    /* The rail sticks, so it must never grow past the window and strand the
       controls at its foot. */
    max-height: calc(100dvh - var(--s5) - var(--player-h, 0px) - var(--s4));
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  @media (max-width: 48rem) {
    .item {
      flex-direction: column;
      gap: var(--s4);
    }
    .rating {
      padding: var(--s4);
    }
  }

  @media (max-width: 68rem) {
    .margin {
      max-height: none;
      overflow: visible;
    }
  }
</style>
