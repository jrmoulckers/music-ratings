import { beforeEach, describe, expect, it } from 'vitest';

import {
  ConflictError,
  RemoteMissingError,
  countRecords,
  mergeById,
  mergeSnapshots,
  pickWinner,
  reconcile,
  worldFingerprint,
  type RemoteAdapter,
} from './sync';
import { emptySnapshot, type Snapshot } from './snapshot';
import {
  defaultSettings,
  mergeSettings,
  hydrateSettings,
  portableSettings,
  localSettings,
} from './settings';
import { makeEntity, rate, resetFixtureCounters, T0 } from '../../test/fixtures';

beforeEach(resetFixtureCounters);

function snapshot(patch: Partial<Snapshot> = {}, device = 'A'): Snapshot {
  return { ...emptySnapshot(device), savedAt: T0, ...patch };
}

describe('pickWinner', () => {
  it('prefers the newer edit', () => {
    const older = { id: 'x', updatedAt: 1 };
    const newer = { id: 'x', updatedAt: 2 };
    expect(pickWinner(older, newer)).toBe(newer);
    expect(pickWinner(newer, older)).toBe(newer);
  });

  it('falls back to createdAt when updatedAt is missing', () => {
    const a = { id: 'x', createdAt: 5 };
    const b = { id: 'x', createdAt: 9 };
    expect(pickWinner(a, b)).toBe(b);
  });

  it('breaks exact ties the same way on both devices', () => {
    const a = { id: 'x', updatedAt: 7, note: 'alpha' };
    const b = { id: 'x', updatedAt: 7, note: 'beta' };
    // Whichever wins, both devices must independently agree.
    expect(pickWinner(a, b)).toBe(pickWinner(a, b));
    expect(JSON.stringify(pickWinner(a, b))).toBe(JSON.stringify(pickWinner(b, a)));
  });

  it('is stable for identical records', () => {
    const a = { id: 'x', updatedAt: 7 };
    expect(pickWinner(a, { ...a })).toBe(a);
  });
});

describe('mergeById', () => {
  it('unions records from both sides', () => {
    const { merged, changedLocally, changedRemotely } = mergeById(
      [{ id: 'a', updatedAt: 1 }],
      [{ id: 'b', updatedAt: 1 }],
    );
    expect(merged.map((m) => m.id)).toEqual(['a', 'b']);
    expect(changedLocally).toBe(true);
    expect(changedRemotely).toBe(true);
  });

  it('reports no change when both sides already agree', () => {
    const rows = [{ id: 'a', updatedAt: 1 }];
    const result = mergeById(rows, [{ id: 'a', updatedAt: 1 }]);
    expect(result.changedLocally).toBe(false);
    expect(result.changedRemotely).toBe(false);
  });

  it('sorts deterministically so two devices produce identical files', () => {
    const a = mergeById([{ id: 'c' }, { id: 'a' }], [{ id: 'b' }]);
    const b = mergeById([{ id: 'b' }], [{ id: 'a' }, { id: 'c' }]);
    expect(a.merged.map((m) => m.id)).toEqual(b.merged.map((m) => m.id));
  });

  it('lets a tombstone beat a stale live copy', () => {
    const result = mergeById([{ id: 'a', updatedAt: 1 }], [{ id: 'a', updatedAt: 5, deleted: 5 }]);
    expect(result.merged[0]!.deleted).toBe(5);
    expect(result.changedLocally).toBe(true);
  });

  it('lets a newer edit beat an older tombstone, so an undelete works', () => {
    const result = mergeById([{ id: 'a', updatedAt: 9 }], [{ id: 'a', updatedAt: 5, deleted: 5 }]);
    expect(result.merged[0]!.deleted).toBeUndefined();
    expect(result.changedRemotely).toBe(true);
  });
});

describe('mergeSnapshots', () => {
  it('keeps work done independently on two devices', () => {
    const album = makeEntity('album', 'al');
    const track = makeEntity('track', 't');
    const local = snapshot({ entities: [album], ratings: [rate(album, 80)] }, 'A');
    const remote = snapshot({ entities: [track], ratings: [rate(track, 20)] }, 'B');
    const result = mergeSnapshots(local, remote);
    expect(result.snapshot.entities).toHaveLength(2);
    expect(result.snapshot.ratings).toHaveLength(2);
    expect(result.changedLocally).toBe(true);
    expect(result.changedRemotely).toBe(true);
  });

  it('reports nothing to do when the two copies match', () => {
    const album = makeEntity('album', 'al');
    const copy = () => snapshot({ entities: [album], ratings: [rate(album, 80, { id: 'fixed' })] });
    const result = mergeSnapshots(copy(), copy());
    expect(result.changedLocally).toBe(false);
    expect(result.changedRemotely).toBe(false);
    expect(result.detail).toEqual([]);
  });

  it('explains what came in, per store', () => {
    const album = makeEntity('album', 'al');
    const result = mergeSnapshots(snapshot(), snapshot({ entities: [album] }, 'B'));
    expect(result.detail).toEqual([{ store: 'entities', added: 1, updated: 0 }]);
  });

  it('never lets a device preference travel', () => {
    const local = defaultSettings();
    local.theme = 'dark';
    local.updatedAt = 10;
    const remote = snapshot({ settings: { theme: 'light', updatedAt: 20, dailyGoal: 3 } }, 'B');
    const result = mergeSnapshots(snapshot({}, 'A'), remote, local);
    expect(result.snapshot.settings.theme).toBe('dark');
    expect(result.snapshot.settings.dailyGoal).toBe(3);
  });

  it('produces the same merged file whichever device runs it', () => {
    const album = makeEntity('album', 'al');
    const track = makeEntity('track', 't');
    const a = snapshot({ entities: [album] }, 'A');
    const b = snapshot({ entities: [track] }, 'B');
    expect(worldFingerprint(mergeSnapshots(a, b).snapshot)).toBe(
      worldFingerprint(mergeSnapshots(b, a).snapshot),
    );
  });
});

describe('fingerprints', () => {
  it('changes when a record is edited', () => {
    const album = makeEntity('album', 'al');
    const before = snapshot({ entities: [album] });
    const after = snapshot({ entities: [{ ...album, updatedAt: T0 + 1 }] });
    expect(worldFingerprint(before)).not.toBe(worldFingerprint(after));
  });

  it('ignores record order', () => {
    const a = makeEntity('album', 'a');
    const b = makeEntity('album', 'b');
    expect(worldFingerprint(snapshot({ entities: [a, b] }))).toBe(
      worldFingerprint(snapshot({ entities: [b, a] })),
    );
  });

  it('counts every record across stores', () => {
    const album = makeEntity('album', 'al');
    expect(countRecords(snapshot({ entities: [album], ratings: [rate(album, 50)] }))).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */

class FakeRemote implements RemoteAdapter {
  file: Snapshot | null = null;
  etag: string | null = null;
  writes = 0;
  /** Simulates another device writing between our read and our write. */
  interfereOnce: (() => void) | null = null;

  async read() {
    if (!this.file) throw new RemoteMissingError();
    return { snapshot: this.file, etag: this.etag };
  }

  async write(next: Snapshot, etag: string | null) {
    if (this.interfereOnce) {
      const fn = this.interfereOnce;
      this.interfereOnce = null;
      fn();
    }
    this.writes += 1;
    if (etag === null && this.file) throw new ConflictError('exists');
    if (etag !== null && etag !== this.etag) {
      throw new ConflictError('changed underneath');
    }
    this.file = next;
    this.etag = `etag-${this.writes}`;
    return this.etag;
  }

  async peek() {
    return this.etag;
  }
}

describe('reconcile', () => {
  it('creates the file the first time', async () => {
    const remote = new FakeRemote();
    const album = makeEntity('album', 'al');
    const local = snapshot({ entities: [album] });
    const outcome = await reconcile({
      adapter: remote,
      local: async () => local,
      apply: async () => {},
    });
    expect(outcome.status).toBe('created');
    expect(remote.file?.entities).toHaveLength(1);
  });

  it('does nothing when both sides already agree', async () => {
    const album = makeEntity('album', 'al');
    const shared = snapshot({ entities: [album] });
    const remote = new FakeRemote();
    remote.file = shared;
    remote.etag = 'etag-0';
    const outcome = await reconcile({
      adapter: remote,
      local: async () => shared,
      apply: async () => {
        throw new Error('should not apply');
      },
    });
    expect(outcome.status).toBe('up-to-date');
    expect(remote.writes).toBe(0);
  });

  it('pulls remote-only work without writing back', async () => {
    const album = makeEntity('album', 'al');
    const remote = new FakeRemote();
    remote.file = snapshot({ entities: [album] }, 'B');
    remote.etag = 'etag-0';
    let applied: Snapshot | null = null;
    const outcome = await reconcile({
      adapter: remote,
      local: async () => snapshot({ entities: [album] }, 'A'),
      apply: async (s) => {
        applied = s;
      },
    });
    expect(outcome.status).toBe('up-to-date');
    expect(applied).toBeNull();
    expect(remote.writes).toBe(0);
  });

  it('merges and writes when both sides changed', async () => {
    const mine = makeEntity('album', 'mine');
    const theirs = makeEntity('album', 'theirs');
    const remote = new FakeRemote();
    remote.file = snapshot({ entities: [theirs] }, 'B');
    remote.etag = 'etag-0';
    let applied: Snapshot | null = null;
    const outcome = await reconcile({
      adapter: remote,
      local: async () => snapshot({ entities: [mine] }, 'A'),
      apply: async (s) => {
        applied = s;
      },
    });
    expect(outcome.status).toBe('merged');
    expect(applied).not.toBeNull();
    expect(remote.file?.entities).toHaveLength(2);
  });

  it('retries when another device writes mid-flight, and loses nothing', async () => {
    const mine = makeEntity('album', 'mine');
    const theirs = makeEntity('album', 'theirs');
    const sneaky = makeEntity('album', 'sneaky');
    const remote = new FakeRemote();
    remote.file = snapshot({ entities: [theirs] }, 'B');
    remote.etag = 'etag-0';
    remote.interfereOnce = () => {
      remote.file = snapshot({ entities: [theirs, sneaky] }, 'C');
      remote.etag = 'etag-sneaky';
    };
    const outcome = await reconcile({
      adapter: remote,
      local: async () => snapshot({ entities: [mine] }, 'A'),
      apply: async () => {},
    });
    expect(outcome.attempts).toBe(2);
    expect(remote.file?.entities.map((e) => e.providerId).sort()).toEqual([
      'mine',
      'sneaky',
      'theirs',
    ]);
  });

  it('gives up honestly rather than clobbering, after repeated collisions', async () => {
    const remote = new FakeRemote();
    remote.file = snapshot({}, 'B');
    remote.etag = 'etag-0';
    let n = 0;
    const forever = {
      read: () => remote.read(),
      peek: () => remote.peek(),
      write: async () => {
        n += 1;
        throw new ConflictError('always busy');
      },
    } satisfies RemoteAdapter;
    await expect(
      reconcile({
        adapter: forever,
        local: async () => snapshot({ entities: [makeEntity('album', 'x')] }, 'A'),
        apply: async () => {},
        maxAttempts: 3,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(n).toBe(3);
  });
});

describe('settings classification', () => {
  it('splits every setting into portable or device-local', () => {
    const settings = defaultSettings();
    const keys = new Set([
      ...Object.keys(portableSettings(settings)),
      ...Object.keys(localSettings(settings)),
    ]);
    expect(keys.size).toBe(Object.keys(settings).length);
  });

  it('keeps device settings out of the portable half', () => {
    expect(portableSettings(defaultSettings())).not.toHaveProperty('theme');
    expect(localSettings(defaultSettings())).not.toHaveProperty('rollup');
  });

  it('takes newer portable settings but never device ones', () => {
    const local = { ...defaultSettings(), theme: 'dark' as const, updatedAt: 1, dailyGoal: 5 };
    const merged = mergeSettings(local, { updatedAt: 2, dailyGoal: 9, theme: 'light' });
    expect(merged.dailyGoal).toBe(9);
    expect(merged.theme).toBe('dark');
  });

  it('ignores an older remote copy entirely', () => {
    const local = { ...defaultSettings(), updatedAt: 10, dailyGoal: 5 };
    expect(mergeSettings(local, { updatedAt: 2, dailyGoal: 9 }).dailyGoal).toBe(5);
  });

  it('repairs an empty type list rather than leaving the app unusable', () => {
    expect(hydrateSettings({ enabledTypes: [] }).enabledTypes.length).toBeGreaterThan(0);
  });
});
