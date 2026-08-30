import type { EntityId, EntityType, Provider } from './types';

/** Canonical key for an entity across providers. */
export function entityId(type: EntityType, provider: Provider, providerId: string): EntityId {
  return `${type}:${provider}:${providerId}`;
}

export interface ParsedEntityId {
  type: EntityType;
  provider: Provider;
  providerId: string;
}

export function parseEntityId(id: EntityId): ParsedEntityId | null {
  const first = id.indexOf(':');
  const second = id.indexOf(':', first + 1);
  if (first < 1 || second < 0) return null;
  const type = id.slice(0, first) as EntityType;
  const provider = id.slice(first + 1, second) as Provider;
  const providerId = id.slice(second + 1);
  if (!providerId) return null;
  return { type, provider, providerId };
}

export function membershipId(parentId: EntityId, childId: EntityId, position?: number): string {
  return position == null ? `${parentId}|${childId}` : `${parentId}|${childId}|${position}`;
}

let counter = 0;

/** Sortable, collision-resistant id. Not a UUID; it never leaves the device. */
export function uid(prefix = ''): string {
  counter = (counter + 1) % 0xffff;
  const time = Date.now().toString(36).padStart(9, '0');
  const rand =
    typeof crypto !== 'undefined' && 'getRandomValues' in crypto
      ? [...crypto.getRandomValues(new Uint8Array(6))]
          .map((b) => b.toString(36).padStart(2, '0'))
          .join('')
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}${time}${counter.toString(36).padStart(3, '0')}${rand}`;
}

/** Stable, order-independent hash used for deterministic tie-breaks. */
export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
