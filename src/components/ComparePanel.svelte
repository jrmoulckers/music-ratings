<script lang="ts">
  import { judgeDuel } from '../lib/app/actions';
  import { explicitRatings, rankings, scaleForType, scores } from '../lib/app/state';
  import { rankingConfidence } from '../lib/domain/elo';
  import { formatComputedOn, formatNormalizedOn } from '../lib/domain/scales';
  import type { Comparison, Entity } from '../lib/domain/types';
  import Icon from '../lib/ui/Icon.svelte';
  import Artwork from './Artwork.svelte';

  /**
   * Head-to-head comparison.
   *
   * Two items side by side with a pivot between them. Choosing tips the pair
   * before the next one loads, so the answer is felt as well as recorded.
   * "Level" leaves it flat, which is a real answer and not a skip.
   */

  interface Props {
    a: Entity;
    b: Entity;
    reason: string;
    onafter?: () => void;
  }

  let { a, b, reason, onafter }: Props = $props();

  let tip = $state<'a' | 'b' | 'level' | null>(null);
  let busy = $state(false);

  $effect(() => {
    void a.id;
    void b.id;
    tip = null;
  });

  function standing(entity: Entity): string {
    const scale = $scaleForType(entity.type);
    const explicit = $explicitRatings.get(entity.id);
    if (explicit) return `you rated it ${formatNormalizedOn(scale, explicit.normalized)}`;
    const rollup = $scores.get(entity.id)?.rollup;
    if (rollup !== null && rollup !== undefined) return `score ${formatComputedOn(scale, rollup)}`;
    return 'no score yet';
  }

  function confidenceLine(entity: Entity): string {
    const table = $rankings.get(entity.type);
    const state = table?.get(entity.id);
    if (!state || state.comparisons === 0) return 'not compared yet';
    const pct = Math.round(rankingConfidence(state) * 100);
    return `${state.comparisons} comparisons · ${pct}% confident`;
  }

  async function judge(outcome: Comparison['outcome']) {
    if (busy) return;
    busy = true;
    tip = outcome === 'a' ? 'a' : outcome === 'b' ? 'b' : 'level';
    try {
      await judgeDuel(a, b, outcome, reason);
      onafter?.();
    } finally {
      busy = false;
    }
  }

  function onKey(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        void judge('a');
        break;
      case 'ArrowRight':
        event.preventDefault();
        void judge('b');
        break;
      case '=':
      case 'Enter':
        event.preventDefault();
        void judge('tie');
        break;
      case '?':
        event.preventDefault();
        void judge('unfamiliar');
        break;
      case 's':
      case 'S':
        event.preventDefault();
        void judge('skip');
        break;
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<section
  class="pair"
  class:tip-a={tip === 'a'}
  class:tip-b={tip === 'b'}
  class:level={tip === 'level'}
>
  <p class="pair__reason note">{reason}</p>

  <div class="pair__pans">
    <button
      type="button"
      class="pan pan--a"
      disabled={busy}
      onclick={() => void judge('a')}
      aria-label="Prefer {a.name}"
    >
      <Artwork src={a.artworkUrl} thumb={a.artworkThumbUrl} name={a.name} size="lg" priority />
      <span class="pan__name title">{a.name}</span>
      {#if a.subtitle}<span class="note">{a.subtitle}</span>{/if}
      <span class="label">{standing(a)} · {confidenceLine(a)}</span>
      <span class="pan__choose">
        <Icon name="check" size={13} />
        This one
        <kbd class="pan__kbd">←</kbd>
      </span>
    </button>

    <div class="fulcrum" aria-hidden="true">
      <span class="fulcrum__rule"></span>
      <span class="fulcrum__pivot"></span>
      <span class="fulcrum__rule"></span>
    </div>

    <button
      type="button"
      class="pan pan--b"
      disabled={busy}
      onclick={() => void judge('b')}
      aria-label="Prefer {b.name}"
    >
      <Artwork src={b.artworkUrl} thumb={b.artworkThumbUrl} name={b.name} size="lg" priority />
      <span class="pan__name title">{b.name}</span>
      {#if b.subtitle}<span class="note">{b.subtitle}</span>{/if}
      <span class="label">{standing(b)} · {confidenceLine(b)}</span>
      <span class="pan__choose">
        <Icon name="check" size={13} />
        This one
        <kbd class="pan__kbd">→</kbd>
      </span>
    </button>
  </div>

  <div class="pair__outs">
    <button type="button" class="btn" disabled={busy} onclick={() => void judge('tie')}>
      <Icon name="versus" size={14} /> Level <kbd>=</kbd>
    </button>
    <button
      type="button"
      class="btn btn--quiet"
      disabled={busy}
      onclick={() => void judge('unfamiliar')}
    >
      Don't know both <kbd>?</kbd>
    </button>
    <button type="button" class="btn btn--quiet" disabled={busy} onclick={() => void judge('skip')}>
      Not this pair <kbd>S</kbd>
    </button>
  </div>
</section>

<style>
  .pair {
    display: flex;
    flex-direction: column;
    gap: var(--s5);
  }

  .pair__reason {
    text-align: center;
    max-width: 56ch;
    margin-inline: auto;
  }

  .pair__pans {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: var(--s4);
  }

  .pan {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s2);
    padding: var(--s5) var(--s4);
    background: var(--surface-raised);
    border: var(--rule-weight) solid var(--border);
    cursor: pointer;
    text-align: center;
    color: inherit;
    font: inherit;
    transition:
      transform var(--dur-2) var(--ease),
      border-color var(--dur-1) var(--ease),
      background-color var(--dur-1) var(--ease);
  }
  .pan:hover:not(:disabled) {
    border-color: var(--ink);
    background: var(--surface);
  }
  .pan:disabled {
    cursor: default;
  }

  .pan__name {
    font-size: 1.25rem;
    margin-top: var(--s2);
  }

  /* The pan is the button, so it has to say so. */
  .pan__choose {
    display: inline-flex;
    align-items: center;
    gap: var(--s2);
    margin-top: var(--s3);
    padding: var(--s2) var(--s3);
    border: var(--rule-weight) solid var(--border);
    font-family: var(--sans);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-quiet);
    transition:
      color var(--dur-1) var(--ease),
      border-color var(--dur-1) var(--ease);
  }
  .pan:hover:not(:disabled) .pan__choose,
  .pan:focus-visible .pan__choose {
    color: var(--accent-ink);
    border-color: var(--accent);
  }

  /* A key cap is a lie on a device with no keys. */
  @media (hover: none) {
    .pan__kbd {
      display: none;
    }
  }

  /* Both sides move together, because the pair is one object. */
  .pair.tip-a .pan--a,
  .pair.tip-b .pan--b {
    transform: translateY(6px);
    border-color: var(--accent);
  }
  .pair.tip-a .pan--b,
  .pair.tip-b .pan--a {
    transform: translateY(-6px);
    opacity: 0.55;
  }
  .pair.level .pan {
    border-color: var(--ink-quiet);
  }

  .fulcrum {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s2);
    align-self: stretch;
    justify-content: center;
  }
  .fulcrum__rule {
    flex: 1;
    width: var(--rule-weight);
    background: var(--border);
    min-height: var(--s5);
  }
  .fulcrum__pivot {
    width: 9px;
    height: 9px;
    background: var(--accent);
    transform: rotate(45deg);
    transition: transform var(--dur-2) var(--ease);
  }
  .pair.tip-a .fulcrum__pivot {
    transform: rotate(45deg) translate(-3px, 3px);
  }
  .pair.tip-b .fulcrum__pivot {
    transform: rotate(45deg) translate(3px, -3px);
  }

  .pair__outs {
    display: flex;
    justify-content: center;
    gap: var(--s2);
    flex-wrap: wrap;
    padding-top: var(--s4);
    border-top: var(--rule-weight) solid var(--border-faint);
  }

  kbd {
    font-family: var(--mono);
    font-size: 0.625rem;
    border: var(--rule-weight) solid var(--border);
    padding: 0 3px;
    color: var(--ink-faint);
  }

  @media (max-width: 48rem) {
    .pair__pans {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--s3);
    }
    .fulcrum {
      flex-direction: row;
      justify-content: center;
      min-height: 0;
    }
    .fulcrum__rule {
      width: auto;
      height: var(--rule-weight);
      min-height: 0;
      min-width: var(--s6);
    }
    .pan {
      padding: var(--s4);
    }
    .pair.tip-a .pan--a,
    .pair.tip-b .pan--b {
      transform: translateX(6px);
    }
    .pair.tip-a .pan--b,
    .pair.tip-b .pan--a {
      transform: translateX(-6px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pan,
    .fulcrum__pivot {
      transition: none;
    }
    .pair.tip-a .pan--a,
    .pair.tip-b .pan--b,
    .pair.tip-a .pan--b,
    .pair.tip-b .pan--a {
      transform: none;
    }
  }
</style>
