import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Playlists from '../pages/Playlists.svelte';
import { settings, world } from '../lib/app/state';
import { storeTokens } from '../lib/spotify/auth';
import * as playlists from '../lib/spotify/ranked-playlists';
import { refreshSpotifySession, requestedScopes } from '../lib/spotify/session';
import { db } from '../lib/storage/db';
import { syncState } from '../lib/storage/autosync';
import { defaultSettings } from '../lib/storage/settings';
import { makeEntity, rate } from './fixtures';

let host: HTMLDivElement;
let component: ReturnType<typeof mount>;

beforeEach(async () => {
  const database = await db();
  await database.clear('spotifyPlaylists');
  playlists.managedPlaylists.set([]);
  playlists.playlistBusy.set(false);
  playlists.playlistStorageError.set(null);
  settings.set({ ...defaultSettings(), scoreView: 'explicit' });
  syncState.update((current) => ({ ...current, status: 'off', lastSyncedAt: null }));
  const entities = Array.from({ length: 15 }, (_, i) =>
    makeEntity('track', `song${i}`, { provider: 'spotify', providerId: `song${i}` }),
  );
  world.update((current) => ({
    ...current,
    entities,
    ratings: entities.map((entity, i) => rate(entity, 100 - i)),
  }));
  localStorage.clear();
  refreshSpotifySession();
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(async () => {
  if (component) await unmount(component);
  host.remove();
  vi.restoreAllMocks();
  localStorage.clear();
  refreshSpotifySession();
});

function render() {
  component = mount(Playlists, { target: host });
  flushSync();
}

describe('ranked playlist controls', () => {
  it('is a dedicated page with creation visible and scoring choices optional', () => {
    settings.update((current) => ({ ...current, scoreView: 'blended' }));
    render();
    expect(host.querySelector('h1')?.textContent).toBe('Playlists');
    expect(host.querySelector('h2')?.textContent).toBe('Create a Spotify playlist');
    expect(host.querySelector('.advanced')?.hasAttribute('open')).toBe(false);
    expect(host.querySelectorAll('select')[1]?.value).toBe('explicit');
    expect(host.textContent).not.toContain('filters on this page');
  });
  it('offers the six requested sizes and an honest shorter-list preview without creating anything', () => {
    const publish = vi.spyOn(playlists, 'publishRankedPlaylist');
    render();
    const sizes = host.querySelector('select')!;
    expect([...sizes.options].map((option) => option.textContent)).toEqual([
      'Top 10',
      'Top 25',
      'Top 50',
      'Top 100',
      'Top 250',
      'Top 500',
    ]);
    expect(host.textContent).toContain('15 of 25 songs ready');
    expect(host.textContent).toContain('Connect Spotify');
    expect(host.textContent).toContain('Library backup not connected');
    expect(host.querySelector('input[type=checkbox]')).toBeNull();
    expect(publish).not.toHaveBeenCalled();
    expect(requestedScopes()).not.toContain('playlist-modify-private');
  });

  it('creates only on an explicit click, with ongoing updates enabled by default', async () => {
    storeTokens({
      accessToken: 'test',
      refreshToken: 'test',
      expiresAt: Date.now() + 60_000,
      scopes: ['playlist-modify-private'],
    });
    localStorage.setItem('music-ratings.spotify.profile-id', 'owner');
    refreshSpotifySession();
    const publish = vi.spyOn(playlists, 'publishRankedPlaylist').mockResolvedValue({
      id: 'created',
      accountId: 'owner',
      size: 500,
      view: 'explicit',
      live: true,
      lastUris: [],
      syncedAt: 1,
      error: null,
      updatedAt: 1,
    });
    render();
    const sizes = host.querySelector('select')!;
    sizes.value = '500';
    sizes.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(publish).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(host.querySelector('button')!.disabled).toBe(false));
    host.querySelector('button')!.click();
    await vi.waitFor(() => expect(publish).toHaveBeenCalledWith(500, 'explicit', true));
    await vi.waitFor(() =>
      expect(host.querySelector('[role=status]')?.textContent).toContain('15 songs'),
    );
  });

  it('shows restored playlists, preserves manual mode and distinguishes backup from Spotify sync', async () => {
    storeTokens({
      accessToken: 'test',
      refreshToken: 'test',
      expiresAt: Date.now() + 60_000,
      scopes: ['playlist-modify-private'],
    });
    localStorage.setItem('music-ratings.spotify.profile-id', 'owner');
    refreshSpotifySession();
    const saved: playlists.ManagedPlaylist = {
      id: 'saved',
      accountId: 'owner',
      size: 25,
      view: 'explicit',
      live: false,
      lastUris: ['spotify:track:song0'],
      syncedAt: 1,
      error: null,
      updatedAt: 1,
    };
    await (await db()).put('spotifyPlaylists', saved);
    const publish = vi.spyOn(playlists, 'publishRankedPlaylist').mockResolvedValue(saved);
    settings.update((current) => ({ ...current, syncEnabled: true }));
    syncState.update((current) => ({
      ...current,
      status: 'pending',
      message: 'Changes waiting to sync.',
    }));
    render();
    await vi.waitFor(() => expect(host.textContent).toContain('Manual updates'));
    expect(host.textContent).not.toContain('Library backed up');
    expect(host.textContent).toContain('Changes waiting to sync.');
    expect(host.querySelector<HTMLAnchorElement>('.managed a')?.href).toBe(
      'https://open.spotify.com/playlist/saved',
    );
    host.querySelector('button')!.click();
    await vi.waitFor(() => expect(publish).toHaveBeenCalledWith(25, 'explicit', false));
  });
});
