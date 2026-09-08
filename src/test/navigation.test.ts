import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';

import type { Route } from '../lib/app/router';
import NavRail from '../components/NavRail.svelte';

const route: Route = {
  name: 'home',
  params: {},
  query: new URLSearchParams(),
  path: '/',
};

let host: HTMLDivElement | null = null;
let app: ReturnType<typeof mount> | null = null;

function render() {
  host = document.createElement('div');
  document.body.appendChild(host);
  app = mount(NavRail, { target: host, props: { route, online: true } });
  flushSync();
}

function moreButton(): HTMLButtonElement {
  const button = [...(host?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((node) =>
    /more/i.test(node.textContent ?? ''),
  );
  if (!button) throw new Error('More button was not rendered');
  return button;
}

afterEach(() => {
  if (app) void unmount(app, { outro: false });
  host?.remove();
  app = null;
  host = null;
});

describe('responsive section navigation', () => {
  it('opens More as a labelled modal and moves focus into it', async () => {
    render();
    const button = moreButton();

    button.click();
    await Promise.resolve();
    flushSync();

    const sheet = host?.querySelector<HTMLElement>('#more-sections');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(sheet?.getAttribute('role')).toBe('dialog');
    expect(sheet?.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement?.textContent).toContain('Now Playing');
  });

  it('closes More with Escape and returns focus to its trigger', async () => {
    render();
    const button = moreButton();
    button.click();
    await Promise.resolve();
    flushSync();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await Promise.resolve();
    flushSync();

    expect(host?.querySelector('#more-sections')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });
});
