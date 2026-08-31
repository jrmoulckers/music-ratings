import type { EntityType } from '../domain/types';
import type { IconName } from './icons';

/**
 * The mark for each kind of thing.
 *
 * Keyed by `EntityType` so a new kind cannot be added to the domain without
 * something in the interface to draw it. Kept out of the component so the
 * mapping can be checked against the icon set without mounting anything.
 */
export const ENTITY_TYPE_ICONS: Record<EntityType, IconName> = {
  artist: 'artist',
  album: 'album',
  track: 'track',
  playlist: 'playlist',
  show: 'show',
  episode: 'episode',
  audiobook: 'audiobook',
  chapter: 'chapter',
};
