<script lang="ts">
  import { entityLabelCap } from '../lib/app/state';
  import type { EntityType } from '../lib/domain/types';
  import { ENTITY_TYPE_ICONS } from '../lib/ui/entity-icons';
  import Icon from '../lib/ui/Icon.svelte';

  /**
   * The mark for a kind of thing.
   *
   * Every list in the app mixes kinds, and a row that only says "Rain Ledger"
   * makes you read the subtitle to find out whether you are looking at a
   * release or the track inside it. One silhouette answers that before the
   * type word does — and where the word is already on screen, the icon steps
   * back to decoration so a screen reader is not told twice.
   */

  interface Props {
    type: EntityType;
    size?: number;
    /**
     * Set when the kind is not written out beside the icon, so the icon has to
     * carry the name itself.
     */
    labelled?: boolean;
    class?: string;
  }

  let { type, size = 15, labelled = false, class: className = '' }: Props = $props();
</script>

<Icon
  name={ENTITY_TYPE_ICONS[type]}
  {size}
  class="type-icon {className}"
  label={labelled ? entityLabelCap(type) : undefined}
/>
