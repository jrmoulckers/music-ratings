import type { AppSettings } from '../storage/settings';

/**
 * The document-level switches.
 *
 * Everything visual keys off four attributes on <html>. Nothing else in the app
 * decides what the page looks like, which is why a theme change is one write.
 */

const THEME_COLOR = { light: '#f1ece2', dark: '#14140f' } as const;

let systemTheme: MediaQueryList | null = null;
let listening = false;

function prefersDark(): boolean {
  if (typeof matchMedia !== 'function') return false;
  systemTheme ??= matchMedia('(prefers-color-scheme: dark)');
  return systemTheme.matches;
}

export function resolveTheme(choice: AppSettings['theme']): 'light' | 'dark' {
  if (choice === 'light' || choice === 'dark') return choice;
  return prefersDark() ? 'dark' : 'light';
}

export function applyTheme(settings: AppSettings): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const theme = resolveTheme(settings.theme);

  root.dataset.theme = theme;
  root.dataset.density = settings.density;
  root.dataset.motion = settings.motion;
  root.dataset.contrast = settings.highContrast ? 'high' : 'normal';
  root.style.colorScheme = theme;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[theme]);
}

/**
 * Follow the OS while the user is on "system". Registered once; the callback
 * re-reads the live settings so it never holds a stale copy.
 */
export function watchSystemTheme(read: () => AppSettings): () => void {
  if (listening || typeof matchMedia !== 'function') return () => {};
  listening = true;
  systemTheme ??= matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    const settings = read();
    if (settings.theme === 'system') applyTheme(settings);
  };
  systemTheme.addEventListener('change', onChange);
  return () => {
    systemTheme?.removeEventListener('change', onChange);
    listening = false;
  };
}
