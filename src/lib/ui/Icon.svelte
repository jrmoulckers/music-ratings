<script lang="ts">
  import { ICON_PATHS, type IconName } from './icons';

  interface Props {
    name: IconName;
    size?: number;
    /** Required when the icon is the only content of a control. */
    label?: string;
    class?: string;
  }

  let { name, size = 16, label, class: className = '' }: Props = $props();
</script>

<svg
  class="icon {className}"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.35"
  stroke-linecap="square"
  stroke-linejoin="miter"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
  focusable="false"
>
  <path d={ICON_PATHS[name]} />
</svg>

<style>
  .icon {
    flex: none;
    display: block;
  }
</style>
