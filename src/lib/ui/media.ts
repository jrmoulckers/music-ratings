import { readable, type Readable } from 'svelte/store';

/**
 * A media query as a store.
 *
 * Some controls change *shape*, not just style, across a breakpoint — the
 * rating rail stands up on a wide screen and lies down on a narrow one — and a
 * shape change has to reach the markup and the ARIA orientation, not only CSS.
 */
const cache = new Map<string, Readable<boolean>>();

export function media(query: string): Readable<boolean> {
  const existing = cache.get(query);
  if (existing) return existing;

  const store = readable(false, (set) => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(query);
    set(mq.matches);
    const onChange = (event: MediaQueryListEvent) => set(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });

  cache.set(query, store);
  return store;
}

/** Wide enough for a control to lay a full scale out horizontally. */
export const wideEnoughForRail = media('(min-width: 48rem)');
