<script lang="ts">
  import { combine, makePrimary, separate } from '../lib/app/actions';
  import { notify } from '../lib/app/notices';
  import { entityHref } from '../lib/app/router';
  import {
    canonical,
    entityLabel,
    entityLabelCap,
    graph,
    scaleForType,
    world,
  } from '../lib/app/state';
  import { checkCombine, planCombine, type CombinePlan } from '../lib/domain/canonical';
  import {
    findDuplicateCandidates,
    VERDICT_LABEL,
    VERDICT_MEANING,
    type DuplicateCandidate,
  } from '../lib/domain/duplicates';
  import { formatScore } from '../lib/domain/ratings';
  import { formatRaw } from '../lib/domain/scales';
  import type { Entity, EntityId } from '../lib/domain/types';
  import { duration } from '../lib/ui/format';
  import Icon from '../lib/ui/Icon.svelte';

  /**
   * Combining duplicates, in place.
   *
   * The same record reaches a library several times over — an original, a
   * remaster, the same song again on a compilation. This is where they are
   * declared to be one thing, and it is deliberately a progressive panel rather
   * than a dialog: the decision is made against the item you were already
   * looking at, and taking the page away to make it would lose the very context
   * the decision needs.
   *
   * Three rules the copy in here has to keep telling the truth about:
   *   1. Nothing is deleted. Every source keeps its own Spotify link, artwork,
   *      release date and place in your library.
   *   2. Ratings are averaged only where two of them exist, into one new entry.
   *      Every original entry stays in your history and goes on counting for
   *      the item it was made on.
   *   3. It comes apart again, and separating puts every rating back.
   *
   * Rating itself is not this component's business: the row and the detail page
   * already own that, and they use RatePanel and QuickRate as they always have.
   */

  interface Props {
    entity: Entity;
    /** Sits inside a row's expanded editor rather than in its own section. */
    inline?: boolean;
    onafter?: (() => void) | undefined;
  }

  let { entity, inline = false, onafter }: Props = $props();

  const uid = $props.id();

  let open = $state(false);
  let term = $state('');
  let picked = $state<EntityId[]>([]);
  /** Null means "the item this was opened from", which is the default. */
  let primaryPick = $state<EntityId | null>(null);
  let stage = $state<'pick' | 'confirm'>('pick');
  let busy = $state(false);
  let confirmSeparate = $state(false);
  let activeEntityId = $state<EntityId | null>(null);

  const primaryId = $derived(primaryPick ?? entity.id);

  // A different item is a different decision: nothing carries over.
  $effect(() => {
    if (activeEntityId === null) {
      activeEntityId = entity.id;
      return;
    }
    if (entity.id === activeEntityId) return;
    activeEntityId = entity.id;
    open = false;
    term = '';
    picked = [];
    primaryPick = null;
    stage = 'pick';
    confirmSeparate = false;
  });

  const group = $derived($canonical.group(entity.id) ?? null);
  const sources = $derived($graph.sourcesOf(entity.id));
  const combined = $derived(sources.length > 1);
  const scale = $derived($scaleForType(entity.type));
  const noun = $derived(entityLabel(entity.type));

  const candidates = $derived.by(() => {
    if (!open) return [] as DuplicateCandidate[];
    return findDuplicateCandidates({
      subject: entity,
      entities: $world.entities,
      exclude: new Set(sources.map((s) => s.id)),
      ...(term.trim() ? { search: term.trim() } : {}),
    });
  });

  const chosen = $derived(picked.filter((id) => id !== entity.id));

  /** Types are all the combine checks need, and the map is built once. */
  const typedEntities = $derived(
    new Map($world.entities.map((e) => [e.id, { id: e.id, type: e.type, name: e.name }])),
  );

  /** Every source the group would hold, primary first, for the preview list. */
  const previewMembers = $derived.by(() => {
    const ids = [
      entity.id,
      ...sources.map((s) => s.id),
      ...chosen.flatMap((id) => [...$canonical.members(id)]),
    ];
    return ids.filter((id, index) => ids.indexOf(id) === index);
  });

  const problem = $derived.by(() => {
    if (chosen.length === 0) return null;
    return checkCombine({
      entityIds: [entity.id, ...chosen],
      primaryId,
      entities: typedEntities,
      index: $canonical,
    });
  });

  const plan = $derived.by<CombinePlan | null>(() => {
    if (chosen.length === 0 || problem) return null;
    return planCombine({
      entityIds: [entity.id, ...chosen],
      primaryId,
      entities: typedEntities,
      index: $canonical,
      ratings: $world.ratings,
      scale,
    });
  });

  function nameOf(id: EntityId): string {
    return $graph.source(id)?.name ?? $graph.entity(id)?.name ?? id;
  }

  function metaOf(id: EntityId): string {
    const source = $graph.source(id);
    if (!source) return '';
    const count =
      source.totalChildren === undefined
        ? ''
        : `${source.totalChildren} ${
            source.type === 'album' ? 'tracks' : source.type === 'show' ? 'episodes' : 'items'
          }`;
    const provider = source.provider === 'spotify' ? `Spotify ID ${source.providerId}` : source.id;
    return [
      entityLabelCap(source.type),
      source.subtitle,
      source.releaseDate,
      count,
      duration(source.durationMs),
      provider,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  function toggle(id: EntityId): void {
    picked = picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id];
    // Dropping the source that was chosen to represent the group hands the job
    // back to the item this was opened from rather than leaving it nowhere.
    if (primaryPick && !picked.includes(primaryPick)) primaryPick = null;
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await action();
      onafter?.();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'That could not be done.', { tone: 'warn' });
    } finally {
      busy = false;
    }
  }

  async function confirm(): Promise<void> {
    await run(async () => {
      await combine(entity, [entity.id, ...chosen], primaryId);
      picked = [];
      stage = 'pick';
      open = false;
    });
  }
</script>

<section class="fold" class:fold--inline={inline} aria-labelledby={`${uid}-head`}>
  <div class="fold__head">
    <h2 id={`${uid}-head`} class={inline ? 'label' : 'title'}>
      {combined ? `Combined from ${sources.length} sources` : 'Duplicates'}
    </h2>
    {#if !open}
      <button
        type="button"
        class="btn btn--small"
        aria-expanded={open}
        onclick={() => (open = true)}
      >
        <Icon name="plus" size={12} />
        <span>{combined ? 'Add another source' : 'Combine with a duplicate'}</span>
        <span class="sr-only">{entity.name}</span>
      </button>
    {/if}
  </div>

  {#if combined}
    <ul class="sources">
      {#each sources as source (source.id)}
        <li class="sources__row">
          <span class="sources__id">
            <a class="sources__name" href={entityHref(source.id)}>{source.name}</a>
            <span class="note note--small">
              {#if source.id === entity.id}Represents this record ·{/if}
              {metaOf(source.id) || source.id}
            </span>
          </span>
          <span class="sources__acts">
            {#if source.externalUrl}
              <a
                class="btn btn--small btn--quiet"
                href={source.externalUrl}
                target="_blank"
                rel="noreferrer noopener"
                data-external
              >
                <Icon name="link" size={12} />
                <span>Open in Spotify</span>
                <span class="sr-only">{source.name}</span>
              </a>
            {/if}
            {#if group && source.id !== entity.id}
              <button
                type="button"
                class="btn btn--small btn--quiet"
                disabled={busy}
                onclick={() => void run(() => makePrimary(group.id, source))}
              >
                Make primary
                <span class="sr-only">{source.name}</span>
              </button>
            {/if}
          </span>
        </li>
      {/each}
    </ul>

    <p class="note note--small">
      The primary is what gets played, linked and listed. Every source keeps its own Spotify link,
      artwork and place in your library, and every rating you made on any of them is still in your
      history.
    </p>

    {#if group}
      <div class="row">
        {#if confirmSeparate}
          <button
            type="button"
            class="btn btn--small btn--danger"
            disabled={busy}
            onclick={() =>
              void run(async () => {
                confirmSeparate = false;
                await separate(group.id, entity.name);
              })}
          >
            Separate {sources.length} items
          </button>
          <button
            type="button"
            class="btn btn--small btn--quiet"
            onclick={() => (confirmSeparate = false)}
          >
            Keep them combined
          </button>
          <p class="note note--small">
            Each goes back to answering for itself, and the averaged entry combining wrote is
            withdrawn so every rating returns to what it was.
          </p>
        {:else}
          <button
            type="button"
            class="btn btn--small btn--quiet"
            disabled={busy}
            onclick={() => (confirmSeparate = true)}
          >
            <Icon name="undo" size={12} />
            <span>Separate them again</span>
          </button>
        {/if}
      </div>
    {/if}
  {/if}

  {#if open}
    <div class="work">
      {#if stage === 'pick'}
        <p class="note note--small work__help">
          Combining tells the app that these are one {noun}. Nothing is deleted: each keeps its own
          Spotify link and stays in your library. If two of them are rated, the two ratings are
          averaged into one new entry and both originals stay in your history. It can be undone.
        </p>

        <label class="field">
          <span class="label">Search your library</span>
          <span class="work__search">
            <Icon name="search" size={14} />
            <input
              class="input"
              type="search"
              bind:value={term}
              placeholder={`Other copies of “${entity.name}”`}
            />
          </span>
        </label>

        {#if candidates.length === 0}
          <p class="note">
            {term.trim()
              ? 'Nothing in your library matches that.'
              : `No other ${entityLabel(entity.type, true)} in your library share this title. Search above to pick one by hand.`}
          </p>
        {:else}
          <ul class="cands">
            {#each candidates as candidate (candidate.entityId)}
              {@const source = $graph.source(candidate.entityId)}
              {#if source}
                <li class="cands__row" class:is-picked={picked.includes(candidate.entityId)}>
                  <button
                    type="button"
                    class="cands__pick"
                    aria-pressed={picked.includes(candidate.entityId)}
                    onclick={() => toggle(candidate.entityId)}
                  >
                    <span class="cands__tick" aria-hidden="true">
                      {#if picked.includes(candidate.entityId)}<Icon name="check" size={12} />{/if}
                    </span>
                    <span class="cands__id">
                      <span class="cands__name">{source.name}</span>
                      {#if metaOf(candidate.entityId)}
                        <span class="note note--small">{metaOf(candidate.entityId)}</span>
                      {/if}
                    </span>
                    <span
                      class="label cands__verdict"
                      class:label--accent={candidate.suggested}
                      title={VERDICT_MEANING[candidate.verdict]}
                    >
                      {VERDICT_LABEL[candidate.verdict]}
                    </span>
                  </button>
                  <p class="note note--small cands__why">
                    {candidate.evidence.join(' ')}
                    {#each candidate.uncertainty as caution (caution)}
                      <span class="cands__caution">{caution}</span>
                    {/each}
                  </p>
                </li>
              {/if}
            {/each}
          </ul>
        {/if}

        {#if problem}
          <p class="note work__problem" role="status">{problem.detail}</p>
        {/if}

        <div class="row">
          <button
            type="button"
            class="btn btn--small btn--primary"
            disabled={chosen.length === 0 || !!problem}
            onclick={() => (stage = 'confirm')}
          >
            Preview combining {chosen.length + 1} items
          </button>
          <button
            type="button"
            class="btn btn--small btn--quiet"
            onclick={() => {
              open = false;
              picked = [];
            }}
          >
            Cancel
          </button>
        </div>
      {:else}
        <fieldset class="pick-primary">
          <legend class="label">Which one represents them</legend>
          {#each previewMembers as id (id)}
            {@const source = $graph.source(id)}
            <div class="pick-primary__row">
              <label class="check">
                <input
                  type="radio"
                  name={`${uid}-primary`}
                  value={id}
                  checked={primaryId === id}
                  onchange={() => (primaryPick = id)}
                />
                <span class="pick-primary__identity">
                  <span>{nameOf(id)}</span>
                  {#if metaOf(id)}<span class="note note--small">{metaOf(id)}</span>{/if}
                </span>
              </label>
              {#if source?.externalUrl}
                <a
                  class="btn btn--small btn--quiet"
                  href={source.externalUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  data-external
                >
                  <Icon name="link" size={12} />
                  Verify edition
                  <span class="sr-only">{source.name} in Spotify</span>
                </a>
              {/if}
            </div>
          {/each}
          <p class="note note--small">
            The one you started from is chosen by default. The primary is what gets played and
            linked; the others stay reachable with their own Spotify links.
          </p>
        </fieldset>

        <div class="consequence">
          <h3 class="label">What happens to your rating</h3>
          {#if plan?.rating.kind === 'averaged' && plan.rating.event}
            <p class="consequence__line">
              <span class="figure">{formatScore(plan.rating.event.normalized, scale)}</span>
              <span class="note">
                — the average of {plan.rating.sources
                  .map((s) => formatScore(s.normalized, scale))
                  .join(' and ')}, recorded as {formatRaw(scale, plan.rating.event.value)} on the
                {scale.label} scale.
              </span>
            </p>
          {:else if plan?.rating.kind === 'carried'}
            <p class="consequence__line">
              <span class="figure"
                >{formatScore(plan.rating.sources[0]?.normalized ?? 0, scale)}</span
              >
              <span class="note">— the one rating among them, kept exactly as it is.</span>
            </p>
          {:else}
            <p class="note">None of these is rated, so no rating is written.</p>
          {/if}
          <ul class="consequence__notes">
            {#each plan?.rating.notes ?? [] as line (line)}
              <li class="note note--small">{line}</li>
            {/each}
            <li class="note note--small">
              Comparisons, queue decisions, notes, tags and listening history follow the sources
              onto the combined record. Nothing is deleted, and separating them again puts every
              rating back.
            </li>
          </ul>
        </div>

        <div class="row">
          <button
            type="button"
            class="btn btn--small btn--primary"
            disabled={busy || !!problem}
            onclick={() => void confirm()}
          >
            {busy ? 'Combining…' : `Combine ${previewMembers.length} items`}
          </button>
          <button type="button" class="btn btn--small btn--quiet" onclick={() => (stage = 'pick')}>
            Back
          </button>
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .fold {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
  }
  .fold--inline {
    padding-top: var(--s3);
    border-top: var(--rule-weight) solid var(--border-faint);
  }

  .fold__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s3);
    flex-wrap: wrap;
  }

  .sources {
    display: flex;
    flex-direction: column;
  }
  .sources__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s3);
    flex-wrap: wrap;
    padding: var(--s2) 0;
    border-bottom: var(--rule-weight) solid var(--border-faint);
  }
  .sources__id {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .sources__name {
    color: var(--ink);
    font-weight: 600;
  }
  .sources__acts {
    display: flex;
    gap: var(--s2);
    flex-wrap: wrap;
  }

  .work {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
    padding: var(--s4);
    background: var(--surface-raised);
    border: var(--rule-weight) solid var(--border);
  }
  .work__help {
    max-width: 62ch;
  }
  .work__problem {
    color: var(--accent-ink);
  }

  .work__search {
    display: flex;
    align-items: center;
    gap: var(--s2);
    border-bottom: 2px solid var(--ink);
    padding-bottom: 2px;
    color: var(--ink-quiet);
  }
  .work__search :global(input) {
    border: 0;
    background: transparent;
    padding: var(--s2) 0;
  }
  .work__search :global(input:focus) {
    outline: none;
  }
  .work__search:focus-within {
    border-bottom-color: var(--accent);
    color: var(--accent-ink);
  }

  .cands {
    display: flex;
    flex-direction: column;
    max-height: 22rem;
    overflow-y: auto;
  }
  .cands__row {
    padding: var(--s2) 0;
    border-bottom: var(--rule-weight) solid var(--border-faint);
  }
  .cands__pick {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--s3);
    width: 100%;
    min-height: 2.75rem;
    padding: 0;
    background: none;
    border: 0;
    text-align: left;
    color: inherit;
    cursor: pointer;
  }
  .cands__tick {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.125rem;
    height: 1.125rem;
    border: var(--rule-weight) solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--accent-ink);
  }
  .cands__pick:hover .cands__tick {
    border-color: var(--ink-quiet);
  }
  .cands__pick:hover .cands__name {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .cands__row.is-picked .cands__tick {
    border-color: var(--accent);
  }
  .cands__id {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .cands__name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cands__verdict {
    flex: none;
  }
  .cands__why {
    padding-left: calc(1.125rem + var(--s3));
    max-width: 68ch;
  }
  .cands__caution {
    display: block;
    color: var(--ink-faint);
  }

  .pick-primary {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    margin: 0;
    padding: 0;
    border: 0;
  }
  .pick-primary__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s3);
    padding: var(--s2) 0;
    border-bottom: var(--rule-weight) solid var(--border-faint);
  }
  .pick-primary__identity {
    display: flex;
    flex-direction: column;
  }

  .consequence {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    padding-top: var(--s3);
    border-top: var(--rule-weight) solid var(--border-faint);
  }
  .consequence__line {
    display: flex;
    align-items: baseline;
    gap: var(--s2);
    flex-wrap: wrap;
  }
  .consequence__line .figure {
    font-size: 1.375rem;
    color: var(--accent-ink);
  }
  .consequence__notes {
    display: flex;
    flex-direction: column;
    gap: var(--s1);
    max-width: 68ch;
  }

  @media (max-width: 40rem) {
    .work {
      padding: var(--s3);
    }
    .cands__pick {
      grid-template-columns: auto minmax(0, 1fr);
      row-gap: var(--s1);
    }
    .cands__verdict {
      grid-column: 2;
    }
    .pick-primary__row {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
