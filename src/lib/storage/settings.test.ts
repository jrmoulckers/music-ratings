import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, META_SETTINGS, readSettings, writeMeta } from './db';
import {
  defaultSettings,
  hydrateSettings,
  localSettings,
  mergeSettings,
  portableSettings,
} from './settings';
import {
  buildSnapshot,
  emptySnapshot,
  parseSnapshot,
  restoreSnapshot,
  serializeSnapshot,
} from './snapshot';

afterEach(async () => {
  await closeDatabase();
});

describe('explanation preference', () => {
  it('defaults to concise for new and older settings without changing score defaults', () => {
    const fresh = defaultSettings();
    const old = hydrateSettings({ schemaVersion: 1, defaultScaleId: 'int-10' });
    expect(fresh.showExplanations).toBe(false);
    expect(old.showExplanations).toBe(false);
    expect(old.defaultScaleId).toBe('int-10');
    expect(old.rollup).toEqual(fresh.rollup);
    expect(old.contextEnabled).toBe(false);
  });

  it('accepts only an explicit boolean opt-in', () => {
    expect(hydrateSettings({ showExplanations: true }).showExplanations).toBe(true);
    // @ts-expect-error Simulate an invalid value read from older browser storage.
    expect(hydrateSettings({ showExplanations: 'true' }).showExplanations).toBe(false);
    // @ts-expect-error Simulate an invalid value in a restored settings record.
    expect(hydrateSettings({ showExplanations: null }).showExplanations).toBe(false);
  });

  it('classifies explanations as local, not portable', () => {
    const settings = { ...defaultSettings(), showExplanations: true };
    expect(localSettings(settings).showExplanations).toBe(true);
    expect(portableSettings(settings)).not.toHaveProperty('showExplanations');
  });

  it('keeps this device’s choice when newer remote settings arrive', () => {
    const local = { ...defaultSettings(), showExplanations: true, updatedAt: 1 };
    const merged = mergeSettings(local, {
      showExplanations: false,
      defaultScaleId: 'tiers',
      updatedAt: 2,
    });
    expect(merged.showExplanations).toBe(true);
    expect(merged.defaultScaleId).toBe('tiers');
  });

  it('persists across a database reopen and stays out of exported snapshots', async () => {
    await writeMeta(META_SETTINGS, { ...defaultSettings(), showExplanations: true });
    await closeDatabase();
    expect(hydrateSettings(await readSettings()).showExplanations).toBe(true);
    const exported = parseSnapshot(serializeSnapshot(await buildSnapshot()));
    expect(exported.settings).not.toHaveProperty('showExplanations');
  });

  it('retains the local preference when restoring a snapshot predating it', async () => {
    await writeMeta(META_SETTINGS, { ...defaultSettings(), showExplanations: true });
    const snapshot = emptySnapshot();
    snapshot.settings = { defaultScaleId: 'int-5', updatedAt: 10 };
    await restoreSnapshot(parseSnapshot(serializeSnapshot(snapshot)));
    const restored = hydrateSettings(await readSettings());
    expect(restored.showExplanations).toBe(true);
    expect(restored.defaultScaleId).toBe('int-5');
    expect(restored.rollup).toEqual(defaultSettings().rollup);
  });
});
