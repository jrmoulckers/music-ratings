import { beforeEach, describe, expect, it } from 'vitest';

import { clearStore, readMeta } from '../lib/storage/db';
import { countPlays, listCompletions, listPlays } from '../lib/storage/repo';
import { clearDemoListening, seedDemoListening } from '../lib/listening/demo';
import { META_LISTENING_COVERAGE } from '../lib/listening/ingest';
import type { ListeningCoverage } from '../lib/domain/listening';
import type { AppSettings } from '../lib/storage/settings';
import { T0 } from './fixtures';

/**
 * The seeded history exists so the surface can be judged without waiting weeks
 * for a real account to fill. That only holds if it behaves like a history and
 * not like a pile: seeding twice must leave one history, and it must write the
 * same provenance a real ingest would, or the preview would quietly be more
 * confident than the product.
 */

beforeEach(async () => {
  await clearStore('plays');
  await clearStore('completions');
  await clearStore('entities');
  await clearStore('memberships');
  await clearStore('meta');
});

describe('the seeded demonstration history', () => {
  it('finishes at least one record, so the completion moment can be seen at all', async () => {
    const seeded = await seedDemoListening(T0);
    expect(seeded.plays).toBeGreaterThan(0);
    expect(seeded.completions.length).toBeGreaterThan(0);

    // The point of the exercise: one of them closed moments ago.
    const newest = [...seeded.completions].sort((a, b) => b.endAt - a.endAt)[0]!;
    expect(T0 - newest.endAt).toBeLessThan(60 * 60 * 1000);
    expect(newest.prompt).toBe('open');
  });

  it('replaces itself rather than layering a second history on top', async () => {
    await seedDemoListening(T0);
    const first = { plays: await countPlays(), completions: (await listCompletions()).length };

    // A different `now` shifts every timestamp, so the deterministic play ids
    // change too. Identity alone cannot deduplicate this; the clear must.
    await seedDemoListening(T0 + 90_000);
    await seedDemoListening(T0 + 175_000);
    const after = { plays: await countPlays(), completions: (await listCompletions()).length };

    expect(after).toEqual(first);
  });

  it('records where the observation starts, as a real ingest would', async () => {
    const seeded = await seedDemoListening(T0);
    const plays = await listPlays();
    const oldest = Math.min(...plays.map((play) => play.at));

    const coverage = await readMeta<ListeningCoverage>(META_LISTENING_COVERAGE);
    expect(coverage?.firstFetchAt).toBe(oldest);
    expect(coverage?.newestSeenAt).toBe(Math.max(...plays.map((play) => play.at)));

    const settings = await readMeta<AppSettings>('settings');
    expect(settings?.listeningObservedFrom).toBe(oldest);
    expect(seeded.observedSince).toBe(oldest);
  });

  it('can be taken away again without touching anything else', async () => {
    await seedDemoListening(T0);
    const removed = await clearDemoListening();

    expect(removed.plays).toBeGreaterThan(0);
    expect(await countPlays()).toBe(0);
    expect(await listCompletions()).toHaveLength(0);
  });
});
