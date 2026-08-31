import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';

import type { Entity, EntityId, EntityType, Membership } from '../lib/domain/types';

/**
 * A detail page that knows what it is looking at.
 *
 * The reported problem was a right rail carrying ten undifferentiated links and
 * a main column asking "What's inside?" of a track, which has no inside. So
 * these mount the real page for each kind and hold it to two rules: a leaf is
 * never offered a container's question, and the record and artist a track
 * belongs to are named, prominent and reachable.
 */

const EntityPage = (await import('../pages/Entity.svelte')).default;
const { world } = await import('../lib/app/state');

const PROVENANCE = { provider: 'spotify', via: 'test', fetchedAt: 0 } as const;

function entity(
  type: EntityType,
  providerId: string,
  name: string,
  extra: Partial<Entity> = {},
): Entity {
  return {
    id: `${type}:spotify:${providerId}` as EntityId,
    type,
    provider: 'spotify',
    providerId,
    name,
    createdAt: 0,
    updatedAt: 0,
    provenance: PROVENANCE,
    ...extra,
  };
}

function member(parent: Entity, child: Entity, position?: number): Membership {
  return {
    id: `${parent.id}->${child.id}`,
    parentId: parent.id,
    childId: child.id,
    parentType: parent.type,
    childType: child.type,
    share: 1,
    ...(position === undefined ? {} : { position }),
    updatedAt: 0,
  };
}

function seed(entities: Entity[], memberships: Membership[] = []) {
  world.set({ ...get(world), entities, memberships });
}

let host: HTMLElement | null = null;
let view: Record<string, unknown> | null = null;

function render(subject: Entity) {
  host = document.createElement('div');
  document.body.append(host);
  view = mount(EntityPage, {
    target: host,
    props: { params: { type: subject.type, provider: 'spotify', id: subject.providerId } },
  }) as Record<string, unknown>;
  flushSync();
}

const text = () => host?.textContent ?? '';

/** Lets the release-completeness effect settle before reading an empty state. */
async function settle() {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
  flushSync();
}
const headings = () =>
  [...(host?.querySelectorAll('h1, h2, h3') ?? [])].map((h) => ({
    level: Number(h.tagName.slice(1)),
    text: (h.textContent ?? '').trim(),
  }));

afterEach(() => {
  if (view) void unmount(view);
  host?.remove();
  view = null;
  host = null;
});

/* -------------------------------------------------------------------------- */

describe('a leaf is never asked a container’s question', () => {
  it('offers a track no contents section, no empty state and no load action', () => {
    const artist = entity('artist', 'a1', 'Kestrel Harbour');
    const album = entity('album', 'r1', 'Rain Ledger');
    const track = entity('track', 't1', 'Low Tide');
    seed([artist, album, track], [member(album, track, 0), member(artist, track)]);
    render(track);

    expect(text()).not.toContain("What's inside");
    expect(text()).not.toContain('Tracklist');
    expect(text()).not.toContain('Nothing loaded yet');
    expect(text()).not.toMatch(/Load the .* from Spotify/);
    expect(host?.querySelector('ul.contents')).toBeNull();
  });

  it('says nothing false about a track with no release recorded', () => {
    const track = entity('track', 't9', 'Orphan Take');
    seed([track]);
    render(track);

    expect(text()).toContain('No release is recorded for this track yet.');
    expect(text()).not.toContain('Nothing loaded yet');
    expect(host?.querySelector('ul.contents')).toBeNull();
  });

  it('gives an episode and a chapter the same treatment', () => {
    const show = entity('show', 's1', 'Night Signal');
    const episode = entity('episode', 'e1', 'Episode 4');
    seed([show, episode], [member(show, episode, 0)]);
    render(episode);
    expect(text()).not.toContain('Episodes');
    expect(host?.querySelector('ul.contents')).toBeNull();
    if (view) void unmount(view);
    host?.remove();

    const book = entity('audiobook', 'b1', 'The Long Field');
    const chapter = entity('chapter', 'c1', 'Chapter 2');
    seed([book, chapter], [member(book, chapter, 0)]);
    render(chapter);
    expect(text()).not.toContain('Chapters');
    expect(host?.querySelector('ul.contents')).toBeNull();
  });
});

describe('every container gets its own word', () => {
  it('calls a release’s contents a tracklist', () => {
    const album = entity('album', 'r1', 'Rain Ledger', { totalChildren: 2 });
    const one = entity('track', 't1', 'Low Tide', { trackNumber: 1 });
    const two = entity('track', 't2', 'High Water', { trackNumber: 2 });
    seed([album, one, two], [member(album, one, 0), member(album, two, 1)]);
    render(album);

    expect(headings().some((h) => h.level === 2 && h.text === 'Tracklist')).toBe(true);
    expect(text()).not.toContain("What's inside");
  });

  it('calls a playlist’s contents tracks', () => {
    const list = entity('playlist', 'p1', 'Late Drive');
    const one = entity('track', 't1', 'Low Tide');
    seed([list, one], [member(list, one, 0)]);
    render(list);

    expect(headings().some((h) => h.level === 2 && h.text === 'Tracks')).toBe(true);
  });

  it('splits an artist’s discography into releases and tracks', () => {
    const artist = entity('artist', 'a1', 'Kestrel Harbour');
    const album = entity('album', 'r1', 'Rain Ledger');
    const single = entity('track', 't1', 'Low Tide');
    seed([artist, album, single], [member(artist, album, 0), member(artist, single, 1)]);
    render(artist);

    const found = headings().filter((h) => h.level === 2);
    expect(found.map((h) => h.text)).toContain('Releases');
    expect(found.map((h) => h.text)).toContain('Tracks');
    expect(found.findIndex((h) => h.text === 'Releases')).toBeLessThan(
      found.findIndex((h) => h.text === 'Tracks'),
    );
  });

  it('names episodes and chapters', () => {
    const show = entity('show', 's1', 'Night Signal');
    const episode = entity('episode', 'e1', 'Episode 4');
    seed([show, episode], [member(show, episode, 0)]);
    render(show);
    expect(headings().some((h) => h.level === 2 && h.text === 'Episodes')).toBe(true);
    if (view) void unmount(view);
    host?.remove();

    const book = entity('audiobook', 'b1', 'The Long Field');
    const chapter = entity('chapter', 'c1', 'Chapter 2');
    seed([book, chapter], [member(book, chapter, 0)]);
    render(book);
    expect(headings().some((h) => h.level === 2 && h.text === 'Chapters')).toBe(true);
  });

  it('names the missing kind rather than apologising generically when empty', async () => {
    const album = entity('album', 'r1', 'Rain Ledger');
    seed([album]);
    render(album);
    await settle();

    expect(text()).toContain('No tracks loaded');
    expect(text()).not.toContain('Nothing loaded yet for this item');
  });
});

describe('the record and the artist stay reachable', () => {
  it('names them under headings that say what the edge means, and links them', () => {
    const artist = entity('artist', 'a1', 'Kestrel Harbour');
    const album = entity('album', 'r1', 'Rain Ledger');
    const list = entity('playlist', 'p1', 'Late Drive');
    const track = entity('track', 't1', 'Low Tide');
    seed(
      [artist, album, list, track],
      [member(album, track, 0), member(artist, track), member(list, track, 3)],
    );
    render(track);

    const h2s = headings()
      .filter((h) => h.level === 2)
      .map((h) => h.text);
    expect(h2s).toContain('Appears on');
    expect(h2s).toContain('By');
    expect(h2s).toContain('In playlists');
    expect(h2s.indexOf('Appears on')).toBeLessThan(h2s.indexOf('By'));

    const hrefs = [...(host?.querySelectorAll('a.rel__row') ?? [])].map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs.some((h) => h?.includes('album/spotify/r1'))).toBe(true);
    expect(hrefs.some((h) => h?.includes('artist/spotify/a1'))).toBe(true);
    expect(hrefs.some((h) => h?.includes('playlist/spotify/p1'))).toBe(true);
  });

  it('tells two editions of the same record apart in the same list', () => {
    const first = entity('album', 'r1969', 'Let It Bleed', {
      subtitle: 'The Rolling Stones',
      releaseDate: '1969-12-05',
    });
    const second = entity('album', 'r2019', 'Let It Bleed', {
      subtitle: 'The Rolling Stones',
      releaseDate: '2019-11-01',
    });
    const track = entity('track', 't1', 'Gimme Shelter');
    seed([first, second, track], [member(first, track, 0), member(second, track, 0)]);
    render(track);

    const rows = [...(host?.querySelectorAll('a.rel__row') ?? [])].map((a) => a.textContent ?? '');
    expect(rows.some((r) => r.includes('1969'))).toBe(true);
    expect(rows.some((r) => r.includes('2019'))).toBe(true);
  });

  it('does not repeat the artist as plain text once it is a link', () => {
    const artist = entity('artist', 'a1', 'Kestrel Harbour');
    const album = entity('album', 'r1', 'Rain Ledger', { subtitle: 'Kestrel Harbour' });
    seed([artist, album], [member(artist, album, 0)]);
    render(album);

    expect(host?.querySelector('.item__sub')).toBeNull();
    expect(host?.querySelector('a.rel__row')?.textContent).toContain('Kestrel Harbour');
  });

  it('keeps a subtitle that says more than the links do', () => {
    const artist = entity('artist', 'a1', 'Kestrel Harbour');
    const album = entity('album', 'r1', 'Rain Ledger', { subtitle: 'Deluxe edition, 2019' });
    seed([artist, album], [member(artist, album, 0)]);
    render(album);

    expect(host?.querySelector('.item__sub')?.textContent).toContain('Deluxe edition');
  });
});

describe('the margin', () => {
  it('keeps the identifier and provenance behind one Details disclosure', () => {
    const album = entity('album', 'r1', 'Rain Ledger');
    seed([album]);
    render(album);

    const details = [...(host?.querySelectorAll('details') ?? [])].find(
      (d) => d.querySelector('summary')?.textContent?.trim() === 'Details',
    );
    expect(details).toBeTruthy();
    expect(details?.textContent).toContain('album:spotify:r1');
    expect(details?.open).toBe(false);

    // Nowhere else on the page, so the rail is not carrying it twice.
    const loose = [...(host?.querySelectorAll('.mono') ?? [])].filter(
      (node) => !details?.contains(node),
    );
    expect(loose).toHaveLength(0);
  });

  it('holds the score working behind a disclosure with a one-line summary', () => {
    const album = entity('album', 'r1', 'Rain Ledger');
    seed([album]);
    render(album);

    const rail = host?.querySelector('aside.margin');
    const summaries = [...(rail?.querySelectorAll('summary') ?? [])].map((s) =>
      (s.textContent ?? '').trim(),
    );
    expect(summaries).toContain('How this score was reached');
    expect(summaries).toContain('Details');
    // Closed, so the four-channel working is not what the rail leads with.
    for (const node of rail?.querySelectorAll('details') ?? []) expect(node.open).toBe(false);
    // The heading is the disclosure's, never repeated inside it.
    expect(rail?.querySelectorAll('.disclose__body h3')?.length ?? 0).toBeLessThan(3);
  });
});

describe('heading order', () => {
  it('has one h1 and never skips a level', () => {
    const artist = entity('artist', 'a1', 'Kestrel Harbour');
    const album = entity('album', 'r1', 'Rain Ledger');
    const track = entity('track', 't1', 'Low Tide');
    seed([artist, album, track], [member(album, track, 0), member(artist, track)]);
    render(track);

    const found = headings();
    expect(found.filter((h) => h.level === 1)).toHaveLength(1);
    expect(found[0]?.level).toBe(1);
    let previous = 1;
    for (const heading of found) {
      expect(heading.level).toBeLessThanOrEqual(previous + 1);
      expect(heading.text.length).toBeGreaterThan(0);
      previous = heading.level;
    }
  });

  it('puts the relationships between the rating and the contents', () => {
    const artist = entity('artist', 'a1', 'Kestrel Harbour');
    const album = entity('album', 'r1', 'Rain Ledger');
    const track = entity('track', 't1', 'Low Tide');
    seed([artist, album, track], [member(artist, album, 0), member(album, track, 0)]);
    render(album);

    const order = headings().map((h) => h.text);
    expect(order.indexOf('By')).toBeGreaterThan(order.indexOf('Your rating'));
    expect(order.indexOf('By')).toBeLessThan(order.indexOf('Tracklist'));
  });
});

describe('every track keeps its rating control', () => {
  it('renders exactly one rating surface per row and none for the relationships', () => {
    const album = entity('album', 'r1', 'Rain Ledger', { totalChildren: 3 });
    const tracks = [1, 2, 3].map((n) => entity('track', `t${n}`, `Track ${n}`, { trackNumber: n }));
    seed(
      [album, ...tracks],
      tracks.map((t, i) => member(album, t, i)),
    );
    render(album);

    const rows = host?.querySelectorAll('ul.contents > *') ?? [];
    expect(rows).toHaveLength(3);
    expect(host?.querySelectorAll('a.rel__row')).toHaveLength(0);
  });
});

describe('a row does not repeat the page it is on', () => {
  it('drops the release and the artist from a tracklist', () => {
    const artist = entity('artist', 'a1', 'Kestrel Harbour');
    const album = entity('album', 'r1', 'Rain Ledger', { totalChildren: 1 });
    const track = entity('track', 't1', 'Low Tide', {
      trackNumber: 1,
      subtitle: 'Kestrel Harbour · Rain Ledger',
    });
    seed(
      [artist, album, track],
      [member(artist, album, 0), member(album, track, 0), member(artist, track)],
    );
    render(album);

    const meta = [...(host?.querySelectorAll('ul.contents .slip__meta') ?? [])].map((el) =>
      el.textContent?.trim(),
    );
    expect(meta.join(' ')).not.toContain('Rain Ledger');
    expect(meta.join(' ')).not.toContain('Kestrel Harbour');
  });

  it('keeps the release on an artist’s track rows, because that is what differs', () => {
    const artist = entity('artist', 'a1', 'Kestrel Harbour');
    const track = entity('track', 't1', 'Low Tide', {
      subtitle: 'Kestrel Harbour · Rain Ledger',
    });
    seed([artist, track], [member(artist, track, 0)]);
    render(artist);

    const meta = [...(host?.querySelectorAll('ul.contents .slip__meta') ?? [])]
      .map((el) => el.textContent ?? '')
      .join(' ');
    expect(meta).toContain('Rain Ledger');
    expect(meta).not.toContain('Kestrel Harbour');
  });
});
