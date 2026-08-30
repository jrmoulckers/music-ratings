import type { Action } from 'svelte/action';

/**
 * The ruling engine.
 *
 * Register marks and corner brackets are drawn as real SVG sized from the
 * element's live box, so a hairline stays one device pixel and the marks stay
 * square whatever the element does. `shape-rendering="crispEdges"` keeps them
 * from blurring on fractional layouts.
 */

const SVG = 'http://www.w3.org/2000/svg';

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

export interface CornerOptions {
  /** Arm length in pixels. */
  size?: number;
  /** Inset from the element's edge. */
  inset?: number;
  colour?: string;
}

/**
 * Draws four corner ticks just inside an element: the printer's trim marks that
 * bound a plate without a border or a shadow.
 */
export const cornerMarks: Action<HTMLElement, CornerOptions | undefined> = (node, options) => {
  const layer = svg('svg', {
    'aria-hidden': 'true',
    focusable: 'false',
    class: 'ruling-layer',
    'shape-rendering': 'crispEdges',
  }) as SVGSVGElement;
  layer.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;';
  if (getComputedStyle(node).position === 'static') node.style.position = 'relative';
  node.appendChild(layer);

  let current = options ?? {};

  const draw = () => {
    const { width, height } = node.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    const size = current.size ?? 9;
    const inset = current.inset ?? 0;
    const colour = current.colour ?? 'var(--rubric)';
    layer.setAttribute('viewBox', `0 0 ${width} ${height}`);
    layer.textContent = '';
    const corners: [number, number, number, number][] = [
      [inset, inset, 1, 1],
      [width - inset, inset, -1, 1],
      [inset, height - inset, 1, -1],
      [width - inset, height - inset, -1, -1],
    ];
    for (const [x, y, dx, dy] of corners) {
      layer.appendChild(
        svg('path', {
          d: `M ${x + dx * size} ${y} L ${x} ${y} L ${x} ${y + dy * size}`,
          fill: 'none',
          stroke: colour,
          'stroke-width': 1,
        }),
      );
    }
  };

  const observer = new ResizeObserver(draw);
  observer.observe(node);
  draw();

  return {
    update(next) {
      current = next ?? {};
      draw();
    },
    destroy() {
      observer.disconnect();
      layer.remove();
    },
  };
};

/* -------------------------------------------------------------------------- */

export interface SwipeOptions {
  threshold?: number;
  onLeft?: () => void;
  onRight?: () => void;
  onMove?: (dx: number) => void;
  onEnd?: () => void;
}

/**
 * Horizontal drag for the queue and the duel. Vertical intent is released back
 * to the page immediately so the list still scrolls under a thumb.
 */
export const swipe: Action<HTMLElement, SwipeOptions> = (node, options) => {
  let config = options;
  let startX = 0;
  let startY = 0;
  let active = false;
  let decided = false;

  const down = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    startX = event.clientX;
    startY = event.clientY;
    active = true;
    decided = false;
  };

  const move = (event: PointerEvent) => {
    if (!active) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!decided) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        active = false;
        return;
      }
      decided = true;
      node.setPointerCapture(event.pointerId);
    }
    config.onMove?.(dx);
  };

  const up = (event: PointerEvent) => {
    if (!active) return;
    const dx = event.clientX - startX;
    active = false;
    if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
    const threshold = config.threshold ?? 90;
    if (decided && dx <= -threshold) config.onLeft?.();
    else if (decided && dx >= threshold) config.onRight?.();
    config.onEnd?.();
    decided = false;
  };

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);

  return {
    update(next) {
      config = next;
    },
    destroy() {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
    },
  };
};

/* -------------------------------------------------------------------------- */

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Keeps tab focus inside a dialog and returns it where it came from. */
export const focusTrap: Action<HTMLElement, boolean | undefined> = (node, enabled = true) => {
  const previous = document.activeElement as HTMLElement | null;
  let on = enabled !== false;

  const first = () => node.querySelector<HTMLElement>(FOCUSABLE);

  const key = (event: KeyboardEvent) => {
    if (!on || event.key !== 'Tab') return;
    const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (items.length === 0) return;
    const start = items[0] as HTMLElement;
    const end = items[items.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === start) {
      event.preventDefault();
      end.focus();
    } else if (!event.shiftKey && document.activeElement === end) {
      event.preventDefault();
      start.focus();
    }
  };

  node.addEventListener('keydown', key);
  queueMicrotask(() => {
    if (on) (first() ?? node).focus();
  });

  return {
    update(next) {
      on = next !== false;
    },
    destroy() {
      node.removeEventListener('keydown', key);
      previous?.focus?.();
    },
  };
};

/** Moves focus to the node once it appears — used for route headings. */
export const autofocus: Action<HTMLElement, boolean | undefined> = (node, enabled = true) => {
  if (enabled !== false) queueMicrotask(() => node.focus());
};

export const clickOutside: Action<HTMLElement, () => void> = (node, handler) => {
  let run = handler;
  const onPointer = (event: PointerEvent) => {
    if (!node.contains(event.target as Node)) run();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') run();
  };
  // Capture so a click on a button elsewhere closes this before it acts.
  document.addEventListener('pointerdown', onPointer, true);
  document.addEventListener('keydown', onKey);
  return {
    update(next) {
      run = next;
    },
    destroy() {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey);
    },
  };
};
