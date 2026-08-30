import type { Entity, EntityId, EntityType, Membership } from './types';

/**
 * The containment graph.
 *
 * A track can be reached through its album, through any number of playlists,
 * and through each credited artist. When a parent's score is rolled up, each
 * distinct descendant must contribute exactly once — otherwise a track that
 * happens to sit on a compilation as well as its album would count twice and
 * quietly skew the result.
 */

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

  constructor(entities: readonly Entity[], memberships: readonly Membership[]) {
    for (const e of entities) {
      if (e.deleted) continue;
      this.entities.set(e.id, e);
    }
    for (const m of memberships) {
      if (m.deleted) continue;
      if (!this.entities.has(m.parentId) || !this.entities.has(m.childId)) continue;
      const edge: GraphEdge = {
        parentId: m.parentId,
        childId: m.childId,
        parentType: m.parentType,
        childType: m.childType,
        share: m.share ?? 1,
      };
      if (m.position != null) edge.position = m.position;
      push(this.childrenOf, m.parentId, edge);
      push(this.parentsOf, m.childId, edge);
    }
  }

  entity(id: EntityId): Entity | undefined {
    return this.entities.get(id);
  }

  has(id: EntityId): boolean {
    return this.entities.has(id);
  }

  allEntities(): Entity[] {
    return [...this.entities.values()];
  }

  entitiesOfType(type: EntityType): Entity[] {
    return this.allEntities().filter((e) => e.type === type);
  }

  /** Direct children, sorted by position then id so output is stable. */
  children(id: EntityId): GraphEdge[] {
    const edges = this.childrenOf.get(id) ?? [];
    return [...edges].sort((a, b) => {
      const pa = a.position ?? Number.MAX_SAFE_INTEGER;
      const pb = b.position ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      return a.childId < b.childId ? -1 : a.childId > b.childId ? 1 : 0;
    });
  }

  parents(id: EntityId): GraphEdge[] {
    return this.parentsOf.get(id) ?? [];
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
