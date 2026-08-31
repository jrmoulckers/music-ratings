import { describe, expect, it } from 'vitest';

import { editionMarks, normalizedTitle } from './editions';
import type { Entity, EntityId } from './types';

/**
 * Two Let It Bleeds.
 *
 * The reported symptom was two identical library rows. They were not one record
 * stored twice — the canonical id is `${type}:${provider}:${providerId}`, so
 * that duplicate cannot survive a Map — they were two Spotify editions the UI
 * gave no way to tell apart. These pin the disambiguation, and the restraint:
 * rows that are already distinct stay clean.
 */

const PROVENANCE = { provider: 'spotify', via: 'test', fetchedAt: 0 } as const;

function album(providerId: string, extra: Partial<Entity> = {}): Entity {
  return {
    id: `album:spotify:${providerId}` as EntityId,
    type: 'album',
    provider: 'spotify',
    providerId,
    name: 'Let It Bleed',
    subtitle: 'The Rolling Stones',
    createdAt: 0,
    updatedAt: 0,
    provenance: PROVENANCE,
    ...extra,
  };
}

describe('editionMarks', () => {
  it('leaves distinct rows unmarked', () => {
    const marks = editionMarks([album('a'), album('b', { name: 'Aftermath' })]);
    expect(marks.size).toBe(0);
  });

  it('separates identical rows by year', () => {
    const rows = [
      album('a', { releaseDate: '1969-12-05' }),
      album('b', { releaseDate: '2019-11-01' }),
    ];
    const marks = editionMarks(rows);
    expect(marks.get(rows[0]!.id)).toBe('1969');
    expect(marks.get(rows[1]!.id)).toBe('2019');
  });

  it('adds the next fact only when the first does not separate them', () => {
    const rows = [
      album('a', { releaseDate: '1969-12-05', totalChildren: 9 }),
      album('b', { releaseDate: '1969-12-05', totalChildren: 18 }),
    ];
    const marks = editionMarks(rows);
    expect(marks.get(rows[0]!.id)).toBe('1969 · 9 tracks');
    expect(marks.get(rows[1]!.id)).toBe('1969 · 18 tracks');
  });

  it('labels the kind when a single shares a title with the album', () => {
    const rows = [
      album('a', { releaseDate: '1969', albumKind: 'album' }),
      album('b', { releaseDate: '1969', albumKind: 'single' }),
    ];
    const marks = editionMarks(rows);
    expect(marks.get(rows[1]!.id)).toContain('Single');
  });

  it('falls back to the catalogue id when nothing else distinguishes them', () => {
    const rows = [album('abcdef123'), album('zyxwvu987')];
    const marks = editionMarks(rows);
    expect(marks.get(rows[0]!.id)).toBe('id abcdef');
    expect(marks.get(rows[1]!.id)).toBe('id zyxwvu');
  });

  it('appends the id when the available facts still collide', () => {
    const rows = [
      album('abcdef123', { releaseDate: '1969', totalChildren: 9 }),
      album('zyxwvu987', { releaseDate: '1969', totalChildren: 9 }),
    ];
    const marks = editionMarks(rows);
    expect(marks.get(rows[0]!.id)).toBe('1969 · 9 tracks · id abcdef');
    expect(marks.get(rows[1]!.id)).toBe('1969 · 9 tracks · id zyxwvu');
  });

  it('does not mark rows that differ only by subtitle', () => {
    const rows = [album('a'), album('b', { subtitle: 'Various Artists' })];
    expect(editionMarks(rows).size).toBe(0);
  });

  it('marks each colliding group independently', () => {
    const rows = [
      album('a', { releaseDate: '1969' }),
      album('b', { releaseDate: '2019' }),
      album('c', { name: 'Sticky Fingers' }),
    ];
    const marks = editionMarks(rows);
    expect(marks.has(rows[2]!.id)).toBe(false);
    expect(marks.size).toBe(2);
  });

  it('does not confuse different types that share a name', () => {
    const rows = [album('a'), album('b', { id: 'track:spotify:b' as EntityId, type: 'track' })];
    expect(editionMarks(rows).size).toBe(0);
  });

  it('never marks a row that appears alone', () => {
    expect(editionMarks([album('a')]).size).toBe(0);
    expect(editionMarks([]).size).toBe(0);
  });
});

describe('normalizedTitle', () => {
  it('strips edition wording so candidates can be found later', () => {
    expect(normalizedTitle('Let It Bleed (Deluxe Edition)')).toBe('let it bleed');
    expect(normalizedTitle('Let It Bleed [50th Anniversary Remastered]')).toBe('let it bleed');
    expect(normalizedTitle('Let It Bleed - 2019 Remaster')).toBe('let it bleed');
  });

  it('keeps meaningful parentheses', () => {
    expect(normalizedTitle('You Can’t Always Get What You Want (Live)')).toBe(
      'you can t always get what you want live',
    );
  });

  it('folds punctuation and case', () => {
    expect(normalizedTitle('  LET  IT   BLEED!  ')).toBe('let it bleed');
  });
});
