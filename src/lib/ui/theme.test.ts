import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultSettings, type AppSettings } from '../storage/settings';

const css = readFileSync(join(process.cwd(), 'src', 'app.css'), 'utf8');
const lightSurface = css.match(/--palette-light-ground:\s*(#[0-9a-f]{6})/)?.[1];
const darkSurface = css.match(/--palette-dark-ground:\s*(#[0-9a-f]{6})/)?.[1];
let styles: HTMLStyleElement;

beforeEach(() => {
  vi.resetModules();
  styles = document.createElement('style');
  styles.textContent = `:root {--surface: ${lightSurface};}
    [data-theme='dark'] {--surface: ${darkSurface};}`;
  document.head.append(styles);
  document.head.insertAdjacentHTML(
    'beforeend',
    '<meta name="theme-color" media="(prefers-color-scheme: light)" content="old-light">' +
      '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="old-dark">',
  );
});

afterEach(() => {
  styles.remove();
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
  for (const attribute of ['theme', 'density', 'motion', 'contrast']) {
    delete document.documentElement.dataset[attribute];
  }
  document.documentElement.style.removeProperty('color-scheme');
  vi.unstubAllGlobals();
});

describe('document appearance', () => {
  it.each(['light', 'dark'] as const)(
    'uses the %s CSS surface for all browser chrome',
    async (theme) => {
      const { applyTheme } = await import('./theme');
      applyTheme({
        ...defaultSettings(),
        theme,
        density: 'compact',
        motion: 'reduce',
        highContrast: true,
      });

      const root = document.documentElement;
      expect(root.dataset).toMatchObject({
        theme,
        density: 'compact',
        motion: 'reduce',
        contrast: 'high',
      });
      expect(root.style.colorScheme).toBe(theme);
      const surface = getComputedStyle(root).getPropertyValue('--surface').trim();
      expect(surface).toMatch(/^#[0-9a-f]{6}$/);
      expect(surface).toBe(theme === 'light' ? lightSurface : darkSurface);
      for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
        expect(meta.getAttribute('content')).toBe(surface);
        expect(meta.hasAttribute('media')).toBe(false);
      }
    },
  );

  it('follows OS changes only while System is selected and releases its listener', async () => {
    const listeners = new Set<() => void>();
    const media = {
      matches: true,
      addEventListener: vi.fn((_: string, listener: () => void) => listeners.add(listener)),
      removeEventListener: vi.fn((_: string, listener: () => void) => listeners.delete(listener)),
    };
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => media),
    );
    const { applyTheme, resolveTheme, watchSystemTheme } = await import('./theme');
    let settings: AppSettings = { ...defaultSettings(), theme: 'system' };
    const stop = watchSystemTheme(() => settings);

    expect(resolveTheme('system')).toBe('dark');
    applyTheme(settings);
    expect(document.documentElement.dataset.theme).toBe('dark');
    media.matches = false;
    for (const listener of listeners) listener();
    expect(document.documentElement.dataset.theme).toBe('light');

    settings = { ...settings, theme: 'dark' };
    applyTheme(settings);
    for (const listener of listeners) listener();
    expect(document.documentElement.dataset.theme).toBe('dark');
    stop();
    expect(listeners.size).toBe(0);
    const stopAgain = watchSystemTheme(() => settings);
    expect(listeners.size).toBe(1);
    stopAgain();
  });

  it('resolves System safely when the browser has no matchMedia', async () => {
    vi.stubGlobal('matchMedia', undefined);
    const { resolveTheme } = await import('./theme');
    expect(resolveTheme('system')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });
});
