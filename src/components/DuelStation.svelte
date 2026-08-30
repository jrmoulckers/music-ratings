<script lang="ts">
  import { judgeDuel } from '../lib/app/actions';
  import { explicitRatings, rankings, scaleForType, scores } from '../lib/app/state';
  import { rankingConfidence } from '../lib/domain/elo';
  import { formatComputedOn, formatNormalizedOn } from '../lib/domain/scales';
  import type { Comparison, Entity } from '../lib/domain/types';
  import Icon from '../lib/ui/Icon.svelte';
  import Plate from './Plate.svelte';

  /**
   * Weighing up.
   *
   * Two items on the beam, the fulcrum between them. Choosing tips the beam
   * before the next pair loads, so the answer is felt as well as recorded.
   * "Level" leaves the beam flat — that is the whole point of the shape.
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
    if (rollup !== null && rollup !== undefined)
      return `computes to ${formatComputedOn(scale, rollup)}`;
    return 'no score yet';
  }

  function settledness(entity: Entity): string {
    const table = $rankings.get(entity.type);
    const state = table?.get(entity.id);
    if (!state || state.comparisons === 0) return 'first time on the beam';
    const pct = Math.round(rankingConfidence(state) * 100);
    return `${state.comparisons} weigh-ins · ${pct}% settled`;
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
  class="beam"
  class:tip-a={tip === 'a'}
  class:tip-b={tip === 'b'}
  class:level={tip === 'level'}
>
  <p class="beam__reason note">{reason}</p>

  <div class="beam__pans">
    <button
      type="button"
      class="pan pan--a"
      disabled={busy}
      onclick={() => void judge('a')}
      aria-label="Prefer {a.name}"
    >
      <Plate src={a.artworkUrl} thumb={a.artworkThumbUrl} name={a.name} size="lg" priority />
      <span class="pan__name title">{a.name}</span>
      {#if a.subtitle}<span class="note">{a.subtitle}</span>{/if}
      <span class="apparatus">{standing(a)} · {settledness(a)}</span>
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
      <Plate src={b.artworkUrl} thumb={b.artworkThumbUrl} name={b.name} size="lg" priority />
      <span class="pan__name title">{b.name}</span>
      {#if b.subtitle}<span class="note">{b.subtitle}</span>{/if}
      <span class="apparatus">{standing(b)} · {settledness(b)}</span>
      <span class="pan__choose">
        <Icon name="check" size={13} />
        This one
        <kbd class="pan__kbd">→</kbd>
      </span>
    </button>
  </div>

  <div class="beam__outs">
    <button type="button" class="btn" disabled={busy} onclick={() => void judge('tie')}>
      <Icon name="balance" size={14} /> Level <kbd>=</kbd>
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
  .beam {
    display: flex;
    flex-direction: column;
    gap: var(--s5);
  }

  .beam__reason {
    text-align: center;
    max-width: 56ch;
    margin-inline: auto;
  }

  .beam__pans {
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
    background: var(--paper-raised);
    border: var(--rule-weight) solid var(--rule);
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
    background: var(--paper);
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
    border: var(--rule-weight) solid var(--rule);
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
    color: var(--rubric-ink);
    border-color: var(--rubric);
  }

  /* A key cap is a lie on a device with no keys. */
  @media (hover: none) {
    .pan__kbd {
      display: none;
    }
  }

  /* The beam tips. Both pans move, because a balance has one body. */
  .beam.tip-a .pan--a,
  .beam.tip-b .pan--b {
    transform: translateY(6px);
    border-color: var(--rubric);
  }
  .beam.tip-a .pan--b,
  .beam.tip-b .pan--a {
    transform: translateY(-6px);
    opacity: 0.55;
  }
  .beam.level .pan {
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
    background: var(--rule);
    min-height: var(--s5);
  }
  .fulcrum__pivot {
    width: 9px;
    height: 9px;
    background: var(--rubric);
    transform: rotate(45deg);
    transition: transform var(--dur-2) var(--ease);
  }
  .beam.tip-a .fulcrum__pivot {
    transform: rotate(45deg) translate(-3px, 3px);
  }
  .beam.tip-b .fulcrum__pivot {
    transform: rotate(45deg) translate(3px, -3px);
  }

  .beam__outs {
    display: flex;
    justify-content: center;
    gap: var(--s2);
    flex-wrap: wrap;
    padding-top: var(--s4);
    border-top: var(--rule-weight) solid var(--rule-faint);
  }

  kbd {
    font-family: var(--mono);
    font-size: 0.625rem;
    border: var(--rule-weight) solid var(--rule);
    padding: 0 3px;
    color: var(--ink-faint);
  }

  @media (max-width: 48rem) {
    .beam__pans {
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
    .beam.tip-a .pan--a,
    .beam.tip-b .pan--b {
      transform: translateX(6px);
    }
    .beam.tip-a .pan--b,
    .beam.tip-b .pan--a {
      transform: translateX(-6px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pan,
    .fulcrum__pivot {
      transition: none;
    }
    .beam.tip-a .pan--a,
    .beam.tip-b .pan--b,
    .beam.tip-a .pan--b,
    .beam.tip-b .pan--a {
      transform: none;
    }
  }
</style>
