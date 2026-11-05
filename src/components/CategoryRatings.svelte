<script lang="ts">
  import { annotationsById, canonical, world } from '../lib/app/state';
  import { announce } from '../lib/app/notices';
  import { categoryKey, categoryStandings } from '../lib/domain/categories';
  import type { Entity } from '../lib/domain/types';
  import { recordCategoryRating } from '../lib/storage/repo';
  import { dateAndTime } from '../lib/ui/format';

  let { entity }: { entity: Entity } = $props();
  const uid = $props.id();
  let category = $state('');
  let value = $state<number | undefined>(undefined);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let message = $state('');
  const history = $derived($annotationsById.get(entity.id)?.categoryRatings ?? []);
  const standings = $derived(categoryStandings(history));
  const current = $derived(standings.filter((rating) => rating.normalized !== null));
  const suggestions = $derived([
    ...new Set([
      'Drums',
      'Vocals',
      'Bass',
      'Guitar',
      'Lyrics',
      'Production',
      ...$world.annotations.flatMap((annotation) =>
        (annotation.categoryRatings ?? []).map((rating) => rating.category),
      ),
    ]),
  ]);
  const ordered = $derived([...history].sort((a, b) => b.at - a.at || b.id.localeCompare(a.id)));

  $effect(() => {
    void entity.id;
    category = '';
    value = undefined;
    error = null;
    message = '';
  });

  function select(label: string) {
    category = label;
    value =
      standings.find((entry) => categoryKey(entry.category) === categoryKey(label))?.normalized ??
      undefined;
  }

  async function save(label: string, normalized: number | null) {
    busy = true;
    error = null;
    message = '';
    try {
      await recordCategoryRating($canonical.resolve(entity.id), label, normalized);
      message =
        normalized === null
          ? `${label} rating withdrawn. History kept.`
          : `${label} rated ${normalized}/100 for ${entity.name}.`;
      announce(message);
      category = '';
      value = undefined;
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      busy = false;
    }
  }
</script>

<section class="categories stack" aria-labelledby="{uid}-heading">
  <h2 id="{uid}-heading" class="title">Category ratings</h2>
  <p class="note">
    Rate a particular part, like drums or vocals, from 0 to 100. These are separate opinions: they
    never change your overall rating or ranking.
  </p>
  {#if current.length > 0}
    <ul class="category-list">
      {#each current as rating (rating.id)}
        <li class="row">
          <span>{rating.category}</span>
          <strong class="figure">{rating.normalized}/100</strong>
          <button
            type="button"
            class="btn btn--small btn--quiet"
            disabled={busy}
            onclick={() => select(rating.category)}>Rate {rating.category} again</button
          >
          <button
            type="button"
            class="btn btn--small btn--quiet"
            disabled={busy}
            onclick={() => void save(rating.category, null)}>Withdraw {rating.category}</button
          >
        </li>
      {/each}
    </ul>
  {/if}
  <form
    class="category-form"
    onsubmit={(event) => {
      event.preventDefault();
      if (value !== undefined && !busy) void save(category, value);
    }}
  >
    <label class="field">
      <span class="label">Category</span>
      <input
        class="input"
        list="{uid}-categories"
        maxlength="80"
        required
        bind:value={category}
        disabled={busy}
        placeholder="e.g. Drums"
      />
    </label>
    <datalist id="{uid}-categories">
      {#each suggestions as suggestion (suggestion)}
        <option value={suggestion}></option>
      {/each}
    </datalist>
    <label class="field">
      <span class="label">Rating / 100</span>
      <input
        class="input"
        type="number"
        min="0"
        max="100"
        step="1"
        required
        bind:value
        disabled={busy}
      />
    </label>
    <button
      class="btn btn--small"
      type="submit"
      disabled={busy || !category.trim() || value === undefined}
    >
      {busy ? 'Saving…' : 'Save category rating'}
    </button>
  </form>
  {#if error}<p class="note" role="alert">{error}</p>{/if}
  {#if message}<p class="note" role="status">{message}</p>{/if}
  {#if history.length > 0}
    <details>
      <summary class="note">Category history ({history.length})</summary>
      <ul class="category-history">
        {#each ordered as entry (entry.id)}
          <li class="note">
            {entry.category}: {entry.normalized === null ? 'withdrawn' : `${entry.normalized}/100`}
            <span class="note note--small"> · {dateAndTime(entry.at)}</span>
          </li>
        {/each}
      </ul>
    </details>
  {/if}
</section>

<style>
  .categories {
    padding-block: var(--s4);
    border-top: var(--rule-weight) solid var(--border);
  }
  .categories > .note {
    max-width: var(--measure);
  }
  .category-list,
  .category-history {
    display: grid;
    gap: var(--s2);
    overflow-wrap: anywhere;
  }
  .category-form {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--s3);
  }
  .category-form .field:first-child {
    flex: 1 1 12rem;
    min-width: 0;
    max-width: 24rem;
  }
  .category-form .field:nth-of-type(2) {
    flex: 0 1 8rem;
    min-width: 6rem;
  }
</style>
