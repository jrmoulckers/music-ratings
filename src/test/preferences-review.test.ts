import { flushSync, mount, unmount } from 'svelte';
import { get, writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Actions from '../lib/app/actions';
import SettingsPage from '../pages/Settings.svelte';
import History from '../pages/History.svelte';
import Insights from '../pages/Insights.svelte';
import Listening from '../pages/Listening.svelte';
import Diagnostics from '../pages/Diagnostics.svelte';
import ComparePanel from '../components/ComparePanel.svelte';
import { loadAll, settings, world } from '../lib/app/state';
import { db, META_SETTINGS, readSettings, SYNCED_STORES, writeMeta } from '../lib/storage/db';
import { defaultSettings } from '../lib/storage/settings';
import * as ingestion from '../lib/listening/ingest';
import { emptyCoverage } from '../lib/domain/listening';
import { makeEntity, play, rate } from './fixtures';

const submitComparison = vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
vi.mock('../lib/app/actions', async (original) => ({
  ...(await original<typeof Actions>()),
  submitComparison: (...args: unknown[]) => submitComparison(...args),
}));
vi.mock('../lib/app/pwa', () => ({
  pwa: writable({ installable: false, installed: false, offlineReady: false, updateReady: false }),
  installApp: vi.fn(),
}));

let host: HTMLDivElement;
let app: ReturnType<typeof mount> | undefined;

beforeEach(async () => {
  const database = await db();
  for (const store of SYNCED_STORES) await database.clear(store);
  await writeMeta(META_SETTINGS, defaultSettings());
  await loadAll();
  submitComparison.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(async () => {
  if (app) await unmount(app, { outro: false });
  app = undefined;
  host.remove();
});

function disclosure(name: string): HTMLDetailsElement {
  const summary = [...host.querySelectorAll('summary')].find((node) =>
    node.textContent?.includes(name),
  );
  if (!summary || !(summary.parentElement instanceof HTMLDetailsElement)) {
    throw new Error(`Missing disclosure: ${name}`);
  }
  return summary.parentElement;
}

describe('task-based preferences', () => {
  it('keeps every task available without exposing all controls at once', () => {
    app = mount(SettingsPage, { target: host });
    flushSync();
    const groups = [...host.querySelectorAll<HTMLDetailsElement>('details.group')];
    expect(groups).toHaveLength(10);
    expect(groups.every((group) => !group.open)).toBe(true);
    expect(groups.map((group) => group.querySelector('h2')?.textContent)).toEqual([
      'Rating',
      'Scores',
      'Deeper rating',
      'Queue',
      'Appearance',
      'Spotify',
      'Playback',
      'Listening history',
      'OneDrive sync',
      'Data',
    ]);
    expect(disclosure('Scales by type and equivalence').querySelector('table')).not.toBeNull();
    expect(disclosure('Edit questions by type').querySelectorAll('.facet').length).toBeGreaterThan(
      0,
    );
    expect(disclosure('Completion rules').querySelector('select')).not.toBeNull();
    expect(host.textContent).toContain('Erase everything');
  });

  it('saves the explanation preference through the existing settings infrastructure', async () => {
    app = mount(SettingsPage, { target: host });
    flushSync();
    disclosure('Appearance').open = true;
    const label = [...host.querySelectorAll('label')].find((node) =>
      node.textContent?.includes('Open explanations by default'),
    );
    const checkbox = label?.querySelector<HTMLInputElement>('input');
    expect(checkbox).not.toBeNull();
    checkbox!.checked = true;
    checkbox!.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    await vi.waitFor(async () => expect((await readSettings())?.showExplanations).toBe(true));
    await loadAll();
    flushSync();
    expect(get(settings).showExplanations).toBe(true);
    expect(disclosure('Scales by type and equivalence').open).toBe(true);
  });
});

describe('review disclosure', () => {
  it('keeps history details available while leaving rating-again visible', () => {
    const entity = makeEntity('track', 'history-test');
    world.update((held) => ({
      ...held,
      entities: [entity],
      ratings: [rate(entity, 70, { note: 'Original note', confidence: 'high' })],
    }));
    app = mount(History, { target: host });
    flushSync();
    const details = disclosure('Details');
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('Original note');
    expect(details.textContent).toContain('high confidence');
    expect(details.textContent).toContain('Withdraw');
    expect(details.parentElement?.classList.contains('entry')).toBe(true);
    const rateAgain = [...host.querySelectorAll('button')].find((node) =>
      node.textContent?.includes('Rate again'),
    );
    expect(rateAgain?.closest('details')).toBeNull();
    settings.update((held) => ({ ...held, showExplanations: true }));
    flushSync();
    expect(details.open).toBe(true);
  });

  it('preserves exact insight rules behind an explanation', () => {
    const entity = makeEntity('artist', 'favourite-test');
    world.update((held) => ({
      ...held,
      entities: [entity],
      ratings: [rate(entity, 95)],
    }));
    app = mount(Insights, { target: host });
    flushSync();
    const details = disclosure('Why this appears');
    expect(details.open).toBe(false);
    expect(details.querySelector('p')?.textContent?.length).toBeGreaterThan(10);
  });

  it('keeps listening limits available and offers a useful empty-state action', () => {
    app = mount(Listening, { target: host });
    flushSync();
    expect(disclosure('Data coverage and limits').open).toBe(false);
    expect(disclosure('Data coverage and limits').textContent).toContain('Spotify');
    expect(host.querySelector('a.btn--primary')?.textContent).toContain('Open settings');
  });

  it('labels fictional listening explicitly instead of claiming Spotify confirmed it', () => {
    const entity = makeEntity('track', 'demo-test', {
      provenance: { provider: 'local', via: 'demo-listening', fetchedAt: 0 },
    });
    world.update((held) => ({
      ...held,
      entities: [entity],
      plays: [play(entity, Date.now())],
    }));
    app = mount(Listening, { target: host });
    flushSync();
    expect(host.querySelector('.demo-notice')?.textContent).toContain('not confirmed by Spotify');
    expect(host.querySelector('header')?.textContent).toContain('Includes demo data');
  });

  it('reports a failed health read and lets it be retried', async () => {
    const read = vi
      .spyOn(ingestion, 'readCoverage')
      .mockRejectedValue(new Error('Coverage unavailable'));
    app = mount(Diagnostics, { target: host, props: { online: false } });
    flushSync();
    await vi.waitFor(() =>
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('Coverage unavailable'),
    );
    read.mockResolvedValue(emptyCoverage());
    host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click();
    flushSync();
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).toBeNull());
    expect(host.textContent).not.toContain('[object Object]');
  });
});

describe('comparison keyboard paths', () => {
  function renderPair() {
    app = mount(ComparePanel, {
      target: host,
      props: {
        a: makeEntity('album', 'left'),
        b: makeEntity('album', 'right'),
        reason: 'Similar scores, few comparisons.',
      },
    });
    flushSync();
  }

  it('does not turn Enter on a focused action or disclosure into a tie', () => {
    renderPair();
    for (const target of [host.querySelector('button'), host.querySelector('summary')]) {
      target!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    expect(submitComparison).not.toHaveBeenCalled();
    expect(disclosure('Pair details and shortcuts').textContent).toContain('Similar scores');
  });

  it('retains the equals shortcut for an intentional tie', () => {
    renderPair();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '=' }));
    expect(submitComparison).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'left' }),
      expect.objectContaining({ name: 'right' }),
      'tie',
      'Similar scores, few comparisons.',
    );
  });
});
