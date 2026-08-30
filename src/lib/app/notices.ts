import { writable } from 'svelte/store';

/**
 * Transient messages, and the polite announcements that go with them.
 *
 * A notice always has a plain sentence; an action is optional and is how undo
 * is offered after a rating or a comparison.
 */

export interface Notice {
  id: number;
  message: string;
  tone: 'plain' | 'warn';
  action?: { label: string; run: () => void | Promise<void> };
  /** Milliseconds before it withdraws itself. `0` keeps it until dismissed. */
  timeout: number;
}

export const notices = writable<Notice[]>([]);

let seq = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export function notify(
  message: string,
  options: { tone?: Notice['tone']; action?: Notice['action']; timeout?: number } = {},
): number {
  seq += 1;
  const id = seq;
  const notice: Notice = {
    id,
    message,
    tone: options.tone ?? 'plain',
    timeout: options.timeout ?? (options.action ? 8000 : 4500),
    ...(options.action ? { action: options.action } : {}),
  };
  notices.update((list) => [...list.slice(-3), notice]);
  if (notice.timeout > 0) {
    timers.set(
      id,
      setTimeout(() => dismiss(id), notice.timeout),
    );
  }
  return id;
}

export function dismiss(id: number): void {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  notices.update((list) => list.filter((n) => n.id !== id));
}

/* -------------------------------------------------------------------------- */

/**
 * A single polite live region for the whole app. Screens call `announce` after
 * an action that changes something they cannot see happening.
 */
export const announcement = writable('');

let clearTimer: ReturnType<typeof setTimeout> | undefined;

export function announce(message: string): void {
  announcement.set('');
  // The empty beat guarantees repeat messages are read again.
  requestAnimationFrame(() => {
    announcement.set(message);
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => announcement.set(''), 6000);
  });
}
