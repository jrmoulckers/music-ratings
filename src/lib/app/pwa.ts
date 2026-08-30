import { writable } from 'svelte/store';

/**
 * Service worker and install state.
 *
 * Updates are offered, never forced: reloading under someone mid-rating would
 * throw away a rating they were still forming.
 */

export interface PwaState {
  updateReady: boolean;
  offlineReady: boolean;
  installable: boolean;
  installed: boolean;
}

export const pwa = writable<PwaState>({
  updateReady: false,
  offlineReady: false,
  installable: false,
  installed: false,
});

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: InstallPromptEvent | null = null;
let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;

const HOUR = 3_600_000;

export async function startPwa(): Promise<void> {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    pwa.update((s) => ({ ...s, installable: true }));
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    pwa.update((s) => ({ ...s, installable: false, installed: true }));
  });

  if (matchMedia('(display-mode: standalone)').matches) {
    pwa.update((s) => ({ ...s, installed: true }));
  }

  if (import.meta.env.DEV) return;

  try {
    const { registerSW } = await import('virtual:pwa-register');
    applyUpdate = registerSW({
      immediate: true,
      onNeedRefresh() {
        pwa.update((s) => ({ ...s, updateReady: true }));
      },
      onOfflineReady() {
        pwa.update((s) => ({ ...s, offlineReady: true }));
      },
      onRegisteredSW(_url, registration) {
        if (!registration) return;
        // A long-lived tab should still learn about new versions.
        setInterval(() => void registration.update(), HOUR);
      },
    });
  } catch {
    // No service worker available (unsupported browser, or blocked). The app
    // works without one; only offline shell caching is lost.
  }
}

export async function installApp(): Promise<boolean> {
  if (!deferredPrompt) return false;
  await deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  pwa.update((s) => ({ ...s, installable: false }));
  return outcome === 'accepted';
}

export async function reloadForUpdate(): Promise<void> {
  pwa.update((s) => ({ ...s, updateReady: false }));
  if (applyUpdate) await applyUpdate(true);
  else location.reload();
}

export function dismissUpdate(): void {
  pwa.update((s) => ({ ...s, updateReady: false }));
}
