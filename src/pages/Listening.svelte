<script lang="ts">
  import AlbumComplete from '../components/AlbumComplete.svelte';
  import Empty from '../components/Empty.svelte';
  import { entityHref, href } from '../lib/app/router';
  import { notify } from '../lib/app/notices';
  import {
    catalogue,
    clock,
    completions,
    explicitRatings,
    playIndex,
    scaleForType,
    settings,
    updateSettings,
    world,
  } from '../lib/app/state';
  import {
    computeListeningStats,
    LISTENING_RANGES,
    RANGE_LABEL,
    type ListeningRange,
    type RankedItem,
    type RatingTension,
  } from '../lib/domain/listening-stats';
  import { formatComputedOn } from '../lib/domain/scales';
  import { readCoverage } from '../lib/listening/ingest';
  import {
    ESTIMATED_TIME_NOTE,
    NO_PERCENTILE,
    WINDOW_CAVEAT,
    breadth,
    coverageNotes,
    estimatedTime,
    elapsedSpan,
    observedSince,
    rangeCaveat,
    share,
  } from '../lib/listening/phrasing';
  import { emptyCoverage, type ListeningCoverage } from '../lib/domain/listening';
  import Icon from '../lib/ui/Icon.svelte';
  import { dateAndTime, plural, relative } from '../lib/ui/format';

  /**
   * What this app actually saw you listen to.
   *
   * Every figure on this page is a count of confirmed plays or a share of them,
   * and the denominator is always in view. That is not modesty, it is the only
   * honest option: Spotify hands back the last fifty plays and says nothing
   * about how anyone else listens, so a lifetime total or a listener percentile
   * would have to be invented. This page would rather state a smaller true
   * thing and show its working.
   */

  let range = $state<ListeningRange>('30d');
  let coverage = $state<ListeningCoverage>(emptyCoverage());

  $effect(() => {
    void readCoverage()
      .then((held) => {
        coverage = held;
      })
      .catch((error: unknown) => {
        notify(error instanceof Error ? error.message : 'Could not read listening coverage.', {
          tone: 'warn',
        });
      });
  });

  const stats = $derived(
    computeListeningStats({
      index: $playIndex,
      catalogue: $catalogue,
      explicit: $explicitRatings,
      completions: $completions,
      range,
      now: $clock,
      limit: 8,
    }),
  );

  const observedFrom = $derived($settings.listeningObservedFrom);
  const byTime = $derived($settings.listeningBasis === 'minutes');
  const caveat = $derived(rangeCaveat(range, observedFrom, stats.from));
  const notes = $derived(coverageNotes(coverage, $clock));
  const trackScale = $derived($scaleForType('track'));
  const hasDemo = $derived.by(() => {
    const demoIds = new Set(
      $world.entities
        .filter((entity) => entity.provenance.via === 'demo-listening')
        .map((entity) => entity.id),
    );
    return $world.plays.some((play) => !play.deleted && demoIds.has(play.entityId));
  });

  /*
   * RATING SURFACE: this page renders rating values as text only, via
   * `formatComputedOn`. It imports no rating component and no primitive. If a
   * canonical inline rating display lands, the three `formatComputedOn` call
   * sites below are the whole migration.
   */

  function metric(item: RankedItem): string {
    return byTime
      ? `${estimatedTime(item.estimatedMs)} · ${share(Math.round(item.timeShare * 1000) / 10, 100, '% of estimated time')}`
      : share(item.plays, stats.plays);
  }
</script>

<div class="sheet">
  <header class="head">
    <h1 class="display">Listening</h1>
    <p class="note">{hasDemo ? 'Includes demo data' : 'Spotify-confirmed plays'}</p>
  </header>
  {#if hasDemo}
    <p class="note note--warn demo-notice">
      Demo listening is included below. These fictional plays were not confirmed by Spotify. Remove
      demo history in Data health to review only your listening.
    </p>
  {/if}

  <!-- The range strip. Not tabs: the page does not change, only the window it
       is counting over, so it reads as a setting on the numbers below. -->
  <div class="range" role="group" aria-label="Time range">
    {#each LISTENING_RANGES as option (option)}
      <button
        type="button"
        class="range__opt"
        aria-pressed={range === option}
        onclick={() => (range = option)}
      >
        {RANGE_LABEL[option]}
      </button>
    {/each}
  </div>
  <label class="field field--inline listening-basis">
    <span class="label">Show</span>
    <select
      class="select"
      value={$settings.listeningBasis}
      onchange={(event) =>
        void updateSettings({ listeningBasis: event.currentTarget.value as 'plays' | 'minutes' })}
    >
      <option value="plays">Plays</option>
      <option value="minutes">Estimated minutes</option>
    </select>
  </label>

  {#if $playIndex.length === 0}
    <Empty
      title="Nothing observed yet"
      body={$settings.listeningEnabled
        ? 'Play music, then refresh listening in Library. Only Spotify-confirmed plays are recorded.'
        : 'Enable listening history in Settings to start recording Spotify-confirmed plays.'}
    >
      {#snippet action()}
        <a
          class="btn btn--primary"
          href={href($settings.listeningEnabled ? '/library' : '/settings')}
        >
          {$settings.listeningEnabled ? 'Open library' : 'Open settings'}
        </a>
      {/snippet}
    </Empty>
  {:else}
    <p class="provenance">
      {observedSince(observedFrom)}
      {#if caveat}<span class="provenance__caveat">{caveat}</span>{/if}
    </p>

    <!-- Totals. A short row of counted facts, before any ranking. -->
    <section class="band" aria-labelledby="totals">
      <h2 class="title band__title" id="totals">In {RANGE_LABEL[range].toLowerCase()}</h2>
      <dl class="totals">
        <div>
          <dt class="note note--small">Plays observed</dt>
          <dd class="mono totals__big">{stats.plays.toLocaleString()}</dd>
        </div>
        <div>
          <dt class="note note--small">Tracks</dt>
          <dd class="mono">{stats.uniqueTracks.toLocaleString()}</dd>
        </div>
        <div>
          <dt class="note note--small">Releases</dt>
          <dd class="mono">{stats.uniqueReleases.toLocaleString()}</dd>
        </div>
        <div>
          <dt class="note note--small">Artists</dt>
          <dd class="mono">{stats.uniqueArtists.toLocaleString()}</dd>
        </div>
        <div>
          <dt class="note note--small">Estimated time</dt>
          <dd class="mono">{estimatedTime(stats.estimatedMs)}</dd>
        </div>
        <div>
          <dt class="note note--small">Repeat plays</dt>
          <dd class="mono">{stats.repeatPlays.toLocaleString()}</dd>
        </div>
      </dl>
      <details class="band__foot" open={$settings.showExplanations}>
        <summary class="note note--small">How time is estimated</summary>
        <p class="note note--small">{ESTIMATED_TIME_NOTE}</p>
      </details>
      {#if stats.playsWithoutDuration > 0}
        <p class="note note--small">
          {plural(stats.playsWithoutDuration, 'play')} had no known length; the estimate is low.
        </p>
      {/if}
    </section>

    <!-- Albums completed: the same object as the prompt, read back quietly. -->
    <section class="band" aria-labelledby="done">
      <h2 class="title band__title" id="done">Albums completed</h2>
      {#if stats.completions.length === 0}
        <p class="note band__none">No albums completed in this period.</p>
      {:else}
        <p class="band__lead">
          {plural(stats.completions.length, 'record')} heard end to end.
          {#if stats.medianCompletionSpanMs != null}
            Typically over {elapsedSpan(stats.medianCompletionSpanMs)}.
          {/if}
          {#if stats.completionStreakDays > 1}
            Longest run: {plural(stats.completionStreakDays, 'day')} in a row.
          {/if}
          {#if stats.startedNotCompleted > 0}
            {plural(stats.startedNotCompleted, 'other release')} started but not finished.
          {/if}
        </p>
        <ul class="done-list">
          {#each stats.completions.slice(0, 6) as completion (completion.id)}
            <li><AlbumComplete {completion} quiet /></li>
          {/each}
        </ul>
        {#if stats.completions.length > 6}
          <p class="note band__none">
            Showing the 6 most recent of {plural(stats.completions.length, 'completion')} in this period.
          </p>
        {/if}
      {/if}
      <details class="band__foot" open={$settings.showExplanations}>
        <summary class="note note--small">What counts as a completion</summary>
        <p class="note note--small">
          Every available track on one album edition must have a confirmed play within your
          completion window.
        </p>
      </details>
    </section>

    {#snippet ranked(title: string, items: RankedItem[], denominatorNote: string)}
      <section class="band" aria-labelledby="r-{title}">
        <h2 class="title band__title" id="r-{title}">{title}</h2>
        {#if items.length === 0}
          <p class="note band__none">Nothing observed in this period.</p>
        {:else}
          <ol class="ranked">
            {#each items as item (item.entityId)}
              <li class="ranked__row">
                <a class="ranked__name" href={entityHref(item.entityId)}>{item.name}</a>
                <span
                  class="ranked__bar"
                  aria-hidden="true"
                  style="--w: {Math.max(2, (byTime ? item.timeShare : item.playShare) * 100)}%"
                ></span>
                <span class="note note--small ranked__metric">{metric(item)}</span>
              </li>
            {/each}
          </ol>
          <details class="band__foot" open={$settings.showExplanations}>
            <summary class="note note--small">How this is counted</summary>
            <p class="note note--small">{denominatorNote}</p>
          </details>
        {/if}
      </section>
    {/snippet}

    {@render ranked(
      'Most played tracks',
      stats.topTracks,
      byTime
        ? 'Share is of estimated track-length time in this period, not actual listening time.'
        : `Share is of the ${stats.plays.toLocaleString()} plays observed in this period.`,
    )}
    {@render ranked(
      'Most played releases',
      stats.topReleases,
      'A release counts a play of any of its tracks.',
    )}
    {@render ranked(
      'Most played artists',
      stats.topArtists,
      'Counted by each track’s first credited artist, so these shares add up to the whole and never past it.',
    )}

    {#if stats.artistCredits.length > 0}
      <section class="band" aria-labelledby="credits">
        <h2 class="title band__title" id="credits">Artists by any credit</h2>
        <details class="band__foot" open={$settings.showExplanations}>
          <summary class="note note--small">Why credits exceed total plays</summary>
          <p class="note note--small">
            The same plays counted for every credited artist. A track by two artists counts once for
            each, so this is breadth of who you heard — not a share of anything, and it deliberately
            adds up past the total.
          </p>
        </details>
        <ul class="credits">
          {#each stats.artistCredits as credit (credit.entityId)}
            <li>
              <a href={entityHref(credit.entityId)}>{credit.name}</a>
              <span class="note note--small mono">{plural(credit.plays, 'play')}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if stats.newToObservation.length > 0 || stats.resurfaced.length > 0}
      <section class="band" aria-labelledby="new">
        <h2 class="title band__title" id="new">New and returning</h2>
        {#if stats.newToObservation.length > 0}
          <p class="band__lead">First heard in this period, as far as this app has observed.</p>
          <ul class="credits">
            {#each stats.newToObservation as item (item.entityId)}
              <li>
                <a href={entityHref(item.entityId)}>{item.name}</a>
                <span class="note note--small mono">{plural(item.plays, 'play')}</span>
              </li>
            {/each}
          </ul>
        {/if}
        {#if stats.resurfaced.length > 0}
          <p class="band__lead band__lead--gap">Back after a long time away.</p>
          <ul class="credits">
            {#each stats.resurfaced as item (item.entityId)}
              <li>
                <a href={entityHref(item.entityId)}>{item.name}</a>
                <span class="note note--small">last heard {relative(item.lastAt, $clock)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

    <!-- Where listening and rating disagree. Stated as an observation, never as
         advice about what to play. -->
    <section class="band" aria-labelledby="against">
      <h2 class="title band__title" id="against">Against your ratings</h2>
      <dl class="totals">
        <div>
          <dt class="note note--small">Rated, of tracks heard</dt>
          <dd class="mono">{breadth(stats.ratedHeard, stats.uniqueTracks, 'heard')}</dd>
        </div>
        {#if stats.meanRatingOfHeard != null}
          <div>
            <dt class="note note--small">Mean rating of what you heard</dt>
            <dd class="mono">{formatComputedOn(trackScale, stats.meanRatingOfHeard)}</dd>
          </div>
        {/if}
      </dl>

      {#snippet tensions(title: string, body: string, rows: RatingTension[])}
        {#if rows.length > 0}
          <p class="band__lead band__lead--gap"><strong>{title}.</strong> {body}</p>
          <ul class="credits">
            {#each rows as row (row.entityId)}
              <li>
                <a href={entityHref(row.entityId)}>{row.name}</a>
                <span class="note note--small mono">
                  {formatComputedOn(trackScale, row.normalized)} · {plural(row.plays, 'play')}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      {/snippet}

      {@render tensions(
        'Loved but neglected',
        'Rated highly, and not played at all in this period.',
        stats.lovedButNeglected,
      )}
      {@render tensions(
        'Played despite the rating',
        'Kept coming back to, but rated low.',
        stats.highPlayLowRating,
      )}

      {#if stats.playedButUnrated.length > 0}
        <p class="band__lead band__lead--gap">
          <strong>Heard but never rated.</strong> Played in this period with no rating on record.
        </p>
        <ul class="credits">
          {#each stats.playedButUnrated as item (item.entityId)}
            <li>
              <a href={entityHref(item.entityId)}>{item.name}</a>
              <span class="note note--small mono">{plural(item.plays, 'play')}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  <!-- What this page cannot tell you. Kept at the foot, stated plainly, and
       never softened: the alternative is a number nobody can check. -->
  {#each notes.filter((note) => note.tone === 'warn') as note, i (i)}
    <p class="note note--small coverage-warning"><Icon name="flag" size={12} /> {note.text}</p>
  {/each}
  <details class="limits" open={$settings.showExplanations}>
    <summary class="note">Data coverage and limits</summary>
    <ul class="limits__list">
      <li>{WINDOW_CAVEAT}</li>
      <li>{NO_PERCENTILE}</li>
      <li>
        A play is counted when Spotify lists it in your recently played. How much of the track was
        actually heard is not something Spotify says, so it is not something this app claims.
      </li>
      {#each notes.filter((note) => note.tone !== 'warn') as note, i (i)}
        <li>
          {note.text}
        </li>
      {/each}
      {#if coverage.newestSeenAt}
        <li>Newest play on record: {dateAndTime(coverage.newestSeenAt)}.</li>
      {/if}
    </ul>
  </details>
</div>

<style>
  /* The shared page header keeps its title and trailing label on one line.
     There is no room for both on a phone, so let them stack here. */
  .head {
    flex-wrap: wrap;
  }
  .listening-basis {
    margin-bottom: var(--s5);
  }
  .demo-notice {
    margin-bottom: var(--s4);
    max-width: var(--measure);
  }
  details summary {
    cursor: pointer;
    color: var(--ink-quiet);
    min-height: var(--target-min, 2.875rem);
    padding-block: var(--s2);
  }
  details p {
    margin-top: var(--s2);
  }
  .coverage-warning {
    margin-bottom: var(--s3);
  }

  .range {
    display: flex;
    flex-wrap: wrap;
    gap: 0;
    margin-bottom: var(--s4);
    border: var(--rule-weight) solid var(--border);
    width: fit-content;
    max-width: 100%;
  }
  .range__opt {
    min-height: var(--target-min, 2.875rem);
    padding: var(--s2) var(--s3);
    border: 0;
    border-right: var(--rule-weight) solid var(--border);
    background: transparent;
    font-family: var(--sans);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-quiet);
    cursor: pointer;
    transition:
      background-color var(--dur-1) var(--ease),
      color var(--dur-1) var(--ease);
  }
  .range__opt:last-child {
    border-right: 0;
  }
  .range__opt:hover {
    color: var(--ink);
  }
  .range__opt[aria-pressed='true'] {
    background: var(--ink);
    color: var(--surface);
  }

  .provenance {
    max-width: var(--measure);
    margin: 0 0 var(--s5);
    font-size: 0.875rem;
    color: var(--ink-quiet);
  }
  .provenance__caveat {
    display: block;
    margin-top: var(--s1);
  }

  .band {
    margin-bottom: var(--s6);
  }
  .band__title {
    padding-bottom: var(--s2);
    margin-bottom: var(--s3);
    border-bottom: var(--rule-weight) solid var(--ink);
  }
  .band__lead {
    max-width: var(--measure);
    margin: 0 0 var(--s3);
    font-size: 0.9375rem;
    line-height: 1.5;
  }
  .band__lead--gap {
    margin-top: var(--s4);
  }
  .band__none {
    max-width: var(--measure);
    margin: 0;
  }
  .band__foot {
    max-width: var(--measure);
    margin: var(--s3) 0 0;
  }

  .totals {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s3) var(--s5);
    margin: 0;
  }
  .totals div {
    display: grid;
    gap: 2px;
  }
  .totals dt,
  .totals dd {
    margin: 0;
  }
  .totals dd {
    font-size: 1.0625rem;
    color: var(--ink);
  }
  .totals__big {
    font-size: 1.75rem;
    line-height: 1.1;
  }

  .done-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: var(--rule-weight) solid var(--border-faint);
  }
  .done-list > li {
    border-bottom: var(--rule-weight) solid var(--border-faint);
  }

  /* A ranked row is a name, a measure and a figure on one line. The measure is
     drawn as a length of the same rail ink, so the ranking is legible before
     the numbers are read. */
  .ranked {
    list-style: none;
    margin: 0;
    padding: 0;
    counter-reset: rank;
  }
  .ranked__row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: baseline;
    gap: var(--s1) var(--s3);
    padding: var(--s2) 0;
    border-bottom: var(--rule-weight) solid var(--border-faint);
  }
  .ranked__name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ink);
    text-decoration: none;
  }
  .ranked__name:hover {
    text-decoration: underline;
  }
  .ranked__metric {
    justify-self: end;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .ranked__bar {
    grid-column: 1 / -1;
    height: 2px;
    width: var(--w);
    background: var(--accent);
  }

  .credits {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .credits > li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s2);
    padding: var(--s2) 0;
    border-bottom: var(--rule-weight) solid var(--border-faint);
  }
  .credits a {
    color: var(--ink);
    text-decoration: none;
  }
  .credits a:hover {
    text-decoration: underline;
  }

  .limits {
    padding-top: var(--s4);
    border-top: var(--rule-weight) solid var(--border);
  }
  .limits__list {
    max-width: var(--measure);
    margin: var(--s3) 0 0;
    padding-left: var(--s4);
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--ink-quiet);
  }
</style>
