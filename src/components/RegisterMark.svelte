<script lang="ts">
  /** The registration cross a press is aligned against. Purely structural. */
  interface Props {
    size?: number;
    class?: string;
  }

  let { size = 11, class: className = '' }: Props = $props();
</script>

<svg
  class="register-mark {className}"
  width={size}
  height={size}
  viewBox="0 0 11 11"
  fill="none"
  stroke="currentColor"
  stroke-width="1"
  shape-rendering="crispEdges"
  aria-hidden="true"
  focusable="false"
>
  <path d="M5.5 0v11M0 5.5h11" />
  <circle cx="5.5" cy="5.5" r="2.5" />
</svg>
