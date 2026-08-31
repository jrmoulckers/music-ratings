import 'fake-indexeddb/auto';

// jsdom does not implement these, and several modules touch them at import time.
if (!globalThis.matchMedia) {
  globalThis.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof globalThis.matchMedia;
}

if (!globalThis.structuredClone) {
  globalThis.structuredClone = ((value: unknown) =>
    JSON.parse(JSON.stringify(value))) as typeof structuredClone;
}

// Svelte's `bind:clientWidth` observes the element. jsdom has no layout, so the
// observer reports nothing and the components fall back to their own defaults —
// which is exactly what they do on a real first paint.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

// Neither does jsdom implement pointer capture, which the star row uses so a
// drag keeps reporting once the finger leaves the control.
for (const method of ['setPointerCapture', 'releasePointerCapture'] as const) {
  if (!Element.prototype[method]) {
    Element.prototype[method] = function noop(): void {};
  }
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = function no(): boolean {
    return false;
  };
}
