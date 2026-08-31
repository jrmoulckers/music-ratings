import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COMPLETION_WINDOW_DAYS,
  albumTrackSet,
  completionWindowMs,
  evaluateAlbumCompletion,
  type RecompletionMode,
} from '../lib/domain/completion';
import { ContainmentGraph } from '../lib/domain/graph';
import type { AlbumCompletion, PlayEvent } from '../lib/domain/listening';
import type { Entity, Membership } from '../lib/domain/types';
import { DAY, HOUR, MINUTE, T0, link, makeAlbum, makeEntity, play } from './fixtures';

const WINDOW = completionWindowMs(DEFAULT_COMPLETION_WINDOW_DAYS);

function evaluate(options: {
  entities: Entity[];
  memberships: Membership[];
  albumId: string;
  plays: PlayEvent[];
  newPlayIds?: string[];
  existing?: AlbumCompletion[];
  recompletion?: RecompletionMode;
  cooldownMs?: number;
  windowMs?: number;
  now?: number;
}) {
  const graph = new ContainmentGraph(options.entities, options.memberships);
  const tracks = albumTrackSet(graph, options.albumId);
  return evaluateAlbumCompletion({
    tracks,
    plays: options.plays,
    windowMs: options.windowMs ?? WINDOW,
    newPlayIds: new Set(options.newPlayIds ?? options.plays.map((p) => p.id)),
    existing: options.existing ?? [],
    recompletion: options.recompletion ?? 'fresh',
    ...(options.cooldownMs !== undefined ? { cooldownMs: options.cooldownMs } : {}),
    now: options.now ?? T0 + 400 * DAY,
  });
}

describe('albumTrackSet', () => {
  it('is complete only when local links match the declared total', () => {
    const { album, tracks, entities, memberships } = makeAlbum('ok', 3);
    const graph = new ContainmentGraph(entities, memberships);
    expect(albumTrackSet(graph, album.id).confidence).toBe('complete');

    const partial = new ContainmentGraph(entities, memberships.slice(0, 2));
    const set = albumTrackSet(partial, album.id);
    expect(set.confidence).toBe('incomplete');
    expect(set.knownTotal).toBe(2);
    expect(set.declaredTotal).toBe(3);
    expect(tracks).toHaveLength(3);
  });

  it('is incomplete when the provider never said how many tracks there are', () => {
    const album = makeEntity('album', 'unknown-total');
    const track = makeEntity('track', 'unknown-total-t1');
    const graph = new ContainmentGraph([album, track], [link(album, track)]);
    const set = albumTrackSet(graph, album.id);
    expect(set.declaredTotal).toBeNull();
    expect(set.confidence).toBe('incomplete');
  });

  it('excludes unavailable and local-file tracks from what must be heard', () => {
    const { album, tracks, memberships } = makeAlbum('mixed', 3);
    const gone = { ...tracks[1]!, available: false };
    const graph = new ContainmentGraph([album, tracks[0]!, gone, tracks[2]!], memberships);
    const set = albumTrackSet(graph, album.id);
    expect(set.trackIds).toHaveLength(2);
    expect(set.excluded.unavailable).toBe(1);
    // The declared total still counts it, so the edition stays knowable.
    expect(set.confidence).toBe('complete');
  });

  it('counts a track linked twice only once', () => {
    const { album, tracks, entities, memberships } = makeAlbum('dupe', 2);
    const again = link(album, tracks[0]!, { position: 3 });
    const graph = new ContainmentGraph(entities, [...memberships, again]);
    const set = albumTrackSet(graph, album.id);
    expect(set.trackIds).toHaveLength(2);
    expect(set.excluded.duplicate).toBe(1);
  });

  it('keeps every disc of a multi-disc edition in one set', () => {
    const { album, entities, memberships } = makeAlbum('double', 24);
    const graph = new ContainmentGraph(entities, memberships);
    expect(albumTrackSet(graph, album.id).trackIds).toHaveLength(24);
  });

  it('treats a deluxe edition as a different record', () => {
    const standard = makeAlbum('std', 2);
    const deluxe = makeAlbum('dlx', 4);
    const graph = new ContainmentGraph(
      [...standard.entities, ...deluxe.entities],
      [...standard.memberships, ...deluxe.memberships],
    );
    expect(albumTrackSet(graph, standard.album.id).trackIds).toHaveLength(2);
    expect(albumTrackSet(graph, deluxe.album.id).trackIds).toHaveLength(4);
  });
});

describe('evaluateAlbumCompletion', () => {
  it('refuses to declare a record finished when the track list is incomplete', () => {
    const { album, tracks, entities, memberships } = makeAlbum('partial', 3);
    const result = evaluate({
      entities,
      memberships: memberships.slice(0, 2),
      albumId: album.id,
      plays: [play(tracks[0]!, T0), play(tracks[1]!, T0 + HOUR)],
    });
    expect(result.completion).toBeNull();
    expect(result.refusal).toBe('track-list-incomplete');
    expect(result.heard).toBe(2);
  });

  it('completes on the play that supplies the final missing track', () => {
    const { album, tracks, entities, memberships } = makeAlbum('close', 3);
    const first = [play(tracks[0]!, T0), play(tracks[1]!, T0 + 3 * MINUTE)];
    const closing = play(tracks[2]!, T0 + 6 * MINUTE);

    const early = evaluate({ entities, memberships, albumId: album.id, plays: first });
    expect(early.completion).toBeNull();
    expect(early.refusal).toBe('not-complete');
    expect(early.heard).toBe(2);

    const result = evaluate({
      entities,
      memberships,
      albumId: album.id,
      plays: [...first, closing],
      newPlayIds: [closing.id],
    });
    expect(result.completion).not.toBeNull();
    expect(result.completion?.closingPlayId).toBe(closing.id);
    expect(result.completion?.endAt).toBe(closing.at);
    expect(result.completion?.startAt).toBe(T0);
    expect(result.completion?.trackCount).toBe(3);
    expect(result.completion?.playIds).toHaveLength(3);
    expect(result.completion?.ordinal).toBe(1);
    expect(result.completion?.prompt).toBe('open');
  });

  it('never fires on a recount of evidence that was already there', () => {
    const { album, tracks, entities, memberships } = makeAlbum('recount', 2);
    const plays = [play(tracks[0]!, T0), play(tracks[1]!, T0 + MINUTE)];
    const result = evaluate({
      entities,
      memberships,
      albumId: album.id,
      plays,
      newPlayIds: [],
    });
    expect(result.completion).toBeNull();
    expect(result.refusal).toBe('already-recorded');
  });

  it('is idempotent: re-running with the same evidence emits nothing new', () => {
    const { album, tracks, entities, memberships } = makeAlbum('idem', 2);
    const closing = play(tracks[1]!, T0 + MINUTE);
    const plays = [play(tracks[0]!, T0), closing];
    const first = evaluate({
      entities,
      memberships,
      albumId: album.id,
      plays,
      newPlayIds: [closing.id],
    });
    expect(first.completion).not.toBeNull();

    const again = evaluate({
      entities,
      memberships,
      albumId: album.id,
      plays,
      newPlayIds: [closing.id],
      existing: [first.completion!],
    });
    expect(again.completion).toBeNull();
  });

  it('will not complete from plays spread beyond the window', () => {
    const { album, tracks, entities, memberships } = makeAlbum('spread', 2);
    const old = play(tracks[0]!, T0);
    const late = play(tracks[1]!, T0 + 40 * DAY);
    const result = evaluate({
      entities,
      memberships,
      albumId: album.id,
      plays: [old, late],
      newPlayIds: [late.id],
    });
    expect(result.completion).toBeNull();
    expect(result.refusal).toBe('not-complete');
  });

  it('includes a play exactly on the window boundary and excludes one past it', () => {
    const { album, tracks, entities, memberships } = makeAlbum('edge', 2);
    const first = play(tracks[0]!, T0);

    const onEdge = play(tracks[1]!, T0 + WINDOW);
    expect(
      evaluate({
        entities,
        memberships,
        albumId: album.id,
        plays: [first, onEdge],
        newPlayIds: [onEdge.id],
      }).completion,
    ).not.toBeNull();

    const pastEdge = play(tracks[1]!, T0 + WINDOW + 1);
    expect(
      evaluate({
        entities,
        memberships,
        albumId: album.id,
        plays: [first, pastEdge],
        newPlayIds: [pastEdge.id],
      }).completion,
    ).toBeNull();
  });

  it('cites the latest play of each track, keeping the recorded span tight', () => {
    const { album, tracks, entities, memberships } = makeAlbum('tight', 2);
    const stale = play(tracks[0]!, T0);
    const fresh = play(tracks[0]!, T0 + 10 * DAY);
    const closing = play(tracks[1]!, T0 + 10 * DAY + MINUTE);
    const result = evaluate({
      entities,
      memberships,
      albumId: album.id,
      plays: [stale, fresh, closing],
      newPlayIds: [closing.id],
    });
    expect(result.completion?.startAt).toBe(fresh.at);
    expect(result.completion?.playIds).toContain(fresh.id);
    expect(result.completion?.playIds).not.toContain(stale.id);
  });

  it('does not require unavailable tracks to be heard', () => {
    const { album, tracks, memberships } = makeAlbum('gone', 3);
    const entities = [album, tracks[0]!, { ...tracks[1]!, available: false }, tracks[2]!];
    const closing = play(tracks[2]!, T0 + MINUTE);
    const result = evaluate({
      entities,
      memberships,
      albumId: album.id,
      plays: [play(tracks[0]!, T0), closing],
      newPlayIds: [closing.id],
    });
    expect(result.completion?.trackCount).toBe(2);
  });

  it('ignores deleted plays', () => {
    const { album, tracks, entities, memberships } = makeAlbum('tomb', 2);
    const closing = play(tracks[1]!, T0 + MINUTE);
    const result = evaluate({
      entities,
      memberships,
      albumId: album.id,
      plays: [{ ...play(tracks[0]!, T0), deleted: T0 + DAY }, closing],
      newPlayIds: [closing.id],
    });
    expect(result.completion).toBeNull();
  });

  describe('sittings', () => {
    it('marks a back-to-back listen from the album context as a sitting', () => {
      const { album, tracks, entities, memberships } = makeAlbum('sit', 3);
      const ctx = { contextType: 'album' as const, contextId: album.id };
      const closing = play(tracks[2]!, T0 + 2 * 200_000, ctx);
      const result = evaluate({
        entities,
        memberships,
        albumId: album.id,
        plays: [play(tracks[0]!, T0, ctx), play(tracks[1]!, T0 + 200_000, ctx), closing],
        newPlayIds: [closing.id],
      });
      expect(result.completion?.sitting).toBe(true);
    });

    it('is not a sitting when the plays are days apart', () => {
      const { album, tracks, entities, memberships } = makeAlbum('nosit', 2);
      const ctx = { contextType: 'album' as const, contextId: album.id };
      const closing = play(tracks[1]!, T0 + 3 * DAY, ctx);
      const result = evaluate({
        entities,
        memberships,
        albumId: album.id,
        plays: [play(tracks[0]!, T0, ctx), closing],
        newPlayIds: [closing.id],
      });
      expect(result.completion?.sitting).toBe(false);
    });

    it('is not a sitting when the app never saw an album context', () => {
      const { album, tracks, entities, memberships } = makeAlbum('noctx', 2);
      const closing = play(tracks[1]!, T0 + 200_000);
      const result = evaluate({
        entities,
        memberships,
        albumId: album.id,
        plays: [play(tracks[0]!, T0), closing],
        newPlayIds: [closing.id],
      });
      expect(result.completion?.sitting).toBe(false);
    });
  });

  describe('re-completion', () => {
    const build = () => makeAlbum('again', 2);

    const firstCompletion = (a: ReturnType<typeof build>): AlbumCompletion => {
      const closing = play(a.tracks[1]!, T0 + MINUTE);
      return evaluate({
        entities: a.entities,
        memberships: a.memberships,
        albumId: a.album.id,
        plays: [play(a.tracks[0]!, T0), closing],
        newPlayIds: [closing.id],
      }).completion!;
    };

    it('off: a record is only ever completed once', () => {
      const a = build();
      const previous = firstCompletion(a);
      const closing = play(a.tracks[1]!, T0 + 200 * DAY + MINUTE);
      const result = evaluate({
        entities: a.entities,
        memberships: a.memberships,
        albumId: a.album.id,
        plays: [play(a.tracks[0]!, T0 + 200 * DAY), closing],
        newPlayIds: [closing.id],
        existing: [previous],
        recompletion: 'off',
      });
      expect(result.completion).toBeNull();
      expect(result.refusal).toBe('recompletion-off');
    });

    it('fresh: a genuine second listen through completes again', () => {
      const a = build();
      const previous = firstCompletion(a);
      const closing = play(a.tracks[1]!, T0 + 200 * DAY + MINUTE);
      const result = evaluate({
        entities: a.entities,
        memberships: a.memberships,
        albumId: a.album.id,
        plays: [play(a.tracks[0]!, T0 + 200 * DAY), closing],
        newPlayIds: [closing.id],
        existing: [previous],
      });
      expect(result.completion?.ordinal).toBe(2);
      expect(result.completion?.startAt).toBeGreaterThan(previous.endAt);
    });

    it('fresh: replaying one track does not re-complete on the old evidence', () => {
      const a = build();
      const previous = firstCompletion(a);
      // Only track two is played again. Track one's only play predates the
      // previous completion, so this is not a second listen through.
      const closing = play(a.tracks[1]!, T0 + 2 * DAY);
      const result = evaluate({
        entities: a.entities,
        memberships: a.memberships,
        albumId: a.album.id,
        plays: [play(a.tracks[0]!, T0), play(a.tracks[1]!, T0 + MINUTE), closing],
        newPlayIds: [closing.id],
        existing: [previous],
      });
      expect(result.completion).toBeNull();
    });

    it('cooldown: a second listen too soon is held back', () => {
      const a = build();
      const previous = firstCompletion(a);
      const closing = play(a.tracks[1]!, T0 + 10 * DAY + MINUTE);
      const result = evaluate({
        entities: a.entities,
        memberships: a.memberships,
        albumId: a.album.id,
        plays: [play(a.tracks[0]!, T0 + 10 * DAY), closing],
        newPlayIds: [closing.id],
        existing: [previous],
        recompletion: 'cooldown',
        cooldownMs: 90 * DAY,
      });
      expect(result.completion).toBeNull();
      expect(result.refusal).toBe('within-cooldown');
    });

    it('cooldown: past the cooldown it completes again', () => {
      const a = build();
      const previous = firstCompletion(a);
      const closing = play(a.tracks[1]!, T0 + 120 * DAY + MINUTE);
      const result = evaluate({
        entities: a.entities,
        memberships: a.memberships,
        albumId: a.album.id,
        plays: [play(a.tracks[0]!, T0 + 120 * DAY), closing],
        newPlayIds: [closing.id],
        existing: [previous],
        recompletion: 'cooldown',
        cooldownMs: 90 * DAY,
      });
      expect(result.completion?.ordinal).toBe(2);
    });
  });

  it('stays fast across a long run of plays', () => {
    const { album, tracks, entities, memberships } = makeAlbum('many', 12);
    // Eleven tracks played over and over for a fortnight; the twelfth never
    // touched until the very end. The engine has to sweep the lot and still
    // only fire on the play that finally supplies it.
    const plays: PlayEvent[] = [];
    for (let i = 0; i < 20_000; i += 1) {
      plays.push(play(tracks[i % 11]!, T0 + i * MINUTE));
    }
    const closing = play(tracks[11]!, T0 + 20_000 * MINUTE);
    plays.push(closing);

    const started = performance.now();
    const result = evaluate({
      entities,
      memberships,
      albumId: album.id,
      plays,
      newPlayIds: [closing.id],
      now: T0 + 20_001 * MINUTE,
    });
    const elapsed = performance.now() - started;

    expect(result.completion?.closingPlayId).toBe(closing.id);
    expect(elapsed).toBeLessThan(250);
  });

  it('does not fire when the record was already finished earlier in the log', () => {
    const { album, tracks, entities, memberships } = makeAlbum('old-news', 3);
    const plays = [
      play(tracks[0]!, T0),
      play(tracks[1]!, T0 + MINUTE),
      play(tracks[2]!, T0 + 2 * MINUTE),
    ];
    const extra = play(tracks[0]!, T0 + 3 * MINUTE);
    const result = evaluate({
      entities,
      memberships,
      albumId: album.id,
      plays: [...plays, extra],
      newPlayIds: [extra.id],
    });
    expect(result.completion).toBeNull();
    expect(result.refusal).toBe('already-recorded');
  });
});
