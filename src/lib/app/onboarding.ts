import { ENTITY_TYPES } from '../domain/types';
import type { EntityType } from '../domain/types';

/**
 * The setup flow's memory, for the one moment it has to leave the app.
 *
 * Connecting Spotify is a full-page redirect to another origin and back, which
 * destroys every component that was mid-question. Without somewhere to put the
 * answers, the only way to survive the trip is to commit them early — and
 * committing `onboarded` early is exactly the bug this exists to prevent.
 *
 * sessionStorage, not IndexedDB: this is scaffolding for one tab's trip through
 * one flow. It is never synced, never exported, and never outlives the tab.
 */

const KEY = 'music-ratings:onboarding';
const VERSION = 1;

/** The last page index. Setup is Source, What you rate, Rating scale. */
export const LAST_STEP = 2;

export interface OnboardingDraft {
  /** The page to resume on, already clamped. */
  step: number;
  types: EntityType[];
  scaleId: string;
  clientId: string;
  /** An OAuth round trip started from setup is still in the air. */
  connecting: boolean;
  /** Spotify came back successfully during this run of setup. */
  spotifyConnected: boolean;
}

export function clampStep(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.min(LAST_STEP, Math.max(0, Math.trunc(n)));
}

function isEntityType(value: unknown): value is EntityType {
  return typeof value === 'string' && (ENTITY_TYPES as readonly string[]).includes(value);
}

/**
 * Read the draft back, trusting none of it.
 *
 * Anything unreadable, of the wrong version, or of the wrong shape is treated
 * as absent rather than repaired — a half-understood draft that resumes setup
 * in a state the user never chose is worse than starting the page again.
 */
export function readOnboardingDraft(): OnboardingDraft | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearOnboardingDraft();
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    clearOnboardingDraft();
    return null;
  }

  const draft = parsed as Record<string, unknown>;
  if (draft.v !== VERSION) {
    clearOnboardingDraft();
    return null;
  }

  const types = Array.isArray(draft.types) ? draft.types.filter(isEntityType) : [];
  return {
    step: clampStep(draft.step),
    types,
    scaleId: typeof draft.scaleId === 'string' ? draft.scaleId : '',
    clientId: typeof draft.clientId === 'string' ? draft.clientId : '',
    connecting: draft.connecting === true,
    spotifyConnected: draft.spotifyConnected === true,
  };
}

export function saveOnboardingDraft(draft: OnboardingDraft): void {
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        v: VERSION,
        step: clampStep(draft.step),
        types: draft.types.filter(isEntityType),
        scaleId: draft.scaleId,
        clientId: draft.clientId,
        connecting: draft.connecting,
        spotifyConnected: draft.spotifyConnected,
      }),
    );
  } catch {
    // A private window with no storage quota still gets to finish setup; it
    // just cannot survive the Spotify round trip, which it will say instead.
  }
}

/** Merge a change into whatever is stored, without needing to read it first. */
export function patchOnboardingDraft(patch: Partial<OnboardingDraft>): void {
  const current = readOnboardingDraft() ?? {
    step: 0,
    types: [],
    scaleId: '',
    clientId: '',
    connecting: false,
    spotifyConnected: false,
  };
  saveOnboardingDraft({ ...current, ...patch });
}

export function clearOnboardingDraft(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear if it could never be written.
  }
}

/** Where setup should pick up, for anything that has to send someone back. */
export function onboardingResumePath(step?: number): string {
  const at = clampStep(step ?? readOnboardingDraft()?.step ?? 0);
  return `/start?step=${at}`;
}

/**
 * True when this OAuth trip was started by setup.
 *
 * Decided by the continuation the trip was started with, not by the current
 * value of `onboarded` — that flag is what the flow is trying to establish, so
 * reading it here to decide where to go is circular.
 */
export function isOnboardingReturn(returnTo: string): boolean {
  // The continuation this particular trip was started with wins; the draft is
  // only consulted when that value is gone (a failed exchange consumes it).
  if (returnTo) return returnTo.startsWith('/start');
  return readOnboardingDraft()?.connecting === true;
}
