import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import InlineRating from '../components/InlineRating.svelte';
import { BUILTIN_SCALES } from '../lib/domain/scales';
import type { Entity, RatingScale } from '../lib/domain/types';

/**
 * The one rating control, held to one contract.
 *
 * Every scale and every variant is run through the same list of behaviours,
 * because the promise being made is that a variant changes how large the
 * control is and never what pressing it does. When that promise breaks it
 * breaks quietly — a list commits where a player drafts — so it is asserted
 * rather than reviewed.
 */

const scaleFor = (id: string): RatingScale => {
  const found = BUILTIN_SCALES.find((s) => s.id === id);
  if (!found) throw new Error(`missing fixture scale ${id}`);
  return found;
};

const track: Entity = {
  id: 'demo:track:1',
  type: 'track',
  provider: 'local',
  providerId: 'track-1',
  name: 'Wichita Lineman',
  provenance: { provider: 'local', via: 'demo', fetchedAt: 0 },
  createdAt: 0,
  updatedAt: 0,
};

let host: HTMLDivElement | null = null;
let app: ReturnType<typeof mount> | null = null;

function render(props: Record<string, unknown>): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  app = mount(InlineRating, { target: host, props: { entity: track, value: null, ...props } });
  flushSync();
  return host;
}

afterEach(() => {
  if (app) void unmount(app, { outro: false });
  host?.remove();
  app = null;
  host = null;
});

function all<T extends Element>(selector: string): T[] {
  return [...(host?.querySelectorAll<T>(selector) ?? [])];
}

function press(element: Element | undefined): void {
  (element as HTMLButtonElement | undefined)?.click();
  flushSync();
}

/**
 * The first gesture that expresses a rating on this scale, whatever kind of
 * control it turned out to be.
 */
function express(root: HTMLElement): number | null {
  const stars = root.querySelector<HTMLDivElement>('.stars');
  if (stars) {
    // A star row is a slider, not a row of buttons: it is driven the way a
    // keyboard user drives it.
    stars.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    flushSync();
    return null;
  }
  const marks = all<HTMLButtonElement>('.quick__mark');
  if (marks.length > 0) {
    press(marks[marks.length - 1]);
    return null;
  }
  const field = root.querySelector<HTMLInputElement>('.quick__field');
  if (field) {
    field.value = '7';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('blur', { bubbles: true }));
    flushSync();
    return null;
  }
  throw new Error('no control was rendered to express a rating with');
}

const COARSE = ['stars-5', 'half-stars-5', 'thumbs', 'tiers'] as const;
const DENSE = ['decimal-10'] as const;
const VARIANTS = ['compact', 'row', 'prominent'] as const;

describe.each([...COARSE, ...DENSE])('the inline control on the %s scale', (scaleId) => {
  const scale = scaleFor(scaleId);
  const dense = (DENSE as readonly string[]).includes(scaleId);

  it.each(VARIANTS)('shows the value it was given, in the %s variant', (variant) => {
    const root = render({ scale, variant, value: 60 });
    // Whatever the control, the current reading is on show somewhere in it:
    // a rating you cannot see is one you set twice.
    const set = root.querySelector('[aria-pressed="true"], .is-set, .is-lit, [aria-valuenow]');
    const field = root.querySelector<HTMLInputElement>('.quick__field, .prec__field');
    expect(Boolean(set) || (field?.value ?? '') !== '').toBe(true);
  });

  it('names the entity and the scale for a screen reader', () => {
    const root = render({ scale, variant: 'row' });
    expect(root.innerHTML).toContain(scale.label);
    expect(root.innerHTML).toContain(track.name);
  });

  it('does not write while disabled', () => {
    const onrate = vi.fn(async () => {});
    const root = render({ scale, variant: 'row', disabled: true, onrate });
    express(root);
    expect(onrate).not.toHaveBeenCalled();
  });

  it('hands a held value out without writing a rating', () => {
    const onvalue = vi.fn();
    const onrate = vi.fn(async () => {});
    const root = render({ scale, variant: 'row', mode: 'held', onvalue, onrate });
    express(root);
    expect(onvalue).toHaveBeenCalledTimes(1);
    expect(onrate).not.toHaveBeenCalled();
    expect(onvalue.mock.calls[0]![0]).toBeGreaterThanOrEqual(0);
    expect(onvalue.mock.calls[0]![0]).toBeLessThanOrEqual(100);
  });

  if (!dense) {
    it('commits a coarse scale in the one gesture', async () => {
      const onrate = vi.fn(async () => {});
      const root = render({ scale, variant: 'row', onrate });
      express(root);
      await Promise.resolve();
      expect(onrate).toHaveBeenCalledTimes(1);
    });

    it('drops a second press while the first is still in the air', async () => {
      const pending: Array<() => void> = [];
      const onrate = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            pending.push(resolve);
          }),
      );
      const root = render({ scale, variant: 'row', onrate });
      express(root);
      express(root);
      expect(onrate).toHaveBeenCalledTimes(1);
      for (const resolve of pending) resolve();
      await Promise.resolve();
    });

    it('says so when the write fails, and does not pretend it saved', async () => {
      const onrate = vi.fn(async () => {
        throw new Error('OneDrive said no.');
      });
      const root = render({ scale, variant: 'row', onrate });
      express(root);
      await Promise.resolve();
      await Promise.resolve();
      flushSync();
      expect(root.textContent).toContain('OneDrive said no.');
    });
  } else {
    it('drafts a dense scale and waits to be saved', async () => {
      const onrate = vi.fn(async () => {});
      const root = render({ scale, variant: 'row', onrate });
      express(root);
      expect(onrate).not.toHaveBeenCalled();

      const save = root.querySelector<HTMLButtonElement>('.quick__save');
      expect(save, 'a dense draft offers its own save').not.toBeNull();
      press(save ?? undefined);
      await Promise.resolve();
      expect(onrate).toHaveBeenCalledTimes(1);
    });
  }
});

describe('the disclosure beside the control', () => {
  it('is absent where a surface has nothing deeper to open', () => {
    const root = render({ variant: 'row' });
    expect(root.querySelector('.inline__more')).toBeNull();
  });

  it('offers details rather than the rating itself', () => {
    const ondetails = vi.fn();
    const root = render({ variant: 'row', ondetails });
    const more = root.querySelector<HTMLButtonElement>('.inline__more');
    expect(more?.textContent).toContain('details');
    // The basic control is present without pressing it — that is the whole point.
    expect(root.querySelector('.quick, .rail')).not.toBeNull();
    press(more ?? undefined);
    expect(ondetails).toHaveBeenCalledTimes(1);
  });

  it('says it is editing once there is a rating to edit', () => {
    const root = render({ variant: 'row', value: 70, ondetails: () => {} });
    expect(root.querySelector('.inline__more')?.textContent).toContain('Edit');
  });
});

describe('the player on a narrow screen', () => {
  beforeEach(() => {
    // jsdom has no matchMedia; the media store treats that as narrow.
    vi.stubGlobal('matchMedia', undefined);
  });

  it('folds into a popover that holds the same control', () => {
    const root = render({ variant: 'player', value: 40 });
    const trigger = root.querySelector<HTMLButtonElement>('.inline__trigger');
    expect(trigger, 'a narrow player shows a trigger, not a bare scale').not.toBeNull();
    // The trigger prints the current reading rather than a generic word.
    expect(trigger?.querySelector('.inline__reading')?.textContent?.trim()).not.toBe('');

    press(trigger ?? undefined);
    const pop = root.querySelector('[role="dialog"]');
    expect(pop).not.toBeNull();
    expect(pop?.querySelector('.quick')).not.toBeNull();
  });

  it('closes on Escape and puts the caret back on the trigger', () => {
    const root = render({ variant: 'player' });
    const trigger = root.querySelector<HTMLButtonElement>('.inline__trigger');
    press(trigger ?? undefined);
    expect(root.querySelector('[role="dialog"]')).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushSync();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
