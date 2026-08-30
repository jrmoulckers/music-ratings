<script lang="ts">
  import { onMount } from 'svelte';

  import { navigate } from '../lib/app/router';
  import { loadAll, settings, updateSettings } from '../lib/app/state';
  import { completeSignIn, describeAuthError } from '../lib/spotify/auth';
  import { refreshSpotifySession, runImport, spotifyConfig } from '../lib/spotify/session';
  import { completeRedirect } from '../lib/storage/onedrive';
  import { oneDriveConfig, startSyncIfEnabled } from '../lib/app/sync';

  /**
   * The landing strip after an OAuth round trip.
   *
   * Both providers come back here. Whichever one it was, the user should end up
   * where they started with something useful having happened.
   */

  let message = $state('Finishing the connection…');
  let failed = $state(false);

  onMount(() => {
    void (async () => {
      try {
        const spotify = await completeSignIn(spotifyConfig());
        if (spotify) {
          refreshSpotifySession();
          await updateSettings({ onboarded: true });
          message = 'Connected. Reading your library…';
          navigate(spotify.returnTo, { replace: true });
          void runImport();
          return;
        }

        const account = await completeRedirect(oneDriveConfig());
        if (account) {
          await updateSettings({ syncEnabled: true });
          await startSyncIfEnabled();
          message = 'OneDrive connected.';
          navigate('/settings', { replace: true });
          return;
        }

        // Neither provider left anything to finish: a refresh, or a stale tab.
        await loadAll();
        navigate($settings.onboarded ? '/' : '/start', { replace: true });
      } catch (error) {
        failed = true;
        message = describeAuthError(error);
      }
    })();
  });
</script>

<div class="landing">
  <p class="landing__text" class:is-failed={failed}>{message}</p>
  {#if failed}
    <div class="row">
      <button type="button" class="btn btn--primary" onclick={() => navigate('/settings')}>
        Back to settings
      </button>
      <button type="button" class="btn btn--quiet" onclick={() => navigate('/')}>
        Carry on without it
      </button>
    </div>
  {/if}
</div>

<style>
  .landing {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s4);
    padding: var(--s5);
    text-align: center;
  }
  .landing__text {
    font-family: var(--display);
    font-size: 1.125rem;
    max-width: 44ch;
    line-height: 1.5;
  }
  .landing__text.is-failed {
    color: var(--accent-ink);
  }
</style>
