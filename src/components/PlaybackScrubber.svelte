<script lang="ts">
  import { allows } from '../lib/playback/model';
  import { playback, playbackProgress, playbackSeek } from '../lib/playback/store';
  import { clockTime } from '../lib/ui/format';

  /**
   * The scrubber.
   *
   * There is one of these in the app, in the bar along the bottom, because a
   * second one would be a second answer to "where am I in this track" and the
   * two would disagree the moment a poll landed between them.
   *
   * The rail moves with the finger; the seek is sent when the finger lets go.
   * A drag is a hundred input events and not one of them is a request to jump
   * the music, so the display follows every event and the transport hears
   * exactly one — on release, on keypress, or not at all if the drag is
   * abandoned. A poll cannot overwrite the value under a finger still holding
   * it.
   */

  interface Props {
    /** Hidden from view but still operable, for a bar that has no room. */
    compact?: boolean;
  }

  let { compact = false }: Props = $props();

  const snapshot = $derived($playback.snapshot);
  const duration = $derived(snapshot?.durationMs ?? 0);
  const elapsed = $derived($playbackProgress);

  let dragging = $state(false);
  let dragged = $state(0);
  const position = $derived(dragging ? dragged : elapsed);
  const fraction = $derived(duration > 0 ? position / duration : 0);

  /** A keyboard nudge is a distance a person can reason about, not a detent. */
  const NUDGE_MS = 5_000;
  const LEAP_MS = 30_000;

  function scrub(event: Event) {
    dragged = Number((event.currentTarget as HTMLInputElement).value);
    dragging = true;
  }

  function commitScrub() {
    if (!dragging) return;
    dragging = false;
    playbackSeek(dragged);
  }

  /** Abandoning a drag puts the thumb back where the music actually is. */
  function cancelScrub() {
    dragging = false;
  }

  function scrubKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      cancelScrub();
      return;
    }
    const from = dragging ? dragged : elapsed;
    let to: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') to = from + NUDGE_MS;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') to = from - NUDGE_MS;
    else if (event.key === 'PageUp') to = from + LEAP_MS;
    else if (event.key === 'PageDown') to = from - LEAP_MS;
    else if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = duration;
    if (to === null) return;
    // The browser's own arrow handling would move by the drag step, which is
    // deliberately far too small to be a useful keystroke.
    event.preventDefault();
    dragged = Math.max(0, Math.min(duration, Math.round(to)));
    dragging = true;
    // Held keys repeat; the transport coalesces them into one seek.
    commitScrub();
  }
</script>

<div class="scrub" class:scrub--compact={compact}>
  <input
    class="slider slider--played scrub__rail"
    type="range"
    min="0"
    max={Math.max(1, duration)}
    step="100"
    value={position}
    style="--played: {fraction}"
    disabled={!allows(snapshot, 'seek')}
    aria-label="Position in track. Arrow keys move five seconds, Page keys thirty."
    aria-valuetext="{clockTime(position)} of {clockTime(duration)}"
    oninput={scrub}
    onchange={commitScrub}
    onkeydown={scrubKey}
    onpointercancel={cancelScrub}
    onblur={commitScrub}
  />
  <div class="scrub__times mono">
    <span>{clockTime(position)}</span>
    <span>−{clockTime(Math.max(0, duration - position))}</span>
  </div>
</div>

<style>
  .scrub {
    display: grid;
    gap: var(--s1);
    min-width: 0;
  }

  .scrub__times {
    display: flex;
    justify-content: space-between;
    font-size: var(--t-small);
    color: var(--ink-quiet);
    font-variant-numeric: tabular-nums;
  }

  /*
   * In the bar the rail is the whole instrument and the clock is a caption on
   * it, so the two collapse onto one line and the numbers stop competing with
   * the track's name.
   */
  .scrub--compact {
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--s2);
  }
  .scrub--compact .scrub__rail {
    grid-column: 2;
    grid-row: 1;
  }
  .scrub--compact .scrub__times {
    display: contents;
  }
  .scrub--compact .scrub__times span:first-child {
    grid-column: 1;
  }
  .scrub--compact .scrub__times span:last-child {
    grid-column: 3;
  }
</style>
