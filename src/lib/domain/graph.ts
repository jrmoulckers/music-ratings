import type { Entity, EntityId, EntityType, Membership } from './types';

/**
 * The containment graph.
 *
 * A track can be reached through its album, through any number of playlists,
 * and through each credited artist. When a parent's score is rolled up, each
 * distinct descendant must contribute exactly once — otherwise a track that
 * happens to sit on a compilation as well as its album would count twice and
 * quietly skew the result.
 *
 * Combined duplicates are folded in here, once, for everybody. Given a
 * resolver, the graph holds one node per canonical group: alias records are
 * kept and remain reachable by their own id, but they no longer appear in any
 * listing, and every containment edge is re-pointed at the canonical id and
 * de-duplicated. That is what makes a combined remaster stop being a second row
 * in every list, a second candidate in every duel and a second child in every
 * rollup, without a single caller having to know that combining exists.
 */

/** All the graph needs of the canonical index: one id in, one id out. */
export interface CanonicalLookup {
  resolve(id: EntityId): EntityId;
}

export interface GraphEdge {
  parentId: EntityId;
  childId: EntityId;
  parentType: EntityType;
  childType: EntityType;
  position?: number;
  share: number;
}

export class ContainmentGraph {
  private readonly childrenOf = new Map<EntityId, GraphEdge[]>();
  private readonly parentsOf = new Map<EntityId, GraphEdge[]>();
  private readonly entities = new Map<EntityId, Entity>();
  /** Every live record by its own id, alias records included. */
  private readonly sources = new Map<EntityId, Entity>();
  /** Alias id → the canonical id it was folded into. */
  private readonly aliasTo = new Map<EntityId, EntityId>();
  /** Canonical id → every source record, primary first. */
  private readonly sourcesOfCanonical = new Map<EntityId, Entity[]>();
  /** Parent id → edges dropped because they landed on something already there. */
  private readonly folded = new Map<EntityId, number>();

  constructor(
    entities: readonly Entity[],
    memberships: readonly Membership[],
    canonical?: CanonicalLookup,
  ) {
    for (const e of entities) {
      if (e.deleted) continue;
      this.sources.set(e.id, e);
    }

    for (const e of this.sources.values()) {
      const canonicalId = canonical?.resolve(e.id) ?? e.id;
      const primary = canonicalId === e.id ? undefined : this.sources.get(canonicalId);
      // A group whose primary is not in the library (removed, or not synced
      // here yet) leaves its aliases standing on their own rather than
      // vanishing. Nothing is ever hidden because a pointer went stale.
      if (primary && primary.type === e.type) {
        this.aliasTo.set(e.id, canonicalId);
        continue;
      }
      this.entities.set(e.id, e);
    }

    for (const [aliasId, canonicalId] of this.aliasTo) {
      const alias = this.sources.get(aliasId);
      if (!alias) continue;
      const list = this.sourcesOfCanonical.get(canonicalId);
      if (list) list.push(alias);
      else {
        const primary = this.entities.get(canonicalId);
        this.sourcesOfCanonical.set(canonicalId, primary ? [primary, alias] : [alias]);
      }
    }
    for (const list of this.sourcesOfCanonical.values()) {
      const [primary, ...rest] = list;
      rest.sort((a, b) => (a.id < b.id ? -1 : 1));
      list.length = 0;
      if (primary) list.push(primary, ...rest);
    }

    const seen = new Set<string>();
    for (const m of memberships) {
      if (m.deleted) continue;
      const parentId = this.canonicalId(m.parentId);
      const childId = this.canonicalId(m.childId);
      if (!this.entities.has(parentId) || !this.entities.has(childId)) continue;
      // Two sources of the same record can carry the same link, and a track
      // combined with one of its own album's tracks would otherwise contain
      // itself. Both are counted and reported rather than silently dropped.
      if (parentId === childId || seen.has(`${parentId}|${childId}`)) {
        this.folded.set(parentId, (this.folded.get(parentId) ?? 0) + 1);
        continue;
      }
      seen.add(`${parentId}|${childId}`);
      const edge: GraphEdge = {
        parentId,
        childId,
        parentType: this.entities.get(parentId)?.type ?? m.parentType,
        childType: this.entities.get(childId)?.type ?? m.childType,
        share: m.share ?? 1,
      };
      if (m.position != null) edge.position = m.position;
      push(this.childrenOf, parentId, edge);
      push(this.parentsOf, childId, edge);
    }
  }

  /** The canonical id for any id, whether or not it is combined. */
  canonicalId(id: EntityId): EntityId {
    return this.aliasTo.get(id) ?? id;
  }

  /** The entity a caller means by this id: an alias resolves to its canonical. */
  entity(id: EntityId): Entity | undefined {
    return this.entities.get(id) ?? this.entities.get(this.canonicalId(id));
  }

  /** The record stored under exactly this id, alias or not. */
  source(id: EntityId): Entity | undefined {
    return this.sources.get(id);
  }

  /** Every source record behind an entity, primary first. One when uncombined. */
  sourcesOf(id: EntityId): Entity[] {
    const canonical = this.canonicalId(id);
    const list = this.sourcesOfCanonical.get(canonical);
    if (list) return [...list];
    const single = this.entities.get(canonical);
    return single ? [single] : [];
  }

  isCombined(id: EntityId): boolean {
    return this.sourcesOfCanonical.has(this.canonicalId(id));
  }

  /** How many containment links under this parent were folded into others. */
  foldedEdges(id: EntityId): number {
    return this.folded.get(this.canonicalId(id)) ?? 0;
  }

  has(id: EntityId): boolean {
    return this.entity(id) !== undefined;
  }

  allEntities(): Entity[] {
    return [...this.entities.values()];
  }

  entitiesOfType(type: EntityType): Entity[] {
    return this.allEntities().filter((e) => e.type === type);
  }

  /** Direct children, sorted by position then id so output is stable. */
  children(id: EntityId): GraphEdge[] {
    const edges = this.childrenOf.get(this.canonicalId(id)) ?? [];
    return [...edges].sort((a, b) => {
      const pa = a.position ?? Number.MAX_SAFE_INTEGER;
      const pb = b.position ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      return a.childId < b.childId ? -1 : a.childId > b.childId ? 1 : 0;
    });
  }

  parents(id: EntityId): GraphEdge[] {
    return this.parentsOf.get(this.canonicalId(id)) ?? [];
  }

  /** Direct children restricted to one type. */
  childrenOfType(id: EntityId, type: EntityType): GraphEdge[] {
    return this.children(id).filter((e) => e.childType === type);
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export interface DescendantHit {
  entityId: EntityId;
  entityType: EntityType;
  /** 1 for a direct child, 2 for a grandchild, and so on. */
  depth: number;
  /** Multiplied credit share along the path (multi-artist tracks split credit). */
  share: number;
  /** Human-readable path, e.g. `album → track`. */
  via: string;
  /** The direct child of the root this hit was counted under. Used for grouping. */
  groupId: EntityId;
}

export interface DescendantWalk {
  hits: DescendantHit[];
  /** Distinct entities that were reachable by more than one path. */
  duplicatePaths: number;
}

/**
 * Breadth-first walk from `rootId`.
 *
 * Breadth-first is load-bearing: the shallowest path wins, so a track that sits
 * on both an album and a compilation is counted once, under whichever release
 * is closest to the root, with ties broken deterministically by id. Every
 * suppressed path is counted and reported so the "Why this score?" label
 * can say exactly what was left out.
 */
export function walkDescendants(
  graph: ContainmentGraph,
  rootId: EntityId,
  options: { maxDepth?: number } = {},
): DescendantWalk {
  const maxDepth = options.maxDepth ?? 3;
  const claimed = new Map<EntityId, DescendantHit>();
  let duplicatePaths = 0;

  interface Frontier {
    edge: GraphEdge;
    depth: number;
    share: number;
    via: string;
    groupId: EntityId;
  }

  let frontier: Frontier[] = graph.children(rootId).map((edge) => ({
    edge,
    depth: 1,
    share: edge.share,
    via: `${edge.parentType} → ${edge.childType}`,
    groupId: edge.childId,
  }));

  const visitedRoots = new Set<EntityId>([rootId]);

  while (frontier.length > 0) {
    const next: Frontier[] = [];
    // Sort each level so shallow ties resolve identically on every device.
    frontier.sort((a, b) =>
      a.edge.childId < b.edge.childId ? -1 : a.edge.childId > b.edge.childId ? 1 : 0,
    );

    for (const item of frontier) {
      const id = item.edge.childId;
      if (id === rootId) continue;
      const existing = claimed.get(id);
      if (existing) {
        duplicatePaths += 1;
        continue;
      }
      claimed.set(id, {
        entityId: id,
        entityType: item.edge.childType,
        depth: item.depth,
        share: item.share,
        via: item.via,
        groupId: item.groupId,
      });

      if (item.depth < maxDepth && !visitedRoots.has(id)) {
        visitedRoots.add(id);
        for (const edge of graph.children(id)) {
          next.push({
            edge,
            depth: item.depth + 1,
            share: item.share * edge.share,
            via: `${item.via} → ${edge.childType}`,
            groupId: item.groupId,
          });
        }
      }
    }
    frontier = next;
  }

  return { hits: [...claimed.values()], duplicatePaths };
}
