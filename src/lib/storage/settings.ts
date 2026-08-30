import { DEFAULT_SCALE_ID } from '../domain/scales';
import { DEFAULT_SUGGESTION_WEIGHTS } from '../domain/suggestions';
import { defaultRollupConfigByType } from '../domain/rollup';
import type { EntityType, RollupConfigByType, ScoreView, SuggestionWeights } from '../domain/types';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type MotionChoice = 'system' | 'reduce' | 'full';
export type DensityChoice = 'cozy' | 'compact';
export type ArtworkChoice = 'full' | 'thumbnails' | 'none';

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
  merged.schemaVersion = SETTINGS_SCHEMA_VERSION;
  return merged;
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
