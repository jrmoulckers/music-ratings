<script lang="ts">
  import { rate } from '../lib/app/actions';
  import { scaleForType } from '../lib/app/state';
  import type { Entity, RatingContext } from '../lib/domain/types';
  import CompactRating from './CompactRating.svelte';

  /**
   * Rating an item from wherever it is listed.
   *
   * The control is shared with every other compact rating in the app; all this
   * adds is what a value means here — a rating for this item, written through
   * the same action the full editor uses, so the two can never disagree about
   * what you meant.
   */

  interface Props {
    entity: Entity;
    /** Current value, canonical 0..100. Null when never rated. */
    value: number | null;
    onafter?: (() => void) | undefined;
    disabled?: boolean;
    /** Recorded on the event so History can say where you were. */
    where?: RatingContext;
  }

  let { entity, value, onafter, disabled = false, where = 'bulk' }: Props = $props();

  const scale = $derived($scaleForType(entity.type));
  let busy = $state(false);

  async function commit(normalized: number) {
    if (busy || disabled) return;
    busy = true;
    try {
      await rate(entity, normalized, { context: where });
      onafter?.();
    } finally {
      busy = false;
    }
  }
</script>

<CompactRating
  {scale}
  {value}
  label="Rating for {entity.name}"
  subject="the rating for {entity.name}"
  disabled={disabled || busy}
  oncommit={(normalized) => void commit(normalized)}
/>
