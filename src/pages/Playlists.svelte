<script lang="ts">
  import { onMount } from 'svelte';

  import { href } from '../lib/app/router';
  import { explicitRatings, graph, scores, settings } from '../lib/app/state';
  import { PLAYLIST_SIZES, rankedPlaylist, type PlaylistSize } from '../lib/domain/playlists';
  import { SCORE_VIEW_LABEL } from '../lib/domain/ratings';
  import { SCORE_VIEWS, type ScoreView } from '../lib/domain/types';
  import { PLAYLIST_WRITE_SCOPE } from '../lib/spotify/auth';
  import { syncState } from '../lib/storage/autosync';
  import {
    loadManagedPlaylists,
    managedPlaylists,
    playlistBusy,
    playlistStorageError,
    publishRankedPlaylist,
    setPlaylistLive,
    updateRankedPlaylist,
  } from '../lib/spotify/ranked-playlists';
  import {
    connectSpotifyPlaylists,
    spotifyAccountId,
    spotifySession,
  } from '../lib/spotify/session';
  import { dateAndTime } from '../lib/ui/format';

  let size = $state<PlaylistSize>(25);
  let view = $state<ScoreView>('explicit');
  let error = $state<string | null>(null);
  let message = $state('');
  let working = $state(false);
  let loading = $state(true);
  const uid = $props.id();
  const allowed = $derived($spotifySession.scopes.includes(PLAYLIST_WRITE_SCOPE));
  const entries = $derived(
    $managedPlaylists.filter(
      (entry) => $spotifySession.connected && entry.accountId === spotifyAccountId(),
    ),
  );
  const existing = $derived(entries.find((entry) => entry.size === size && entry.view === view));
  const preview = $derived(
    rankedPlaylist({ graph: $graph, scores: $scores, explicit: $explicitRatings }, size, view),
  );

  onMount(() => {
    void loadManagedPlaylists()
      .catch((failure: unknown) => {
        error = failure instanceof Error ? failure.message : String(failure);
      })
      .finally(() => {
        loading = false;
      });
  });

  async function act(run: () => Promise<unknown>, success = '') {
    working = true;
    error = null;
    message = '';
    try {
      await run();
      message = success;
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      working = false;
    }
  }
</script>

<div class="sheet playlists">
  <header class="head">
    <h1 class="display">Playlists</h1>
  </header>
  <div class="page-content">
    <section class="create stack" aria-labelledby="{uid}-create">
      <div class="stack stack--tight">
        <h2 id="{uid}-create" class="title">Create a Spotify playlist</h2>
        <p class="note">
          Your highest-rated songs, best first. Create once; keep the same playlist as your ratings
          change.
        </p>
      </div>
      <div class="create-controls">
        <label class="field">
          <span class="label">Songs</span>
          <select class="select" bind:value={size} disabled={loading || working || $playlistBusy}>
            {#each PLAYLIST_SIZES as option (option)}
              <option value={option}>Top {option}</option>
            {/each}
          </select>
        </label>
        {#if !$spotifySession.connected || !allowed}
          <button
            type="button"
            class="btn btn--primary"
            disabled={loading || working || $playlistBusy}
            onclick={() => void act(connectSpotifyPlaylists)}
          >
            Connect Spotify
          </button>
        {:else}
          <button
            type="button"
            class="btn btn--primary"
            disabled={loading ||
              working ||
              $playlistBusy ||
              !!$playlistStorageError ||
              (!existing && preview.rows.length === 0)}
            onclick={() =>
              void act(
                () => publishRankedPlaylist(size, view, existing?.live ?? true),
                `Top ${size} saved with ${preview.rows.length} songs.`,
              )}
          >
            {working || $playlistBusy
              ? 'Saving…'
              : existing
                ? 'Update playlist'
                : 'Create playlist'}
          </button>
        {/if}
      </div>
      <p class="note note--small">
        {preview.rows.length} of {size} songs ready · Private playlist
        {#if preview.excluded > 0}
          · {preview.excluded} local-only or unavailable tracks excluded
        {/if}
      </p>
      {#if !$spotifySession.connected || !allowed}
        <p class="note note--small">
          Allow playlist access to continue. Nothing is created until you choose Create playlist.
        </p>
      {/if}
      <div class="options">
        <details class="advanced">
          <summary class="note">Scoring options{view !== 'explicit' ? ' · custom' : ''}</summary>
          <label class="field">
            <span class="label">Order songs by</span>
            <select class="select" bind:value={view} disabled={loading || working || $playlistBusy}>
              {#each SCORE_VIEWS as option (option)}
                <option value={option}>{SCORE_VIEW_LABEL[option]}</option>
              {/each}
            </select>
          </label>
          <p class="note note--small">
            Uses your direct song ratings unless you choose another score here.
          </p>
        </details>
        {#if preview.rows.length > 0}
          <details class="song-preview">
            <summary class="note">Preview songs</summary>
            <ol class="preview">
              {#each preview.rows as row (row.entityId)}
                <li>
                  <span>{row.name}</span>
                  {#if row.subtitle}<span class="note note--small"> — {row.subtitle}</span>{/if}
                </li>
              {/each}
            </ol>
          </details>
        {/if}
      </div>
      {#if error || $playlistStorageError}
        <p class="note" role="alert">{error ?? $playlistStorageError}</p>
      {/if}
      {#if message}<p class="note" role="status">{message}</p>{/if}
    </section>
    <section class="saved stack" aria-labelledby="{uid}-saved">
      <div class="row row--between">
        <h2 id="{uid}-saved" class="title">Your playlists</h2>
        {#if entries.length > 0}<span class="note note--small">{entries.length} managed</span>{/if}
      </div>
      {#if loading}
        <p class="note" role="status">Loading your playlists…</p>
      {:else if entries.length > 0}
        <ul class="managed">
          {#each entries as entry (entry.id)}
            <li>
              <div class="playlist-info stack stack--tight">
                <a
                  href="https://open.spotify.com/playlist/{encodeURIComponent(entry.id)}"
                  target="_blank"
                  rel="noreferrer noopener"
                  data-external>Top {entry.size} songs</a
                >
                <p class="note note--small">
                  {SCORE_VIEW_LABEL[entry.view]} · {entry.error
                    ? 'Needs attention'
                    : entry.live
                      ? 'Automatic updates'
                      : 'Manual updates'}
                </p>
                <p class="note note--small">
                  {entry.syncedAt
                    ? `${entry.lastUris.length} songs · Updated ${dateAndTime(entry.syncedAt)}`
                    : 'Waiting for first update'}
                </p>
              </div>
              <div class="playlist-actions">
                <label class="check" for="{uid}-{entry.id}">
                  <input
                    id="{uid}-{entry.id}"
                    type="checkbox"
                    checked={entry.live}
                    disabled={working || $playlistBusy}
                    onchange={(event) => {
                      const checked = event.currentTarget.checked;
                      void act(() => setPlaylistLive(entry.id, checked));
                    }}
                  />
                  <span>Sync with ratings</span>
                </label>
                <button
                  type="button"
                  class="btn btn--small"
                  disabled={working || $playlistBusy || !allowed}
                  onclick={() =>
                    void act(() => updateRankedPlaylist(entry.id), `Top ${entry.size} updated.`)}
                  >{entry.error ? 'Retry update' : 'Update now'}</button
                >
              </div>
              {#if entry.error}
                <p class="note playlist-error" role="alert">
                  {entry.live ? 'Automatic updates paused.' : 'Update failed.'}
                  {entry.error}
                </p>
              {/if}
            </li>
          {/each}
        </ul>
      {:else if !$spotifySession.connected}
        <p class="note">
          Connect the Spotify account that owns your playlists to manage them here.
        </p>
      {:else if !error && !$playlistStorageError}
        <p class="note">No playlists yet. Choose a size above to create your first.</p>
      {/if}
    </section>
    <aside class="backup stack stack--tight" aria-label="Playlist backup">
      <p class="note note--small">
        {#if !$settings.syncEnabled || $syncState.status === 'off'}
          Library backup not connected. <a href={href('/settings')}>Set up library backup</a>
        {:else if $syncState.status === 'synced'}
          Library backed up{#if $syncState.lastSyncedAt}
            · {dateAndTime($syncState.lastSyncedAt)}{/if}
        {:else}
          Library backup: {$syncState.message} <a href={href('/settings')}>Manage backup</a>
        {/if}
      </p>
      <p class="note note--small">
        Playlist connections travel with your library backup. Spotify sign-in stays on each device.
      </p>
    </aside>
    <details class="how-it-works">
      <summary class="note">How ongoing updates work</summary>
      <div class="stack stack--tight">
        <p class="note note--small">
          Your playlist stays in Spotify between sessions. With Sync with ratings enabled, changes
          are sent automatically when you rate, reopen the app, or sync your library. Reconnect the
          same Spotify account if asked; the existing playlist is reused.
        </p>
        <p class="note note--small">
          Updates need an open app and internet access; there is no closed-app background service.
          Updating replaces the playlist’s contents, including edits made in Spotify. Equal scores
          keep a stable order.
        </p>
      </div>
    </details>
  </div>
</div>

<style>
  .playlists {
    max-width: 64rem;
  }
  .page-content {
    display: grid;
    gap: var(--s7);
    max-width: 48rem;
  }
  .create-controls {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s3);
    align-items: flex-end;
  }
  .create-controls .field {
    width: 12rem;
  }
  .create-controls .btn {
    min-width: 10rem;
  }
  .options {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 0 var(--s6);
  }
  .options details[open] {
    flex-basis: 100%;
  }
  .advanced .field {
    margin-block: var(--s3);
  }
  .advanced .field {
    max-width: 22rem;
  }
  .playlists summary {
    cursor: pointer;
    padding-block: var(--s2);
    min-height: var(--target-min);
  }
  .saved {
    padding-top: var(--s6);
    border-top: var(--rule-weight) solid var(--border);
  }
  .preview {
    list-style: decimal;
    padding-left: var(--s5);
    max-height: 18rem;
    overflow: auto;
    overflow-wrap: anywhere;
  }
  .preview li {
    padding-block: var(--s1);
    padding-left: var(--s1);
  }
  .managed {
    min-width: 0;
  }
  .managed li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--s3) var(--s5);
    align-items: center;
    padding-block: var(--s4);
  }
  .managed li + li {
    border-top: var(--rule-weight) solid var(--border);
  }
  .playlist-info {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .playlist-info > a {
    font-weight: 600;
    width: fit-content;
  }
  .playlist-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--s3);
  }
  .playlist-error {
    grid-column: 1 / -1;
  }
  .backup {
    border-top: var(--rule-weight) solid var(--border);
    padding-top: var(--s4);
  }
  .how-it-works {
    margin-top: calc(-1 * var(--s4));
  }
  @media (max-width: 40rem) {
    .create-controls .field {
      flex: 1;
      min-width: 8rem;
    }
    .create-controls .select,
    .create-controls .btn,
    .playlist-actions .btn,
    .playlist-actions .check {
      min-height: var(--target-min);
    }
    .managed li {
      grid-template-columns: minmax(0, 1fr);
    }
    .playlist-actions {
      justify-content: flex-start;
    }
  }
  @media (max-width: 24rem) {
    .create-controls .field,
    .create-controls .btn {
      width: 100%;
    }
  }
</style>
