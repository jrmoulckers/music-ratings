<script lang="ts">
  import { settings, updateSettings } from '../lib/app/state';
  import { href, route } from '../lib/app/router';
  import {
    browserPlayer,
    startBrowserPlayer,
    stopBrowserPlayer,
    unlockBrowserPlayer,
  } from '../lib/playback/sdk';
  import { playback, playbackTransfer, refreshDevices } from '../lib/playback/store';
  import type { PlaybackDevice } from '../lib/playback/types';
  import { describeAuthError } from '../lib/spotify/auth';
  import { connectSpotify, spotifySession } from '../lib/spotify/session';
  import Icon from '../lib/ui/Icon.svelte';
  import type { IconName } from '../lib/ui/icons';

  /**
   * Where the sound comes out.
   *
   * Spotify plays on one device at a time and this app is a remote control, so
   * the honest thing to show is Spotify's own list — including the devices it
   * will not take orders from — plus a way out when the list is empty.
   */

  interface Props {
    onchosen?: (() => void) | undefined;
  }

  let { onchosen }: Props = $props();

  let starting = $state(false);
  let notice = $state('');

  const devices = $derived($playback.devices);
  const demo = $derived($playback.source === 'demo');
  const activeId = $derived($playback.snapshot?.device?.id ?? null);
  /**
   * The sign-in cannot stream. True either because the stored scopes say so, or
   * because Spotify said so when the player tried — one sentence covers both,
   * and the way out of both is the same reconnect.
   */
  const needsStreaming = $derived(
    $spotifySession.missingStreamingScope || $browserPlayer.status === 'needs-permission',
  );

  function iconFor(device: PlaybackDevice): IconName {
    const type = device.type.toLowerCase();
    if (type.includes('speaker') || type.includes('cast') || type.includes('tv')) return 'speaker';
    if (type.includes('phone') || type.includes('tablet')) return 'phone';
    return 'device';
  }

  async function choose(device: PlaybackDevice) {
    if (!device.id || device.restricted) return;
    notice = '';
    await playbackTransfer(device.id, true);
    onchosen?.();
  }

  async function activateBrowser() {
    starting = true;
    notice = '';
    try {
      if (!$settings.browserPlayer) await updateSettings({ browserPlayer: true });
      const id = await startBrowserPlayer();
      if (!id) {
        // A missing permission explains itself, with its own way out, in the
        // panel below. Repeating it here would say the same thing twice.
        if ($browserPlayer.status !== 'needs-permission') {
          notice = $browserPlayer.error ?? 'This browser could not become a Spotify device.';
        }
        return;
      }
      await unlockBrowserPlayer();
      await playbackTransfer(id, true);
      onchosen?.();
    } finally {
      starting = false;
    }
  }

  /** Sign in again, now asking for `streaming`, and come back to this screen. */
  async function reconnect() {
    notice = '';
    try {
      await connectSpotify($route.path);
    } catch (error) {
      notice = describeAuthError(error);
    }
  }
</script>

<div class="picker stack">
  <div class="row row--between">
    <h3 class="head">Devices</h3>
    <button type="button" class="btn btn--small btn--quiet" onclick={() => void refreshDevices()}>
      Refresh
    </button>
  </div>

  {#if devices.length === 0}
    <p class="note">
      Spotify does not see any devices right now. Open Spotify on a phone, computer or speaker and
      refresh, or make this browser the device.
    </p>
  {:else}
    <ul class="picker__list">
      {#each devices as device (device.id ?? device.name)}
        {@const chosen = device.id !== null && device.id === activeId}
        <li class="entry picker__row" class:picker__row--on={chosen}>
          <Icon name={iconFor(device)} size={16} />
          <span class="picker__name">
            <span>{device.name}</span>
            <span class="note picker__meta">
              {device.type}{device.privateSession ? ' · private session' : ''}
              {#if device.restricted}
                · will not accept remote control
              {/if}
            </span>
          </span>
          {#if chosen}
            <span class="tag">Playing here</span>
          {:else}
            <button
              type="button"
              class="btn btn--small"
              disabled={device.restricted || !device.id || $playback.pending === 'transfer'}
              onclick={() => void choose(device)}
            >
              Play here
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if !demo}
    <div class="picker__browser stack">
      {#if $browserPlayer.status === 'ready'}
        <p class="note">This browser is a Spotify device. It stops when you close the tab.</p>
        <button type="button" class="btn btn--small btn--quiet" onclick={stopBrowserPlayer}>
          Stop using this browser
        </button>
      {:else if needsStreaming}
        <p class="note">
          Playing in this browser needs one more Spotify permission. Reconnect Spotify to grant it —
          your ratings and library are untouched.
        </p>
        <div class="row">
          <button type="button" class="btn btn--small" onclick={() => void reconnect()}>
            Reconnect Spotify
          </button>
          <a class="btn btn--small btn--quiet" href={href('/settings')}>Open Settings</a>
        </div>
      {:else}
        <p class="note">
          This browser can become a Spotify device. It needs Spotify Premium, and sound only starts
          after you press play here.
        </p>
        <button
          type="button"
          class="btn btn--small"
          disabled={starting}
          onclick={() => void activateBrowser()}
        >
          {starting ? 'Starting…' : 'Play in this browser'}
        </button>
      {/if}
    </div>
  {/if}

  {#if notice}
    <p class="note picker__notice" role="status">{notice}</p>
  {/if}
</div>

<style>
  .picker__list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .picker__row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--s3);
  }
  .picker__row--on {
    color: var(--ink);
  }

  .picker__name {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .picker__meta {
    font-size: 0.75rem;
  }

  .picker__browser {
    border-top: var(--rule-weight) solid var(--border-faint);
    padding-top: var(--s3);
    align-items: flex-start;
  }

  .picker__notice {
    color: var(--danger);
  }
</style>
