import { describe, expect, it } from 'vitest';

import { BUILTIN_SCALES } from '../domain/scales';
import { ICON_PATHS } from './icons';

describe('icon set', () => {
  it('can draw every mark the scales name', () => {
    // The domain names a picture; this layer owns whether one exists. Without
    // this the thumbs scale would silently fall back to spelling itself out.
    const named = BUILTIN_SCALES.flatMap((scale) => scale.markIcons ?? []);
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) expect(ICON_PATHS).toHaveProperty(name);
  });

  it('draws thumbs as thumbs and not as arrows', () => {
    expect(ICON_PATHS).toHaveProperty('thumb-up');
    expect(ICON_PATHS).toHaveProperty('thumb-down');
    expect(ICON_PATHS['thumb-up']).not.toBe(ICON_PATHS['arrow-up']);
    expect(ICON_PATHS['thumb-down']).not.toBe(ICON_PATHS['arrow-down']);
    // A thumb is a hand and a cuff: two subpaths, unlike the single-stroke arrows.
    for (const name of ['thumb-up', 'thumb-down'] as const) {
      expect(ICON_PATHS[name].match(/M/g)?.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps the thumbs inside the 24-unit grid the rest of the set is drawn on', () => {
    // Only the thumb paths are checked numerically: they are pure move/line
    // commands, so every number in them is a coordinate. Arc commands elsewhere
    // pack their flags in with the digits and cannot be read this way.
    for (const name of ['thumb-up', 'thumb-down'] as const) {
      const path = ICON_PATHS[name];
      expect(path, name).not.toMatch(/[aAcCsSqQtT]/);
      const numbers = path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
      expect(numbers.length, name).toBeGreaterThan(0);
      for (const n of numbers) expect(n, `${name} uses ${n}`).toBeLessThanOrEqual(24);
      for (const n of numbers) expect(n, `${name} uses ${n}`).toBeGreaterThanOrEqual(0);
    }
  });
});
