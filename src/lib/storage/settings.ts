import { DEFAULT_SCALE_ID } from '../domain/scales';
import { DEFAULT_SUGGESTION_WEIGHTS } from '../domain/suggestions';
import { defaultRollupConfigByType } from '../domain/rollup';
import { DEFAULT_CONTEXT_CONTRIBUTION, clampContribution, defaultFacets } from '../domain/context';
import {
  DEFAULT_COMPLETION_WINDOW_DAYS,
  DEFAULT_RECOMPLETION,
  DEFAULT_RECOMPLETION_COOLDOWN_DAYS,
  type RecompletionMode,
} from '../domain/completion';
import type {
  EntityType,
  FacetConfig,
  RollupConfigByType,
  ScoreView,
  SuggestionWeights,
} from '../domain/types';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type MotionChoice = 'system' | 'reduce' | 'full';
export type DensityChoice = 'cozy' | 'compact';
export type ArtworkChoice = 'full' | 'thumbnails' | 'none';
export type PollingChoice = 'responsive' | 'relaxed' | 'manual';
export type ListeningBasis = 'plays' | 'minutes';
export type OneDriveFolderMode = 'app' | 'custom';

export interface AppSettings {
  /* ---- portable: the user's judgement, synced everywhere ---- */
  schemaVersion: number;
  enabledTypes: EntityType[];
  scaleByType: Partial<Record<EntityType, string>>;
  defaultScaleId: string;
  rollup: RollupConfigByType;
  suggestionWeights: SuggestionWeights;
  /** How often the queue offers a head-to-head instead of a direct rating, 0..1. */
  comparisonFrequency: number;
  staleAfterDays: number;
  scoreView: ScoreView;
  /** Weight of the explicit rating in the blended view, 0..1. */
  blendExplicitWeight: number;
  /**
   * Whether contextual facets are allowed to move a score. Off by default:
   * turning this feature on must never change a number nobody asked it to.
   * Facets can be recorded either way.
   */
  contextEnabled: boolean;
  /** Share of the result the context score carries, 0..0.5. */
  contextContribution: number;
  /** Per-type override of the contribution. */
  contextByType: Partial<Record<EntityType, number>>;
  /** The facet questions, built-in and user-made. */
  facets: FacetConfig[];
  showExplicitContent: boolean;
  goalsEnabled: boolean;
  dailyGoal: number;
  /**
   * Record what Spotify confirms you played. Off until it is asked for: a
   * listening log is a diary, and one is not started on someone's behalf.
   */
  listeningEnabled: boolean;
  /**
   * Epoch ms the log started. Everything the Listening surface says is qualified
   * by this date, because there is no honest way to talk about what happened
   * before the app was looking. Merged as the *earliest* of the two, so syncing
   * a newer device never shortens the observed record.
   */
  listeningObservedFrom: number;
  /** Days a record's tracks must all be heard within to count as one listen. */
  completionWindowDays: number;
  /** When a record may be recorded as completed again. */
  recompletionMode: RecompletionMode;
  /** Days between completions when `recompletionMode` is `cooldown`. */
  recompletionCooldownDays: number;
  /** Offer to rate a record once it has been heard all the way through. */
  completionPrompts: boolean;
  /** Whether the Listening surface ranks by plays or by estimated minutes. */
  listeningBasis: ListeningBasis;
  /** Discard plays older than this. 0 keeps everything. */
  listeningRetentionDays: number;
  updatedAt: number;

  /* ---- device-local: never leaves this browser ---- */
  theme: ThemeChoice;
  motion: MotionChoice;
  density: DensityChoice;
  artwork: ArtworkChoice;
  highContrast: boolean;
  syncEnabled: boolean;
  syncFileName: string;
  /**
   * Where in OneDrive the backup lives. `app` is a sandboxed folder only this
   * app can see; `custom` is a folder of your choosing, which costs a broader
   * permission because Graph cannot scope a delegated grant to one folder.
   */
  onedriveFolderMode: OneDriveFolderMode;
  /** Slash-separated folder path from the drive root, used only in `custom` mode. */
  onedriveCustomPath: string;
  onboarded: boolean;
  /**
   * Ask as your own registered application instead of this build's.
   *
   * Empty is the ordinary case, not a missing setting: it means "use the ID this
   * build ships with". See `src/lib/config.ts`.
   */
  spotifyClientId: string;
  spotifyRedirectUri: string;
  /** Same bring-your-own arrangement as `spotifyClientId`, for Microsoft. */
  onedriveClientId: string;
  /**
   * Turn this browser into a Spotify device. Off by default: it needs the
   * `streaming` permission and Spotify Premium, and most people already have a
   * speaker or phone they would rather control.
   */
  browserPlayer: boolean;
  /** The device to reach for first. A Spotify device id, meaningless elsewhere. */
  preferredDeviceId: string;
  /** How hard to chase Spotify for the current state. */
  playbackPolling: PollingChoice;
  /** Open album listening automatically when Spotify starts playing a release. */
  autoAlbumMode: boolean;
}

/**
 * Split so sync never carries a device preference across machines. The
 * exhaustiveness guard below fails the build if a new setting is added without
 * deciding which side of the line it belongs on.
 */
export const PORTABLE_SETTINGS = [
  'schemaVersion',
  'enabledTypes',
  'scaleByType',
  'defaultScaleId',
  'rollup',
  'suggestionWeights',
  'comparisonFrequency',
  'staleAfterDays',
  'scoreView',
  'blendExplicitWeight',
  'contextEnabled',
  'contextContribution',
  'contextByType',
  'facets',
  'showExplicitContent',
  'goalsEnabled',
  'dailyGoal',
  'listeningEnabled',
  'listeningObservedFrom',
  'completionWindowDays',
  'recompletionMode',
  'recompletionCooldownDays',
  'completionPrompts',
  'listeningBasis',
  'listeningRetentionDays',
  'updatedAt',
] as const;

export const LOCAL_SETTINGS = [
  'theme',
  'motion',
  'density',
  'artwork',
  'highContrast',
  'syncEnabled',
  'syncFileName',
  'onedriveFolderMode',
  'onedriveCustomPath',
  'onboarded',
  'spotifyClientId',
  'spotifyRedirectUri',
  'onedriveClientId',
  'browserPlayer',
  'preferredDeviceId',
  'playbackPolling',
  'autoAlbumMode',
] as const;

type Portable = (typeof PORTABLE_SETTINGS)[number];
type Local = (typeof LOCAL_SETTINGS)[number];
type Unclassified = Exclude<keyof AppSettings, Portable | Local>;
type AssertNever<T extends never> = T;
// If this line errors, a setting was added without classifying it.
export type _SettingsAreClassified = AssertNever<Unclassified>;

export const SETTINGS_SCHEMA_VERSION = 1;

export const DEFAULT_ENABLED_TYPES: EntityType[] = ['artist', 'album', 'track', 'playlist'];

export function defaultSettings(): AppSettings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    enabledTypes: [...DEFAULT_ENABLED_TYPES],
    scaleByType: {},
    defaultScaleId: DEFAULT_SCALE_ID,
    rollup: defaultRollupConfigByType(),
    suggestionWeights: { ...DEFAULT_SUGGESTION_WEIGHTS },
    comparisonFrequency: 0.25,
    staleAfterDays: 365,
    scoreView: 'blended',
    blendExplicitWeight: 0.6,
    contextEnabled: false,
    contextContribution: DEFAULT_CONTEXT_CONTRIBUTION,
    contextByType: {},
    facets: defaultFacets(),
    showExplicitContent: true,
    goalsEnabled: false,
    dailyGoal: 10,
    listeningEnabled: false,
    listeningObservedFrom: 0,
    completionWindowDays: DEFAULT_COMPLETION_WINDOW_DAYS,
    recompletionMode: DEFAULT_RECOMPLETION,
    recompletionCooldownDays: DEFAULT_RECOMPLETION_COOLDOWN_DAYS,
    completionPrompts: true,
    listeningBasis: 'plays',
    listeningRetentionDays: 0,
    updatedAt: 0,

    theme: 'system',
    motion: 'system',
    density: 'cozy',
    artwork: 'full',
    highContrast: false,
    syncEnabled: false,
    syncFileName: 'music-ratings.json',
    onedriveFolderMode: 'app',
    onedriveCustomPath: '',
    onboarded: false,
    // Empty means "ask as this build". A value here is the user's own
    // registration, and always wins — see `src/lib/config.ts`.
    spotifyClientId: '',
    spotifyRedirectUri:
      (import.meta.env?.VITE_SPOTIFY_REDIRECT_URI as string | undefined) ??
      (typeof location === 'undefined' ? '' : `${location.origin}${base()}callback`),
    onedriveClientId: '',
    browserPlayer: false,
    preferredDeviceId: '',
    playbackPolling: 'responsive',
    autoAlbumMode: false,
  };
}

function base(): string {
  const value = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  return value.endsWith('/') ? value : `${value}/`;
}

/** Merge stored settings over the defaults, dropping anything unrecognised. */
export function hydrateSettings(stored: Partial<AppSettings> | undefined): AppSettings {
  const base_ = defaultSettings();
  if (!stored) return base_;
  const merged: AppSettings = { ...base_, ...stored };
  merged.rollup = { ...base_.rollup, ...(stored.rollup ?? {}) };
  merged.suggestionWeights = { ...base_.suggestionWeights, ...(stored.suggestionWeights ?? {}) };
  merged.enabledTypes = (stored.enabledTypes ?? base_.enabledTypes).filter(Boolean);
  if (merged.enabledTypes.length === 0) merged.enabledTypes = [...DEFAULT_ENABLED_TYPES];
  merged.contextEnabled = stored.contextEnabled === true;
  merged.contextContribution = clampContribution(
    stored.contextContribution ?? base_.contextContribution,
  );
  merged.contextByType = clampByType(stored.contextByType);
  merged.facets = hydrateFacets(stored.facets);
  merged.listeningEnabled = stored.listeningEnabled === true;
  merged.completionWindowDays = clampInt(
    stored.completionWindowDays,
    base_.completionWindowDays,
    1,
    365,
  );
  merged.recompletionCooldownDays = clampInt(
    stored.recompletionCooldownDays,
    base_.recompletionCooldownDays,
    1,
    3650,
  );
  merged.listeningRetentionDays = clampInt(stored.listeningRetentionDays, 0, 0, 3650);
  merged.listeningObservedFrom =
    typeof stored.listeningObservedFrom === 'number' && stored.listeningObservedFrom > 0
      ? stored.listeningObservedFrom
      : 0;
  merged.onedriveFolderMode = stored.onedriveFolderMode === 'custom' ? 'custom' : 'app';
  merged.onedriveCustomPath = normalizeFolderPath(stored.onedriveCustomPath);
  merged.schemaVersion = SETTINGS_SCHEMA_VERSION;
  return merged;
}

/**
 * Reduce whatever was typed to a plain sequence of folder names.
 *
 * Blank and `.` segments are dropped so stray slashes are harmless, and `..` is
 * dropped rather than honoured: a backup path is a destination, never a way to
 * climb somewhere the user did not name. An empty result means the drive root,
 * which is a legitimate choice.
 */
export function normalizeFolderPath(value: unknown): string {
  if (typeof value !== 'string') return '';
  return (
    value
      .split(/[\\/]+/)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
      // The characters OneDrive refuses in an item name, plus control codes.
      // Control codes are filtered by code point rather than matched by a regular
      // expression, which cannot express them without embedding them literally.
      .map((segment) =>
        Array.from(segment.replace(/[:*?"<>|]/g, '-'))
          .filter((character) => (character.codePointAt(0) ?? 0) > 0x1f)
          .join(''),
      )
      .filter((segment) => segment.length > 0)
      .join('/')
  );
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampByType(
  stored: Partial<Record<EntityType, number>> | undefined,
): Partial<Record<EntityType, number>> {
  const out: Partial<Record<EntityType, number>> = {};
  for (const [type, value] of Object.entries(stored ?? {})) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    out[type as EntityType] = clampContribution(value);
  }
  return out;
}

/**
 * Keep the user's facet edits, and adopt any built-in they have never seen.
 *
 * A facet the user renamed, reweighted or switched off stays exactly as they
 * left it. A built-in added in a later release simply appears, because a
 * question that never shows up is worse than one you can turn off.
 */
function hydrateFacets(stored: FacetConfig[] | undefined): FacetConfig[] {
  if (!Array.isArray(stored)) return defaultFacets();
  const clean = stored.filter(
    (f): f is FacetConfig =>
      !!f &&
      typeof f.id === 'string' &&
      !!f.id &&
      typeof f.label === 'string' &&
      f.label.length > 0,
  );
  if (clean.length === 0) return defaultFacets();
  const seen = new Set(clean.map((f) => f.id));
  const out = clean.map((f, i) => ({
    ...f,
    description: typeof f.description === 'string' ? f.description : '',
    types: Array.isArray(f.types) ? [...f.types] : [],
    weight: Number.isFinite(f.weight) ? Math.max(0, f.weight) : 1,
    enabled: f.enabled !== false,
    builtin: f.builtin === true,
    order: Number.isFinite(f.order) ? f.order : i,
  }));
  for (const builtin of defaultFacets()) {
    if (!seen.has(builtin.id)) out.push({ ...builtin, order: out.length });
  }
  return out;
}

export function portableSettings(settings: AppSettings): Pick<AppSettings, Portable> {
  const out = {} as Pick<AppSettings, Portable>;
  for (const key of PORTABLE_SETTINGS) {
    (out as Record<string, unknown>)[key] = settings[key];
  }
  return out;
}

export function localSettings(settings: AppSettings): Pick<AppSettings, Local> {
  const out = {} as Pick<AppSettings, Local>;
  for (const key of LOCAL_SETTINGS) {
    (out as Record<string, unknown>)[key] = settings[key];
  }
  return out;
}

/**
 * Device settings always come from this device. Portable settings follow the
 * newest edit, so changing your scale on your phone reaches your laptop.
 *
 * The one exception is the observation start date. It is not a preference — it
 * is a claim about when this app began watching, and the honest answer across
 * two devices is the earlier of the two. Taking the newer edit wholesale would
 * quietly shorten the record and make every "since" line on the Listening
 * surface wrong.
 */
export function mergeSettings(
  local: AppSettings,
  remote: Partial<AppSettings> | undefined,
): AppSettings {
  if (!remote) return local;
  const observedFrom = earliestObservation(
    local.listeningObservedFrom,
    remote.listeningObservedFrom,
  );
  const remoteAt = remote.updatedAt ?? 0;
  if (remoteAt <= (local.updatedAt ?? 0)) {
    return observedFrom === local.listeningObservedFrom
      ? local
      : { ...local, listeningObservedFrom: observedFrom };
  }
  const merged = { ...local, ...portableSettings(hydrateSettings({ ...local, ...remote })) };
  merged.listeningObservedFrom = observedFrom;
  return merged;
}

function earliestObservation(local: number | undefined, remote: number | undefined): number {
  const candidates = [local, remote].filter(
    (value): value is number => typeof value === 'number' && value > 0,
  );
  return candidates.length === 0 ? 0 : Math.min(...candidates);
}
