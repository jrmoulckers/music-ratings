import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { appUrl, routeNameFor } from './router';

/**
 * The Rankings page once navigated to `/lists`, a path with no pattern behind
 * it, so touching any of its own filters replaced the list with the not-found
 * page. Nothing typed catches that: the target is a string. So the source is
 * read back and every hand-written navigation target is resolved for real.
 */

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (/\.(ts|svelte)$/.test(name) && !name.endsWith('.test.ts')) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Reads one string literal starting at `start`, marking each `${…}` so an
 * interpolated path can still be resolved: a target written as
 * `/rankings?${params}` is checked as `/rankings?x`, and as `/rankings`.
 */
const HOLE = '\u0001';

function readLiteral(text: string, start: number): string | null {
  const quote = text[start];
  if (quote !== '`' && quote !== "'" && quote !== '"') return null;
  let out = '';
  let depth = 0;
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i]!;
    if (depth > 0) {
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) out += HOLE;
      }
      continue;
    }
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (quote === '`' && ch === '$' && text[i + 1] === '{') {
      depth = 1;
      i += 1;
      continue;
    }
    if (ch === quote) return out;
    out += ch;
  }
  return null;
}

/**
 * An interpolated target is sound if it resolves either with the hole filled in
 * (`/e/${…}/${…}/${…}`) or with everything from the hole onwards dropped, since
 * a hole often carries an optional query (`/library${…}`).
 */
function resolves(path: string): boolean {
  if (routeNameFor(path.replaceAll(HOLE, 'x')) !== 'notfound') return true;
  const stem = path.split(HOLE)[0]!.replace(/[?&/]+$/, '');
  return routeNameFor(stem || '/') !== 'notfound';
}

/** Every `navigate('/…')` and `href('/…')` target written across the app. */
function navigationTargets(): { file: string; path: string }[] {
  const found: { file: string; path: string }[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\b(?:navigate|href)\(\s*/g)) {
      const path = readLiteral(text, match.index + match[0].length);
      if (path?.startsWith('/')) found.push({ file: file.slice(SRC.length + 1), path });
    }
  }
  return found;
}

describe('router', () => {
  it('resolves each page path', () => {
    expect(routeNameFor('/')).toBe('home');
    expect(routeNameFor('/rankings')).toBe('rankings');
    expect(routeNameFor('/rankings/')).toBe('rankings');
    expect(routeNameFor('/settings')).toBe('settings');
    expect(routeNameFor('/e/album/demo/abc')).toBe('entity');
  });

  it('keeps list filters in the query, not the path', () => {
    // Filter state must never change which page you are on.
    expect(routeNameFor('/rankings?type=artist&dir=bottom&view=explicit&range=all')).toBe(
      'rankings',
    );
    expect(routeNameFor('/lists?type=artist')).toBe('notfound');
  });

  it('has no unknown navigation target anywhere in the app', () => {
    const targets = navigationTargets();
    // If this ever finds nothing, the scan itself broke.
    expect(targets.length).toBeGreaterThan(5);
    const broken = targets.filter((t) => !resolves(t.path));
    expect(broken).toEqual([]);
  });

  it('would catch a target with no route behind it', () => {
    // The shape of the bug this guards against, proven rather than assumed.
    expect(resolves(`/lists?${HOLE}`)).toBe(false);
    expect(resolves(`/rankings?${HOLE}`)).toBe(true);
  });

  it('builds an absolute url for the addresses registered outside this app', () => {
    // BASE is read once at import, so this covers the root deployment; the
    // subpath case is exercised where it matters, in the OneDrive tests.
    expect(appUrl('/callback')).toBe('https://rank.jrmoulckers.com/callback');
    expect(appUrl('/')).toBe('https://rank.jrmoulckers.com/');
  });
});
