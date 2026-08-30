import type {
  Comparison,
  Entity,
  EntityId,
  EntityType,
  Membership,
  RatingConfidence,
  RatingEvent,
} from '../lib/domain/types';
import { entityId, membershipId } from '../lib/domain/ids';

/** Deterministic fixtures for domain tests. No randomness, no wall clock. */

export const T0 = Date.UTC(2025, 0, 1);

export function makeEntity(type: EntityType, id: string, overrides: Partial<Entity> = {}): Entity {
  const canonical = entityId(type, 'local', id);
  const base: Entity = {
    id: canonical,
    type,
    provider: 'local',
    providerId: id,
    name: overrides.name ?? id,
    provenance: { provider: 'local', via: 'test', fetchedAt: T0 },
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
  // `id` is derived, never overridden, so fixtures cannot drift from the key rule.
  base.id = canonical;
  return base;
}

export function link(
  parent: Entity,
  child: Entity,
  overrides: Partial<Membership> = {},
): Membership {
  return {
    id: membershipId(parent.id, child.id, overrides.position),
    parentId: parent.id,
    childId: child.id,
    parentType: parent.type,
    childType: child.type,
    updatedAt: T0,
    ...overrides,
  };
}

let ratingSeq = 0;

export function rate(
  entity: Entity | EntityId,
  normalized: number,
  overrides: Partial<RatingEvent> = {},
): RatingEvent {
  ratingSeq += 1;
  const id = typeof entity === 'string' ? entity : entity.id;
  const type =
    typeof entity === 'string' ? ((id.split(':')[0] ?? 'track') as EntityType) : entity.type;
  return {
    id: `r${String(ratingSeq).padStart(4, '0')}`,
    entityId: id,
    entityType: type,
    at: T0,
    value: normalized / 10,
    scaleId: 'int-10',
    normalized,
    confidence: 'medium' as RatingConfidence,
    updatedAt: T0,
    ...overrides,
  };
}

let comparisonSeq = 0;

export function compare(
  a: Entity | EntityId,
  b: Entity | EntityId,
  outcome: Comparison['outcome'],
  overrides: Partial<Comparison> = {},
): Comparison {
  comparisonSeq += 1;
  const aId = typeof a === 'string' ? a : a.id;
  const bId = typeof b === 'string' ? b : b.id;
  const type = (aId.split(':')[0] ?? 'track') as EntityType;
  return {
    id: `c${String(comparisonSeq).padStart(4, '0')}`,
    entityType: type,
    aId,
    bId,
    outcome,
    at: T0 + comparisonSeq * 1000,
    updatedAt: T0,
    ...overrides,
  };
}

export function resetFixtureCounters(): void {
  ratingSeq = 0;
  comparisonSeq = 0;
}
