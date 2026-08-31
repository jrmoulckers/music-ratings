import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';

import ContextEditor from '../components/ContextEditor.svelte';
import PrecisionRail from '../components/rating/PrecisionRail.svelte';
import RatePanel from '../components/RatePanel.svelte';
import { defaultFacets, type ContextConfig } from '../lib/domain/context';
import { BUILTIN_SCALES } from '../lib/domain/scales';
import type { Entity, FacetJudgement, RatingEvent, RatingScale } from '../lib/domain/types';
import { seedFrom } from '../lib/ui/history';

/**
 * Rating in context, as the reader meets it.
 *
 * Three rules are worth proving in the DOM rather than only in the domain: the
 * context path is optional and starts closed; opening it takes the save away
 * from the individual controls so one press records the lot; and an entry in
 * the record reopens on the answers it was actually saved with.
 */

const scale: RatingScale = BUILTIN_SCALES.find((s) => s.id === 'decimal-10')!;

const album: Entity = {
  id: 'demo:album:1',
  type: 'album',
  provider: 'local',
  providerId: 'album-1',
  name: 'Sex Machine',
  releaseDate: '1970-08-01',
  provenance: { provider: 'local', via: 'demo', fetchedAt: 0 },
  createdAt: 0,
  updatedAt: 0,
};

function config(over: Partial<ContextConfig> = {}): ContextConfig {
  return { enabled: true, contribution: 0.2, facets: defaultFacets(), ...over };
}

function judgement(facetId: string, normalized: number): FacetJudgement {
  return { facetId, value: normalized / 10, scaleId: 'decimal-10', normalized };
}

let host: HTMLDivElement | null = null;
let app: any = null;

afterEach(() => {
  if (app) void unmount(app, { outro: false });
  host?.remove();
  app = null;
  host = null;
});

function render(component: any, props: Record<string, unknown>): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  app = mount(component, { target: host, props });
  flushSync();
  return host;
}

/* -------------------------------------------------------------------------- */
/* The optional path                                                          */
/* -------------------------------------------------------------------------- */

describe('the context section in the shared editor', () => {
  function panel(props: Record<string, unknown> = {}) {
    return render(RatePanel, { entity: album, inline: true, shortcuts: false, ...props });
  }

  it('starts closed, so the fast path is still one gesture', () => {
    const root = panel();
    const disclose = root.querySelector<HTMLButtonElement>('.panel__disclose');
    expect(disclose).not.toBeNull();
    expect(disclose?.getAttribute('aria-expanded')).toBe('false');
    expect(disclose?.textContent).toContain('Deeper rating');
    expect(root.querySelector('.ctx')).toBeNull();
  });

  it('opens onto the questions that apply to this type, and no others', () => {
    const root = panel();
    root.querySelector<HTMLButtonElement>('.panel__disclose')!.click();
    flushSync();

    const asked = [...root.querySelectorAll('.ctx__label')].map((n) => n.textContent);
    expect(asked).toContain('Enjoyment');
    expect(asked).toContain('Innovation for its time');
    // Curation is a playlist question. An album is never asked it.
    expect(asked).not.toContain('Curation');
    expect(asked.length).toBeLessThanOrEqual(5);
  });

  it('prints the release year as a fact, never as a judgement', () => {
    const root = panel();
    root.querySelector<HTMLButtonElement>('.panel__disclose')!.click();
    flushSync();
    const lede = root.querySelector('.ctx__lede')?.textContent ?? '';
    expect(lede).toContain('Released in 1970');
    expect(lede).toContain('Your judgements, not Spotify');
  });

  it('takes the save away from the rail while it is open, and gives back one', () => {
    const root = panel();
    expect(root.querySelector('.panel__save')).toBeNull();

    root.querySelector<HTMLButtonElement>('.panel__disclose')!.click();
    flushSync();

    // Exactly one primary save in the whole editor: the rail's own footer, if
    // it has one, stands down while an outer save owns the transaction.
    expect(root.querySelectorAll('.btn--primary').length).toBe(1);
    expect(root.querySelector('.panel__save .btn--primary')).not.toBeNull();
  });

  it('will not save context without a rating of your own', () => {
    const root = panel();
    root.querySelector<HTMLButtonElement>('.panel__disclose')!.click();
    flushSync();

    const save = root.querySelector<HTMLButtonElement>('.panel__save .btn--primary')!;
    expect(save.disabled).toBe(true);
    expect(root.querySelector('.panel__save .note')?.textContent).toContain(
      'context is saved with a rating, never instead of one',
    );
  });

  it('does not close or commit while the rating is being chosen', () => {
    const root = panel();
    root.querySelector<HTMLButtonElement>('.panel__disclose')!.click();
    flushSync();

    const detents = root.querySelectorAll<HTMLButtonElement>('.rail__detent');
    expect(detents.length).toBeGreaterThan(0);
    detents[6]!.click();
    flushSync();

    // Still open, still unsaved: the value has become a draft, not a record.
    expect(root.querySelector('.ctx')).not.toBeNull();
    expect(root.querySelector<HTMLButtonElement>('.panel__save .btn--primary')!.disabled).toBe(
      false,
    );
    expect(root.querySelector('.panel__save .note')?.textContent).toContain('Saved as one rating');
  });

  it('reopens on the answers an entry was saved with, not on a blank sheet', () => {
    const event: RatingEvent = {
      id: 'e1',
      entityId: album.id,
      entityType: 'album',
      at: 1_700_000_000_000,
      value: 7,
      scaleId: 'decimal-10',
      normalized: 70,
      confidence: 'medium',
      updatedAt: 1_700_000_000_000,
      contextual: {
        v: 1,
        facets: [judgement('innovation', 100), judgement('enjoyment', 70)],
        weights: { innovation: 1, enjoyment: 1 },
        contribution: 0.2,
        applicable: 5,
      },
    };
    const root = panel({ seed: seedFrom(event) });

    // Opened already, because there is context on this entry to show.
    expect(root.querySelector('.panel__disclose')?.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('.ctx')).not.toBeNull();
    expect(root.querySelector('.panel__disclose')?.textContent).toContain('2 of');
  });
});

/* -------------------------------------------------------------------------- */
/* The editor itself                                                          */
/* -------------------------------------------------------------------------- */

describe('the context editor', () => {
  function editor(values: Record<string, FacetJudgement>, over: Partial<ContextConfig> = {}) {
    const set: string[] = [];
    const root = render(ContextEditor, {
      entity: album,
      scale,
      direct: 70,
      values,
      config: config(over),
      onset: (id: string) => set.push(id),
    });
    return { root, set };
  }

  it('says there is no context score before anything is answered', () => {
    const { root } = editor({});
    const figures = [...root.querySelectorAll('.ctx__part')].map((n) => n.textContent);
    expect(figures.some((t) => t?.includes('Deeper') && t.includes('—'))).toBe(true);
    expect(root.textContent).toContain('No answers yet');
    expect(root.querySelector('.ctx__how')).toBeNull();
  });

  it('shows your rating, the context score and the adjusted result side by side', () => {
    const { root } = editor({
      enjoyment: judgement('enjoyment', 70),
      craft: judgement('craft', 90),
      innovation: judgement('innovation', 100),
      influence: judgement('influence', 100),
      'staying-power': judgement('staying-power', 80),
    });
    const said = root.querySelector('.ctx__tally')?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(said).toContain('Your rating 7.0');
    expect(said).toContain('Deeper 8.8');
    expect(said).toContain('Adjusted 7.4');
  });

  it('counts coverage over the questions that apply, not the ones answered', () => {
    const { root } = editor({ enjoyment: judgement('enjoyment', 70) });
    expect(root.textContent).toContain('1 of 5 answered');
  });

  it('says answers are recorded but uncounted when contribution is off', () => {
    const { root } = editor({ enjoyment: judgement('enjoyment', 70) }, { enabled: false });
    expect(root.textContent).toContain('not counted');
    expect(root.querySelector('.ctx__part--out')).toBeNull();
  });

  it('offers a way to take an answer back', () => {
    const { root, set } = editor({ enjoyment: judgement('enjoyment', 70) });
    const clear = root.querySelector<HTMLButtonElement>('.ctx__clear')!;
    clear.click();
    expect(set).toEqual(['enjoyment']);
  });

  it('explains each share and where the blend came from', () => {
    const { root } = editor({
      enjoyment: judgement('enjoyment', 70),
      craft: judgement('craft', 90),
    });
    const table = root.querySelector('.ctx__table')?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(table).toContain('Enjoyment');
    expect(table).toContain('50%');
    // With a contribution set, the one disclosure worth printing is the
    // arithmetic that moved the number, not a definition of an average.
    expect(root.querySelector('.ctx__how')?.textContent).toContain('of the way towards');
  });
});

/* -------------------------------------------------------------------------- */
/* Composing versus committing                                                */
/* -------------------------------------------------------------------------- */

describe('a precision rail asked to compose rather than commit', () => {
  it('hides its own save and reports every change instead', () => {
    const seen: number[] = [];
    const root = render(PrecisionRail, {
      scale,
      value: null,
      mode: 'compose',
      oncommit: (n: number) => seen.push(n),
    });

    expect(root.querySelector('.prec__settle .btn--primary')).toBeNull();

    const range = root.querySelector<HTMLInputElement>('.prec__range')!;
    range.value = '7';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    expect(seen).toEqual([70]);
    expect(root.querySelector('.prec__said')?.textContent).toContain('7.0');
  });

  it('still keeps its own save when nobody else owns it', () => {
    const root = render(PrecisionRail, { scale, value: null, oncommit: () => {} });
    expect(root.querySelector('.prec__settle .btn--primary')).not.toBeNull();
  });

  it('does not report anything from the resting position alone', () => {
    const seen: number[] = [];
    const root = render(PrecisionRail, {
      scale,
      value: null,
      mode: 'compose',
      oncommit: (n: number) => seen.push(n),
    });
    // The steppers stay shut until the reader has said where they are starting.
    for (const button of root.querySelectorAll<HTMLButtonElement>('.prec__step')) {
      expect(button.disabled).toBe(true);
      button.click();
    }
    flushSync();
    expect(seen).toEqual([]);
  });
});
