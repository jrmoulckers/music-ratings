import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src', 'app.css'), 'utf8');

function declarations(block: string | undefined): Record<string, string> {
  if (!block) throw new Error('Missing appearance token block');
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => {
      if (!name || !value) throw new Error('Invalid appearance token declaration');
      return [name, value.trim()];
    }),
  );
}

const light = declarations(css.match(/:root\s*\{([^}]+)\}/)?.[1]);
const dark = declarations(css.match(/\[data-theme='dark'\]\s*\{([^}]+)\}/)?.[1]);
const high = declarations(css.match(/\[data-contrast='high'\]\s*\{([^}]+)\}/)?.[1]);
const darkHigh = declarations(
  css.match(/\[data-theme='dark'\]\[data-contrast='high'\]\s*\{([^}]+)\}/)?.[1],
);

function resolve(tokens: Record<string, string>, role: string, seen = new Set<string>()): string {
  if (seen.has(role)) throw new Error(`Circular token: ${role}`);
  seen.add(role);
  const value = tokens[role];
  if (!value) throw new Error(`Unresolved token: ${role}`);
  const reference = value.match(/^var\(--([\w-]+)\)$/)?.[1];
  return reference ? resolve(tokens, reference, seen) : value;
}

function luminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Expected sRGB hex color, got ${hex}`);
  return (
    [
      [1, 0.2126],
      [3, 0.7152],
      [5, 0.0722],
    ] as const
  ).reduce((sum, [offset, weight]) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return sum + linear * weight;
  }, 0);
}

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe('shared color accessibility', () => {
  it.each([
    ['light', light],
    ['dark', { ...light, ...dark }],
    ['light high contrast', { ...light, ...high }],
    ['dark high contrast', { ...light, ...dark, ...high, ...darkHigh }],
  ] as const)('%s resolves every shared color role and meets AA on all surfaces', (_, tokens) => {
    for (const surface of ['surface', 'surface-sunk', 'surface-raised', 'accent-wash']) {
      const background = resolve(tokens, surface);
      for (const text of ['ink', 'ink-quiet', 'ink-faint', 'accent-ink']) {
        expect(
          contrast(resolve(tokens, text), background),
          `${text} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      for (const boundary of ['control-border', 'accent']) {
        expect(
          contrast(resolve(tokens, boundary), background),
          `${boundary} on ${surface}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
    for (const fill of ['accent', 'accent-ink']) {
      expect(
        contrast(resolve(tokens, 'on-accent'), resolve(tokens, fill)),
        `on-accent on ${fill}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps controls touch-safe and system/reduced motion distinct', () => {
    expect(light['target-min']).toBe('2.875rem');
    expect(css).toContain("[data-motion='system']");
    expect(css).toContain("[data-motion='reduce']");
    expect(css).toContain('transition-duration: 1ms !important');
    expect(css).not.toContain('body::before');
  });
});
