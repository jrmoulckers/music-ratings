import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';

import PrecisionRail from '../components/rating/PrecisionRail.svelte';
import StarRating from '../components/rating/StarRating.svelte';
import { BUILTIN_SCALES, findScale } from '../lib/domain/scales';
import type { RatingScale } from '../lib/domain/types';

/**
 * The two controls that actually write ratings, mounted.
 *
 * The rules they follow are unit-tested next to them; what is proved here is
 * that the components obey those rules through real DOM events — because the
 * bug being fixed was never in the arithmetic, it was in a control that
 * committed when it should only have been thinking about it.
 */

const scale = (id: string): RatingScale => {
  const found = findScale(BUILTIN_SCALES, id);
  if (!found) throw new Error(`missing fixture scale ${id}`);
  return found;
};

let host: HTMLDivElement | null = null;

let app: any = null;

function render(component: unknown, props: Record<string, unknown>) {
  host = document.createElement('div');
  document.body.appendChild(host);

  app = mount(component as any, { target: host, props });
  flushSync();
  return host;
}

afterEach(() => {
  if (app) void unmount(app, { outro: false });
  host?.remove();
  app = null;
  host = null;
});

function query<T extends Element>(selector: string): T {
  const found = host?.querySelector<T>(selector);
  if (!found) throw new Error(`no ${selector} in the rendered control`);
  return found;
}

function press(selector: string): void {
  query<HTMLButtonElement>(selector).click();
  flushSync();
}

describe('the precision rail', () => {
  const decimal = scale('decimal-10');

  it('will not step off the resting middle of an unrated control', () => {
    const commits: number[] = [];
    render(PrecisionRail, {
      scale: decimal,
      value: null,
      oncommit: (n: number) => commits.push(n),
    });

    const [down, up] = [...(host?.querySelectorAll<HTMLButtonElement>('.prec__step') ?? [])];
    expect(down?.disabled).toBe(true);
    expect(up?.disabled).toBe(true);

    // Even if something reaches past the disabled attribute, nothing is written.
    up?.click();
    down?.click();
    flushSync();
    expect(commits).toEqual([]);
    expect(query<HTMLInputElement>('.prec__field').value).toBe('');
  });

  it('explains why the steppers are shut instead of leaving them dead', () => {
    render(PrecisionRail, { scale: decimal, value: null });
    const up = [...(host?.querySelectorAll<HTMLButtonElement>('.prec__step') ?? [])][1];
    const hintId = up?.getAttribute('aria-describedby');
    expect(hintId).toBeTruthy();
    expect(host?.querySelector(`#${hintId}`)?.textContent?.trim()).toBe(
      'Drag or type a value to start, then save it.',
    );
  });

  it('turns the slider into a draft, not a rating', () => {
    const commits: number[] = [];
    const previews: number[] = [];
    render(PrecisionRail, {
      scale: decimal,
      value: null,
      oncommit: (n: number) => commits.push(n),
      onpreview: (n: number) => previews.push(n),
    });

    const range = query<HTMLInputElement>('.prec__range');
    range.value = '7.3';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();

    expect(commits).toEqual([]);
    expect(previews.at(-1)).toBeCloseTo(73, 6);
    expect(query<HTMLInputElement>('.prec__field').value).toBe('7.3');
    expect(host?.querySelector('.prec__of')?.textContent?.trim()).toBe('Not saved yet');
  });

  it('steps from the real value once there is one, and still does not commit', () => {
    const commits: number[] = [];
    render(PrecisionRail, { scale: decimal, value: 50, oncommit: (n: number) => commits.push(n) });
    expect(query<HTMLInputElement>('.prec__field').value).toBe('5.0');

    press('.prec__step:last-of-type');
    expect(query<HTMLInputElement>('.prec__field').value).toBe('5.1');
    expect(commits).toEqual([]);
  });

  it('saves once, and only when asked', () => {
    const commits: number[] = [];
    render(PrecisionRail, { scale: decimal, value: 50, oncommit: (n: number) => commits.push(n) });

    const save = query<HTMLButtonElement>('.prec__buttons .btn--primary');
    expect(save.disabled).toBe(true);

    press('.prec__step:last-of-type');
    expect(query<HTMLButtonElement>('.prec__buttons .btn--primary').disabled).toBe(false);

    press('.prec__buttons .btn--primary');
    expect(commits).toEqual([51]);
  });

  it('puts the old value back when the draft is cancelled', () => {
    const commits: number[] = [];
    render(PrecisionRail, { scale: decimal, value: 50, oncommit: (n: number) => commits.push(n) });
    press('.prec__step:last-of-type');
    press('.prec__step:first-of-type');
    press('.prec__step:first-of-type');
    expect(query<HTMLInputElement>('.prec__field').value).toBe('4.9');

    press('.prec__buttons .btn');
    expect(query<HTMLInputElement>('.prec__field').value).toBe('5.0');
    expect(commits).toEqual([]);
  });

  it('clamps a typed number into the draft and says so, without saving it', () => {
    const commits: number[] = [];
    render(PrecisionRail, {
      scale: decimal,
      value: null,
      oncommit: (n: number) => commits.push(n),
    });

    const field = query<HTMLInputElement>('.prec__field');
    field.value = '14';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('blur', { bubbles: true }));
    flushSync();

    expect(query<HTMLInputElement>('.prec__field').value).toBe('10.0');
    expect(commits).toEqual([]);
    expect(host?.querySelector('.prec__said')?.textContent).toContain(
      'This scale runs from 0.0 and 10.0',
    );
  });

  it('saves on Enter, but only what the reader actually typed', () => {
    const commits: number[] = [];
    render(PrecisionRail, {
      scale: decimal,
      value: null,
      oncommit: (n: number) => commits.push(n),
    });

    const field = query<HTMLInputElement>('.prec__field');
    // Enter on an untouched field must not save the resting middle.
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    flushSync();
    expect(commits).toEqual([]);

    field.value = '8.4';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    flushSync();
    expect(commits).toEqual([84]);
  });

  it('takes Escape back from whatever opened it only while there is a draft to drop', () => {
    render(PrecisionRail, { scale: decimal, value: 50 });
    const field = query<HTMLInputElement>('.prec__field');

    const idle = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    field.dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);

    press('.prec__step:last-of-type');
    const held = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    field.dispatchEvent(held);
    flushSync();
    expect(held.defaultPrevented).toBe(true);
    expect(query<HTMLInputElement>('.prec__field').value).toBe('5.0');
  });

  it('walks a hundred-point scale one whole point at a time', () => {
    const commits: number[] = [];
    render(PrecisionRail, {
      scale: scale('int-100'),
      value: 73,
      oncommit: (n: number) => commits.push(n),
    });
    press('.prec__step:last-of-type');
    expect(query<HTMLInputElement>('.prec__field').value).toBe('74');
    press('.prec__buttons .btn--primary');
    expect(commits).toEqual([74]);
  });
});

describe('the stars', () => {
  const stars = scale('stars-5');
  const half = scale('half-stars-5');

  it('draws five stars, whether or not it counts in halves', () => {
    render(StarRating, { scale: half, value: null });
    expect(host?.querySelectorAll('.stars__cell').length).toBe(5);
  });

  it('fills up to the rating and no further', () => {
    render(StarRating, { scale: stars, value: 60 });
    const lit = host?.querySelectorAll('.stars__cell.is-lit');
    expect(lit?.length).toBe(3);
  });

  it('cuts the star in half rather than drawing ten of them', () => {
    render(StarRating, { scale: half, value: 70 });
    expect(host?.querySelectorAll('.stars__cell').length).toBe(5);
    expect(host?.querySelectorAll('.stars__cell.is-lit').length).toBe(4);
    const fills = [...(host?.querySelectorAll<SVGPathElement>('.stars__fill') ?? [])];
    expect(fills.at(-1)?.style.clipPath).toBe('inset(0 50% 0 0)');
    expect(fills[0]?.style.clipPath).toBe('inset(0 0% 0 0)');
  });

  it('says what it currently reads, out loud', () => {
    render(StarRating, { scale: half, value: 70 });
    expect(query('.stars').getAttribute('aria-valuetext')).toBe('3.5 out of 5 stars');

    if (app) void unmount(app, { outro: false });
    host?.remove();
    render(StarRating, { scale: stars, value: null });
    expect(query('.stars').getAttribute('aria-valuetext')).toBe('Not yet rated');
  });

  it('commits on a press, the way a star rating always has', () => {
    const commits: number[] = [];
    render(StarRating, { scale: stars, value: null, oncommit: (n: number) => commits.push(n) });

    const row = query<HTMLDivElement>('.stars');
    // jsdom gives every element a zero-width box, so the geometry is stubbed.
    row.getBoundingClientRect = () => ({ left: 0, width: 200, right: 200 }) as DOMRect;
    row.setPointerCapture = () => undefined;
    row.hasPointerCapture = () => false;
    row.releasePointerCapture = () => undefined;

    row.dispatchEvent(new PointerEvent('pointerdown', { clientX: 150, bubbles: true }));
    flushSync();
    expect(commits).toEqual([]);
    row.dispatchEvent(new PointerEvent('pointerup', { clientX: 150, bubbles: true }));
    flushSync();
    expect(commits).toEqual([80]);
  });

  it('puts the old rating back when a hover is abandoned', () => {
    render(StarRating, { scale: stars, value: 40 });
    const row = query<HTMLDivElement>('.stars');
    row.getBoundingClientRect = () => ({ left: 0, width: 200, right: 200 }) as DOMRect;

    row.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 190, bubbles: true, pointerType: 'mouse' }),
    );
    flushSync();
    expect(row.getAttribute('aria-valuetext')).toBe('5 out of 5 stars');

    row.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    flushSync();
    expect(row.getAttribute('aria-valuetext')).toBe('2 out of 5 stars');
  });

  it('moves by the scale step on the arrows and reaches both ends', () => {
    const commits: number[] = [];
    const row = () => query<HTMLDivElement>('.stars');
    render(StarRating, { scale: half, value: 70, oncommit: (n: number) => commits.push(n) });

    row().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    flushSync();
    expect(commits.at(-1)).toBe(80);

    row().dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    flushSync();
    expect(commits.at(-1)).toBe(10);

    row().dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    flushSync();
    expect(commits.at(-1)).toBe(100);
  });

  it('takes a digit as the number of stars', () => {
    const commits: number[] = [];
    render(StarRating, { scale: stars, value: null, oncommit: (n: number) => commits.push(n) });
    query('.stars').dispatchEvent(new KeyboardEvent('keydown', { key: '4', bubbles: true }));
    flushSync();
    expect(commits).toEqual([80]);
  });

  it('starts from the bottom on an unrated control rather than from the middle', () => {
    const commits: number[] = [];
    render(StarRating, { scale: stars, value: null, oncommit: (n: number) => commits.push(n) });
    query('.stars').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    flushSync();
    expect(commits).toEqual([20]);
  });
});
