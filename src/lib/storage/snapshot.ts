import { markDataChanged } from './changes';
import { SYNCED_STORES, db, raw, readMeta, writeMeta, META_SETTINGS, type SyncedStore } from './db';
import { hydrateSettings, portableSettings, type AppSettings } from './settings';
import type {
  CanonicalGroup,
  Collection,
  Comparison,
  Entity,
  EntityAnnotation,
  Membership,
  QueueState,
  RatingEvent,
  RatingScale,
} from '../domain/types';
import type { AlbumCompletion, PlayEvent } from '../domain/listening';

export const SNAPSHOT_KIND = 'music-ratings/snapshot';
/** What the kind field said before the app was renamed; still restorable. */
const LEGACY_SNAPSHOT_KIND = 'music-ratings/ledger';
/**
 * 2 added `canonicalGroups`; 3 unifies canonical groups with listening records.
 *
 * The bump is deliberate rather than incidental. The store list is read from
 * the running app, so a device still on format 1 would merge a file it did not
 * understand by writing back a copy with every combined group missing — a
 * silent deletion. Refusing the file outright, which is what the version guard
 * does, is the honest failure: that device says the backup is newer than it is
 * and stops, instead of quietly undoing work.
 */
export const SNAPSHOT_VERSION = 3;

/**
 * The file that travels: to OneDrive, to a download, to another browser.
 *
 * It is deliberately plain JSON with no compression and no minification. If
 * this project disappears tomorrow the user should still be able to open the
 * file and read their own ratings.
 */
export interface Snapshot {
  kind: typeof SNAPSHOT_KIND;
  version: number;
  savedAt: number;
  /** Random per-install id, so a device can tell its own writes apart. */
  deviceId: string;
  settings: Partial<AppSettings>;
  entities: Entity[];
  memberships: Membership[];
  ratings: RatingEvent[];
  comparisons: Comparison[];
  queueStates: QueueState[];
  annotations: EntityAnnotation[];
  collections: Collection[];
  scales: RatingScale[];
  plays: PlayEvent[];
  completions: AlbumCompletion[];
  canonicalGroups: CanonicalGroup[];
}

export const SNAPSHOT_COLLECTIONS = SYNCED_STORES;

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DEVICE_KEY = 'deviceId';

export async function deviceId(): Promise<string> {
  const existing = await readMeta<string>(DEVICE_KEY);
  if (existing) return existing;
  const created =
    globalThis.crypto?.randomUUID?.() ?? `dev-${Math.random().toString(36).slice(2, 12)}`;
  await writeMeta(DEVICE_KEY, created);
  return created;
}

export function emptySnapshot(device = 'unknown'): Snapshot {
  return {
    kind: SNAPSHOT_KIND,
    version: SNAPSHOT_VERSION,
    savedAt: 0,
    deviceId: device,
    settings: {},
    entities: [],
    memberships: [],
    ratings: [],
    comparisons: [],
    queueStates: [],
    annotations: [],
    collections: [],
    scales: [],
    plays: [],
    completions: [],
    canonicalGroups: [],
  };
}

/** Includes tombstones on purpose: a deletion must be able to travel. */
export async function buildSnapshot(settings?: AppSettings): Promise<Snapshot> {
  const database = await db();
  const device = await deviceId();
  const snapshot = emptySnapshot(device);
  snapshot.savedAt = Date.now();
  await Promise.all(
    SYNCED_STORES.map(async (store) => {
      const rows = await database.getAll(store);
      (snapshot as unknown as Record<string, unknown[]>)[store] = rows;
    }),
  );
  const stored = settings ?? hydrateSettings(await readMeta<Partial<AppSettings>>(META_SETTINGS));
  snapshot.settings = portableSettings(stored);
  return snapshot;
}

/**
 * Replace local data wholesale. Used by import and by the "take the cloud copy"
 * side of conflict resolution.
 *
 * `markChanged` defaults to false: a restore that came from the cloud must not
 * look like a local edit, or the two devices will push at each other forever.
 */
export async function restoreSnapshot(
  snapshot: Snapshot,
  options: { markChanged?: boolean; keepLocalSettings?: boolean } = {},
): Promise<void> {
  const parsed = validateSnapshot(snapshot);
  const database = await db();
  const tx = database.transaction([...SYNCED_STORES], 'readwrite');
  const writes: Promise<unknown>[] = [];
  for (const store of SYNCED_STORES) {
    const objectStore = tx.objectStore(store);
    writes.push(objectStore.clear());
    for (const row of rowsFor(parsed, store)) {
      writes.push(objectStore.put(raw(row) as never));
    }
  }
  await Promise.all([...writes, tx.done]);

  if (!options.keepLocalSettings && parsed.settings) {
    const current = hydrateSettings(await readMeta<Partial<AppSettings>>(META_SETTINGS));
    await writeMeta(META_SETTINGS, hydrateSettings({ ...current, ...parsed.settings }));
  }
  if (options.markChanged) markDataChanged();
}

function rowsFor(snapshot: Snapshot, store: SyncedStore): unknown[] {
  const value = (snapshot as unknown as Record<string, unknown>)[store];
  return Array.isArray(value) ? value : [];
}

/** Parse a file the user chose. Refuses anything that is not clearly ours. */
export function parseSnapshot(text: string): Snapshot {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SnapshotError('That file is not valid JSON.');
  }
  return validateSnapshot(data);
}

export function validateSnapshot(data: unknown): Snapshot {
  if (!data || typeof data !== 'object') {
    throw new SnapshotError('That file does not contain a backup.');
  }
  const candidate = data as Partial<Snapshot>;
  if (candidate.kind !== SNAPSHOT_KIND && String(candidate.kind) !== LEGACY_SNAPSHOT_KIND) {
    throw new SnapshotError(
      'That backup was written by a different app. Only files saved by this one can be restored.',
    );
  }
  if (typeof candidate.version !== 'number' || candidate.version > SNAPSHOT_VERSION) {
    throw new SnapshotError(
      `That backup was written by a newer version (format ${String(candidate.version)}). Update the app first.`,
    );
  }
  const snapshot = { ...emptySnapshot(candidate.deviceId ?? 'unknown'), ...candidate } as Snapshot;
  for (const store of SYNCED_STORES) {
    const rows = rowsFor(snapshot, store);
    (snapshot as unknown as Record<string, unknown[]>)[store] = rows.filter(
      (row) => !!row && typeof row === 'object' && typeof (row as { id?: unknown }).id === 'string',
    );
  }
  return migrateSnapshot(snapshot);
}

/**
 * Older backups are read, not rejected. Each step is additive and idempotent so
 * a file can pass through every migration in order.
 */
export function migrateSnapshot(snapshot: Snapshot): Snapshot {
  const out = { ...snapshot };
  if (out.version < 1) {
    out.scales = out.scales ?? [];
    out.version = 1;
  }
  if (out.version < 2) {
    // A file written before combining existed simply has no groups in it.
    out.canonicalGroups = out.canonicalGroups ?? [];
    out.version = 2;
  }
  if (out.version < 3) {
    out.plays = out.plays ?? [];
    out.completions = out.completions ?? [];
    out.canonicalGroups = out.canonicalGroups ?? [];
    out.version = 3;
  }
  out.version = SNAPSHOT_VERSION;
  return out;
}

export function snapshotFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `music-ratings-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

export function serializeSnapshot(snapshot: Snapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

export function snapshotCounts(snapshot: Snapshot): { label: string; count: number }[] {
  const label: Record<SyncedStore, string> = {
    entities: 'catalogue items',
    memberships: 'containment links',
    ratings: 'rating events',
    comparisons: 'comparisons',
    queueStates: 'queue states',
    annotations: 'notes and tags',
    collections: 'lists',
    scales: 'custom scales',
    plays: 'confirmed plays',
    completions: 'albums completed',
    canonicalGroups: 'combined items',
  };
  return SYNCED_STORES.map((store) => ({
    label: label[store],
    count: rowsFor(snapshot, store).filter((r) => !(r as { deleted?: number }).deleted).length,
  }));
}
