<script lang="ts">
  import { RANGE_SEPARATOR, type EquivalenceReading } from '../lib/domain/scales';
  import Icon from '../lib/ui/Icon.svelte';
  import { ICON_PATHS, type IconName } from '../lib/ui/icons';

  /**
   * One cell of the scale-equivalence table.
   *
   * A reading is either a position or a range between two, and either spelled
   * or drawn. Scales that draw their marks — thumbs — render the real glyph;
   * the cell keeps the words as its accessible name, so a reader who cannot see
   * the picture still hears "Down" rather than a shrug.
   */

  interface Props {
    reading: EquivalenceReading;
  }

  let { reading }: Props = $props();

  const icons = $derived(
    reading.ends
      .map((end) => end.icon)
      .filter((name): name is IconName => !!name && name in ICON_PATHS),
  );
  const drawn = $derived(icons.length === reading.ends.length);
</script>

{#if drawn}
  <span class="reading" role="img" aria-label={reading.label}>
    {#each icons as name, index (index)}
      {#if index > 0}
        <span class="reading__tie" aria-hidden="true">{RANGE_SEPARATOR.trim()}</span>
      {/if}
      <Icon {name} size={15} />
    {/each}
  </span>
{:else}
  {reading.label}
{/if}

<style>
  .reading {
    display: inline-flex;
    align-items: center;
    gap: var(--s2);
    vertical-align: middle;
  }
  .reading__tie {
    color: var(--ink-quiet);
  }
</style>
