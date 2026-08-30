import { SYNCED_STORES, type SyncedStore } from './db';
import { mergeSettings, type AppSettings } from './settings';
import { SNAPSHOT_KIND, SNAPSHOT_VERSION, emptySnapshot, type Snapshot } from './snapshot';

/**
 * Merge, not "last writer wins on the whole file".
 *
 * Two devices editing different albums must both keep their work. So the unit
 * of conflict is a single record, and the whole file is only ever a container.
 */

export class ConflictError extends Error {
  constructor(
    message: string,
    readonly remote?: Snapshot,
  ) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class InteractionRequiredError extends Error {
  constructor(message = 'Sign in again to continue syncing.') {
    super(message);
    this.name = 'InteractionRequiredError';
  }
}

export class RemoteMissingError extends Error {
  constructor(message = 'No backup file exists yet.') {
    super(message);
    this.name = 'RemoteMissingError';
  }
}

export interface SyncRecord {
  id: string;
  updatedAt?: number;
  createdAt?: number;
  deleted?: number;
}

/**
 * Pick between two versions of the same record.
 *
 * The tie-break matters more than it looks: two devices that made the same edit
 * at the same millisecond must reach the *same* answer independently, or they
 * will keep overwriting each other. Comparing the serialised forms is arbitrary
 * but it is stable and identical everywhere.
 */
export function pickWinner<T extends SyncRecord>(a: T, b: T): T {
  const at = a.updatedAt ?? a.createdAt ?? 0;
  const bt = b.updatedAt ?? b.createdAt ?? 0;
  if (at !== bt) return at > bt ? a : b;
  const as = JSON.stringify(a);
  const bs = JSON.stringify(b);
  if (as === bs) return a;
  return as > bs ? a : b;
}

export function mergeById<T extends SyncRecord>(
  local: readonly T[],
  remote: readonly T[],
): { merged: T[]; changedLocally: boolean; changedRemotely: boolean } {
  const byId = new Map<string, T>();
  for (const item of local) byId.set(item.id, item);

  let changedLocally = false;
  let changedRemotely = false;

  for (const item of remote) {
    const mine = byId.get(item.id);
    if (!mine) {
      byId.set(item.id, item);
      changedLocally = true;
      continue;
    }
    const winner = pickWinner(mine, item);
    if (winner !== mine) {
      byId.set(item.id, winner);
      changedLocally = true;
    } else if (JSON.stringify(mine) !== JSON.stringify(item)) {
      changedRemotely = true;
    }
  }

  const remoteIds = new Set(remote.map((r) => r.id));
  for (const item of local) {
    if (!remoteIds.has(item.id)) changedRemotely = true;
  }

  const merged = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { merged, changedLocally, changedRemotely };
}

export interface MergeResult {
  snapshot: Snapshot;
  /** The local database needs updating from the merge. */
  changedLocally: boolean;
  /** The remote file needs updating from the merge. */
  changedRemotely: boolean;
  /** Per-store counts, for an honest "what just happened" message. */
  detail: { store: SyncedStore; added: number; updated: number }[];
}

export function mergeSnapshots(
  local: Snapshot,
  remote: Snapshot,
  localSettings?: AppSettings,
): MergeResult {
  const merged = emptySnapshot(local.deviceId);
  merged.savedAt = Date.now();
  merged.kind = SNAPSHOT_KIND;
  merged.version = SNAPSHOT_VERSION;

  let changedLocally = false;
  let changedRemotely = false;
  const detail: MergeResult['detail'] = [];

  for (const store of SYNCED_STORES) {
    const localRows = rows(local, store);
    const remoteRows = rows(remote, store);
    const result = mergeById(localRows, remoteRows);
    (merged as unknown as Record<string, unknown[]>)[store] = result.merged;
    changedLocally ||= result.changedLocally;
    changedRemotely ||= result.changedRemotely;

    const localIds = new Set(localRows.map((r) => r.id));
    const added = result.merged.filter((r) => !localIds.has(r.id)).length;
    const updated = result.merged.filter((r) => {
      if (!localIds.has(r.id)) return false;
      const mine = localRows.find((l) => l.id === r.id);
      return mine ? JSON.stringify(mine) !== JSON.stringify(r) : false;
    }).length;
    if (added || updated) detail.push({ store, added, updated });
  }

  if (localSettings) {
    const settings = mergeSettings(localSettings, remote.settings);
    merged.settings = settings;
    if (JSON.stringify(settings) !== JSON.stringify(localSettings)) changedLocally = true;
    if (JSON.stringify(settings) !== JSON.stringify(remote.settings)) changedRemotely = true;
  } else {
    merged.settings = { ...remote.settings, ...local.settings };
  }

  return { snapshot: merged, changedLocally, changedRemotely, detail };
}

function rows(snapshot: Snapshot, store: SyncedStore): SyncRecord[] {
  const value = (snapshot as unknown as Record<string, unknown>)[store];
  return Array.isArray(value) ? (value as SyncRecord[]) : [];
}

/**
 * A cheap equality check for "did anything actually change?" that does not
 * require holding two whole snapshots in memory to compare.
 */
export function worldFingerprint(snapshot: Snapshot): string {
  const parts: string[] = [];
  for (const store of SYNCED_STORES) {
    const ids = rows(snapshot, store)
      .map((r) => `${r.id}:${r.updatedAt ?? 0}`)
      .sort();
    parts.push(`${store}=${ids.join(',')}`);
  }
  return parts.join('|');
}

export function countRecords(snapshot: Snapshot): number {
  let total = 0;
  for (const store of SYNCED_STORES) total += rows(snapshot, store).length;
  return total;
}

/* -------------------------------------------------------------------------- */
/* The reconcile loop                                                         */
/* -------------------------------------------------------------------------- */

export interface RemoteFile {
  snapshot: Snapshot;
  etag: string | null;
}

export interface RemoteAdapter {
  read(): Promise<RemoteFile | null>;
  /** `etag` null means "create only, fail if it already exists". */
  write(snapshot: Snapshot, etag: string | null): Promise<string | null>;
  /** Cheap poll: just the version tag, no body. */
  peek(): Promise<string | null>;
}

export interface ReconcileOptions {
  adapter: RemoteAdapter;
  local: () => Promise<Snapshot>;
  apply: (snapshot: Snapshot) => Promise<void>;
  settings?: AppSettings;
  maxAttempts?: number;
}

export interface ReconcileOutcome {
  status: 'up-to-date' | 'pushed' | 'pulled' | 'merged' | 'created';
  etag: string | null;
  detail: MergeResult['detail'];
  attempts: number;
}

/**
 * Read, merge, write, and retry if someone else wrote in between.
 *
 * The retry is the whole point of the ETag: a 412 means the file moved under
 * us, so we re-read and merge again rather than clobbering the other device.
 */
export async function reconcile(options: ReconcileOptions): Promise<ReconcileOutcome> {
  const maxAttempts = options.maxAttempts ?? 4;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const local = await options.local();
    let remote: RemoteFile | null;
    try {
      remote = await options.adapter.read();
    } catch (error) {
      if (error instanceof RemoteMissingError) remote = null;
      else throw error;
    }

    if (!remote) {
      const etag = await options.adapter.write(local, null);
      return { status: 'created', etag, detail: [], attempts: attempt };
    }

    const result = mergeSnapshots(local, remote.snapshot, options.settings);
    if (!result.changedLocally && !result.changedRemotely) {
      return { status: 'up-to-date', etag: remote.etag, detail: [], attempts: attempt };
    }

    if (result.changedLocally) await options.apply(result.snapshot);

    if (!result.changedRemotely) {
      return { status: 'pulled', etag: remote.etag, detail: result.detail, attempts: attempt };
    }

    try {
      const etag = await options.adapter.write(result.snapshot, remote.etag);
      return {
        status: result.changedLocally ? 'merged' : 'pushed',
        etag,
        detail: result.detail,
        attempts: attempt,
      };
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      lastError = error;
      // Someone wrote while we were merging. Go round again with their copy.
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ConflictError('Could not settle the backup after several attempts.');
}
