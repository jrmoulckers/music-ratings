<script lang="ts">
  import { entityHref } from '../lib/app/router';
  import {
    explicitRatings,
    graph,
    rankings,
    scaleForType,
    scores,
    settings,
    signals,
    world,
  } from '../lib/app/state';
  import { computeInsights, type Insight } from '../lib/domain/insights';
  import { formatComputedOn } from '../lib/domain/scales';
  import Empty from '../components/Empty.svelte';

  /**
   * Insights.
   *
   * Every one of these is a rule you can read and check against your own data.
   * Nothing here is a prediction, a model, or a claim that Spotify recommended
   * anything — the evidence line says exactly what produced the finding.
   */

  const insights = $derived(
    computeInsights({
      graph: $graph,
      explicit: $explicitRatings,
      scores: $scores,
      rankings: $rankings,
      events: $world.ratings,
      signals: $signals,
      enabledTypes: $settings.enabledTypes,
    }),
  );

  const GROUPS: { label: string; kinds: Insight['kind'][] }[] = [
    { label: 'What you actually like', kinds: ['favourite', 'hidden-gem'] },
    { label: 'What you actually avoid', kinds: ['avoid', 'deprioritise'] },
    { label: 'Where you are undecided', kinds: ['polarizing', 'uncertain', 'drift'] },
    { label: 'Where the record is thin', kinds: ['coverage', 'explore'] },
    { label: 'Settled rankings', kinds: ['stable'] },
  ];

  const grouped = $derived(
    GROUPS.map((group) => ({
      ...group,
      items: insights.filter((f) => group.kinds.includes(f.kind)),
    })).filter((group) => group.items.length > 0),
  );

  /**
   * Insights are computed on the canonical 0–100 basis, but they are read on
   * whatever scale the reader chose. Where a finding hands back a bare score,
   * print it on that scale instead.
   */
  function describe(item: { entityId: string; detail: string; value?: number }): string {
    if (item.value === undefined || !/^\d+ \/ 100$/.test(item.detail)) return item.detail;
    const entity = $graph.entity(item.entityId);
    const scale = $scaleForType(entity?.type ?? 'track');
    return `${formatComputedOn(scale, item.value)} on ${scale.label}`;
  }
</script>

<div class="sheet">
  <header class="head">
    <h1 class="display">Insights</h1>
    <p class="label">computed here, from your ratings only</p>
  </header>

  {#if grouped.length === 0}
    <Empty
      title="Not enough to say anything honest"
      body="Insights need a body of ratings to describe. Rate twenty or thirty things and patterns start to be worth stating; before that, anything shown here would be noise dressed up as insight."
    />
  {:else}
    <div class="insights">
      {#each grouped as group (group.label)}
        <section aria-labelledby="g-{group.label}">
          <h2 id="g-{group.label}" class="insights__group title">{group.label}</h2>
          {#each group.items as finding (finding.id)}
            <article class="finding">
              <h3 class="finding__title">{finding.title}</h3>
              <p class="finding__body">{finding.finding}</p>
              {#if finding.entities.length > 0}
                <ul class="finding__items">
                  {#each finding.entities.slice(0, 6) as item (item.entityId)}
                    <li>
                      <a href={entityHref(item.entityId)}>{item.name}</a>
                      <span class="note">{describe(item)}</span>
                    </li>
                  {/each}
                </ul>
              {/if}
              <p class="finding__evidence label">Rule: {finding.evidence}</p>
            </article>
          {/each}
        </section>
      {/each}
    </div>
  {/if}

  <p class="disclaimer note note--small">
    These are descriptions of your own ratings, worked out on this device. No model is trained, no
    data is sent anywhere, and nothing here is a Spotify recommendation.
  </p>
</div>

<style>
  .insights {
    display: flex;
    flex-direction: column;
    gap: var(--s6);
  }

  .insights__group {
    padding-bottom: var(--s2);
    border-bottom: var(--rule-weight) solid var(--ink);
    margin-bottom: var(--s3);
  }

  .finding {
    padding: var(--s4) 0;
    border-bottom: var(--rule-weight) solid var(--border-faint);
    max-width: var(--measure);
  }
  .finding__title {
    font-family: var(--sans);
    font-size: 0.9375rem;
    font-weight: 650;
    margin-bottom: var(--s1);
  }
  .finding__body {
    font-family: var(--display);
    line-height: 1.5;
    margin-bottom: var(--s3);
  }

  .finding__items {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: var(--s3);
    padding-left: var(--s4);
    border-left: var(--rule-weight) solid var(--accent);
  }
  .finding__items li {
    display: flex;
    gap: var(--s3);
    align-items: baseline;
    flex-wrap: wrap;
  }

  .finding__evidence {
    color: var(--ink-faint);
    max-width: 68ch;
    line-height: 1.5;
    text-transform: none;
    letter-spacing: 0.01em;
  }

  .disclaimer {
    margin-top: var(--s6);
    padding-top: var(--s3);
    border-top: var(--rule-weight) solid var(--border-faint);
    max-width: var(--measure);
  }
</style>
