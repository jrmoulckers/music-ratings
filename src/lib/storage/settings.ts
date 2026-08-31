import { DEFAULT_SCALE_ID } from '../domain/scales';
import { DEFAULT_SUGGESTION_WEIGHTS } from '../domain/suggestions';
import { defaultRollupConfigByType } from '../domain/rollup';
import { DEFAULT_CONTEXT_CONTRIBUTION, clampContribution, defaultFacets } from '../domain/context';
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
  updatedAt: number;

  /* ---- device-local: never leaves this browser ---- */
  theme: ThemeChoice;
  motion: MotionChoice;
  density: DensityChoice;
  artwork: ArtworkChoice;
  highContrast: boolean;
  syncEnabled: boolean;
  syncFileName: string;
  onboarded: boolean;
  spotifyClientId: string;
  spotifyRedirectUri: string;
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
    updatedAt: 0,

    theme: 'system',
    motion: 'system',
    density: 'cozy',
    artwork: 'full',
    highContrast: false,
    syncEnabled: false,
    syncFileName: 'music-ratings.json',
    onboarded: false,
    spotifyClientId: (import.meta.env?.VITE_SPOTIFY_CLIENT_ID as string | undefined) ?? '',
    spotifyRedirectUri:
      (import.meta.env?.VITE_SPOTIFY_REDIRECT_URI as string | undefined) ??
      (typeof location === 'undefined' ? '' : `${location.origin}${base()}callback`),
    onedriveClientId: (import.meta.env?.VITE_ONEDRIVE_CLIENT_ID as string | undefined) ?? '',
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
  merged.schemaVersion = SETTINGS_SCHEMA_VERSION;
  return merged;
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
 */
export function mergeSettings(
  local: AppSettings,
  remote: Partial<AppSettings> | undefined,
): AppSettings {
  if (!remote) return local;
  const remoteAt = remote.updatedAt ?? 0;
  if (remoteAt <= (local.updatedAt ?? 0)) return local;
  return { ...local, ...portableSettings(hydrateSettings({ ...local, ...remote })) };
}
