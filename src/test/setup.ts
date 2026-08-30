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
