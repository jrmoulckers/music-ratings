import { describe, expect, it } from 'vitest';

import {
  compareEntities,
  findDuplicateCandidates,
  findDuplicateClusters,
  sameProviderIdentity,
  titleParts,
} from './duplicates';
import { makeEntity } from '../../test/fixtures';
import type { Entity } from './types';

/**
 * Finding the same record twice.
 *
 * The detector is judged on restraint as much as on recall: a live take and a
 * cover must never be offered as the same thing without saying what they are,
 * and nothing here may ever act on its own conclusion.
 */

const album = (id: string, name: string, overrides: Partial<Entity> = {}): Entity =>
  makeEntity('album', id, { name, subtitle: 'Radiohead', ...overrides });

const track = (id: string, name: string, overrides: Partial<Entity> = {}): Entity =>
  makeEntity('track', id, { name, subtitle: 'Radiohead', durationMs: 260_000, ...overrides });

describe('reading a title', () => {
  it('takes off case, accents, punctuation and the leading article', () => {
    expect(titleParts('The Bends').base).toBe('bends');
    expect(titleParts('Björk').base).toBe('bjork');
    expect(titleParts('Everything In Its Right Place').base).toBe(
      titleParts('everything in its right place!').base,
    );
  });

  it('keeps a qualifier it does not recognise, so part two is not part one', () => {
    expect(titleParts('Suite (Part 2)').base).not.toBe(titleParts('Suite (Part 1)').base);
    expect(titleParts('Weird Fishes - Arpeggi').base).toBe('weird fishes arpeggi');
  });

  it('separates what is said about this copy from the thing itself', () => {
    const bracketed = titleParts('Kid A (2016 Remaster)');
    expect(bracketed.base).toBe('kid a');
    expect(bracketed.kinds).toEqual(['edition']);

    const trailing = titleParts('Idioteque - 2009 Remastered');
    expect(trailing.base).toBe('idioteque');
    expect(trailing.kinds).toEqual(['edition']);

    expect(titleParts('Creep (Live at the Astoria)').kinds).toEqual(['performance']);
    expect(titleParts('Creep (Acoustic Version)').kinds).toContain('performance');
    expect(titleParts('Nude (Holy Fuck Remix)').kinds).toEqual(['rework']);
    expect(titleParts('Kid A (feat. Someone)').kinds).toEqual(['credit']);
    expect(titleParts('Kid A (2016)').kinds).toEqual(['edition']);
  });
});

describe('comparing two records', () => {
  it('calls two identical copies the same recording', () => {
    const a = track('a', 'Idioteque');
    const b = track('b', 'Idioteque');
    const result = compareEntities(a, b);
    expect(result.verdict).toBe('same-recording');
    expect(result.evidence.join(' ')).toMatch(/both are titled/i);
    expect(result.score).toBeGreaterThan(0.9);
  });

  it('calls a remaster a reissue and says why', () => {
    const a = album('a', 'Kid A', { releaseDate: '2000-10-02' });
    const b = album('b', 'Kid A (2016 Remaster)', { releaseDate: '2016-05-01' });
    const result = compareEntities(a, b);
    expect(result.verdict).toBe('reissue');
    expect(result.evidence.join(' ')).toMatch(/2000 and 2016/);
    expect(result.uncertainty.join(' ')).toMatch(/remixed as well as remastered/i);
  });

  it('will not call a live take or a remix a duplicate', () => {
    const studio = track('a', 'Creep');
    expect(compareEntities(studio, track('b', 'Creep (Live at Glastonbury)')).verdict).toBe(
      'different-version',
    );
    expect(compareEntities(studio, track('c', 'Creep - Acoustic')).verdict).toBe(
      'different-version',
    );
    expect(compareEntities(studio, track('d', 'Creep (Radio Edit)')).verdict).toBe(
      'different-version',
    );
    for (const other of ['Creep (Live)', 'Creep - Remix']) {
      const result = compareEntities(studio, track('x', other));
      expect(result.uncertainty.join(' ')).toMatch(/different performances|different take/i);
    }
  });

  it('will not call a cover a duplicate, however exact the title', () => {
    const result = compareEntities(
      track('a', 'Creep'),
      makeEntity('track', 'b', { name: 'Creep', subtitle: 'Someone Else', durationMs: 260_000 }),
    );
    expect(result.verdict).toBe('different-version');
    expect(result.evidence.join(' ')).toMatch(/different artists/i);
  });

  it('uses length to tell a copy from a different take', () => {
    const a = track('a', 'Idioteque', { durationMs: 260_000 });
    const close = track('b', 'Idioteque', { durationMs: 261_000 });
    const far = track('c', 'Idioteque', { durationMs: 320_000 });
    expect(compareEntities(a, close).verdict).toBe('same-recording');
    expect(compareEntities(a, close).evidence.join(' ')).toMatch(/within two seconds/i);
    expect(compareEntities(a, far).verdict).toBe('different-version');
  });

  it('says when it could not check the length', () => {
    const a = track('a', 'Idioteque', { durationMs: undefined });
    const result = compareEntities(a, track('b', 'Idioteque'));
    expect(result.uncertainty.join(' ')).toMatch(/no length recorded/i);
  });

  it('separates the same song reached through a different release', () => {
    const onAlbum = track('a', 'Idioteque', { parentIds: ['album:local:kida'] });
    const onComp = track('b', 'Idioteque', { parentIds: ['album:local:best-of'] });
    const result = compareEntities(onAlbum, onComp);
    expect(result.verdict).toBe('appearance');
    expect(result.evidence.join(' ')).toMatch(/different releases/i);
  });

  it('notices a different track count on two pressings', () => {
    const a = album('a', 'Kid A', { totalChildren: 10 });
    const b = album('b', 'Kid A', { totalChildren: 14 });
    const result = compareEntities(a, b);
    expect(result.verdict).toBe('reissue');
    expect(result.evidence.join(' ')).toMatch(/10 items, the other 14/);
  });

  it('refuses to compare across kinds, or a record with itself', () => {
    expect(compareEntities(album('a', 'Kid A'), track('a2', 'Kid A')).verdict).toBe('unrelated');
    const same = album('a', 'Kid A');
    expect(compareEntities(same, same).verdict).toBe('unrelated');
  });

  it('treats repeated rows for one Spotify identity as ingestion dedup, not a merge', () => {
    const first = album('local-a', 'Let It Bleed', {
      provider: 'spotify',
      providerId: 'spotify-release-a',
    });
    const repeated = album('local-b', 'Let It Bleed', {
      provider: 'spotify',
      providerId: 'spotify-release-a',
    });
    const edition = album('local-c', 'Let It Bleed (50th Anniversary Edition)', {
      provider: 'spotify',
      providerId: 'spotify-release-b',
    });

    expect(sameProviderIdentity(first, repeated)).toBe(true);
    expect(compareEntities(first, repeated).verdict).toBe('unrelated');
    expect(
      findDuplicateCandidates({ subject: first, entities: [first, repeated, edition] }).map(
        (candidate) => candidate.entityId,
      ),
    ).toEqual([edition.id]);
  });
});

describe('finding candidates for one item', () => {
  const subject = album('subject', 'Kid A', { releaseDate: '2000-10-02' });
  const library: Entity[] = [
    subject,
    album('remaster', 'Kid A (2016 Remaster)', { releaseDate: '2016-05-01' }),
    album('live', 'Kid A (Live in Oslo)'),
    album('other', 'Amnesiac'),
    makeEntity('track', 'trackish', { name: 'Kid A', subtitle: 'Radiohead' }),
  ];

  it('offers same-titled records of the same kind, best first', () => {
    const found = findDuplicateCandidates({ subject, entities: library });
    expect(found.map((c) => c.entityId)).toEqual(['album:local:remaster', 'album:local:live']);
    expect(found[0]!.suggested).toBe(true);
    // The live record is offered but labelled, never quietly recommended.
    expect(found[1]!.suggested).toBe(false);
    expect(found[1]!.verdict).toBe('different-version');
  });

  it('never offers the item itself or anything already folded into it', () => {
    const found = findDuplicateCandidates({
      subject,
      entities: library,
      exclude: new Set([subject.id, 'album:local:remaster']),
    });
    expect(found.map((c) => c.entityId)).toEqual(['album:local:live']);
  });

  it('lets a search reach a record whose title does not match at all', () => {
    const withoutSearch = findDuplicateCandidates({ subject, entities: library });
    expect(withoutSearch.some((c) => c.entityId === 'album:local:other')).toBe(false);

    const searched = findDuplicateCandidates({ subject, entities: library, search: 'amnesiac' });
    expect(searched.map((c) => c.entityId)).toEqual(['album:local:other']);
    expect(searched[0]!.verdict).toBe('unrelated');
    expect(searched[0]!.suggested).toBe(false);
  });

  it('leaves tombstoned records out', () => {
    const found = findDuplicateCandidates({
      subject,
      entities: [...library, album('gone', 'Kid A', { deleted: 1 })],
    });
    expect(found.some((c) => c.entityId === 'album:local:gone')).toBe(false);
  });
});

describe('sweeping the whole library', () => {
  it('groups copies by title and skips the singletons', () => {
    const clusters = findDuplicateClusters([
      album('a', 'Kid A'),
      album('b', 'Kid A (2016 Remaster)'),
      album('c', 'Amnesiac'),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.entityIds).toEqual(['album:local:a', 'album:local:b']);
    expect(clusters[0]!.verdict).toBe('reissue');
  });

  it('leaves out records that are already combined', () => {
    const clusters = findDuplicateClusters(
      [album('a', 'Kid A'), album('b', 'Kid A (2016 Remaster)')],
      { exclude: new Set(['album:local:b']) },
    );
    expect(clusters).toEqual([]);
  });

  it('is order-independent', () => {
    const entities = [album('a', 'Kid A'), album('b', 'Kid A (Remaster)'), album('c', 'Kid A')];
    const forwards = findDuplicateClusters(entities);
    const backwards = findDuplicateClusters([...entities].reverse());
    expect(forwards).toEqual(backwards);
  });
});
