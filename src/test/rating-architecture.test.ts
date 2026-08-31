import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * One way to rate a thing.
 *
 * Rating used to be four components deep and every surface picked its own
 * depth, so the same act looked different in a list, on a player and in a
 * search result. `InlineRating` is now the only component allowed to mount a
 * scale control, and the controls it dispatches to live behind a folder that
 * nothing else may reach into. This file is the fence: it fails the build
 * rather than the review when a page reaches past it.
 */

const SRC = resolve(__dirname, '..');
const INTERNAL = ['CompactRating', 'StarRating', 'PrecisionRail', 'RatingRail'];

/** Everything that may mount a scale control, and nothing else. */
const ALLOWED = ['components/InlineRating.svelte'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(svelte|ts)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Repo-relative, forward slashes, so an expectation reads like a path. */
function key(file: string): string {
  return relative(SRC, file).replaceAll('\\', '/');
}

const files = sourceFiles(SRC)
  .map(key)
  // Tests unit-test the primitives directly and are meant to.
  .filter((f) => !f.startsWith('test/') && !f.includes('.test.'));

function importsOf(file: string): string[] {
  const text = readFileSync(join(SRC, file), 'utf8');
  return [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
}

describe('the rating boundary', () => {
  it('lets nothing but InlineRating mount a scale control', () => {
    const trespassers = files.filter((file) => {
      if (file.startsWith('components/rating/') || ALLOWED.includes(file)) return false;
      return importsOf(file).some((spec) =>
        INTERNAL.some((name) => spec.endsWith(`${name}.svelte`)),
      );
    });

    expect(trespassers).toEqual([]);
  });

  it('keeps the internal controls inside the rating folder', () => {
    const here = readdirSync(join(SRC, 'components', 'rating'));
    for (const name of INTERNAL) {
      expect(here, name).toContain(`${name}.svelte`);
    }
  });

  it('has no QuickRate left to confuse the one name with', () => {
    const stragglers = files.filter((file) =>
      importsOf(file).some((spec) => spec.endsWith('QuickRate.svelte')),
    );
    expect(stragglers).toEqual([]);
    expect(files).not.toContain('components/QuickRate.svelte');
  });

  /**
   * The surfaces where rating is possible, and the component each one is
   * expected to reach for. A new ratable surface either appears here or fails.
   */
  const SURFACES: ReadonlyArray<[file: string, mounts: string]> = [
    ['components/MiniPlayer.svelte', 'InlineRating'],
    ['components/AlbumMode.svelte', 'InlineRating'],
    ['components/RatableRow.svelte', 'InlineRating'],
    ['components/SearchOverlay.svelte', 'InlineRating'],
    ['components/SpotifySearch.svelte', 'InlineRating'],
    ['components/RatePanel.svelte', 'InlineRating'],
    ['components/ContextEditor.svelte', 'InlineRating'],
    ['pages/NowPlaying.svelte', 'InlineRating'],
    ['pages/History.svelte', 'InlineRating'],
    ['pages/Entity.svelte', 'RatePanel'],
    ['pages/Rate.svelte', 'RatableRow'],
    ['pages/Library.svelte', 'RatableRow'],
    ['pages/Home.svelte', 'RatableRow'],
    ['pages/Rankings.svelte', 'RatableRow'],
  ];

  it.each(SURFACES)('%s rates through %s', (file, mounts) => {
    const text = readFileSync(join(SRC, file), 'utf8');
    expect(text).toContain(`<${mounts}`);
  });

  it('names every ratable surface it knows about', () => {
    // A surface that mounts a rating component but is missing from the table
    // above has escaped the audit, which is how the exceptions grew last time.
    const listed = new Set(SURFACES.map(([file]) => file));
    const mounting = files.filter((file) => {
      if (file.startsWith('components/rating/') || ALLOWED.includes(file)) return false;
      const text = readFileSync(join(SRC, file), 'utf8');
      return /<(InlineRating|RatableRow|RatePanel)\b/.test(text);
    });

    expect(mounting.filter((file) => !listed.has(file))).toEqual([]);
  });
});

/**
 * One transport, in one place.
 *
 * Now Playing used to draw its own play, previous, next and rail beneath the
 * persistent bar, which meant two answers to "where am I in this track" and a
 * visible disagreement the moment a poll landed between them. The bar is now
 * the only transport in the app, on every route including its own page.
 */
describe('the transport boundary', () => {
  const surfaces = files.filter((f) => f.startsWith('components/') || f.startsWith('pages/'));

  it('draws the position rail in exactly one component', () => {
    const rails = surfaces.filter((file) =>
      readFileSync(join(SRC, file), 'utf8').includes('aria-label="Position in track'),
    );
    expect(rails).toEqual(['components/PlaybackScrubber.svelte']);
  });

  it('puts the scrubber in the bar and nowhere else', () => {
    const mounts = surfaces.filter((file) =>
      /<PlaybackScrubber\b/.test(readFileSync(join(SRC, file), 'utf8')),
    );
    expect(mounts).toEqual(['components/MiniPlayer.svelte']);
  });

  it('leaves play, previous and next to the bar', () => {
    const bar = ['components/MiniPlayer.svelte', 'components/PlaybackScrubber.svelte'];
    const commanding = surfaces.filter((file) => {
      if (bar.includes(file)) return false;
      const text = readFileSync(join(SRC, file), 'utf8');
      return /\bplaybackToggle\b|\bplaybackNext\b|\bplaybackPrevious\b|\bplaybackSeek\b/.test(text);
    });
    expect(commanding).toEqual([]);
  });

  it('keeps the bar on every route, Now Playing included', () => {
    const app = readFileSync(join(SRC, 'App.svelte'), 'utf8');
    const mount = app.match(/\{#if[^}]*\}\s*\n\s*<MiniPlayer \/>/);
    expect(mount, 'MiniPlayer is mounted behind a guard').not.toBeNull();
    expect(mount?.[0]).not.toMatch(/now-playing/);
  });
});
